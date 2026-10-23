const CACHE_NAME = 'growth-checkin-v111';
const APP_SHELL = [
  './',
  './index.html',
  './main.js',
  './assets/app.css',
  './questions.json',
  './recovery.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

// 不同资源的网络超时配置
const TIMEOUT = {
  navigate: 15000,   // 导航绝不能因为"慢"就返回错误页
  static: 3000,      // CSS/JS/图片：缓存优先，网络只用于后台更新
  data: 5000,        // JSON 数据：允许稍长一点
  default: 6000
};

// 解析成绝对地址，避免 new Request 的相对路径基准不确定
function absUrl(path) {
  try { return new URL(path, self.location.href).href; } catch (e) { return path; }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.all(APP_SHELL.map(path =>
        cache.add(new Request(absUrl(path), { cache: 'reload' }))
          .catch(err => { console.warn('预缓存失败:', path, err); return null; })
      )))
      .then(() => caches.open(CACHE_NAME))
      .then(cache => cache.match(absUrl('./index.html')).then(r => r || cache.match(absUrl('./'))))
      .then(critical => {
        if (!critical) {
          console.warn('关键资源未缓存成功，放弃本次更新，继续使用当前版本');
          return;
        }
        // 强制立即激活，不要等用户关闭页面
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(allKeys => Promise.all(
        allKeys
          .filter(key => key.indexOf('growth-checkin-') === 0 && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('network timeout')), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); }
    );
  });
}

function cacheKeysNewestFirst(keys) {
  const num = k => {
    const m = /growth-checkin-v(\d+)/.exec(k);
    return m ? parseInt(m[1], 10) : 0;
  };
  return keys.filter(k => k.indexOf('growth-checkin-') === 0).sort((a, b) => num(b) - num(a));
}

async function matchAnyCache(request, ignoreSearch) {
  let keys = [];
  try { keys = cacheKeysNewestFirst(await caches.keys()); } catch (e) { return null; }
  for (const key of keys) {
    try {
      const hit = await caches.match(request, { cacheName: key, ignoreSearch: !!ignoreSearch });
      if (hit) return hit;
    } catch (e) {}
  }
  return null;
}

// 后台静默更新缓存（不阻塞响应）
function backgroundUpdate(request, response) {
  if (!response || response.status !== 200) return;
  const copy = response.clone();
  caches.open(CACHE_NAME)
    .then(cache => cache.put(request, copy))
    .catch(err => console.warn('后台缓存更新失败:', err));
}

// ========== 按资源类型的精细化策略 ==========

// 1. 导航请求 / HTML → Network First（保证最新）
async function handleNavigate(request) {
  const cached = await matchAnyCache(request, true);
  try {
    const networkRes = await withTimeout(fetch(request), TIMEOUT.navigate);
    if (networkRes && networkRes.ok) {
      backgroundUpdate(request, networkRes);
      return networkRes;
    }
  } catch (e) {}
  // 网络失败 → 回退缓存 → 最后给错误页
  const shell = cached || await matchAnyCache(new Request(absUrl('./index.html')), false);
  return shell || Response.error();
}

// 2. 静态资源（JS/CSS/图片/字体）→ Cache First（快，后台更新）
async function handleStatic(request) {
  const cached = await matchAnyCache(request, false);
  if (cached) {
    // 有缓存先返回，同时后台检查更新
    fetch(request).then(backgroundUpdate.bind(null, request)).catch(() => {});
    return cached;
  }
  // 没缓存 → 等网络
  try {
    const networkRes = await withTimeout(fetch(request), TIMEOUT.static);
    if (networkRes && networkRes.ok) {
      backgroundUpdate(request, networkRes);
      return networkRes;
    }
  } catch (e) {}
  return Response.error();
}

// 3. JSON 数据 → Stale While Revalidate（先给旧的，后台拉新的）
async function handleData(request) {
  const cached = await matchAnyCache(request, false);
  const networkPromise = fetch(request).then(response => {
    if (response && response.ok) backgroundUpdate(request, response);
    return response;
  }).catch(() => null);

  if (cached) {
    // 有缓存先返回，网络在后台跑
    networkPromise.then(res => {
      if (res) console.log('[SW] 数据文件已后台更新');
    });
    return cached;
  }

  // 没缓存 → 必须等网络
  try {
    const res = await withTimeout(networkPromise, TIMEOUT.data);
    if (res) return res;
  } catch (e) {}
  return Response.error();
}

async function handleRequest(request) {
  const url = new URL(request.url);
  const isNavigate = request.mode === 'navigate';
  const isHTML = request.destination === 'document' || url.pathname.endsWith('.html');
  const isStatic = /\.(js|css|png|jpe?g|svg|ico|woff2?|ttf|eot)$/.test(url.pathname);
  const isData = url.pathname.endsWith('.json');

  if (isNavigate || isHTML) {
    return handleNavigate(request);
  } else if (isStatic) {
    return handleStatic(request);
  } else if (isData) {
    return handleData(request);
  } else {
    // 默认：Network First
    const cached = await matchAnyCache(request, false);
    try {
      const res = await withTimeout(fetch(request), TIMEOUT.default);
      if (res && res.ok) {
        backgroundUpdate(request, res);
        return res;
      }
    } catch (e) {}
    return cached || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(handleRequest(event.request));
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.indexOf(self.registration.scope) === 0 && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(absUrl('./'));
    })
  );
});
