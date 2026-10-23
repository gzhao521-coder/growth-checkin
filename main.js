    // ========== PWA 配置 ==========
    if ('serviceWorker' in navigator) {
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (refreshing) return;
          refreshing = true;
          location.reload();
        });
        navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
          .then(reg => {
            setupUpdatePrompt(reg);
            reg.update().catch(() => {});
          })
          .catch(err => console.log('Service Worker 注册失败:', err));
    }

    // ========== 星尘背景 ==========
    const STARDUST_COLORS = [
      'rgba(255,255,255,0.95)',
      'rgba(100,255,218,0.9)',
      'rgba(0,212,255,0.9)',
      'rgba(189,52,254,0.85)',
      'rgba(255,215,64,0.9)'
    ];

    function buildStarDust() {
      const wrap = document.getElementById('starDustWrap');
      if (!wrap) return;
      wrap.innerHTML = '';
      const count = window.innerWidth < 600 ? 10 : 18;
      for (let i = 0; i < count; i++) {
        const star = document.createElement('span');
        star.className = 'bg-particle';
        star.style.setProperty('--x', (Math.random() * 100).toFixed(2) + '%');
        star.style.setProperty('--y', (Math.random() * 100).toFixed(2) + '%');
        star.style.setProperty('--size', (1.5 + Math.random() * 2.2).toFixed(2) + 'px');
        star.style.setProperty('--color', STARDUST_COLORS[i % STARDUST_COLORS.length]);
        star.style.setProperty('--dx', (Math.random() * 28 - 14).toFixed(1) + 'px');
        star.style.setProperty('--dy', (Math.random() * 18 - 9).toFixed(1) + 'px');
        star.style.setProperty('--drift-duration', (8 + Math.random() * 8).toFixed(1) + 's');
        star.style.setProperty('--twinkle-duration', (2 + Math.random() * 3).toFixed(1) + 's');
        star.style.setProperty('--twinkle-delay', (Math.random() * 4).toFixed(2) + 's');
        wrap.appendChild(star);
      }
    }

    function initStarDust() {
      buildStarDust();
      window.addEventListener('resize', buildStarDust);
    }

    const LS_KEY = 'myCheckinApp_v10';
    // 单一版本号来源：诊断信息、备份 payload、sw.js 的 CACHE_NAME 都应对齐这里
    const APP_VERSION = 'v112';
    const CURRENT_SCHEMA_VERSION = 1;
    // 存储安全状态。必须在 `let data = loadData();` 之前初始化：
    // loadData / saveData / validateAndRepairData 都会用到它们，放在后面会踩暂时性死区（TDZ）直接报错。
    let storageHealthy = true;
    let storageWarned = false;
    const RESCUE_PREFIX = LS_KEY + '_rescue_';
    // 自动备份条数与总字符上限（约 1.2M 字符）。每份备份都是整份数据的拷贝，
    // 不限制的话会把 localStorage 配额吃光，导致主数据无法保存。
    const MAX_AUTO_BACKUPS = 20;
    const MAX_AUTO_BACKUP_CHARS = 1200000;

    // ========== 补剂清单版本与迁移配置 ==========
    // 每次调整内置补剂清单就 +1；迁移只跑一次。
    // 迁移以 id 为准就地更新，完整保留 records / taken / stock / cycleStart，并且从不删除项目。
    // （这些常量必须在 `let data = loadData();` 之前声明，否则会踩暂时性死区。）
    // v2：替换 #11（MEGA STRENGTH 精氨酸）；v3：替换 #17（Tadarise-5）、#18（REPL HYPOWER MUSLI）
    // v4：替换 #1（Healthy Care CoQ10 300mg）；v5：新增 #19（NOW Foods 吡啶甲酸锌 50mg）
    // v6：清单定稿——落地 #4/#5/#6/#7/#9/#10 六项替换，新增 #20（X5 TEST FORCE），
    //     并把已吃完的 #2/#3/#8/#12/#13/#14/#15/#16 标记为 active:false（记录全部保留）
    // v7：#6 改为每天2粒；#18 改为每天1粒（取消吃3停1）；#19 单独安排到新增的"下午"时段
    // v8：矿物质汇总增加"来源明细 + 超出多少"；含锌三项显式标注错开安排
    // v9：#5 与 #10 改为隔天轮换（每天元素锌降到 26mg 或 11mg，都在 40mg 以内）；
    //     #19 NOW 锌 50mg 单粒即超上限，移出每日清单（记录保留，可一键恢复）
    // v11：（预留）
    // v12：错开时段——#11 精氨酸→睡前、#18 阿育吠陀→下午、#20 X5→午餐后，
    //     避免与 #17 他达拉非（早）及彼此的药理作用叠加；SUPPLEMENT_RESLOT_IDS 强制覆盖旧时段
    // v13：全部在服项写入具体钟点（8:00 他达拉非 / 8:30 早餐组 / 12:00 X5 / 12:30 睾酮促进剂 /
    //     15:00 阿育吠陀 / 19:00 护肝 / 19:30 晚餐组 / 21:00 锌镁 / 21:30 精氨酸）
    const SUPPLEMENT_LIST_VERSION = 13;
    // 身体记录里"测量值"字段名。必须在这里声明：bodyRecordHasData() 会在启动时
    // （validateAndRepairData）被调用，若此常量声明在 `let data = loadData();` 之后
    // 就会踩暂时性死区，导致整个应用启动报错。
    const BODY_METRIC_KEYS = ['weight', 'waist', 'restingHeartRate', 'sleepHours', 'systolic', 'diastolic'];
    // 处方药类项目的 id（不要再依赖 "id >= 16" 这种范围判断，
    // 否则以后往清单里加普通补剂会被误当成处方药）
    const MED_SUPPLEMENT_IDS = [16, 17, 18];
    // v12 起被强制错开时段的项目：老用户的 timeSlot 会被迁移逻辑覆盖成新时段，
    // 防止旧存档里残留的"早晨/午餐"时段让相互作用错开方案失效
    const SUPPLEMENT_RESLOT_IDS = [11, 18, 20];
    // 本次启动是否做过了补剂清单迁移（用于静默保存，不触发"数据异常"告警）
    let supplementsMigrated = false;

    // ========== IndexedDB 封装 ==========
    const DB_NAME = 'growth-checkin-db';
    const DB_VERSION = 1;
    const STORE_NAME = 'appData';
    let idbReady = false;

    function initIndexedDB() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
        };
      });
    }

    async function dbGet(db, key) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }

    async function dbSet(db, key, value) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(value, key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    }

    async function dbDelete(db, key) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    }

    // 加载优先顺序：IndexedDB → localStorage → initData
    async function initStorage() {
      try {
        const db = await initIndexedDB();
        let saved = await dbGet(db, 'data');
        if (saved && saved.modules) {
          console.log('[Storage] 从 IndexedDB 加载数据');
          idbReady = true;
          return saved;
        }
        // IndexedDB 为空，尝试从 localStorage 迁移
        let raw = null;
        try { raw = localStorage.getItem(LS_KEY); } catch (e) { raw = null; }
        if (raw) {
          try {
            saved = JSON.parse(raw);
            if (saved && saved.modules) {
              console.log('[Storage] 从 localStorage 迁移到 IndexedDB');
              await dbSet(db, 'data', saved);
              idbReady = true;
              return saved;
            }
          } catch (e) {
            console.log('[Storage] localStorage 数据解析失败:', e);
          }
        }
        idbReady = true;
        return null; // 首次使用
      } catch (e) {
        console.log('[Storage] IndexedDB 不可用，回退到 localStorage:', e);
        idbReady = false;
        return null;
      }
    }

    async function persistData(payload) {
      // 1. 始终写 localStorage（同步，保底）
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(payload));
      } catch (e) {
        console.log('localStorage 写入失败:', e);
      }
      // 2. 如果 IndexedDB 可用，异步写入
      if (idbReady) {
        try {
          const db = await initIndexedDB();
          await dbSet(db, 'data', payload);
        } catch (e) {
          console.log('IndexedDB 写入失败:', e);
        }
      }
    }

    // ========== 加密备份（Web Crypto API）==========
    async function deriveKey(password, salt) {
      const enc = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey(
        'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveKey']
      );
      return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
    }

    async function exportEncrypted(password) {
      const payload = JSON.stringify(data);
      const enc = new TextEncoder();
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const key = await deriveKey(password, salt);
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        enc.encode(payload)
      );
      const blob = new Blob([
        new Uint8Array([1]), // 版本号
        salt,
        iv,
        new Uint8Array(ciphertext)
      ]);
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }

    async function importEncrypted(dataUrl, password) {
      const res = await fetch(dataUrl);
      const buf = await res.arrayBuffer();
      const view = new DataView(buf);
      const version = view.getUint8(0);
      if (version !== 1) throw new Error('不支持的备份版本');
      const salt = new Uint8Array(buf, 1, 16);
      const iv = new Uint8Array(buf, 17, 12);
      const ciphertext = new Uint8Array(buf, 29);
      const key = await deriveKey(password, salt);
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        ciphertext
      );
      const dec = new TextDecoder();
      return JSON.parse(dec.decode(decrypted));
    }

    // 已知库存（按瓶身数量），只在首次迁移且该用户从未设过库存时写入
    const SUPPLEMENT_STOCK_SEED = {
      11: { stock: 120, stockTotal: 120, stockUnit: '片' }   // MEGA STRENGTH L-精氨酸：120片/瓶
    };
    // id 找不到时的旧名字兜底（只有这些名字对应到新清单的同一项）
    const SUPPLEMENT_LEGACY_ALIASES = {
      4:  ['MegLife 前列腺六合一', '番茄红素六合一'],
      5:  ['VORSE 锌镁片', '锌镁片'],
      7:  ['鱼油'],
      9:  ['水飞蓟护肝片'],
      10: ['RAINBOWBAR 葫芦巴', '葫芦巴提取物'],
      11: ['VITAS 瓜氨酸精氨酸粉', '瓜氨酸精氨酸粉', '黑金刚精氨酸片', '复合精氨酸']
    };
    const ICONS = ['🌅','🏃','📖','💧','🧘','🎸','💻','🥗','✍️','🧹','🌙','💪','🎯','🎨','🎧','🚴','🏊','🧠','🌳','🔥'];

    function getBgMotionEnabled() {
      return localStorage.getItem(LS_KEY + '_motion') !== 'off';
    }

    function applyBgMotion() {
      const on = getBgMotionEnabled();
      document.body.classList.toggle('motion-on', on);
    }

    function toggleBgMotion() {
      const on = !getBgMotionEnabled();
      localStorage.setItem(LS_KEY + '_motion', on ? 'on' : 'off');
      applyBgMotion();
      showAchievementToast(on ? '背景动态已开启' : '背景动态已关闭');
    }

    const MODULE_CONFIG = {
      daily:   { name: '每日打卡', icon: '🔥', color: '#64ffda', bg: 'linear-gradient(135deg, rgba(100,255,218,0.15), rgba(0,212,255,0.1))', desc: '每日必做 · 基础习惯' },
      sleepPlan: { name: '睡眠流程', icon: '😴', color: '#00d4ff', bg: 'linear-gradient(135deg, rgba(0,212,255,0.15), rgba(189,52,254,0.1))', desc: '班次睡眠 · 每日执行' },
      study:   { name: '每日学习', icon: '📚', color: '#4d96ff', bg: 'linear-gradient(135deg, rgba(77,150,255,0.15), rgba(100,255,218,0.1))', desc: '学习提升 · 知识积累' },
      game:    { name: '游戏娱乐', icon: '🎮', color: '#bd34fe', bg: 'linear-gradient(135deg, rgba(189,52,254,0.15), rgba(255,107,107,0.1))', desc: '休闲娱乐 · 放松身心' },
      fitness: { name: '健身记录', icon: '💪', color: '#6bcb77', bg: 'linear-gradient(135deg, rgba(107,203,119,0.15), rgba(0,212,255,0.1))', desc: '训练打卡 · 身体管理' },
      finance: { name: '财务管理', icon: '💰', color: '#ffd740', bg: 'linear-gradient(135deg, rgba(255,215,64,0.15), rgba(255,159,67,0.1))', desc: '理财记账 · 财富积累' },
      shopping: { name: '购物清单', icon: '🛒', color: '#ff6b9d', bg: 'linear-gradient(135deg, rgba(255,107,157,0.15), rgba(255,215,64,0.1))', desc: '计划购买 · 值不值得' },
      cycle:   { name: '周期打卡', icon: '⏰', color: '#00d4ff', bg: 'linear-gradient(135deg, rgba(0,212,255,0.15), rgba(100,255,218,0.1))', desc: '周期性任务 · 定时提醒' },
      free:    { name: '自由打卡', icon: '🌟', color: '#ff6b6b', bg: 'linear-gradient(135deg, rgba(255,107,107,0.15), rgba(189,52,254,0.1))', desc: '自由安排 · 灵活记录' },
      manifestation: { name: '显化记录', icon: '✨', color: '#ffd740', bg: 'linear-gradient(135deg, rgba(255,215,64,0.15), rgba(255,159,67,0.1))', desc: '意念显化 · 愿望成真' },
      supplements: { name: '补剂明细', icon: '💊', color: '#6bcb77', bg: 'linear-gradient(135deg, rgba(107,203,119,0.15), rgba(0,212,255,0.1))', desc: '每日补剂 · 科学服用' },
      body: { name: '身体记录', icon: '🧬', color: '#00d4ff', bg: 'linear-gradient(135deg, rgba(0,212,255,0.15), rgba(189,52,254,0.1))', desc: '健身补剂 · 记录身体变化' },
      reading: { name: '看书记录', icon: '📖', color: '#ff9f43', bg: 'linear-gradient(135deg, rgba(255,159,67,0.15), rgba(255,215,64,0.1))', desc: '阅读书单 · 时间记录' },
      qa: { name: '问题档案', icon: '❓', color: '#ff9f43', bg: 'linear-gradient(135deg, rgba(255,159,67,0.15), rgba(255,107,107,0.1))', desc: '日常疑问 · 答案沉淀' }
    };

    const MODULE_ORDER = ['daily','game','cycle','free','finance','shopping','fitness','supplements','body','reading','qa','study','sleepPlan','manifestation'];
    const NAV_PRIMARY_IDS = ['daily','study','sleepPlan','finance','supplements','manifestation'];
    const ACHIEVEMENT_MILESTONES = [7, 14, 21, 30, 60, 90];
    const DAILY_HABIT_REMARKS = {
      '戒除': '需坚持 14 天',
      '吃早饭': '早上 9 点前完成',
      '早睡早起': '早上 7 点起床，晚上 10 点半睡觉',
      '学习': '每天至少 1 小时',
      '练字': '每天最少半小时',
      '盘串': '每天最少半小时',
      '显化': '记住当天所有的目标',
      '摸鱼': '全天都可以',
      '打游戏': '每天不超过两小时',
      '写记录': '每天睡前记得写记录',
      '听歌': '每天不超过一小时',
      '攒钱': '每天都攒钱',
      '社交': '尽量保持每日社交',
      '锻炼': '除夜班、下夜班外，尽量都坚持',
      '吃补剂': '每日需坚持，按照补剂明细走'
    };
    const DAILY_QUOTES = [
      '今天也是值得认真过的一天。',
      '完成一件小事，也比原地不动强。',
      '你坚持的样子，正在变成更好的自己。',
      '慢一点没关系，停下来才可怕。',
      '今天积累的一点点，明天都会算数。',
      '把注意力放在下一步，而不是整座山。',
      '给自己一次机会，今天不打折。',
      '真正的成长，是在没人看见时也继续。',
      '先完成，再完美。',
      '每一天都是重启的机会。',
      '别小看五分钟，它足以改变方向。',
      '当你觉得难，说明正在上坡。',
      '今天不辜负，明天不慌张。',
      '记录本身就是一种力量。'
    ];

    let data = loadData();
    validateAndRepairData();

    // ========== IndexedDB 启动同步 ==========
    // 优先使用 IndexedDB 数据（如果存在且更新），否则保持 localStorage 数据
    initStorage().then(async (idbData) => {
      if (idbData && idbData.modules) {
        // 用 IndexedDB 数据覆盖（它更可能是从支持 IDB 的环境写入的）
        data = idbData;
        // 重新跑迁移和校验
        const fromVersion = typeof data.schemaVersion === 'number' ? data.schemaVersion : 0;
        runMigrations(data, fromVersion, CURRENT_SCHEMA_VERSION);
        validateAndRepairData();
        // 刷新 UI
        renderModule(activeModule);
        updateTotalStats();
        renderNav();
        console.log('[Storage] IndexedDB 数据已同步到内存');
      }
      // 启动后把当前数据写回 IndexedDB（确保双写一致）
      await persistData(data);
    }).catch(e => {
      console.log('[Storage] IndexedDB 同步失败:', e);
    });

    // 注意：这里必须是 let。以前是 const，只在启动时算一次；手机 PWA 常驻后台跨过午夜后，
    // 打卡会被写到"昨天"，加油也会被判成"未来日期"而无法记录。
    let today = getTodayStr();
    // 补剂/睡眠模块的"按日期查看"游标（必须在 refreshTodayIfChanged 之前声明）
    let supplementViewDate = getTodayStr();
    let sleepViewDate = getTodayStr();
    let activeModule = 'daily';

    // 跨天检测：回到前台、获得焦点或每分钟检查一次，发现日期变了就整体刷新。
    function refreshTodayIfChanged() {
      const nowStr = getTodayStr();
      if (nowStr === today) return false;
      const prevStr = today;
      today = nowStr;
      // 这两个是"按日期查看"的游标，若原本停在昨天就一起推进到今天
      if (supplementViewDate === prevStr) supplementViewDate = nowStr;
      if (sleepViewDate === prevStr) sleepViewDate = nowStr;
      try {
        const dateEl = document.getElementById('todayDate');
        if (dateEl) dateEl.textContent = formatDateCN(new Date());
        renderNav();
        renderModule(activeModule);
        updateTotalStats();
        updateDailyHero();
        showInfoToast('已进入新的一天：' + nowStr);
      } catch (e) { console.log('跨天刷新失败:', e); }
      return true;
    }

    try { localStorage.removeItem(LS_KEY + '_active'); } catch(e) {}
    let pendingNoteId = null;
    let pendingNoteModule = null;
    let pendingFuelId = null;
    let pendingFuelModule = null;
    let skipCardEntryAnim = false;
    const REMINDER_KEY = LS_KEY + '_reminders';
    const PIN_KEY = LS_KEY + '_pin';
    let reminderTimer = null;
    let appUnlocked = true;

    let manifestExpandedGoal = null;
    let manifestPendingGoalId = null;
    let supplementTagFilter = 'all';
    let bodyEditId = null;
    let bodyRating = 4;
    let readingEditId = null;
    let shoppingEditId = null;
    let shoppingPracticality = 3;
    let shoppingHappiness = 4;
    let qaData = null;
    let qaLoading = false;
    let qaFilter = '全部';
    const qaExpanded = new Set((data.modules.qa && data.modules.qa.expanded) || []);

    const SUPPLEMENT_TIME_SLOTS = {
      morning: { label: '☀️ 早晨', color: '#ffd740', order: 1 },
      noon: { label: '🌤️ 中午', color: '#ff9f43', order: 2 },
      afternoon: { label: '🌇 下午', color: '#4fc3f7', order: 3 },
      evening: { label: '🌙 晚上', color: '#bd34fe', order: 4 },
      workout: { label: '💪 运动', color: '#00e676', order: 5 }
    };

    document.getElementById('todayDate').textContent = formatDateCN(new Date());

    function hideSplashScreen() {
      const splash = document.getElementById('splashScreen');
      if (!splash) return;
      splash.classList.add('hide');
      setTimeout(() => { if (splash.parentNode) splash.parentNode.removeChild(splash); }, 600);
    }

    applyBgMotion();
    applyUiPrefs();
    initStarDust();
    renderNav();
    renderModule(activeModule);
    setTimeout(hideSplashScreen, 2200);
    updateTotalStats();
    startReminderLoop();
    maybePromptBackup();
    updateNetworkStatus();
    updateWeather();
    checkPinLock();
    window.addEventListener('online', () => { updateNetworkStatus(); updateWeather(); });
    window.addEventListener('offline', () => {
      updateNetworkStatus();
      const weatherEl = document.getElementById('weatherWidget');
      if (weatherEl) {
        weatherEl.textContent = '--°';
        weatherEl.title = '离线，联网后自动刷新';
      }
    });
    // 跨天 / 回到前台的处理：修掉"打卡记到昨天"的问题
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { refreshTodayIfChanged(); updateNetworkStatus(); }
    });
    window.addEventListener('pageshow', () => refreshTodayIfChanged());
    window.addEventListener('focus', () => refreshTodayIfChanged());
    setInterval(refreshTodayIfChanged, 60000);

    function updateNetworkStatus() {
      const el = document.getElementById('netStatus');
      if (!el) return;
      const online = navigator.onLine;
      el.textContent = online ? '在线' : '离线';
      el.classList.toggle('offline', !online);
    }

    const WEATHER_CODE_MAP = {
      0: { icon: '☀️', text: '晴' },
      1: { icon: '🌤️', text: '大致晴朗' },
      2: { icon: '⛅', text: '多云' },
      3: { icon: '☁️', text: '阴' },
      45: { icon: '🌫️', text: '雾' },
      48: { icon: '🌫️', text: '雾凇' },
      51: { icon: '🌦️', text: '毛毛雨' },
      53: { icon: '🌦️', text: '毛毛雨' },
      55: { icon: '🌦️', text: '毛毛雨' },
      56: { icon: '🌦️', text: '冻毛毛雨' },
      57: { icon: '🌦️', text: '冻毛毛雨' },
      61: { icon: '🌧️', text: '小雨' },
      63: { icon: '🌧️', text: '中雨' },
      65: { icon: '🌧️', text: '大雨' },
      66: { icon: '🌧️', text: '冻雨' },
      67: { icon: '🌧️', text: '冻雨' },
      71: { icon: '🌨️', text: '小雪' },
      73: { icon: '🌨️', text: '中雪' },
      75: { icon: '🌨️', text: '大雪' },
      77: { icon: '🌨️', text: '雪粒' },
      80: { icon: '🌦️', text: '阵雨' },
      81: { icon: '🌦️', text: '阵雨' },
      82: { icon: '⛈️', text: '强阵雨' },
      85: { icon: '🌨️', text: '阵雪' },
      86: { icon: '🌨️', text: '阵雪' },
      95: { icon: '⛈️', text: '雷雨' },
      96: { icon: '⛈️', text: '雷暴伴冰雹' },
      99: { icon: '⛈️', text: '雷暴伴冰雹' }
    };

    let weatherRefreshTimer = null;

    async function weatherFetchJson(url) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return await res.json();
      } finally {
        clearTimeout(timer);
      }
    }

    async function resolveWeatherLocation() {
      if (navigator.geolocation) {
        try {
          const pos = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 6000, maximumAge: 600000 });
          });
          return { city: '当前位置', lat: pos.coords.latitude, lon: pos.coords.longitude };
        } catch(e) {}
      }
      return { city: '兰州', lat: 36.057, lon: 103.839, fallback: true };
    }

    function scheduleWeatherRefresh() {
      if (weatherRefreshTimer) clearTimeout(weatherRefreshTimer);
      weatherRefreshTimer = setTimeout(() => updateWeather(), 30 * 60 * 1000);
    }

    async function updateWeather() {
      const el = document.getElementById('weatherWidget');
      if (!el) return;
      if (!navigator.onLine) {
        el.textContent = '--°';
        el.title = '离线，联网后自动刷新';
        return;
      }
      el.textContent = '🌤 --°';
      el.title = '正在获取天气...';
      try {
        const loc = await resolveWeatherLocation();
        const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + loc.lat +
          '&longitude=' + loc.lon +
          '&current=temperature_2m,weather_code' +
          '&daily=temperature_2m_max,temperature_2m_min' +
          '&timezone=Asia%2FShanghai';
        const data = await weatherFetchJson(url);
        const current = data && data.current;
        const temp = current && typeof current.temperature_2m === 'number' ? Math.round(current.temperature_2m) : null;
        const code = current && typeof current.weather_code === 'number' ? current.weather_code : null;
        const info = WEATHER_CODE_MAP[code] || { icon: '🌤️', text: '天气' };
        const daily = data && data.daily;
        const max = daily && daily.temperature_2m_max && typeof daily.temperature_2m_max[0] === 'number' ? Math.round(daily.temperature_2m_max[0]) : null;
        const min = daily && daily.temperature_2m_min && typeof daily.temperature_2m_min[0] === 'number' ? Math.round(daily.temperature_2m_min[0]) : null;
        el.textContent = info.icon + ' ' + (temp !== null ? temp + '°' : '--°');
        el.title = loc.city + ' · ' + info.text +
          (temp !== null ? ' · ' + temp + '°C' : '') +
          (min !== null && max !== null ? ' · ' + min + '°~' + max + '°' : '') +
          (loc.fallback ? '（定位未开启）' : '');
        scheduleWeatherRefresh();
      } catch(e) {
        el.textContent = '🌤 --°';
        el.title = '天气获取失败，点击重试';
      }
    }

    function normalizeSupplementItem(item) {
      if (!item) return item;
      if (item.taken === undefined) item.taken = false;
      if (!Array.isArray(item.records)) {
        item.records = [];
        if (item.taken) item.records.push({ date: getTodayStr(), taken: true });
      } else {
        item.taken = item.records.some(r => r.date === getTodayStr() && r.taken);
      }
      if (item.stock === undefined) item.stock = null;
      if (item.stockTotal === undefined) item.stockTotal = null;
      if (item.stockUnit === undefined) item.stockUnit = '粒';
      if (item.lowStockThreshold === undefined) item.lowStockThreshold = 10;
      if (item.cycleEnabled === undefined) item.cycleEnabled = false;
      if (item.cycleTakeDays === undefined) item.cycleTakeDays = 5;
      if (item.cycleStopDays === undefined) item.cycleStopDays = 2;
      if (item.cycleStart === undefined) item.cycleStart = '';
      if (!Array.isArray(item.tags)) item.tags = [];
      // 元素矿物质含量（mg/份），可选。只用于"今日矿物质总量"汇总，不影响打卡逻辑。
      if (item.zincMg === undefined) item.zincMg = null;
      if (item.magnesiumMg === undefined) item.magnesiumMg = null;
      // active=false 表示"已吃完 / 已停用"：不再计入今日应服、矿物质汇总和相互作用判断，
      // 但项目本身与全部历史记录都保留（从不删除）。
      if (item.active === undefined) item.active = true;
      return item;
    }

    function createDefaultSupplementItems() {
      return [
        { id: 1, name: 'Healthy Care CoQ10 300mg', icon: '❤️', dosage: '1粒（300mg）', time: '早餐后（8:30）', timeSlot: 'morning', taken: false, stock: null, stockTotal: null, stockUnit: '粒', lowStockThreshold: 10, tags: ['含大豆'], note: 'Healthy Care Australia · Ultra Strength Coenzyme Q10。每粒 Ubidecarenone（辅酶Q10）300mg，规格 60粒。厂家建议：成人每日1粒，随餐服用。脂溶性，随餐（含脂肪）吸收更佳；避免晚上服用以免影响睡眠。', warning: '【标签提示】正在接受抗凝治疗者需先咨询医生。含大豆成分，过敏者注意。' },
        { id: 2, name: '水解增肌粉', icon: '💪', dosage: '1勺', time: '运动后30分钟内', timeSlot: 'workout', taken: false, active: false, stock: null, stockTotal: null, stockUnit: '克', lowStockThreshold: 10, note: '运动后30分钟内服用；无训练日改为早餐后，与其他产品错开时间。', warning: '过量增加肾脏负担' },
        { id: 3, name: '冻干甜菜根粉', icon: '🍠', dosage: '5-10g', time: '早晨空腹', timeSlot: 'morning', taken: false, active: false, stock: null, stockTotal: null, stockUnit: '克', lowStockThreshold: 10, note: '富含硝酸盐，运动前1-2小时服用可提升耐力。', warning: '过量可能导致胃肠不适、尿液变红(正常现象)' },
        { id: 4, name: 'MegLifeExten 活力精华加强版', icon: '🎯', dosage: '2粒（每日）', time: '晚餐后（19:30）', timeSlot: 'evening', taken: false, stock: null, stockTotal: null, stockUnit: '粒', lowStockThreshold: 10, tags: ['仅限男性'], note: 'MegLifeExten · VITALITY ESSENCE ULTRA（活力精华加强版）。每份2粒含：番茄红素 80mg、牛磺酸 1000mg、锯棕榈提取物 200mg(10:1)、南瓜籽提取物 120mg(20:1)、淫羊藿提取物 60mg(10:1)、当归提取物 30mg(10:1)。规格 60粒/瓶（按每日2粒约30天）。标签注明无糖、纯素友好。番茄红素为脂溶性，随晚餐（油脂最丰富的一餐）吸收更佳。', warning: '【标签说明】标签仅注明"不可替代药物"、请勿超过每日用量。成分含锯棕榈（可能影响凝血、干扰前列腺相关检查）与淫羊藿，正在服药或做检查前建议先告知医生。' },
        { id: 5, name: 'VORSE 吡啶甲酸锌+甘氨酸镁', icon: '⚡', dosage: '1片（隔天1片）', time: '睡前一小时（21:00 · 隔天）', timeSlot: 'evening', taken: false, stock: null, stockTotal: null, stockUnit: '片', lowStockThreshold: 10, zincMg: 26, magnesiumMg: 118, cycleEnabled: true, cycleTakeDays: 1, cycleStopDays: 1, cycleStart: '2026-01-01', tags: ['隔天服用'], note: 'VORSE Zinc Picolinate。每片：吡啶甲酸锌 125mg（≈元素锌 26mg）、甘氨酸镁 834mg（≈元素镁 118mg），片重1700mg。规格 30片/瓶。批号 E260530，有效期至 2029-05-27，香港制造。为把每天的元素锌控制在 40mg 以内，本项**隔天**服用（#10 每天吃）：吃到本项的那天锌合计 26+11=37mg，未到 40mg；只吃 #10 的那天是 11mg。卡片上会显示今天该吃还是停服。', warning: '【标签提示】锌的每日可耐受最高摄入量约 40mg 元素锌，切勿超量；长期过量补锌可能导致铜缺乏。建议随餐服用。' },
        { id: 6, name: 'MOOSRLE 肌酸软糖（芒果）', icon: '🍬', dosage: '2粒（肌酸3g）', time: '早餐后（8:30）', timeSlot: 'morning', taken: false, stock: null, stockTotal: null, stockUnit: '粒', lowStockThreshold: 10, tags: ['运动营养'], note: 'MOOSRLE 肌酸软糖，芒果味。每粒5g，其中一水肌酸 1.5g（每粒能量49kJ、碳水2.9g、钠0mg）。规格 净含量300g＝60粒；每天 2 粒 ≈ 肌酸 3g。配料含麦芽糖醇液、异麦芽酮糖醇（代糖）等。', warning: '【标签提示】代糖含量较高，过量食用可能引起肠胃胀气或腹泻。肌酸会把水分带入肌肉细胞，服用期间请保证充足饮水。肾脏功能不全者请先咨询医生。' },
        { id: 7, name: 'CPTKING 复合鱼油 (rTG型)', icon: '🐟', dosage: '2粒（每日1次）', time: '晚餐后（19:30）', timeSlot: 'evening', taken: false, stock: null, stockTotal: null, stockUnit: '粒', lowStockThreshold: 10, tags: ['鱼油'], note: 'CPTKING（赛霸）COMPOUND FISH OIL 复合鱼油，rTG型（再酯化甘油三酯）。每粒1g：鱼油提取物中 EPA 50%／DHA 40%，Omega-3 ≥95%。配料另含明胶、水、甘油、元宝枫籽油。规格 30g＝1g×10粒×3板（30粒/盒）。保质期至 2028-06-08。随餐服用（含脂肪的餐食帮助吸收）。', warning: '【标签提示】鱼油提取物≤3克/天、元宝枫籽油≤3克/天，本产品每日不超过 3粒；不适宜婴幼儿。高剂量鱼油可能影响凝血功能，正在服用抗凝/抗血小板药或准备手术前请先咨询医生。' },
        { id: 8, name: 'Supovita 12合一多维牡蛎片', icon: '💊', dosage: '按说明 1片', time: '早餐后', timeSlot: 'morning', taken: false, active: false, stock: null, stockTotal: null, stockUnit: '粒', lowStockThreshold: 10, note: '复合维生素+牡蛎提取物，含锌、硒等，随餐服用。', warning: '含锌，避免与其他锌产品叠加；脂溶性维生素长期过量可能积累' },
        { id: 9, name: 'Healthy Care 护肝排毒片', icon: '🛡️', dosage: '1粒（每日）', time: '晚餐后（19:00）', timeSlot: 'evening', taken: false, stock: null, stockTotal: null, stockUnit: '粒', lowStockThreshold: 10, tags: ['含亚硫酸盐'], note: 'Healthy Care Australia · Ultimate One-A-Day LIVER DETOX，规格 60粒（按每日1粒约60天），AUST L 421902。每粒：奶蓟草干果提取物 600mg（≈干果42g，标准化至水飞蓟宾 480mg）、姜黄干根茎提取物 80mg（≈2g）、朝鲜蓟干叶提取物 20mg（≈300mg）。标签注明：17岁及以下不适用。', warning: '【标签警示】① 极少数情况下姜黄可能损害肝脏；出现皮肤/眼睛发黄、异常疲劳、恶心、食欲不振、腹痛、深色尿液或瘙痒，请停药并就医。② 含亚硫酸盐，过敏者注意。③ 避免高剂量水飞蓟长期服用，建议定期监测肝功能；服药或准备手术前先咨询医生。' },
        { id: 10, name: 'RAINBOWBAR 男性睾酮促进剂', icon: '🌱', dosage: '2片（每日）', time: '午餐后（12:30）', timeSlot: 'noon', taken: false, stock: null, stockTotal: null, stockUnit: '片', lowStockThreshold: 10, zincMg: 11, tags: ['仅限男性'], note: 'RAINBOWBAR MEN\'S T-BOOST，标称100% PURE／2300mg，规格 90片＝45份（每份2片，约一个半月）。每份2片含：葫芦巴提取物 1200mg、葫芦巴糖苷 600mg、DIM 200mg、原薯蓣皂苷 150mg、锌 11mg、黑胡椒提取物（95%胡椒碱）10mg、硼 8mg、维生素D3 500IU。建议：每日2片随餐，本项**每天吃**。#5（含锌 26mg）隔天吃，所以吃到 #5 的那天锌合计 11+26=37mg，仍在 40mg 以内。', warning: '【标签提示】请勿超过建议每日用量；营养补充剂不可替代药物。含葫芦巴（可能影响血糖）、DIM、胡椒碱（黑胡椒提取物，常被提到会影响药物代谢酶）与硼，正在服药者建议先咨询医生。' },
        { id: 11, name: 'MEGA STRENGTH L-精氨酸 1000mg', icon: '💥', dosage: '1片（1000mg）', time: '睡前（21:30）', timeSlot: 'evening', taken: false, stock: null, stockTotal: null, stockUnit: '片', lowStockThreshold: 10, tags: ['医药级'], note: '每片含 L-精氨酸盐酸盐 1000mg（医药级、游离形式）。标签建议随餐服用以减少肠胃刺激；每日1至2次、每次1片。⚠️ 已调到睡前（21:30）服用，与早晨服用的他达拉非（#17）错开约12小时，避开两段的血药浓度高峰重叠。', warning: '【标签警示】低血压患者，以及正在服用降压药、硝酸甘油或伟哥类（PDE5 抑制剂）药物的人群，标签明确标注「绝对禁止服用」，可能导致血压急剧下降。另：可能引起胃肠不适；有疱疹病毒感染史者慎用；哮喘患者慎用。【相互作用】与 PDE5 抑制剂（#17 他达拉非）合用时降压作用会叠加——本应用已把两者在时间上错开，但这不能彻底消除相互作用，如服用后出现头晕、眼前发黑等低血压症状，请立即停药并就医咨询医生。' },
        { id: 12, name: '小分子液体钙', icon: '🦴', dosage: '按说明', time: '午餐后', timeSlot: 'noon', taken: false, active: false, stock: null, stockTotal: null, stockUnit: '粒', lowStockThreshold: 10, note: '午餐后随餐服用，与铁锌间隔2小时以上。', warning: '过量可能增加结石风险，与铁锌竞争吸收' },
        { id: 13, name: '营养米粉', icon: '🍚', dosage: '按说明', time: '早餐/加餐', timeSlot: 'morning', taken: false, active: false, stock: null, stockTotal: null, stockUnit: '克', lowStockThreshold: 10, note: '作为代餐，早餐或加餐时服用。', warning: '过量可能导致热量过剩' },
        { id: 14, name: '口服胶原蛋白', icon: '✨', dosage: '按说明', time: '睡前1小时', timeSlot: 'evening', taken: false, active: false, stock: null, stockTotal: null, stockUnit: '克', lowStockThreshold: 10, note: '睡前1-2小时空腹服用，夜间修复效果更佳。', warning: '过量增加代谢负担' },
        { id: 15, name: '蛹虫草玛咖片', icon: '🍄', dosage: '按说明 1-2片', time: '早餐后/下午', timeSlot: 'morning', taken: false, active: false, stock: null, stockTotal: null, stockUnit: '片', lowStockThreshold: 10, note: '蛹虫草+玛咖，提升精力与状态，白天服用。', warning: '可能影响血糖/血压；晚上服用可能影响睡眠' },
        { id: 16, name: '达泊西汀 60mg', icon: '💊', dosage: '半片（30mg）', time: '按需 · 性活动前1-3小时', timeSlot: 'evening', taken: false, active: false, stock: null, stockTotal: null, stockUnit: '片', lowStockThreshold: 1, cycleEnabled: true, cycleTakeDays: 3, cycleStopDays: 1, cycleStart: getTodayStr(), tags: ['处方药'], note: '医生建议半片；按需服用，不建议连续每天使用，请按医生指示调整频次。', warning: '不可与MAO抑制剂、其他SSRI/SNRI、圣约翰草、5-HTP同用；避免酒精和西柚汁；头晕/晕厥风险' },
        { id: 17, name: 'Tadarise-5（他达拉非 5mg）', icon: '💊', dosage: '1片（5mg）', time: '早餐后（8:00，固定）', timeSlot: 'morning', taken: false, stock: null, stockTotal: null, stockUnit: '片', lowStockThreshold: 1, cycleEnabled: true, cycleTakeDays: 3, cycleStopDays: 1, cycleStart: getTodayStr(), tags: ['处方药'], note: 'Sunrise 出品 · Tadalafil Tablets IP 5mg · 规格 10×10＝100片。辅料适量，色素含酒石黄（Tartrazine）。遵医嘱服用；储存：阴凉干燥、低于30°C、避光、儿童接触不到。标签注明：仅凭泌尿科/精神科/内分泌科/性病科医生处方零售。', warning: '【处方药】绝对禁止与硝酸甘油等硝酸酯类药物同用（可致血压骤降、危及生命）；严重心血管疾病、低血压患者禁用。与其他扩血管／降压类产品同用需谨慎。副作用：头痛、消化不良、背痛、肌肉痛、面部潮红、鼻塞；极少数情况可能出现突然视力丧失或听力下降，需立即就医。' },
        { id: 18, name: 'REPL HYPOWER MUSLI（阿育吠陀）', icon: '🌿', dosage: '1粒（每日）', time: '下午（15:00）', timeSlot: 'afternoon', taken: false, stock: null, stockTotal: null, stockUnit: '粒', lowStockThreshold: 1, tags: ['阿育吠陀', '仅限男性'], note: '每粒500mg，含：Safed Musli 120mg、Sudha Shilajit 105mg、南非醉茄 95mg、刺毛黧豆（含左旋多巴）60mg、天门冬 60mg、Vidarikand 35mg、肉豆蔻 10mg、Abhrak Bhasm（云母灰）10mg。每日1粒，饭后服用（每天吃，不是吃几天停几天）。⚠️ 已调到下午（15:00）服用：本项含左旋多巴与南非醉茄，与 X5（#20）的育亨宾兴奋作用错开，避免同服的叠加兴奋/失眠。', warning: '【成分提示】① 含刺毛黧豆（左旋多巴）：正在服用帕金森药物、抗抑郁药（尤其 MAO 抑制剂）、抗精神病药物者应绝对避免。② 含 Shilajit 与云母灰（Bhasm）等矿物成分，此类阿育吠陀制剂有重金属（铅/汞/砷）超标风险，长期或超量服用可能损伤肝肾。③ 含南非醉茄，需关注甲状腺、血压、血糖。④ 仅限成年男性。⑤ 出现恶心、头晕、皮肤发黄、尿液变色等请立即停药就医。' },
        { id: 19, name: 'NOW Foods 吡啶甲酸锌 50mg', icon: '⚡', dosage: '1粒（元素锌 50mg）', time: '已移出每日轮换', timeSlot: 'afternoon', taken: false, active: false, stock: null, stockTotal: null, stockUnit: '粒', lowStockThreshold: 10, zincMg: 50, tags: ['高剂量锌', '已移出轮换'], note: 'NOW Foods Zinc Picolinate。每份1粒含元素锌 50mg，规格 60粒。★ 已移出每日清单：单粒 50mg 本身就超过"每天 40mg"的参考上限，任何按天轮换的安排里，只要那天吃了它就会超标。想恢复请点本项的「重新开始」。', warning: '【应用参考】单粒元素锌 50mg，已超过应用提示里"每天锌总量不宜长期超过 40mg"的参考值；锌过量会影响铜吸收。请按标签或医生建议服用。' },
        { id: 20, name: 'X5 TEST FORCE', icon: '🌿', dosage: '2粒（每日）／活动前3粒', time: '午餐后（12:00-13:00）', timeSlot: 'noon', taken: false, stock: null, stockTotal: null, stockUnit: '粒', lowStockThreshold: 10, tags: ['草本', '仅限男性'], note: 'X5 TEST FORCE（强效草本混合物）。每份2粒含：淫羊藿提取物 500mg（含淫羊藿苷 50mg）、玛卡 1200mg、蒺藜提取物 250mg（含皂苷 112.5mg）、育亨宾提取物 80mg（标准化含2%育亨宾生物碱 ≈1.6mg）、L-精氨酸盐酸盐 40mg。规格 90粒＝45份。标签建议：每日2粒随餐；为更快效果可在活动前60-90分钟服3粒。⚠️ 已调到午餐后服用：① 他达拉非（#17，早晨）是扩血管降压，育亨宾是升压——血药高峰不重叠可减小血压波动幅度；② 育亨宾有兴奋作用，夜间（尤其与睡前服用的精氨酸同时段）服用会影响睡眠。活动前的急性3粒用法仍照标签。倒班注意：夜班日按实际作息把"午餐后"平移到白天中段的一餐。', warning: '【标签警示】① 含育亨宾（Yohimbe）：作用较强的植物生物碱，可能引起血压升高、心跳加快、焦虑、失眠；有高血压、心脏病、焦虑症，或正在服用降压药、抗抑郁药（尤其 MAO 抑制剂）、抗凝药者应避免。【相互作用】与降压/扩血管类药物（#17 他达拉非）方向相反，可能引起血压不稳——已错开服用时段，但如仍出现头晕、心悸等请停用并就医。② 不要与硝酸酯类药物或其他血管扩张剂同服。③ 标签建议活动前服3粒属急性用法，请勿睡前服用。④ 请严格遵守每日2粒（或短期3粒），切勿超量。⑤ 有前列腺或激素相关疾病、正在服用其他药物者，务必先咨询医生。' },
        { id: 21, name: 'FoYes 多种维生素矿物质耐力片', icon: '🧬', dosage: '2片（隔天2片）', time: '早餐后（8:30 · 隔天）', timeSlot: 'morning', taken: false, stock: null, stockTotal: null, stockUnit: '片', lowStockThreshold: 10, zincMg: 10, magnesiumMg: 160, cycleEnabled: true, cycleTakeDays: 1, cycleStopDays: 1, cycleStart: '2026-01-02', tags: ['维生素矿物质', '隔天'], note: 'FoYes / EXE[FIT] 多种维生素矿物质耐力片 · 运动营养食品（耐力类）· GB 24154 · 生产许可证 SC10633021100134 · 净含量 90g＝1.0g×90片。食用方法：吞食，每日1次、每次2片。每份（2片）：能量15kJ、碳水0.9g、钠2mg；维生素A 220µg、D 6.0µg、E 10mg α-TE、B1 3.0mg、B2 1.2mg、B6 1.6mg、B12 2.6µg、C 80mg、烟酸14mg、叶酸120µg、泛酸3mg、生物素40µg；矿物质 镁160mg、钙200mg、铁2.5mg、锌10mg、硒40µg、铜0.8mg、锰1.6mg、钼90µg、铬24µg。另添加黑胡椒提取物。为把每天元素锌控制在 40mg 以内，本项与 #5 隔天交替（两项不会同一天吃）。', warning: '【标签提示】本品为运动营养食品，不能替代药物治疗。含黑胡椒提取物（胡椒碱，属生物利用度增强剂），可能提高同服药物或补剂的血药浓度——正在服用处方药时请先咨询医生。有肾脏疾病或正在服用利尿剂等药物者，补充矿物质前建议先咨询医生。' }
      ].map(normalizeSupplementItem);
    }

    function createMedSupplementItems() {
      return createDefaultSupplementItems().filter(i => MED_SUPPLEMENT_IDS.indexOf(i.id) !== -1);
    }

    // 补剂清单迁移：只更新展示字段，保留用户的全部记录与库存；从不删除项目。
    // 返回 true 表示做了改动（调用方会保存）。
    function migrateSupplementList(saved) {
      const sup = saved && saved.modules && saved.modules.supplements;
      if (!sup || !Array.isArray(sup.items)) return false;
      if (sup.listVersion === SUPPLEMENT_LIST_VERSION) return false;

      const targets = createDefaultSupplementItems();
      const items = sup.items.slice();
      const usedIdx = new Set();
      const result = [];

      targets.forEach(t => {
        // 1) 优先按 id 匹配（默认清单的 id 是稳定的 1..18）
        let idx = items.findIndex((it, i) => !usedIdx.has(i) && it && it.id === t.id);
        // 2) id 对不上时按旧名字兜底
        if (idx < 0 && SUPPLEMENT_LEGACY_ALIASES[t.id]) {
          const aliases = SUPPLEMENT_LEGACY_ALIASES[t.id];
          idx = items.findIndex((it, i) => !usedIdx.has(i) && it && aliases.indexOf(it.name) !== -1);
        }

        if (idx >= 0) {
          usedIdx.add(idx);
          const cur = items[idx];
          // 先备份用户数据
          const keptRecords = Array.isArray(cur.records) ? cur.records : [];
          const keptStock = cur.stock;
          const keptStockTotal = cur.stockTotal;
          const keptCycleStart = cur.cycleStart;
          const keptFuel = cur.fuelRecords;
          // 用户自己动过的设置，迁移时必须尊重（否则我下次更新清单会覆盖掉你的修改）
          const keptActive = cur.active;
          const keptCycleOn = cur.cycleEnabled;
          const keptCycleTake = cur.cycleTakeDays;
          const keptCycleStop = cur.cycleStopDays;
          const userSetActive = cur.activeUserEdited === true;
          const userSetCycle = cur.cycleUserEdited === true;
          // 保留用户自己设置的时段（如果有）
          const keptTimeSlot = cur.timeSlot;
          // 用目标定义的展示字段覆盖（深拷贝，避免共享引用）
          Object.keys(t).forEach(k => {
            const v = t[k];
            cur[k] = (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
          });
          // 再还原用户数据
          if (keptTimeSlot) cur.timeSlot = keptTimeSlot;
          // 相互作用错开项：强制覆盖为新时段（用户自行改的时段也必须让位，安全优先）
          if (SUPPLEMENT_RESLOT_IDS.indexOf(t.id) !== -1) cur.timeSlot = t.timeSlot;
          cur.records = keptRecords;
          if (keptStock !== undefined) cur.stock = keptStock;
          if (keptStockTotal !== undefined) cur.stockTotal = keptStockTotal;
          if (keptCycleStart) cur.cycleStart = keptCycleStart;   // 不悄悄改周期起算日
          if (keptFuel) cur.fuelRecords = keptFuel;
          if (userSetActive && keptActive !== undefined) { cur.active = keptActive; cur.activeUserEdited = true; }
          if (userSetCycle) {
            cur.cycleEnabled = keptCycleOn;
            cur.cycleTakeDays = keptCycleTake;
            cur.cycleStopDays = keptCycleStop;
            cur.cycleUserEdited = true;
          }
          cur.taken = keptRecords.some(r => r.date === getTodayStr() && r.taken);
          const seed = SUPPLEMENT_STOCK_SEED[t.id];
          if (seed && typeof cur.stock !== 'number') {
            cur.stock = seed.stock;
            cur.stockTotal = seed.stockTotal;
            cur.stockUnit = seed.stockUnit;
          }
          result.push(cur);
        } else {
          const fresh = JSON.parse(JSON.stringify(t));
          const seed = SUPPLEMENT_STOCK_SEED[t.id];
          if (seed) { fresh.stock = seed.stock; fresh.stockTotal = seed.stockTotal; fresh.stockUnit = seed.stockUnit; }
          result.push(fresh);
        }
      });

      // 用户自己新增的（id 不在目标清单里）原样保留——绝不因为迁移而丢项目
      items.forEach((it, i) => {
        if (usedIdx.has(i)) return;
        if (!it) return;
        if (targets.some(t => t.id === it.id)) return;   // 同 id 的重复项已被目标占用
        result.push(it);
      });

      sup.items = result;
      sup.listVersion = SUPPLEMENT_LIST_VERSION;
      supplementsMigrated = true;
      return true;
    }

    // ========== 存储安全 ==========
    // 背景：以前 JSON.parse 失败会被静默吞掉并返回空数据，紧接着启动流程会 saveData()
    // 把空数据写回，原始数据就永久没了；写入失败（配额满）也只在 console 里留一行。
    // 这里做三层保护：
    //   1) 解析失败时先把原始字符串另存为"救援副本"，且本次会话禁止写入；
    //   2) 写入失败时明确提示用户；
    //   3) 自动备份按总字节数裁剪，避免备份把配额挤爆。
    function isQuotaError(e) {
      if (!e) return false;
      const name = e.name || '';
      return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014;
    }

    function lsChars(key) {
      try { const v = localStorage.getItem(key); return v ? v.length : 0; } catch (e) { return 0; }
    }

    function totalLocalStorageChars() {
      let n = 0;
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          n += (k ? k.length : 0) + lsChars(k);
        }
      } catch (e) {}
      return n;
    }

    function warnStorageOnce(msg) {
      if (storageWarned) return;
      storageWarned = true;
      console.log('存储警告:', msg);
      setTimeout(() => alert(msg), 0);
    }

    function rescueRawData(raw) {
      if (!raw) return null;
      const key = RESCUE_PREFIX + Date.now();
      try {
        localStorage.setItem(key, raw);
        console.log('原始数据已另存为救援副本:', key);
        return key;
      } catch (e) {
        console.log('救援副本写入失败:', e);
        return null;
      }
    }

    // ========== 显式数据迁移（按 schemaVersion）==========
    function runMigrations(saved, fromVersion, toVersion) {
      if (fromVersion >= toVersion) return;
      console.log(`[Migration] ${fromVersion} → ${toVersion}`);

      if (fromVersion < 1) {
        // V0 → V1：把历史 loadData 中的所有兜底迁移集中到这里
        if (!saved.modules.daily) saved.modules.daily = {};
        if (!Array.isArray(saved.modules.daily.tomorrowPlans)) saved.modules.daily.tomorrowPlans = [];
        if (!saved.modules.finance) saved.modules.finance = {};
        const fin = saved.modules.finance;
        if (fin.targetAmount === undefined) fin.targetAmount = 10000;
        if (fin.currentAmount === undefined) fin.currentAmount = 0;
        if (fin.monthlyBudget === undefined) fin.monthlyBudget = 0;
        if (!fin.transactions) fin.transactions = [];
        if (!fin.marketData) fin.marketData = {};
        if (!fin.marketHistory || typeof fin.marketHistory !== 'object') fin.marketHistory = {};
        if (!fin.funds) fin.funds = [];
        if (!fin.habits) fin.habits = [];
        if (!saved.modules.manifestation || !saved.modules.manifestation.goals) {
          saved.modules.manifestation = { goals: [
            { id: 1, title: '显化示例：获得理想工作', description: '我相信宇宙会为我安排最好的', targetDate: '2026-12-31', status: 'active', records: [], createdAt: '2026-08-08' }
          ] };
        } else if (!Array.isArray(saved.modules.manifestation.goals)) {
          saved.modules.manifestation.goals = [];
        }
        if (!saved.modules.supplements || !saved.modules.supplements.items || saved.modules.supplements.items.length === 0) {
          saved.modules.supplements = { items: createDefaultSupplementItems() };
        } else if (!Array.isArray(saved.modules.supplements.items)) {
          saved.modules.supplements.items = [];
        }
        if (Array.isArray(saved.modules.supplements.items)) {
          saved.modules.supplements.items = saved.modules.supplements.items.map(normalizeSupplementItem);
          if (!saved.modules.supplements.medSeeded) {
            const existingNames = new Set(saved.modules.supplements.items.map(i => i.name));
            const meds = createMedSupplementItems().filter(i => !existingNames.has(i.name));
            saved.modules.supplements.items = saved.modules.supplements.items.concat(meds);
            saved.modules.supplements.medSeeded = true;
          }
          migrateSupplementList(saved);
        }
        if (!saved.modules.body || !Array.isArray(saved.modules.body.records)) {
          saved.modules.body = { records: [] };
        }
        if (!saved.modules.reading || !Array.isArray(saved.modules.reading.records)) {
          saved.modules.reading = { records: [] };
        }
        if (!saved.modules.shopping || !Array.isArray(saved.modules.shopping.items)) {
          saved.modules.shopping = { planSeeded: true, items: createShoppingPlanItems() };
        } else if (!saved.modules.shopping.planSeeded) {
          saved.modules.shopping.planSeeded = true;
          saved.modules.shopping.items = createShoppingPlanItems().concat(saved.modules.shopping.items);
        }
        if (!saved.achievements || typeof saved.achievements !== 'object') saved.achievements = {};
        // V1 新增字段
        if (!saved.modules.qa) saved.modules.qa = { expanded: [] };
        if (!saved.modules.sleepPlan || typeof saved.modules.sleepPlan !== 'object') {
          saved.modules.sleepPlan = { records: {}, nightWindows: {}, sleepHours: {}, trainingDone: {} };
        }
        // V1 新增：健身记录默认4项训练
        if (!saved.modules.fitness) saved.modules.fitness = {};
        if (!Array.isArray(saved.modules.fitness.habits) || saved.modules.fitness.habits.length === 0) {
          saved.modules.fitness.habits = [
            { id: 101, name: '凯格尔运动', icon: '⭐', type: 'daily', records: [], note: '盆底肌训练：收紧盆底肌保持5秒→放松5秒，算1次。每天3组×10次，早中晚各一组。坐着/站着/躺着都能做。' },
            { id: 102, name: '深蹲', icon: '🦵', type: 'daily', records: [], note: '双脚与肩同宽，屁股往后坐，膝盖不超过脚尖太多，蹲到大腿与地面平行。每天3组×15个。可抱水桶/米袋负重。' },
            { id: 103, name: '臀桥', icon: '🍑', type: 'daily', records: [], note: '仰卧屈膝，脚掌踩地，用臀部力量把身体顶起，肩背贴床，成一条直线。顶端夹臀停2秒→缓慢放下。每天3组×15个。' },
            { id: 104, name: '平板支撑', icon: '📐', type: 'daily', records: [], note: '前臂支撑，身体成一条直线，不塌腰不撅屁股。每次30秒，每天3次。能做到1分钟后再进阶。睡眠不足6小时时跳过。' }
          ];
        }
        fromVersion = 1;
      }

      saved.schemaVersion = toVersion;
    }

    function loadData() {
      let raw = null;
      try { raw = localStorage.getItem(LS_KEY); } catch (e) { raw = null; }
      if (raw === null || raw === '') return initData();   // 首次使用，没有历史数据
      try {
        const saved = JSON.parse(raw);
        if (saved && saved.modules) {
          const fromVersion = typeof saved.schemaVersion === 'number' ? saved.schemaVersion : 0;
          runMigrations(saved, fromVersion, CURRENT_SCHEMA_VERSION);
          return saved;
        }
        // 能解析但不是本应用的数据结构 —— 同样按损坏处理，先抢救再停写
        const rk = rescueRawData(raw);
        storageHealthy = false;
        console.log('loadData: 数据结构异常（缺少 modules）');
        warnStorageOnce('⚠️ 检测到本地数据格式异常，已暂停写入以保护原始数据。\n\n请先到「工具菜单 → 备份 → 导出备份」保存一份，再处理，不要直接重置。'
          + (rk ? '\n（原始数据已另存为救援副本）' : ''));
      } catch(e) {
        const rk = rescueRawData(raw);
        storageHealthy = false;
        console.log('loadData 解析失败:', e);
        warnStorageOnce('⚠️ 检测到本地数据损坏，已暂停写入以保护原始数据。\n\n请不要重置数据，先到「工具菜单 → 备份 → 导出备份」导出，再处理。'
          + (rk ? '\n（原始数据已另存为救援副本）' : ''));
      }
      return initData();
    }

    function saveData() {
      // 保护：数据损坏时本会话一律不写回，避免用空数据覆盖还能抢救的原始字符串
      if (!storageHealthy) {
        console.log('saveData: 本次会话存储状态异常，已跳过写入以保护原始数据');
        return;
      }
      // 保护：防止保存空数据
      if (!data || !data.modules || !data.modules.daily || !Array.isArray(data.modules.daily.habits)) {
        console.log('saveData: 数据不完整，跳过保存');
        return;
      }
      persistData(data).catch(e => {
        console.log('saveData 失败:', e);
        if (isQuotaError(e)) {
          warnStorageOnce('⚠️ 手机存储空间已满，本次改动没有保存成功。\n\n请到「工具菜单 → 备份」导出备份，并删除一些自动备份后再试。');
        } else {
          warnStorageOnce('⚠️ 数据保存失败：' + (e && e.message ? e.message : e) + '\n\n建议先导出一份备份。');
        }
      });
    }

    function validateAndRepairData() {
      if (!data || !data.modules) {
        data = initData();
        return;
      }
      let repaired = false;
      if (!data.achievements || typeof data.achievements !== 'object') {
        data.achievements = {};
        repaired = true;
      }
      const base = JSON.parse(JSON.stringify(initData().modules));
      for (const key of Object.keys(base)) {
        if (!data.modules[key]) {
          data.modules[key] = base[key];
          repaired = true;
        }
      }
      ['daily', 'study', 'game', 'fitness', 'cycle', 'free'].forEach(key => {
        const mod = data.modules[key];
        if (!mod || !Array.isArray(mod.habits)) {
          if (mod) mod.habits = [];
          repaired = true;
        } else {
          mod.habits.forEach(h => {
            if (!Array.isArray(h.records)) {
              h.records = [];
              repaired = true;
            }
          });
        }
      });
      if (data.modules.free && Array.isArray(data.modules.free.habits)) {
        data.modules.free.habits.forEach(h => {
          if (!h.fuelRecords || typeof h.fuelRecords !== 'object') {
            h.fuelRecords = {};
            repaired = true;
          }
        });
        if (!data.modules.free.habits.some(h => h.name === '加油') && data.modules.free.fuelSeeded !== true && data.modules.free.fuelSeeded !== 'removed') {
          const maxId = data.modules.free.habits.reduce((m, h) => Math.max(m, Number(h.id) || 0), 0);
          data.modules.free.habits.push({
            id: maxId + 1,
            name: '加油',
            icon: '⛽',
            type: 'daily',
            records: [],
            fuelRecords: {}
          });
          data.modules.free.fuelSeeded = true;
          repaired = true;
        }
      }
      if (!data.modules.daily || !Array.isArray(data.modules.daily.tomorrowPlans)) {
        if (data.modules.daily) data.modules.daily.tomorrowPlans = [];
        repaired = true;
      } else {
        const validPlans = data.modules.daily.tomorrowPlans.filter(p => p && p.id && p.text && p.targetDate);
        if (validPlans.length !== data.modules.daily.tomorrowPlans.length) {
          data.modules.daily.tomorrowPlans = validPlans;
          repaired = true;
        }
      }
      const fin = data.modules.finance;
      if (!fin) {
        data.modules.finance = base.finance;
        repaired = true;
      } else {
        if (typeof fin.targetAmount !== 'number' || isNaN(fin.targetAmount)) { fin.targetAmount = 10000; repaired = true; }
        if (typeof fin.currentAmount !== 'number' || isNaN(fin.currentAmount)) { fin.currentAmount = 0; repaired = true; }
        if (typeof fin.monthlyBudget !== 'number' || isNaN(fin.monthlyBudget)) { fin.monthlyBudget = 0; repaired = true; }
        if (!Array.isArray(fin.transactions)) { fin.transactions = []; repaired = true; }
        if (!fin.marketData || typeof fin.marketData !== 'object') { fin.marketData = {}; repaired = true; }
        if (!fin.marketHistory || typeof fin.marketHistory !== 'object') { fin.marketHistory = {}; repaired = true; }
        if (!Array.isArray(fin.funds)) { fin.funds = []; repaired = true; }
        if (!Array.isArray(fin.habits)) { fin.habits = []; repaired = true; }
        if (!Array.isArray(fin.deposits)) { fin.deposits = createDefaultDeposits(); repaired = true; }
        if (!fin.depositStartDate) { fin.depositStartDate = getTodayStr(); repaired = true; }
      }
      if (!Array.isArray(data.modules.manifestation.goals)) {
        data.modules.manifestation.goals = [];
        repaired = true;
      }
      if (!Array.isArray(data.modules.supplements.items)) {
        data.modules.supplements.items = [];
        repaired = true;
      }
      const validSupps = data.modules.supplements.items.filter(i => i && i.name);
      if (validSupps.length !== data.modules.supplements.items.length) {
        data.modules.supplements.items = validSupps;
        repaired = true;
      }
      if (!data.modules.body || !Array.isArray(data.modules.body.records)) {
        data.modules.body = { records: [] };
        repaired = true;
      } else {
        const validBodyRecords = data.modules.body.records.filter(bodyRecordHasData);
        if (validBodyRecords.length !== data.modules.body.records.length) {
          data.modules.body.records = validBodyRecords;
          repaired = true;
        }
      }
      if (!data.modules.reading || !Array.isArray(data.modules.reading.records)) {
        data.modules.reading = { records: [] };
        repaired = true;
      } else {
        const validReadingRecords = data.modules.reading.records.filter(r => r && r.id && r.bookName);
        if (validReadingRecords.length !== data.modules.reading.records.length) {
          data.modules.reading.records = validReadingRecords;
          repaired = true;
        }
      }
      if (!data.modules.shopping || !Array.isArray(data.modules.shopping.items)) {
        data.modules.shopping = { planSeeded: true, items: createShoppingPlanItems() };
        repaired = true;
      } else {
        if (!data.modules.shopping.planSeeded) {
          data.modules.shopping.planSeeded = true;
          data.modules.shopping.items = createShoppingPlanItems().concat(data.modules.shopping.items);
          repaired = true;
        }
        const validShoppingItems = data.modules.shopping.items.filter(i => i && i.id && i.name);
        if (validShoppingItems.length !== data.modules.shopping.items.length) {
          data.modules.shopping.items = validShoppingItems;
          repaired = true;
        }
      }
      if (!data.modules.sleepPlan || typeof data.modules.sleepPlan !== 'object') {
        data.modules.sleepPlan = { records: {}, nightWindows: {} };
        repaired = true;
      } else {
        if (!data.modules.sleepPlan.records || typeof data.modules.sleepPlan.records !== 'object') {
          data.modules.sleepPlan.records = {};
          repaired = true;
        }
        if (!data.modules.sleepPlan.nightWindows || typeof data.modules.sleepPlan.nightWindows !== 'object') {
          data.modules.sleepPlan.nightWindows = {};
          repaired = true;
        }
        if (!data.modules.sleepPlan.sleepHours || typeof data.modules.sleepPlan.sleepHours !== 'object') {
          data.modules.sleepPlan.sleepHours = {};
          repaired = true;
        }
        if (!data.modules.sleepPlan.trainingDone || typeof data.modules.sleepPlan.trainingDone !== 'object') {
          data.modules.sleepPlan.trainingDone = {};
          repaired = true;
        }
      }
      if (data.modules.water) {
        delete data.modules.water;
        repaired = true;
      }
      if (repaired) {
        saveData();
        setTimeout(() => alert('检测到数据异常，已自动修复'), 0);
      } else if (supplementsMigrated) {
        // 补剂清单迁移：静默保存即可，不算"数据异常"，不弹告警
        saveData();
      }
    }

    let undoState = null;
    let undoHideTimer = null;
    let achievementToastTimer = null;

    function captureUndoSnapshot(label) {
      undoState = { label: label, data: JSON.parse(JSON.stringify(data)) };
      const bar = document.getElementById('undoBar');
      const text = document.getElementById('undoText');
      if (bar) bar.style.display = 'flex';
      if (text) text.textContent = label;
      clearTimeout(undoHideTimer);
      undoHideTimer = setTimeout(hideUndoBar, 8000);
    }

    function undoLastDelete() {
      if (!undoState) return;
      data = undoState.data;
      saveData();
      hideUndoBar();
      renderModule(activeModule);
      updateTotalStats();
      renderNav();
    }

    function hideUndoBar() {
      const bar = document.getElementById('undoBar');
      if (bar) bar.style.display = 'none';
      undoState = null;
      clearTimeout(undoHideTimer);
    }

    function setupUpdatePrompt(reg) {
      // 1. 监听新 Service Worker 安装
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // 有新版本可用，显示更新提示
            showUpdateToast();
          }
        });
      });
      // 2. 每次启动时主动检查更新（不依赖页面刷新）
      setTimeout(() => {
        reg.update().catch(() => {});
      }, 3000);
    }

    function showUpdateToast() {
      // 创建更新提示条
      let bar = document.getElementById('updateBanner');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'updateBanner';
        bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:linear-gradient(90deg,#64ffda,#00d4ff);color:#0f0f23;padding:10px 16px;font-size:14px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:12px;transform:translateY(-100%);transition:transform 0.3s ease;box-shadow:0 2px 12px rgba(0,212,255,0.3);';
        bar.innerHTML = '<span>🎉 发现新版本，点击更新</span><button style="background:#0f0f23;color:#64ffda;border:none;padding:6px 14px;border-radius:20px;font-size:13px;font-weight:600;cursor:pointer;">立即更新</button>';
        bar.querySelector('button').onclick = () => {
          // 强制跳过等待并刷新
          if (navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({ action: 'skipWaiting' });
          }
          location.reload();
        };
        document.body.appendChild(bar);
      }
      // 动画显示
      requestAnimationFrame(() => { bar.style.transform = 'translateY(0)'; });
    }

    function getReminderSettings() {
      try {
        return JSON.parse(localStorage.getItem(REMINDER_KEY)) || {};
      } catch(e) {
        return {};
      }
    }

    function openReminderModal() {
      const s = getReminderSettings();
      const slots = s.slotTimes || {};
      document.getElementById('reminderEnabled').checked = !!s.enabled;
      document.getElementById('reminderCheckinTime').value = s.checkinTime || '09:00';
      document.getElementById('reminderSmartMode').checked = s.smartMode !== false;
      document.getElementById('reminderMorningTime').value = slots.morning || '08:30';
      document.getElementById('reminderNoonTime').value = slots.noon || '12:30';
      document.getElementById('reminderEveningTime').value = slots.evening || s.supplementTime || '20:00';
      document.getElementById('reminderWorkoutTime').value = slots.workout || '18:30';
      document.getElementById('reminderOverlay').classList.add('show');
    }

    function closeReminderModal(e) {
      if (e && e.target !== document.getElementById('reminderOverlay')) return;
      document.getElementById('reminderOverlay').classList.remove('show');
    }

    function saveReminderSettings() {
      const settings = {
        enabled: !!document.getElementById('reminderEnabled').checked,
        smartMode: !!document.getElementById('reminderSmartMode').checked,
        checkinTime: document.getElementById('reminderCheckinTime').value || '09:00',
        slotTimes: {
          morning: document.getElementById('reminderMorningTime').value || '08:30',
          noon: document.getElementById('reminderNoonTime').value || '12:30',
          evening: document.getElementById('reminderEveningTime').value || '20:00',
          workout: document.getElementById('reminderWorkoutTime').value || '18:30'
        },
        lastCheckinDate: null,
        lastSupplementSlots: {}
      };
      localStorage.setItem(REMINDER_KEY, JSON.stringify(settings));
      if (settings.enabled && 'Notification' in window && Notification.permission !== 'granted') {
        Notification.requestPermission().then(perm => {
          if (perm !== 'granted') alert('未获得通知权限，提醒不会显示');
        });
      }
      closeReminderModal();
      startReminderLoop();
    }

    function startReminderLoop() {
      clearInterval(reminderTimer);
      reminderTimer = setInterval(checkAndSendReminders, 30000);
      checkAndSendReminders();
    }

    function hasPendingCheckins() {
      const todayStr = getTodayStr();
      for (const modId of Object.keys(data.modules)) {
        const mod = data.modules[modId];
        if (!mod || !Array.isArray(mod.habits)) continue;
        for (const h of mod.habits) {
          if (h.type === 'daily' && !h.records.includes(todayStr)) return true;
          if (h.type === 'period' && isPeriodDay(h, todayStr) && !h.records.includes(todayStr)) return true;
          if (h.type === 'cycle' && isCycleCheckable(h, getCycleState(h, todayStr)) && !h.records.includes(todayStr)) return true;
        }
      }
      return false;
    }

    function checkAndSendReminders() {
      const s = getReminderSettings();
      if (!s.enabled) return;
      const now = new Date();
      const hm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
      const todayStr = getTodayStr();
      if (hm === s.checkinTime && s.lastCheckinDate !== todayStr) {
        s.lastCheckinDate = todayStr;
        localStorage.setItem(REMINDER_KEY, JSON.stringify(s));
        if (!s.smartMode || hasPendingCheckins()) {
          sendReminderNotification('成长打卡', s.smartMode ? '今天还有未完成项目，记得完成打卡' : '到打卡时间了，记得完成今天的习惯');
        }
        const pendingPlans = getTomorrowPlans().filter(p => p.targetDate <= todayStr && !p.doneDate);
        if (pendingPlans.length) {
          sendReminderNotification('昨日待办提醒', '还没记录：' + pendingPlans.slice(0, 2).map(p => p.text).join('、'));
        }
      }
      const slotTimes = s.slotTimes || {};
      const slotLabels = { morning: '早晨', noon: '中午', evening: '晚上', workout: '运动后' };
      for (const slot of Object.keys(slotLabels)) {
        const time = slotTimes[slot] || (slot === 'evening' ? s.supplementTime : '');
        if (!time || hm !== time) continue;
        const notified = s.lastSupplementSlots || {};
        if (notified[slot] === todayStr) continue;
        notified[slot] = todayStr;
        s.lastSupplementSlots = notified;
        localStorage.setItem(REMINDER_KEY, JSON.stringify(s));
        const slotItems = (data.modules.supplements && data.modules.supplements.items ? data.modules.supplements.items : [])
          .filter(i => (i.timeSlot || 'noon') === slot);
        if (!slotItems.length) continue;
        const pending = slotItems.filter(i => shouldTakeSupplement(i, todayStr) && !isSupplementTakenOn(i, todayStr)).map(i => i.name);
        if (pending.length) {
          sendReminderNotification('补剂提醒', slotLabels[slot] + '还有未服用：' + pending.slice(0, 3).join('、'));
        } else if (!s.smartMode) {
          sendReminderNotification('补剂提醒', '到' + slotLabels[slot] + '补剂时间了，记得查看补剂明细');
        }
      }
    }

    function sendReminderNotification(title, body) {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      const options = { body: body, icon: 'icon-192.png', badge: 'icon-192.png' };
      try {
        if (navigator.serviceWorker && navigator.serviceWorker.ready) {
          navigator.serviceWorker.ready.then(reg => reg.showNotification(title, options)).catch(() => {});
        } else {
          new Notification(title, options);
        }
      } catch(e) {}
    }

    function checkPinLock() {
      const pin = localStorage.getItem(PIN_KEY);
      if (!pin) return;
      appUnlocked = false;
      const overlay = document.getElementById('lockOverlay');
      const input = document.getElementById('lockPinInput');
      if (overlay) overlay.style.display = 'flex';
      if (input) input.value = '';
      setTimeout(() => input && input.focus(), 100);
    }

    function unlockApp() {
      const input = document.getElementById('lockPinInput');
      const pin = localStorage.getItem(PIN_KEY);
      if (!pin) return;
      if (input.value !== pin) {
        input.value = '';
        input.focus();
        showInfoToast('PIN 不正确，请重试');
        return;
      }
      appUnlocked = true;
      document.getElementById('lockOverlay').style.display = 'none';
    }

    function openPinModal() {
      const hasPin = !!localStorage.getItem(PIN_KEY);
      document.getElementById('pinCurrent').value = '';
      document.getElementById('pinNew').value = '';
      document.getElementById('pinConfirm').value = '';
      document.getElementById('pinOverlay').classList.add('show');
      document.getElementById('pinCurrent').placeholder = hasPin ? '当前 PIN' : '未设置，保持留空';
    }

    function closePinModal(e) {
      if (e && e.target !== document.getElementById('pinOverlay')) return;
      document.getElementById('pinOverlay').classList.remove('show');
    }

    function savePinSettings() {
      const currentPin = localStorage.getItem(PIN_KEY) || '';
      const currentInput = document.getElementById('pinCurrent').value;
      const newPin = document.getElementById('pinNew').value;
      const confirmPin = document.getElementById('pinConfirm').value;
      if (currentPin && currentInput !== currentPin) {
        alert('当前 PIN 不正确');
        return;
      }
      if (newPin || confirmPin) {
        if (!/^\d{4,6}$/.test(newPin)) {
          alert('PIN 必须是 4-6 位数字');
          return;
        }
        if (newPin !== confirmPin) {
          alert('两次输入的新 PIN 不一致');
          return;
        }
        localStorage.setItem(PIN_KEY, newPin);
        showInfoToast('PIN 已设置，下次打开需要解锁');
      } else {
        localStorage.removeItem(PIN_KEY);
        appUnlocked = true;
        showInfoToast('PIN 保护已关闭');
      }
      closePinModal();
    }

    function escapeHtml(str) {
      return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    // ========== 输入边界校验 ==========
    const VALIDATORS = {
      weight: { min: 30, max: 300, unit: 'kg', label: '体重' },
      height: { min: 50, max: 300, unit: 'cm', label: '身高' },
      waist: { min: 40, max: 200, unit: 'cm', label: '腰围' },
      systolic: { min: 60, max: 250, unit: 'mmHg', label: '收缩压' },
      diastolic: { min: 30, max: 160, unit: 'mmHg', label: '舒张压' },
      heartRate: { min: 30, max: 220, unit: 'bpm', label: '静息心率' },
      sleepHours: { min: 0, max: 24, unit: '小时', label: '睡眠时长' },
      temperature: { min: 34, max: 42, unit: '°C', label: '体温' },
      supplementDosage: { min: 0, max: 5000, unit: 'mg', label: '单次剂量' },
      financeAmount: { min: -9999999, max: 9999999, unit: '元', label: '金额' }
    };

    function clampValue(value, type) {
      const v = Number(value);
      if (isNaN(v)) return { valid: false, value: null, msg: '请输入数字' };
      const rule = VALIDATORS[type];
      if (!rule) return { valid: true, value: v };
      if (v < rule.min || v > rule.max) {
        return { valid: false, value: null, msg: `${rule.label}应在 ${rule.min}–${rule.max} ${rule.unit} 之间` };
      }
      return { valid: true, value: v };
    }

    function sanitizeText(text, maxLength = 500) {
      const s = String(text == null ? '' : text).trim();
      if (s.length > maxLength) return s.slice(0, maxLength);
      return s;
    }

    function getTodayStr() {
      const d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    }

    function formatDateCN(d) {
      const week = ['周日','周一','周二','周三','周四','周五','周六'];
      return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日 ${week[d.getDay()]}`;
    }

    function daysBetween(d1, d2) {
      const a = new Date(d1 + 'T00:00:00');
      const b = new Date(d2 + 'T00:00:00');
      return Math.floor((b - a) / (1000 * 60 * 60 * 24));
    }

    function getCycleState(habit, dateStr) {
      const diff = daysBetween(habit.cycleStart, dateStr);
      const idx = ((diff % habit.cycleLength) + habit.cycleLength) % habit.cycleLength;
      return habit.cycleStates[idx];
    }

    function isCycleCheckable(habit, state) {
      return !!state && /喂/.test(state);
    }

    function isPeriodDay(habit, dateStr) {
      const diff = daysBetween(habit.baseDate, dateStr);
      return diff >= 0 && diff % habit.period === 0;
    }

    function getDaysUntilNext(habit, dateStr) {
      const diff = daysBetween(habit.baseDate, dateStr);
      if (diff < 0) return null;
      const mod = diff % habit.period;
      if (mod === 0) return 0;
      return habit.period - mod;
    }

    function getCycleStateClass(state) {
      const map = { '休息': 'rest', '白班': 'work', '夜班': 'night', '下夜班': 'off', '喂食': 'feed', '停喂': 'stop' };
      return map[state] || 'rest';
    }

    function getStreak(records) {
      if (!records || !records.length) return 0;
      const set = new Set(records);
      let d = new Date();
      let streak = 0;
      const todayStr = getTodayStr();
      if (!set.has(todayStr)) { d.setDate(d.getDate() - 1); }
      while (true) {
        const s = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
        if (set.has(s)) { streak++; d.setDate(d.getDate() - 1); }
        else break;
      }
      return streak;
    }

    function initData() {
      return {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        achievements: {},
        modules: {
          daily: {
            tomorrowPlans: [],
            habits: [
              { id: 1, name: '戒除', icon: '🚫', type: 'daily', records: [] },
              { id: 2, name: '吃早饭', icon: '🍳', type: 'daily', records: [] },
              { id: 3, name: '早睡早起', icon: '😴', type: 'daily', records: [] },
              { id: 4, name: '学习', icon: '📚', type: 'daily', records: [] },
              { id: 5, name: '练字', icon: '✒️', type: 'daily', records: [] },
              { id: 6, name: '盘串', icon: '📿', type: 'daily', records: [] },
              { id: 7, name: '显化', icon: '✨', type: 'daily', records: [] },
              { id: 8, name: '摸鱼', icon: '🐟', type: 'daily', records: [] },
              { id: 9, name: '打游戏', icon: '🎮', type: 'daily', records: [] },
              { id: 10, name: '写记录', icon: '📝', type: 'daily', records: [] },
              { id: 11, name: '听歌', icon: '🎵', type: 'daily', records: [] },
              { id: 12, name: '攒钱', icon: '💰', type: 'daily', records: [] },
              { id: 13, name: '社交', icon: '👥', type: 'daily', records: [] },
              { id: 14, name: '锻炼', icon: '💪', type: 'daily', records: [] },
              { id: 15, name: '吃补剂', icon: '💊', type: 'daily', records: [] }
            ]
          },
          study: { habits: [] },
          game: { habits: [] },
          fitness: {
            habits: [
              { id: 101, name: '凯格尔运动', icon: '⭐', type: 'daily', records: [], note: '盆底肌训练：收紧盆底肌保持5秒→放松5秒，算1次。每天3组×10次，早中晚各一组。坐着/站着/躺着都能做。' },
              { id: 102, name: '深蹲', icon: '🦵', type: 'daily', records: [], note: '双脚与肩同宽，屁股往后坐，膝盖不超过脚尖太多，蹲到大腿与地面平行。每天3组×15个。可抱水桶/米袋负重。' },
              { id: 103, name: '臀桥', icon: '🍑', type: 'daily', records: [], note: '仰卧屈膝，脚掌踩地，用臀部力量把身体顶起，肩背贴床，成一条直线。顶端夹臀停2秒→缓慢放下。每天3组×15个。' },
              { id: 104, name: '平板支撑', icon: '📐', type: 'daily', records: [], note: '前臂支撑，身体成一条直线，不塌腰不撅屁股。每次30秒，每天3次。能做到1分钟后再进阶。睡眠不足6小时时跳过。' }
            ]
          },
          finance: { 
            targetAmount: 10000,
            currentAmount: 0,
            monthlyBudget: 0,
            transactions: [],
            marketData: {},
            marketHistory: {},
            funds: [],
            habits: [],
            deposits: createDefaultDeposits(),
            depositStartDate: '2026-10-23'
          },
          cycle: {
            habits: [
              { id: 16, name: '上班', icon: '💼', type: 'cycle',
                cycleStart: '2026-08-08', cycleLength: 4,
                cycleStates: ['休息','白班','夜班','下夜班'],
                records: [] },
              { id: 17, name: '喂鱼', icon: '🐠', type: 'cycle',
                cycleStart: '2026-08-08', cycleLength: 4,
                cycleStates: ['喂食','停喂','喂食','喂食'],
                records: [] },
              { id: 18, name: '浇花', icon: '🌱', type: 'period',
                period: 5, baseDate: '2026-08-08', records: [], notes: {} },
              { id: 19, name: '起飞', icon: '🚀', type: 'period',
                period: 14, baseDate: '2026-08-08', records: [], notes: {} }
            ]
          },
          free: {
            habits: [
              { id: 20, name: '按摩', icon: '💆', type: 'daily', records: [], fuelRecords: {} },
              { id: 21, name: '色色', icon: '🔞', type: 'daily', records: [], fuelRecords: {} },
              { id: 22, name: '骑车', icon: '🚴', type: 'daily', records: [], fuelRecords: {} },
              { id: 23, name: '摄影', icon: '📷', type: 'daily', records: [], fuelRecords: {} },
              { id: 24, name: '购物', icon: '🛍️', type: 'daily', records: [], fuelRecords: {} },
              { id: 25, name: '旅游', icon: '✈️', type: 'daily', records: [], fuelRecords: {} },
              { id: 26, name: '加油', icon: '⛽', type: 'daily', records: [], fuelRecords: {} }
            ]
          },
          manifestation: {
            goals: [
              { id: 1, title: '显化示例：获得理想工作', description: '我相信宇宙会为我安排最好的', targetDate: '2026-12-31', status: 'active', records: [], createdAt: '2026-08-08' }
            ]
          },
          supplements: {
            items: createDefaultSupplementItems()
          },
          body: {
            records: []
          },
          reading: {
            records: []
          },
          shopping: {
            planSeeded: true,
            items: createShoppingPlanItems()
          },
          qa: {
            expanded: []
          },
          sleepPlan: {
            records: {},
            nightWindows: {},
            sleepHours: {},
            trainingDone: {}
          }
        }
      };
    }

    function vibrate(pattern) {
      if (navigator && typeof navigator.vibrate === 'function') {
        try { navigator.vibrate(pattern); } catch(e) {}
      }
    }

    // 彩带动画
    function spawnConfetti(x, y) {
      const colors = ['#64ffda', '#bd34fe', '#00d4ff', '#00e676', '#ffd740', '#ff6b6b'];
      const container = document.createElement('div');
      container.className = 'confetti-container';
      container.style.left = x + 'px';
      container.style.top = y + 'px';
      document.body.appendChild(container);

      for (let i = 0; i < 12; i++) {
        const piece = document.createElement('div');
        piece.className = 'confetti-piece';
        piece.style.background = colors[Math.floor(Math.random() * colors.length)];
        piece.style.left = (Math.random() * 40 - 20) + 'px';
        piece.style.top = (Math.random() * 20 - 10) + 'px';
        piece.style.animationDelay = (Math.random() * 0.2) + 's';
        piece.style.animationDuration = (0.6 + Math.random() * 0.4) + 's';
        piece.style.transform = `rotate(${Math.random() * 360}deg)`;
        container.appendChild(piece);
      }
      setTimeout(() => container.remove(), 1200);
    }

    function switchModule(moduleId) {
      activeModule = moduleId;
      const navMoreOverlay = document.getElementById('navMoreOverlay');
      if (navMoreOverlay) navMoreOverlay.classList.remove('show');
      document.body.classList.remove('nav-more-open');
      renderNav();
      renderModule(moduleId);
    }

    function moduleHasPending(id) {
      const mod = data.modules[id];
      if (!mod) return false;
      if (id === 'supplements' && mod.items) {
        return mod.items.some(i => !isSupplementTakenOn(i, today));
      }
      if (id === 'sleepPlan') {
        const steps = getSleepStepsForDate(today);
        const done = getSleepPlan().records[today] || [];
        return steps.some(s => done.indexOf(s.id) === -1);
      }
      if (id === 'fitness') {
        return !getSleepPlan().trainingDone[today];
      }
      if (mod.habits) {
        for (const h of mod.habits) {
          if (h.type === 'daily' && !h.records.includes(today)) return true;
          if (h.type === 'period' && isPeriodDay(h, today) && !h.records.includes(today)) return true;
          if (h.type === 'cycle' && isCycleCheckable(h, getCycleState(h, today)) && !h.records.includes(today)) return true;
        }
      }
      return false;
    }

    function openHeaderMenu() {
      const overlay = document.getElementById('headerMenuOverlay');
      if (overlay) overlay.classList.add('show');
    }

    function closeHeaderMenu(e) {
      const overlay = document.getElementById('headerMenuOverlay');
      if (!overlay) return;
      if (e && e.target !== overlay) return;
      overlay.classList.remove('show');
    }

    function openNavMore() {
      const grid = document.getElementById('navMoreGrid');
      if (grid) {
        grid.innerHTML = MODULE_ORDER.filter(id => NAV_PRIMARY_IDS.indexOf(id) === -1).map(id => {
          const cfg = MODULE_CONFIG[id];
          const isActive = activeModule === id;
          return `
            <button class="nav-more-item ${isActive ? 'active' : ''} ${moduleHasPending(id) ? 'has-pending' : ''}" style="--nav-color:${cfg.color}" onclick="switchModule('${id}')">
              <span class="nav-icon">${cfg.icon}</span>
              <span>${cfg.name}</span>
            </button>
          `;
        }).join('');
      }
      const overlay = document.getElementById('navMoreOverlay');
      if (overlay) overlay.classList.add('show');
      document.body.classList.add('nav-more-open');
    }

    function closeNavMore(e) {
      const overlay = document.getElementById('navMoreOverlay');
      if (!overlay) return;
      if (e && e.target !== overlay) return;
      overlay.classList.remove('show');
      document.body.classList.remove('nav-more-open');
    }

    function scrollActiveNavIntoView() {
      const container = document.getElementById('navItems');
      const active = container && container.querySelector('.nav-item.active');
      if (!container || !active) return;
      const target = active.offsetLeft - (container.clientWidth - active.offsetWidth) / 2;
      const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
      const left = Math.min(Math.max(0, target), maxLeft);
      try {
        container.scrollTo({ left: left, behavior: 'smooth' });
      } catch(e) {
        container.scrollLeft = left;
      }
    }

    function renderNav() {
      const nav = document.getElementById('navItems');
      const moreIds = MODULE_ORDER.filter(id => NAV_PRIMARY_IDS.indexOf(id) === -1);
      const moreHasPending = moreIds.some(id => moduleHasPending(id));
      nav.innerHTML = NAV_PRIMARY_IDS.map(id => {
        const cfg = MODULE_CONFIG[id];
        const isActive = id === activeModule;
        const hasPending = moduleHasPending(id);
        return `
          <button class="nav-item ${isActive ? 'active' : ''} ${hasPending ? 'has-pending' : ''}" style="--nav-color:${cfg.color}" onclick="switchModule('${id}')">
            <span class="nav-icon">${cfg.icon}</span>
            <span class="nav-label">${cfg.name}</span>
            <span class="nav-indicator"></span>
            <span class="nav-dot"></span>
          </button>
        `;
      }).join('') + `
        <button class="nav-item nav-more-btn ${NAV_PRIMARY_IDS.indexOf(activeModule) === -1 ? 'active' : ''} ${moreHasPending ? 'has-pending' : ''}" style="--nav-color:#64ffda" onclick="openNavMore()" title="更多模块">
          <span class="nav-icon">•••</span>
          <span class="nav-label">更多</span>
          <span class="nav-indicator"></span>
          <span class="nav-dot"></span>
        </button>
      `;
      setTimeout(() => scrollActiveNavIntoView(), 0);
    }

    function addHabit() {
      const input = document.getElementById('moduleInput');
      const name = input.value.trim();
      if (!name) return;
      const mod = data.modules[activeModule];
      const allHabits = Object.values(data.modules).reduce((acc, m) => acc.concat(m.habits || []), []);
      const habit = {
        id: Date.now(),
        name: name,
        icon: ICONS[allHabits.length % ICONS.length],
        type: 'daily',
        records: []
      };
      mod.habits.push(habit);
      saveData();
      input.value = '';
      renderModule(activeModule);
      updateTotalStats();
      renderNav();
    }


    // ========== 财务管理专用函数 ==========
    function formatMoney(num) {
      return '¥' + Number(num).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function getFinanceStats() {
      const fin = data.modules.finance;
      const target = fin.targetAmount || 0;
      // 当前存款 = 存款资产总本金 + 全部收支流水净额（与「存款资产」区块实时联动）
      const deposits = Array.isArray(fin.deposits) ? fin.deposits : [];
      const depositPrincipal = deposits.reduce((s, d) => s + (Number(d.amount) || 0), 0);
      const txNet = (fin.transactions || []).reduce((s, t) => s + (t.type === 'income' ? (Number(t.amount) || 0) : -(Number(t.amount) || 0)), 0);
      const current = depositPrincipal + txNet;
      const budget = fin.monthlyBudget || 0;
      const pct = target > 0 ? Math.min(100, Math.round(current / target * 100)) : 0;
      const remaining = Math.max(0, target - current);
      const txs = fin.transactions || [];
      const now = new Date();
      const monthTxs = txs.filter(t => {
        const d = new Date(t.date + 'T00:00:00');
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      });
      const monthIncome = monthTxs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
      const monthExpense = monthTxs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
      const monthSpent = monthExpense;
      const budgetRemaining = Math.max(0, budget - monthSpent);
      const budgetPct = budget > 0 ? Math.min(100, Math.round(monthSpent / budget * 100)) : 0;
      const categoryMap = {};
      monthTxs.filter(t => t.type === 'expense').forEach(t => {
        const cat = t.category || '其他';
        categoryMap[cat] = (categoryMap[cat] || 0) + t.amount;
      });
      const expenseCategories = Object.entries(categoryMap)
        .map(([name, amount]) => ({ name: name, amount: amount }))
        .sort((a, b) => b.amount - a.amount);
      return { target, current, budget, pct, remaining, txs, monthIncome, monthExpense, monthSpent, budgetRemaining, budgetPct, expenseCategories };
    }

    function getFinanceTrend() {
      const txs = data.modules.finance.transactions || [];
      const months = [];
      const now = new Date();
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        months.push({ key: key, label: (d.getMonth() + 1) + '月', income: 0, expense: 0 });
      }
      txs.forEach(tx => {
        if (!tx.date) return;
        const d = new Date(tx.date + 'T00:00:00');
        const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        const month = months.find(m => m.key === key);
        if (!month) return;
        if (tx.type === 'income') month.income += tx.amount;
        else month.expense += tx.amount;
      });
      return months;
    }

    function renderFinanceTrendHtml() {
      const trend = getFinanceTrend();
      const max = Math.max(1, ...trend.reduce((acc, m) => acc.concat([m.income, m.expense]), []));
      const bars = trend.map(m => {
        const incomeH = Math.max(2, Math.round(m.income / max * 100));
        const expenseH = Math.max(2, Math.round(m.expense / max * 100));
        return `
          <div class="trend-bar-item">
            <div class="trend-pair">
              <div class="trend-bar-track"><div class="trend-bar-fill" style="height:${incomeH}%" title="收入 ${formatMoney(m.income)}"></div></div>
              <div class="trend-bar-track"><div class="trend-bar-fill expense" style="height:${expenseH}%" title="支出 ${formatMoney(m.expense)}"></div></div>
            </div>
            <div class="trend-bar-label">${m.label}</div>
          </div>
        `;
      }).join('');
      return `
        <div class="trend-section">
          <div class="trend-section-title">📈 近 6 月收支趋势</div>
          <div class="trend-bars">${bars}</div>
        </div>
      `;
    }

    function exportFinanceCSV() {
      const txs = (data.modules.finance.transactions || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
      const rows = [['日期', '类型', '分类', '金额', '备注']];
      txs.forEach(tx => {
        rows.push([
          tx.date || '',
          tx.type === 'income' ? '收入' : '支出',
          tx.category || '其他',
          String(tx.amount),
          (tx.note || '').replace(/[\r\n,]+/g, ' ')
        ]);
      });
      const csv = '\ufeff' + rows.map(r => r.join(',')).join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '财务收支_' + getTodayStr() + '.csv';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 0);
    }

    function openFinanceTargetModal() {
      const fin = data.modules.finance;
      document.getElementById('targetInput').value = fin.targetAmount || '';
      document.getElementById('budgetInput').value = fin.monthlyBudget || '';
      document.getElementById('targetNoteInput').value = fin.targetNote || '';
      document.getElementById('targetOverlay').classList.add('show');
    }

    function closeTargetModal(e) {
      if (e && e.target !== document.getElementById('targetOverlay')) return;
      document.getElementById('targetOverlay').classList.remove('show');
    }

    function saveTarget() {
      const val = parseFloat(document.getElementById('targetInput').value);
      const budgetVal = parseFloat(document.getElementById('budgetInput').value);
      const note = document.getElementById('targetNoteInput').value.trim();
      if (isNaN(val) || val < 0) { alert('请输入有效的目标金额'); return; }
      data.modules.finance.targetAmount = val;
      data.modules.finance.monthlyBudget = isNaN(budgetVal) || budgetVal < 0 ? 0 : budgetVal;
      data.modules.finance.targetNote = note;
      saveData();
      closeTargetModal();
      renderModule('finance');
      updateTotalStats();
    }

    function openTransactionModal(type) {
      document.getElementById('txType').value = type;
      const categories = type === 'income'
        ? ['工资', '奖金', '理财', '兼职', '其他']
        : ['餐饮', '交通', '购物', '娱乐', '学习', '医疗', '居住', '其他'];
      document.getElementById('txCategory').innerHTML = categories.map(c => `<option value="${c}">${c}</option>`).join('');
      document.getElementById('txAmount').value = '';
      document.getElementById('txNote').value = '';
      document.getElementById('txModalTitle').textContent = type === 'income' ? '💰 记录收入' : '💸 记录支出';
      document.getElementById('txOverlay').classList.add('show');
      setTimeout(() => document.getElementById('txAmount').focus(), 100);
    }

    function closeTxModal(e) {
      if (e && e.target !== document.getElementById('txOverlay')) return;
      document.getElementById('txOverlay').classList.remove('show');
    }

    function saveTransaction() {
      const type = document.getElementById('txType').value;
      const category = sanitizeText(document.getElementById('txCategory').value || '其他', 50);
      const amountRaw = document.getElementById('txAmount').value;
      const note = sanitizeText(document.getElementById('txNote').value, 200);
      const amountCheck = clampValue(amountRaw, 'financeAmount');
      if (!amountCheck.valid) { alert(amountCheck.msg); return; }
      const amount = amountCheck.value;
      if (amount === 0) { alert('金额不能为 0'); return; }

      const tx = {
        id: Date.now(),
        type: type,
        category: category,
        amount: amount,
        note: note,
        date: getTodayStr()
      };
      data.modules.finance.transactions.unshift(tx);
      if (type === 'income') {
        data.modules.finance.currentAmount = (data.modules.finance.currentAmount || 0) + amount;
      } else {
        data.modules.finance.currentAmount = (data.modules.finance.currentAmount || 0) - amount;
      }
      saveData();
      closeTxModal();
      updateFinanceInPlace();
      updateTotalStats();
    }

    function deleteTransaction(id) {
      if (!confirm('确定删除这条记录吗？')) return;
      createAutoBackup('删除收支记录前');
      captureUndoSnapshot('已删除收支记录');
      const fin = data.modules.finance;
      const idx = fin.transactions.findIndex(t => t.id === id);
      if (idx >= 0) {
        const tx = fin.transactions[idx];
        if (tx.type === 'income') {
          fin.currentAmount -= tx.amount;
        } else {
          fin.currentAmount += tx.amount;
        }
        fin.transactions.splice(idx, 1);
        saveData();
        updateFinanceInPlace();
        updateTotalStats();
      }
    }

    // ========== 财务管理渲染 ==========
    function renderTxListHtml(stats) {
      const recentTxs = stats.txs.slice(0, 20);
      if (recentTxs.length === 0) {
        return `
          <div class="empty-state" style="padding:30px 20px">
            <div class="big" style="font-size:36px">📒</div>
            <p style="font-size:13px">还没有收支记录</p>
          </div>
        `;
      }
      return recentTxs.map(tx => {
        const isIncome = tx.type === 'income';
        const color = isIncome ? '#00e676' : '#ff5252';
        const sign = isIncome ? '+' : '-';
        const txDate = tx.date === today ? '今天' : tx.date.slice(5);
        return `
          <div class="tx-item" onclick="deleteTransaction(${tx.id})" title="点击删除">
            <div class="tx-left">
              <div class="tx-icon" style="background:${isIncome ? 'rgba(0,230,118,0.15)' : 'rgba(255,82,82,0.15)'};border-color:${isIncome ? 'rgba(0,230,118,0.25)' : 'rgba(255,82,82,0.25)'};color:${color}">${isIncome ? '↓' : '↑'}</div>
              <div class="tx-info">
                <div class="tx-name">${escapeHtml(tx.note || (isIncome ? '收入' : '支出'))}</div>
                <div class="tx-date">${txDate} · ${escapeHtml(tx.category || '其他')}</div>
              </div>
            </div>
            <div class="tx-amount" style="color:${color}">${sign}${formatMoney(tx.amount)}</div>
          </div>
        `;
      }).join('');
    }

    function updateFinanceInPlace() {
      const txSection = document.querySelector('.tx-section');
      if (!txSection) {
        renderModule('finance');
        return;
      }
      const stats = getFinanceStats();
      txSection.innerHTML = `
        <div class="tx-section-header">
          <span class="tx-section-title">📝 最近记录</span>
          <span class="tx-section-count">共 ${stats.txs.length} 笔</span>
        </div>
        <div class="tx-list">
          ${renderTxListHtml(stats)}
        </div>
      `;
      const amountEl = document.getElementById('currentAmountDisplay');
      if (amountEl) amountEl.textContent = formatMoney(stats.current);
      const todayTxs = (stats.txs || []).filter(t => t.date === today);
      const todayExpense = todayTxs.filter(t => t.type === 'expense').reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
      const todayIncome = todayTxs.filter(t => t.type === 'income').reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
      const todayExpenseEl = document.getElementById('todayExpenseValue');
      if (todayExpenseEl) todayExpenseEl.textContent = formatMoney(todayExpense);
      const todayIncomeEl = document.getElementById('todayIncomeValue');
      if (todayIncomeEl) todayIncomeEl.textContent = formatMoney(todayIncome);
      const todayCountEl = document.getElementById('todayTxCount');
      if (todayCountEl) todayCountEl.textContent = String(todayTxs.length);
      const cardSub = document.querySelector('.finance-card-sub');
      if (cardSub) {
        cardSub.innerHTML = `
          <span>目标 ${formatMoney(stats.target)}</span>
          <span style="color:${stats.remaining > 0 ? '#ff9f43' : '#00e676'}">${stats.remaining > 0 ? '还差 ' + formatMoney(stats.remaining) : '已达成 🎉'}</span>
        `;
      }
      const fill = document.querySelector('.finance-progress-fill');
      if (fill) fill.style.width = stats.pct + '%';
      const text = document.querySelector('.finance-progress-text');
      if (text) text.textContent = stats.pct + '%';
      const budgetCard = document.querySelector('.budget-card');
      if (budgetCard) budgetCard.outerHTML = renderBudgetCardHtml(stats);
      const categorySection = document.querySelector('.category-section');
      if (categorySection) categorySection.outerHTML = renderCategorySectionHtml(stats);
      const trendSection = document.querySelector('.trend-section');
      if (trendSection) trendSection.outerHTML = renderFinanceTrendHtml();
      const mp = document.querySelector('.module-title-bar .m-progress');
      if (mp) mp.textContent = stats.pct + '%';
    }

    function renderBudgetCardHtml(stats) {
      return `
        <div class="finance-card budget-card">
          <div class="finance-card-label">💰 本月支出预算</div>
          <div class="finance-budget-values">
            <span>已用 ${formatMoney(stats.monthSpent)}</span>
            <span>${stats.budget > 0 ? '预算 ' + formatMoney(stats.budget) : '未设置预算'}</span>
          </div>
          ${stats.budget > 0 ? `
            <div class="finance-budget-bar"><div class="finance-budget-fill" style="width:${stats.budgetPct}%"></div></div>
            <div class="finance-budget-sub">${stats.budgetRemaining > 0 ? '剩余 ' + formatMoney(stats.budgetRemaining) : '预算已用完'}</div>
          ` : `
            <div class="finance-budget-sub">点击“设预算”设置本月支出上限</div>
          `}
        </div>
      `;
    }

    function renderCategorySectionHtml(stats) {
      const categoryTotal = stats.expenseCategories.reduce((s, c) => s + c.amount, 0);
      const items = stats.expenseCategories.length ? stats.expenseCategories.map(cat => {
        const catPct = stats.monthExpense > 0 ? Math.round(cat.amount / stats.monthExpense * 100) : 0;
        return `
          <div class="category-item">
            <div class="category-item-head">
              <span class="category-item-name">${escapeHtml(cat.name)}</span>
              <span class="category-item-amount">${formatMoney(cat.amount)} · ${catPct}%</span>
            </div>
            <div class="category-bar"><div class="category-fill" style="width:${catPct}%"></div></div>
          </div>
        `;
      }).join('') : `
        <div class="empty-state" style="padding:24px 20px">
          <div class="big" style="font-size:32px">🗂️</div>
          <p style="font-size:13px">本月还没有支出分类数据</p>
        </div>
      `;
      return `
        <div class="tx-section category-section">
          <div class="tx-section-header">
            <span class="tx-section-title">📊 本月支出分类</span>
            <span class="tx-section-count">${categoryTotal > 0 ? formatMoney(categoryTotal) : '暂无'}</span>
          </div>
          <div class="category-list">${items}</div>
        </div>
      `;
    }

    // ========== 存款资产配置 & 每日收益记账 ==========
    // 默认配置：2026-10-23 版方案（长钱 2000 万锁定 20-30 年 + 活钱 600 万随时可用）
    function createDefaultDeposits() {
      return [
        { id: 'dep_1', name: '超长期特别国债（30年期）', bank: '财政部 · 工行/建行柜台', term: '30年', amount: 12000000, rate: 0.022 },
        { id: 'dep_2', name: '超长期特别国债（20年期）', bank: '财政部 · 工行/建行柜台', term: '20年', amount: 5000000, rate: 0.022 },
        { id: 'dep_3', name: '个人大额存单', bank: '工商银行', term: '5年', amount: 1500000, rate: 0.016 },
        { id: 'dep_4', name: '个人大额存单', bank: '中国银行', term: '5年', amount: 1500000, rate: 0.016 },
        { id: 'dep_5', name: '7天通知存款', bank: '工商银行', term: '活期', amount: 1000000, rate: 0.003 },
        { id: 'dep_6', name: '可转让大额存单（3个月滚动）', bank: '中国银行', term: '3个月', amount: 5000000, rate: 0.009 }
      ];
    }

    let depositLedgerAll = false;

    function getDepositStats() {
      const fin = data.modules.finance;
      const deposits = Array.isArray(fin.deposits) ? fin.deposits : [];
      const principal = deposits.reduce((s, d) => s + (Number(d.amount) || 0), 0);
      const annual = deposits.reduce((s, d) => s + (Number(d.amount) || 0) * (Number(d.rate) || 0), 0);
      const daily = annual / 365;
      const rate = principal > 0 ? annual / principal : 0;
      const startStr = fin.depositStartDate || getTodayStr();
      const start = new Date(startStr + 'T00:00:00');
      const now = new Date();
      const days = isNaN(start.getTime()) ? 0 : Math.max(0, Math.floor((now - start) / 86400000) + 1);
      const cumulative = days * daily;
      return { deposits, principal, annual, daily, rate, startStr, days, cumulative };
    }

    // 从计息起始日到今天的每日流水（第 N 天累计 = N × 每天收益）
    function getDepositLedger(stats) {
      const entries = [];
      const start = new Date(stats.startStr + 'T00:00:00');
      const now = new Date();
      if (isNaN(start.getTime())) return entries;
      let cum = 0;
      const d = new Date(start);
      let guard = 0;
      while (d <= now && guard < 36600) {
        cum += stats.daily;
        entries.push({
          date: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'),
          daily: stats.daily,
          cum: cum
        });
        d.setDate(d.getDate() + 1);
        guard++;
      }
      return entries;
    }

    function renderDepositSectionHtml() {
      const stats = getDepositStats();
      const entries = getDepositLedger(stats);
      const todayStr = getTodayStr();
      const showEntries = depositLedgerAll ? entries.slice().reverse() : entries.slice(-10).reverse();

      const depositItems = stats.deposits.map(dep => {
        const daily = (Number(dep.amount) || 0) * (Number(dep.rate) || 0) / 365;
        return `
          <div class="deposit-item">
            <div class="deposit-item-main">
              <div class="deposit-item-name">${escapeHtml(dep.name)}</div>
              <div class="deposit-item-sub">${escapeHtml(dep.bank)} · ${escapeHtml(dep.term)} · 年利率 ${(dep.rate * 100).toFixed(2)}%</div>
            </div>
            <div class="deposit-item-right">
              <div class="deposit-item-amount">${formatMoney(dep.amount)}</div>
              <div class="deposit-item-daily">+${formatMoney(daily)}/天</div>
            </div>
            <div class="deposit-item-actions">
              <button onclick="openDepositModal('${dep.id}')">编辑</button>
              <button class="danger" onclick="deleteDeposit('${dep.id}')">删除</button>
            </div>
          </div>
        `;
      }).join('');

      const ledgerRows = showEntries.map(e => {
        const isToday = e.date === todayStr;
        return `
          <div class="dep-ledger-row${isToday ? ' today' : ''}">
            <span class="dep-ledger-date">${e.date}${isToday ? ' <b>今天</b>' : ''}</span>
            <span class="dep-ledger-daily">+${formatMoney(e.daily)}</span>
            <span class="dep-ledger-cum">${formatMoney(e.cum)}</span>
          </div>
        `;
      }).join('');

      return `
        <div class="deposit-section">
          <div class="deposit-head">
            <span class="deposit-title">🏦 存款资产 <small style="color:var(--text2);font-weight:400">每天收益自动累计，像记账一样逐日相加</small></span>
            <button class="deposit-add" onclick="openDepositModal()">＋ 添加</button>
          </div>

          <div class="deposit-grid">
            <div class="deposit-card main">
              <div class="deposit-card-label">累计收益（已计息 ${stats.days} 天）</div>
              <div class="deposit-card-value">${formatMoney(stats.cumulative)}</div>
              <div class="deposit-card-sub">每天 +${formatMoney(stats.daily)} · 明天预计 ${formatMoney(stats.cumulative + stats.daily)}</div>
            </div>
            <div class="deposit-card">
              <div class="deposit-card-label">总本金</div>
              <div class="deposit-card-value sm">${formatMoney(stats.principal)}</div>
            </div>
            <div class="deposit-card">
              <div class="deposit-card-label">加权年利率</div>
              <div class="deposit-card-value sm">${(stats.rate * 100).toFixed(2)}%</div>
            </div>
            <div class="deposit-card">
              <div class="deposit-card-label">每年利息</div>
              <div class="deposit-card-value sm">${formatMoney(stats.annual)}</div>
            </div>
            <div class="deposit-card">
              <div class="deposit-card-label">每天收益</div>
              <div class="deposit-card-value sm" style="color:#00e676">+${formatMoney(stats.daily)}</div>
            </div>
          </div>

          <div class="deposit-list">
            ${depositItems || '<div class="empty-state" style="padding:24px"><p style="font-size:13px">还没有存款资产，点右上角「＋ 添加」</p></div>'}
          </div>

          <div class="dep-ledger">
            <div class="dep-ledger-head">
              <span class="dep-ledger-title">📒 每日收益记账</span>
              <button class="deposit-add" onclick="toggleDepositLedger()">${depositLedgerAll ? '收起' : '查看全部'}</button>
            </div>
            <div class="dep-ledger-cols">
              <span>日期</span><span style="text-align:right">当日收益</span><span style="text-align:right">累计收益</span>
            </div>
            ${ledgerRows || '<div class="empty-state" style="padding:24px"><p style="font-size:13px">设置计息起始日后开始记账</p></div>'}
          </div>

          <div class="dep-start-row">
            <span>计息起始日（改早可补录历史流水）</span>
            <input type="date" value="${stats.startStr}" onchange="updateDepositStartDate(this.value)">
          </div>
        </div>
      `;
    }

    function rerenderDepositSection() {
      const sec = document.querySelector('.deposit-section');
      if (sec) {
        sec.outerHTML = renderDepositSectionHtml();
        return;
      }
      renderModule('finance');
    }

    function toggleDepositLedger() {
      depositLedgerAll = !depositLedgerAll;
      rerenderDepositSection();
    }

    function updateDepositStartDate(value) {
      if (!value) return;
      data.modules.finance.depositStartDate = value;
      saveData();
      rerenderDepositSection();
    }

    function openDepositModal(id) {
      const overlay = document.getElementById('depositOverlay');
      document.getElementById('depId').value = id || '';
      document.getElementById('depModalTitle').textContent = id ? '编辑存款' : '添加存款';
      document.getElementById('depName').value = '';
      document.getElementById('depBank').value = '';
      document.getElementById('depAmountWan').value = '';
      document.getElementById('depRatePct').value = '';
      document.getElementById('depTerm').value = '';
      if (id) {
        const dep = (data.modules.finance.deposits || []).find(d => d.id === id);
        if (dep) {
          document.getElementById('depName').value = dep.name || '';
          document.getElementById('depBank').value = dep.bank || '';
          document.getElementById('depAmountWan').value = (dep.amount / 10000).toString();
          document.getElementById('depRatePct').value = (dep.rate * 100).toString();
          document.getElementById('depTerm').value = dep.term || '';
        }
      }
      overlay.classList.add('show');
    }

    function closeDepositModal(e) {
      if (e && e.target !== document.getElementById('depositOverlay')) return;
      document.getElementById('depositOverlay').classList.remove('show');
    }

    function saveDeposit() {
      const id = document.getElementById('depId').value;
      const name = sanitizeText(document.getElementById('depName').value.trim(), 50);
      const bank = sanitizeText(document.getElementById('depBank').value.trim(), 50);
      const term = sanitizeText(document.getElementById('depTerm').value.trim(), 20);
      const amountWan = parseFloat(document.getElementById('depAmountWan').value);
      const ratePct = parseFloat(document.getElementById('depRatePct').value);
      if (!name) { alert('请输入产品名称'); return; }
      if (isNaN(amountWan) || amountWan <= 0) { alert('请输入有效的金额（万元）'); return; }
      if (isNaN(ratePct) || ratePct < 0 || ratePct > 15) { alert('请输入有效的年利率（0-15%）'); return; }

      const deposits = data.modules.finance.deposits || [];
      const payload = {
        name: name,
        bank: bank || '未填写',
        term: term || '—',
        amount: Math.round(amountWan * 10000 * 100) / 100,
        rate: ratePct / 100
      };
      if (id) {
        const idx = deposits.findIndex(d => d.id === id);
        if (idx >= 0) deposits[idx] = { ...deposits[idx], ...payload };
      } else {
        payload.id = 'dep_' + Date.now();
        deposits.push(payload);
      }
      data.modules.finance.deposits = deposits;
      saveData();
      closeDepositModal();
      rerenderDepositSection();
    }

    function deleteDeposit(id) {
      if (!confirm('确定删除这笔存款？每天收益将重新计算。')) return;
      const fin = data.modules.finance;
      fin.deposits = (fin.deposits || []).filter(d => d.id !== id);
      saveData();
      rerenderDepositSection();
    }

    function renderFinanceModule(container) {
      const fin = data.modules.finance;
      const stats = getFinanceStats();
      const cfg = MODULE_CONFIG.finance;

      const txHtml = renderTxListHtml(stats);
      const todayTxs = (stats.txs || []).filter(t => t.date === today);
      const todayExpense = todayTxs.filter(t => t.type === 'expense').reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
      const todayIncome = todayTxs.filter(t => t.type === 'income').reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

      container.innerHTML = `
        <div class="module-title-bar">
          <div class="m-icon" style="background:${cfg.bg};border:1px solid ${cfg.color}22">${cfg.icon}</div>
          <div class="m-text">
            <div class="m-name">${cfg.name}</div>
            <div class="m-desc">${cfg.desc}</div>
          </div>
          <div class="m-progress" style="background:linear-gradient(135deg, ${cfg.color}, ${cfg.color}88);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent">${stats.pct}%</div>
        </div>

        <!-- 财务总览卡片 -->
        <div class="finance-overview">
          <div class="finance-card main-card">
            <div class="finance-card-label">💰 当前存款</div>
            <div class="finance-card-value" id="currentAmountDisplay">${formatMoney(stats.current)}</div>
            <div class="finance-card-sub">
              <span>目标 ${formatMoney(stats.target)}</span>
              <span style="color:${stats.remaining > 0 ? '#ff9f43' : '#00e676'}">${stats.remaining > 0 ? '还差 ' + formatMoney(stats.remaining) : '已达成 🎉'}</span>
            </div>
            <div class="finance-progress-wrap">
              <div class="finance-progress-bar">
                <div class="finance-progress-fill" style="width:${stats.pct}%"></div>
              </div>
              <div class="finance-progress-text">${stats.pct}%</div>
            </div>
          </div>
          <div class="finance-card sub-card today-card">
            <div class="finance-card-label" style="color:#ff5252">💸 今日花费</div>
            <div class="finance-card-value" id="todayExpenseValue" style="font-size:22px;color:#ff5252">${formatMoney(todayExpense)}</div>
            <div class="finance-card-sub">
              <span>今日收入 <b id="todayIncomeValue" style="color:#00e676">${formatMoney(todayIncome)}</b></span>
              <span>今日 <b id="todayTxCount">${todayTxs.length}</b> 笔</span>
            </div>
          </div>
        </div>

        <!-- 存款资产与每日收益记账 -->
        ${renderDepositSectionHtml()}

        <!-- 快捷操作 -->
        <div class="finance-actions">
          <button class="finance-btn income" onclick="openTransactionModal('income')">
            <span class="finance-btn-icon">➕</span>
            <span>记收入</span>
          </button>
          <button class="finance-btn expense" onclick="openTransactionModal('expense')">
            <span class="finance-btn-icon">➖</span>
            <span>记支出</span>
          </button>
          <button class="finance-btn target" onclick="openFinanceTargetModal()">
            <span class="finance-btn-icon">🎯</span>
            <span>设目标</span>
          </button>
          <button class="finance-btn" onclick="exportFinanceCSV()">
            <span class="finance-btn-icon">📄</span>
            <span>导出CSV</span>
          </button>
        </div>

        <!-- 交易记录 -->
        <div class="tx-section">
          <div class="tx-section-header">
            <span class="tx-section-title">📝 最近记录</span>
            <span class="tx-section-count">共 ${stats.txs.length} 笔</span>
          </div>
          <div class="tx-list">
            ${txHtml}
          </div>
        </div>
      `;
    }

    function showDiagnostics() {
      const info = [];
      info.push('版本: ' + APP_VERSION);
      info.push('LS_KEY: ' + LS_KEY);
      info.push('存储状态: ' + (storageHealthy ? '正常' : '⚠️ 异常（已暂停写入以保护数据）'));
      const mainChars = lsChars(LS_KEY);
      const backupChars = lsChars(LS_KEY + '_backups');
      info.push('主数据: ' + mainChars + ' 字符（约 ' + Math.round(mainChars / 1024) + ' KB）');
      info.push('自动备份: ' + backupChars + ' 字符（约 ' + Math.round(backupChars / 1024) + ' KB，上限 ' + MAX_AUTO_BACKUPS + ' 份 / ' + Math.round(MAX_AUTO_BACKUP_CHARS / 1024) + ' KB）');
      info.push('本域合计: 约 ' + Math.round(totalLocalStorageChars() / 1024) + ' KB（配额约 5 MB）');
      let rescueCount = 0;
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.indexOf(RESCUE_PREFIX) === 0) rescueCount++;
        }
      } catch (e) {}
      if (rescueCount) info.push('⚠️ 救援副本: ' + rescueCount + ' 份（数据曾解析失败）');
      info.push('模块数: ' + Object.keys(data.modules).length);
      info.push('manifestation: ' + (data.modules.manifestation ? '有' : '无'));
      if (data.modules.manifestation) {
        info.push('  goals: ' + (data.modules.manifestation.goals ? data.modules.manifestation.goals.length : 'undefined'));
      }
      info.push('supplements: ' + (data.modules.supplements ? '有' : '无'));
      if (data.modules.supplements) {
        info.push('  items: ' + (data.modules.supplements.items ? data.modules.supplements.items.length : 'undefined'));
      }
      info.push('finance: ' + (data.modules.finance ? '有' : '无'));
      info.push('daily habits: ' + (data.modules.daily && data.modules.daily.habits ? data.modules.daily.habits.length : 0));

      const msg = info.join('\n');
      console.log(msg);
      alert(msg);
    }

    const BACKUP_KEY = LS_KEY + '_backups';
    const BACKUP_PROMPT_KEY = LS_KEY + '_backup_prompt';
    const BACKUP_TOAST_KEY = LS_KEY + '_backup_toast';

    function isBackupReminderDue() {
      try {
        const last = parseInt(localStorage.getItem(BACKUP_PROMPT_KEY) || '0', 10);
        return !last || Date.now() - last > 7 * 24 * 60 * 60 * 1000;
      } catch(e) {
        return false;
      }
    }

    function simpleHash(str) {
      let h = 5381;
      for (let i = 0; i < str.length; i++) {
        h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
      }
      return h.toString(16);
    }

    function showInfoToast(text) {
      const toast = document.getElementById('achievementToast');
      if (!toast) return;
      toast.textContent = text;
      toast.style.display = 'flex';
      clearTimeout(achievementToastTimer);
      achievementToastTimer = setTimeout(() => { toast.style.display = 'none'; }, 5000);
    }

    function maybePromptBackup() {
      if (!isBackupReminderDue()) return;
      try {
        const lastToast = parseInt(localStorage.getItem(BACKUP_TOAST_KEY) || '0', 10);
        if (!lastToast || Date.now() - lastToast > 7 * 24 * 60 * 60 * 1000) {
          localStorage.setItem(BACKUP_TOAST_KEY, String(Date.now()));
          setTimeout(() => showInfoToast('💾 距上次导出备份已超过 7 天，建议在“备份”里导出一份'), 1200);
        }
      } catch(e) {}
    }

    function getAutoBackups() {
      try {
        const list = JSON.parse(localStorage.getItem(BACKUP_KEY));
        return Array.isArray(list) ? list : [];
      } catch(e) {
        return [];
      }
    }

    function saveAutoBackups(list) {
      // 先按条数裁剪
      if (list.length > MAX_AUTO_BACKUPS) list.length = MAX_AUTO_BACKUPS;
      // 再按总字符数裁剪：每份备份都是整份数据的深拷贝，很容易把 localStorage 配额挤爆，
      // 一旦挤爆主数据的 saveData 就会静默失败。保留最新的若干条。
      let total = 0;
      for (let i = 0; i < list.length; i++) {
        total += JSON.stringify(list[i]).length;
        if (total > MAX_AUTO_BACKUP_CHARS) { list.length = Math.max(1, i); break; }
      }
      try {
        localStorage.setItem(BACKUP_KEY, JSON.stringify(list));
        return true;
      } catch(e) {
        console.log('自动备份保存失败:', e);
        if (isQuotaError(e) && list.length > 1) {
          list.length = Math.max(1, Math.floor(list.length / 2));   // 丢掉较老的一半再试
          try {
            localStorage.setItem(BACKUP_KEY, JSON.stringify(list));
            return true;
          } catch(e2) { console.log('自动备份二次保存仍失败:', e2); }
        }
        warnStorageOnce('⚠️ 自动备份没能保存（存储空间不足），本次操作前没有恢复点。\n\n请先到「工具菜单 → 备份」导出备份，并删除一些旧的自动备份。');
        return false;
      }
    }

    function createAutoBackup(reason) {
      if (!data || !data.modules) return false;
      const list = getAutoBackups();
      list.unshift({
        id: Date.now(),
        reason: reason || '操作前自动备份',
        createdAt: new Date().toLocaleString('zh-CN', { hour12: false }),
        data: JSON.parse(JSON.stringify(data))
      });
      return saveAutoBackups(list);
    }

    function exportBackup() {
      const payload = {
        app: 'growth-checkin',
        version: APP_VERSION,
        exportedAt: new Date().toISOString(),
        data: data
      };
      payload.checksum = simpleHash(JSON.stringify(payload.data));
      try { localStorage.setItem(BACKUP_PROMPT_KEY, String(Date.now())); } catch(e) {}
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '成长打卡备份_' + getTodayStr() + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 0);
    }

    function importBackupFile(event) {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function(e) {
        try {
          const parsed = JSON.parse(e.target.result);
          applyImportedBackup(parsed);
          closeBackupModal();
        } catch(err) {
          alert('导入失败：' + err.message);
        }
        if (event.target) event.target.value = '';
      };
      reader.readAsText(file);
    }

    async function exportEncryptedBackup() {
      const password = prompt('请设置加密密码（至少 6 位）：');
      if (!password) return;
      if (password.length < 6) { alert('密码太短，至少 6 位'); return; }
      try {
        const dataUrl = await exportEncrypted(password);
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = '成长打卡加密备份_' + getTodayStr() + '.enc';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { document.body.removeChild(a); }, 0);
        showInfoToast('🔐 加密备份已导出');
      } catch (e) {
        alert('加密失败：' + e.message);
      }
    }

    async function importEncryptedBackupFile(event) {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const password = prompt('请输入加密密码：');
      if (!password) { event.target.value = ''; return; }
      const reader = new FileReader();
      reader.onload = async function(e) {
        try {
          const imported = await importEncrypted(e.target.result, password);
          applyImportedBackup({ data: imported });
          closeBackupModal();
          showInfoToast('🔓 加密备份导入成功');
        } catch(err) {
          alert('导入失败：密码错误或文件损坏 (' + err.message + ')');
        }
        if (event.target) event.target.value = '';
      };
      reader.readAsDataURL(file);
    }

    // 校验导入的每个模块结构，避免"导入成功"之后页面直接崩掉
    function validateImportedStructure(imported) {
      const problems = [];
      const mods = imported.modules || {};
      if (!mods.daily || !Array.isArray(mods.daily.habits)) problems.push('每日打卡');
      ['daily', 'study', 'game', 'fitness', 'cycle', 'free'].forEach(k => {
        const m = mods[k];
        if (!m) return;
        if (m.habits !== undefined && !Array.isArray(m.habits)) problems.push(k + '.habits 不是列表');
        else if (Array.isArray(m.habits)) {
          m.habits.forEach((h, i) => {
            if (!h || typeof h !== 'object') problems.push(k + '.habits[' + i + '] 不是对象');
            else if (h.records !== undefined && !Array.isArray(h.records)) problems.push(k + '.habits[' + i + '].records 不是列表');
          });
        }
      });
      ['body', 'reading'].forEach(k => {
        const m = mods[k];
        if (m && m.records !== undefined && !Array.isArray(m.records)) problems.push(k + '.records 不是列表');
      });
      if (mods.shopping && mods.shopping.items !== undefined && !Array.isArray(mods.shopping.items)) problems.push('shopping.items 不是列表');
      if (mods.supplements && mods.supplements.items !== undefined && !Array.isArray(mods.supplements.items)) problems.push('supplements.items 不是列表');
      if (mods.manifestation && mods.manifestation.goals !== undefined && !Array.isArray(mods.manifestation.goals)) problems.push('manifestation.goals 不是列表');
      if (mods.finance) {
        if (mods.finance.transactions !== undefined && !Array.isArray(mods.finance.transactions)) problems.push('finance.transactions 不是列表');
        if (mods.finance.funds !== undefined && !Array.isArray(mods.finance.funds)) problems.push('finance.funds 不是列表');
      }
      return problems;
    }

    function applyImportedBackup(parsed) {
      const imported = parsed && parsed.data && parsed.data.modules ? parsed.data : parsed;
      if (!imported || !imported.modules) throw new Error('文件格式不正确，缺少 modules 数据');
      if (!imported.modules.daily || !Array.isArray(imported.modules.daily.habits)) throw new Error('备份文件缺少每日打卡数据');
      // 校验和：以前 checksum 缺失时会整段跳过校验。现在给出明确提示。
      const hasChecksum = !!(parsed && parsed.checksum);
      if (hasChecksum && simpleHash(JSON.stringify(imported)) !== parsed.checksum) {
        throw new Error('备份文件校验失败，可能已损坏');
      }
      const isOwnBackup = !!(parsed && parsed.app === 'growth-checkin');
      const problems = validateImportedStructure(imported);
      if (problems.length) {
        throw new Error('备份文件结构异常：' + problems.slice(0, 3).join('；') + (problems.length > 3 ? ' 等' : ''));
      }
      // 关键：导入会整体覆盖当前数据，必须先让用户确认
      const warn = []
        .concat(hasChecksum ? [] : ['· 这份文件没有校验和，无法确认是否完整'])
        .concat(isOwnBackup ? [] : ['· 这不是本应用导出的标准备份文件'])
        .join('\n');
      if (!confirm('⚠️ 导入会覆盖当前全部数据\n\n'
        + '打卡记录、补剂、存款、基金、显化目标都会被这份文件替换。\n'
        + (warn ? warn + '\n' : '')
        + '\n确定要继续吗？（会先自动备份当前数据）')) {
        return;
      }
      const backedUp = createAutoBackup('导入前备份');
      data = JSON.parse(JSON.stringify(imported));
      validateAndRepairData();
      persistData(data).then(() => {
        renderNav();
        renderModule(activeModule);
        updateTotalStats();
      }).catch(e => {
        alert('导入失败：写入存储出错（' + (e && e.message ? e.message : e) + '）\n\n当前数据没有被修改。');
        throw e;
      });
      alert('导入成功' + (backedUp ? '\n\n（已保存一份"导入前备份"，可在备份弹窗里恢复）' : '\n\n注意：导入前备份未能保存，请尽快手动导出一份。'));
    }

    function openBackupModal() {
      renderAutoBackupList();
      document.getElementById('backupOverlay').classList.add('show');
    }

    function closeBackupModal(e) {
      if (e && e.target !== document.getElementById('backupOverlay')) return;
      document.getElementById('backupOverlay').classList.remove('show');
    }

    function renderAutoBackupList() {
      const listEl = document.getElementById('autoBackupList');
      const list = getAutoBackups();
      if (!list.length) {
        listEl.innerHTML = '<div class="backup-empty">暂无自动备份</div>';
        return;
      }
      listEl.innerHTML = list.slice(0, MAX_AUTO_BACKUPS).map(b => `
        <div class="backup-item">
          <div class="backup-item-info">
            <div class="backup-item-time">${b.createdAt || new Date(b.id).toLocaleString('zh-CN', { hour12: false })}</div>
            <div class="backup-item-reason">${escapeHtml(b.reason || '自动备份')}</div>
          </div>
          <button class="backup-restore-btn" onclick="restoreAutoBackup(${b.id})">恢复</button>
          <button class="backup-del-btn" onclick="removeAutoBackup(${b.id})" title="删除备份">×</button>
        </div>
      `).join('');
    }

    function restoreAutoBackup(id) {
      const list = getAutoBackups();
      const target = list.find(b => String(b.id) === String(id));
      if (!target) return;
      if (!confirm('确定恢复这条备份吗？当前数据会被覆盖。')) return;
      createAutoBackup('恢复前备份');
      data = JSON.parse(JSON.stringify(target.data));
      persistData(data).then(() => {
        renderNav();
        renderModule(activeModule);
        updateTotalStats();
      });
      renderNav();
      renderModule(activeModule);
      updateTotalStats();
      renderAutoBackupList();
      alert('已恢复备份');
    }

    function removeAutoBackup(id) {
      if (!confirm('确定删除这条自动备份吗？')) return;
      const list = getAutoBackups().filter(b => String(b.id) !== String(id));
      saveAutoBackups(list);
      renderAutoBackupList();
    }

    let editState = null;
    let editSelectedIcon = '🔥';
    let editSuppSelectedIcon = '💊';

    function renderIconPicker(containerId, selected, stateKey) {
      const container = document.getElementById(containerId);
      container.innerHTML = ICONS.map(icon => `
        <button type="button" class="icon-pick-btn ${icon === selected ? 'active' : ''}" onclick="selectEditIcon('${icon}', '${stateKey}', '${containerId}')">${icon}</button>
      `).join('');
    }

    function selectEditIcon(icon, stateKey, containerId) {
      if (stateKey === 'editSelectedIcon') {
        editSelectedIcon = icon;
      } else {
        editSuppSelectedIcon = icon;
      }
      renderIconPicker(containerId, icon, stateKey);
    }

    function openHabitEdit(moduleId, id) {
      const h = data.modules[moduleId].habits.find(x => x.id === id);
      if (!h) return;
      editState = { kind: 'habit', moduleId: moduleId, id: id };
      document.getElementById('editModalTitle').textContent = '编辑目标';
      let extra = '';
      if (h.type === 'cycle') {
        extra = `
          <div class="fund-form-row"><label>周期天数</label><input type="number" class="fund-form-input" id="editCycleLength" min="1" value="${h.cycleLength}"></div>
          <div class="fund-form-row"><label>状态列表（用逗号分隔）</label><input type="text" class="fund-form-input" id="editCycleStates" value="${escapeHtml((h.cycleStates || []).join(','))}"></div>
          <div class="fund-form-row"><label>周期开始日期</label><input type="date" class="fund-form-input" id="editCycleStart" value="${h.cycleStart || ''}"></div>
        `;
      } else if (h.type === 'period') {
        extra = `
          <div class="fund-form-row"><label>间隔天数</label><input type="number" class="fund-form-input" id="editPeriod" min="1" value="${h.period}"></div>
          <div class="fund-form-row"><label>基准日期</label><input type="date" class="fund-form-input" id="editBaseDate" value="${h.baseDate || ''}"></div>
        `;
      }
      document.getElementById('editFormFields').innerHTML = `
        <div class="fund-form-row"><label>名称</label><input type="text" class="fund-form-input" id="editName" maxlength="20" value="${escapeHtml(h.name)}"></div>
        <div class="fund-form-row"><label>图标</label><div class="icon-picker" id="editIconPicker"></div></div>
        ${extra}
      `;
      editSelectedIcon = h.icon || '🔥';
      renderIconPicker('editIconPicker', editSelectedIcon, 'editSelectedIcon');
      document.getElementById('editOverlay').classList.add('show');
    }

    function openManifestEdit(goalId) {
      const goal = data.modules.manifestation.goals.find(g => g.id === goalId);
      if (!goal) return;
      editState = { kind: 'manifest', id: goalId };
      document.getElementById('editModalTitle').textContent = '编辑显化目标';
      const linkOptions = [
        { id: '', name: '自动识别（根据标题/描述）' },
        { id: 'finance', name: '💰 财务存款' },
        { id: 'fitness', name: '💪 健身训练' },
        { id: 'reading', name: '📖 读书学习' },
        { id: 'sleepPlan', name: '😴 睡眠作息' },
        { id: 'body', name: '🧬 身体记录' }
      ].map(o => `<option value="${o.id}" ${(goal.linkModule || '') === o.id ? 'selected' : ''}>${o.name}</option>`).join('');
      document.getElementById('editFormFields').innerHTML = `
        <div class="fund-form-row"><label>标题</label><input type="text" class="fund-form-input" id="editManifestTitle" maxlength="30" value="${escapeHtml(goal.title)}"></div>
        <div class="fund-form-row"><label>描述</label><textarea class="note-input" id="editManifestDesc" style="min-height:60px;margin-bottom:0">${escapeHtml(goal.description || '')}</textarea></div>
        <div class="fund-form-row"><label>目标日期（可选）</label><input type="date" class="fund-form-input" id="editManifestTargetDate" value="${goal.targetDate || ''}"></div>
        <div class="fund-form-row"><label>关联真实数据</label><select class="fund-form-input" id="editManifestLink">${linkOptions}</select></div>
      `;
      document.getElementById('editOverlay').classList.add('show');
    }

    function openSupplementEdit(id) {
      const item = data.modules.supplements.items.find(i => i.id === id);
      if (!item) return;
      editState = { kind: 'supplement', id: id };
      document.getElementById('editModalTitle').textContent = '编辑补剂';
      const slotOptions = Object.entries(SUPPLEMENT_TIME_SLOTS).map(([k, v]) => `
        <option value="${k}" ${k === (item.timeSlot || 'noon') ? 'selected' : ''}>${v.label}</option>
      `).join('');
      document.getElementById('editFormFields').innerHTML = `
        <div class="fund-form-row"><label>名称</label><input type="text" class="fund-form-input" id="editSuppName" maxlength="30" value="${escapeHtml(item.name)}"></div>
        <div class="fund-form-row"><label>图标</label><div class="icon-picker" id="editSuppIconPicker"></div></div>
        <div class="fund-form-row"><label>剂量</label><input type="text" class="fund-form-input" id="editSuppDosage" value="${escapeHtml(item.dosage || '')}"></div>
        <div class="fund-form-row"><label>服用时间</label><input type="text" class="fund-form-input" id="editSuppTime" value="${escapeHtml(item.time || '')}"></div>
        <div class="fund-form-row"><label>时间段</label><select class="fund-form-input" id="editSuppSlot">${slotOptions}</select></div>
        <div class="fund-form-row"><label>当前余量（留空则不追踪）</label><input type="number" class="fund-form-input" id="editSuppStock" min="0" step="1" value="${typeof item.stock === 'number' ? item.stock : ''}"></div>
        <div class="fund-form-row"><label>总库存（可选）</label><input type="number" class="fund-form-input" id="editSuppStockTotal" min="0" step="1" value="${typeof item.stockTotal === 'number' ? item.stockTotal : ''}"></div>
        <div class="fund-form-row"><label>单位</label><input type="text" class="fund-form-input" id="editSuppStockUnit" maxlength="4" value="${escapeHtml(item.stockUnit || '粒')}"></div>
        <div class="fund-form-row"><label>提醒阈值</label><input type="number" class="fund-form-input" id="editSuppLowThreshold" min="0" step="1" value="${typeof item.lowStockThreshold === 'number' ? item.lowStockThreshold : 10}"></div>
        <div class="fund-form-row"><label>周期模式（吃 X 天停 Y 天）</label><label class="switch-label"><input type="checkbox" id="editSuppCycleEnabled" ${item.cycleEnabled ? 'checked' : ''}> 启用周期模式</label></div>
        <div class="fund-form-row"><label>吃几天</label><input type="number" class="fund-form-input" id="editSuppCycleTake" min="1" value="${item.cycleTakeDays || 5}"></div>
        <div class="fund-form-row"><label>停几天</label><input type="number" class="fund-form-input" id="editSuppCycleStop" min="0" value="${item.cycleStopDays || 0}"></div>
        <div class="fund-form-row"><label>周期起始日期</label><input type="date" class="fund-form-input" id="editSuppCycleStart" value="${item.cycleStart || ''}"></div>
        <div class="fund-form-row"><label>标签（逗号分隔，如：运动前,促睾）</label><input type="text" class="fund-form-input" id="editSuppTags" value="${escapeHtml((item.tags || []).join(','))}"></div>
        <div class="fund-form-row"><label>备注</label><textarea class="note-input" id="editSuppNote" style="min-height:60px;margin-bottom:0">${escapeHtml(item.note || '')}</textarea></div>
        <div class="fund-form-row"><label>警示</label><textarea class="note-input" id="editSuppWarning" style="min-height:60px;margin-bottom:0">${escapeHtml(item.warning || '')}</textarea></div>
      `;
      editSuppSelectedIcon = item.icon || '💊';
      renderIconPicker('editSuppIconPicker', editSuppSelectedIcon, 'editSuppSelectedIcon');
      document.getElementById('editOverlay').classList.add('show');
    }

    function saveEditModal() {
      if (!editState) return;
      if (editState.kind === 'habit') {
        const h = data.modules[editState.moduleId].habits.find(x => x.id === editState.id);
        if (!h) return;
        const name = document.getElementById('editName').value.trim();
        if (!name) { alert('名称不能为空'); return; }
        h.name = name;
        h.icon = editSelectedIcon || h.icon;
        if (h.type === 'cycle') {
          const cycleLength = parseInt(document.getElementById('editCycleLength').value, 10);
          const states = document.getElementById('editCycleStates').value.split(/[,，]/).map(s => s.trim()).filter(Boolean);
          const start = document.getElementById('editCycleStart').value;
          if (!cycleLength || cycleLength < 1) { alert('周期天数不正确'); return; }
          if (!states.length) { alert('状态列表不能为空'); return; }
          h.cycleLength = cycleLength;
          h.cycleStates = states;
          if (start) h.cycleStart = start;
        } else if (h.type === 'period') {
          const period = parseInt(document.getElementById('editPeriod').value, 10);
          const baseDate = document.getElementById('editBaseDate').value;
          if (!period || period < 1) { alert('间隔天数不正确'); return; }
          h.period = period;
          if (baseDate) h.baseDate = baseDate;
        }
        saveData();
        renderModule(activeModule);
        updateTotalStats();
        renderNav();
      } else if (editState.kind === 'manifest') {
        const goal = data.modules.manifestation.goals.find(g => g.id === editState.id);
        if (!goal) return;
        const title = document.getElementById('editManifestTitle').value.trim();
        if (!title) { alert('标题不能为空'); return; }
        goal.title = title;
        goal.description = document.getElementById('editManifestDesc').value.trim();
        goal.targetDate = document.getElementById('editManifestTargetDate').value || '';
        goal.linkModule = document.getElementById('editManifestLink').value || '';
        saveData();
        renderModule('manifestation');
        updateTotalStats();
        renderNav();
      } else if (editState.kind === 'supplement') {
        const item = data.modules.supplements.items.find(i => i.id === editState.id);
        if (!item) return;
        const name = document.getElementById('editSuppName').value.trim();
        if (!name) { alert('名称不能为空'); return; }
        item.name = name;
        item.icon = editSuppSelectedIcon || item.icon;
        item.dosage = document.getElementById('editSuppDosage').value.trim();
        item.time = document.getElementById('editSuppTime').value.trim() || '随餐';
        item.timeSlot = document.getElementById('editSuppSlot').value;
        const stockVal = parseFloat(document.getElementById('editSuppStock').value);
        const stockTotalVal = parseFloat(document.getElementById('editSuppStockTotal').value);
        const thresholdVal = parseFloat(document.getElementById('editSuppLowThreshold').value);
        item.stock = isNaN(stockVal) || stockVal < 0 ? null : stockVal;
        item.stockTotal = isNaN(stockTotalVal) || stockTotalVal < 0 ? null : stockTotalVal;
        item.stockUnit = document.getElementById('editSuppStockUnit').value.trim() || '粒';
        item.lowStockThreshold = isNaN(thresholdVal) || thresholdVal < 0 ? 10 : thresholdVal;
        const cycleBefore = [item.cycleEnabled, item.cycleTakeDays, item.cycleStopDays, item.cycleStart].join('|');
        item.cycleEnabled = !!document.getElementById('editSuppCycleEnabled').checked;
        item.cycleTakeDays = parseInt(document.getElementById('editSuppCycleTake').value, 10) || 5;
        item.cycleStopDays = parseInt(document.getElementById('editSuppCycleStop').value, 10) || 0;
        if (item.cycleTakeDays < 1) item.cycleTakeDays = 1;
        if (item.cycleStopDays < 0) item.cycleStopDays = 0;
        item.cycleStart = document.getElementById('editSuppCycleStart').value || '';
        // 你如果自己改过周期，就标记下来，以后我更新内置清单不会把它覆盖回去
        if (cycleBefore !== [item.cycleEnabled, item.cycleTakeDays, item.cycleStopDays, item.cycleStart].join('|')) {
          item.cycleUserEdited = true;
        }
        item.tags = document.getElementById('editSuppTags').value.split(/[,，]/).map(s => s.trim()).filter(Boolean);
        item.note = document.getElementById('editSuppNote').value.trim();
        item.warning = document.getElementById('editSuppWarning').value.trim();
        saveData();
        renderModule('supplements');
        updateTotalStats();
        renderNav();
      }
      closeEditModal();
    }

    function closeEditModal(e) {
      if (e && e.target !== document.getElementById('editOverlay')) return;
      document.getElementById('editOverlay').classList.remove('show');
      editState = null;
    }

    function getWeekDates() {
      const dates = [];
      const now = new Date();
      const day = now.getDay() || 7;
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1);
      for (let d = new Date(monday); d <= now; d.setDate(d.getDate() + 1)) {
        dates.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
      }
      return dates;
    }

    function getWeeklyHabitStats(days) {
      let need = 0, done = 0;
      for (const mod of Object.values(data.modules)) {
        if (!mod || !Array.isArray(mod.habits)) continue;
        for (const h of mod.habits) {
          for (const date of days) {
            if (h.type === 'daily') {
              need++;
              if (h.records.includes(date)) done++;
            } else if (h.type === 'period' && isPeriodDay(h, date)) {
              need++;
              if (h.records.includes(date)) done++;
            }
          }
        }
      }
      return { need: need, done: done, pct: need ? Math.round(done / need * 100) : 0 };
    }

    function getWeeklySupplementStats(days) {
      const items = (data.modules.supplements && data.modules.supplements.items) || [];
      let need = 0, done = 0;
      days.forEach(date => {
        items.forEach(item => {
          if (!shouldTakeSupplement(item, date)) return;
          need++;
          if (item.records && item.records.some(r => r.date === date && r.taken)) done++;
        });
      });
      return { need: need, done: done, pct: need ? Math.round(done / need * 100) : 0 };
    }

    function getWeeklyReadingStats(days) {
      const records = getReadingRecords().filter(r => days.includes(r.date));
      return {
        sessions: records.length,
        minutes: records.reduce((sum, r) => sum + (Number(r.durationMinutes) || 0), 0),
        pages: records.reduce((sum, r) => sum + (Number(r.pages) || 0), 0)
      };
    }

    function openWeeklyReport() {
      const days = getWeekDates();
      const habit = getWeeklyHabitStats(days);
      const supp = getWeeklySupplementStats(days);
      const reading = getWeeklyReadingStats(days);
      const bodyCount = getBodyRecords().filter(r => days.includes(r.date)).length;
      const finance = getFinanceStats();
      const monthLabel = (new Date().getMonth() + 1) + '月';
      let message = '这周已经开始积累，每天多做一点就好。';
      if (habit.pct >= 100 && supp.pct >= 100) {
        message = '这周状态非常完整，打卡和补剂都跟上了，继续保持这种节奏。';
      } else if (habit.pct >= 80) {
        message = '这周打卡完成率很高，把剩下的小缺口补上会更完整。';
      } else if (reading.minutes > 0) {
        message = '这周有阅读记录，已经比原地不动强很多，明天继续翻几页。';
      }
      document.getElementById('weeklyReportContent').innerHTML = `
        <div class="weekly-report-grid">
          <div class="weekly-report-card">
            <div class="weekly-report-label">本周打卡</div>
            <div class="weekly-report-num">${habit.done}/${habit.need}</div>
            <div class="weekly-report-sub">完成率 ${habit.pct}%</div>
          </div>
          <div class="weekly-report-card">
            <div class="weekly-report-label">补剂完成</div>
            <div class="weekly-report-num">${supp.done}/${supp.need}</div>
            <div class="weekly-report-sub">完成率 ${supp.pct}%</div>
          </div>
          <div class="weekly-report-card">
            <div class="weekly-report-label">本周阅读</div>
            <div class="weekly-report-num">${reading.sessions} 次</div>
            <div class="weekly-report-sub">${formatReadingDuration(reading.minutes)}</div>
          </div>
          <div class="weekly-report-card">
            <div class="weekly-report-label">身体记录</div>
            <div class="weekly-report-num">${bodyCount} 条</div>
            <div class="weekly-report-sub">记录变化和感受</div>
          </div>
          <div class="weekly-report-card">
            <div class="weekly-report-label">${monthLabel}支出</div>
            <div class="weekly-report-num">${formatMoney(finance.monthSpent)}</div>
            <div class="weekly-report-sub">${finance.budget > 0 ? '预算 ' + formatMoney(finance.budget) : '未设置预算'}</div>
          </div>
          <div class="weekly-report-card">
            <div class="weekly-report-label">累计阅读页数</div>
            <div class="weekly-report-num">${reading.pages} 页</div>
            <div class="weekly-report-sub">本周读书记录</div>
          </div>
        </div>
        <div class="weekly-report-message">${message}</div>
      `;
      document.getElementById('weeklyOverlay').classList.add('show');
    }

    function closeWeeklyReport(e) {
      if (e && e.target !== document.getElementById('weeklyOverlay')) return;
      document.getElementById('weeklyOverlay').classList.remove('show');
    }

    let statsRange = 7;

    function openStatsModal() {
      const buttons = document.querySelectorAll('.stats-range-btn');
      if (buttons && buttons.forEach) {
        buttons.forEach(btn => btn.classList.toggle('active', Number(btn.getAttribute('data-range')) === statsRange));
      }
      document.getElementById('statsOverlay').classList.add('show');
      renderStats();
    }

    function closeStatsModal(e) {
      if (e && e.target !== document.getElementById('statsOverlay')) return;
      document.getElementById('statsOverlay').classList.remove('show');
    }

    function setStatsRange(days) {
      statsRange = days;
      const buttons = document.querySelectorAll('.stats-range-btn');
      if (buttons && buttons.forEach) {
        buttons.forEach(btn => btn.classList.toggle('active', Number(btn.getAttribute('data-range')) === days));
      }
      renderStats();
    }

    function getStatsDates(days) {
      const dates = [];
      const d = new Date();
      for (let i = days - 1; i >= 0; i--) {
        const t = new Date(d);
        t.setDate(d.getDate() - i);
        dates.push(t.getFullYear() + '-' + String(t.getMonth()+1).padStart(2,'0') + '-' + String(t.getDate()).padStart(2,'0'));
      }
      return dates;
    }

    function getCheckinStats(dates) {
      const dailyHabits = [];
      for (const mod of Object.values(data.modules)) {
        if (mod && Array.isArray(mod.habits)) {
          for (const h of mod.habits) {
            if (h.type === 'daily') dailyHabits.push(h);
          }
        }
      }
      const total = dailyHabits.length || 1;
      return dates.map(date => {
        const done = dailyHabits.filter(h => h.records.includes(date)).length;
        return { value: done / total * 100, label: date.slice(5).replace('-','/') };
      });
    }

    function getSupplementStats(dates) {
      const items = (data.modules.supplements && data.modules.supplements.items) || [];
      const total = items.length || 1;
      return dates.map(date => {
        const taken = items.filter(i => i.records && i.records.some(r => r.date === date && r.taken)).length;
        return { value: taken / total * 100, label: date.slice(5).replace('-','/') };
      });
    }

    function getManifestStats(dates) {
      const goals = (data.modules.manifestation && data.modules.manifestation.goals) || [];
      return dates.map(date => {
        const count = goals.reduce((sum, g) => sum + (g.records ? g.records.filter(r => r.date === date).length : 0), 0);
        return { value: count, label: date.slice(5).replace('-','/') };
      });
    }

    function renderStats() {
      const dates = getStatsDates(statsRange);
      drawStatsChart('statsGrowthChart', getGrowthStats(dates), { max: 100 });
      drawStatsChart('statsCheckinChart', getCheckinStats(dates), { max: 100 });
      drawStatsChart('statsSupplementChart', getSupplementStats(dates), { max: 100 });
      drawStatsChart('statsManifestChart', getManifestStats(dates), { max: null });
    }

    function getDailyReportRows(days) {
      const dates = getStatsDates(days);
      const checkin = getCheckinStats(dates);
      const mani = getManifestStats(dates);
      const growth = getGrowthStats(dates);
      const suppItems = (data.modules.supplements && data.modules.supplements.items) || [];
      return dates.map((date, i) => {
        const taken = suppItems.filter(it => it.records && it.records.some(r => r.date === date && r.taken)).length;
        return {
          date: date,
          growth: growth[i] ? growth[i].value : 0,
          checkin: Math.round(checkin[i].value * 10) / 10,
          supplement: taken + '/' + suppItems.length,
          manifest: mani[i].value
        };
      });
    }

    function exportReportCSV(days) {
      const rows = getDailyReportRows(days);
      const header = ['日期', '成长评分', '打卡完成率(%)', '补剂服用', '显化记录'];
      const lines = rows.map(r => [r.date, r.growth, r.checkin, r.supplement, r.manifest].join(','));
      const csv = '\uFEFF' + [header.join(','), ...lines].join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const rangeName = days === 1 ? '日报' : days === 7 ? '周报' : days === 30 ? '月报' : '年报';
      a.download = rangeName + '_' + getTodayStr() + '.csv';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
    }

    function drawStatsChart(canvasId, points, opts) {
      const canvas = document.getElementById(canvasId);
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
      const w = rect.width, h = rect.height;
      const pad = { top: 14, right: 10, bottom: 20, left: 30 };
      const cw = w - pad.left - pad.right;
      const ch = h - pad.top - pad.bottom;
      const rawMax = opts.max != null ? opts.max : Math.max(1, ...points.map(p => p.value));
      const max = opts.max != null ? opts.max : Math.ceil(rawMax * 1.1);
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(100,255,218,0.08)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 3; i++) {
        const y = pad.top + ch * i / 3;
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
      }
      ctx.fillStyle = '#5a5a7a';
      ctx.font = '8px sans-serif';
      ctx.textAlign = 'left';
      [0, max / 2, max].forEach(v => {
        const y = pad.top + ch * (1 - v / max);
        ctx.fillText(String(Math.round(v)), 2, y + 3);
      });
      const isMany = points.length > 10;
      const barW = isMany ? Math.max(2, cw / points.length * 0.55) : Math.max(4, cw / points.length * 0.45);
      const xStepDenom = Math.max(1, points.length - 1);
      const barGrad = ctx.createLinearGradient(0, pad.top, 0, pad.top + ch);
      barGrad.addColorStop(0, 'rgba(100,255,218,0.7)');
      barGrad.addColorStop(1, 'rgba(0,212,255,0.2)');
      const barPoints = [];
      points.forEach((p, i) => {
        const x = pad.left + cw * i / xStepDenom;
        const y = pad.top + ch * (1 - p.value / max);
        const barH = ch * (p.value / max);
        barPoints.push({ x: x, y: y });
        if (barH > 0) {
          ctx.fillStyle = barGrad;
          ctx.fillRect(x - barW / 2, y, barW, barH);
        }
        if (!isMany) {
          ctx.fillStyle = '#ffd740';
          ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
        }
      });
      if (barPoints.length > 1) {
        ctx.strokeStyle = 'rgba(100,255,218,0.75)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        barPoints.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
        ctx.stroke();
      }
      if (barPoints.length > 0) {
        const last = barPoints[barPoints.length - 1];
        ctx.fillStyle = '#ffd740';
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(points[points.length - 1].value.toFixed(0), last.x, last.y - 6);
      }
      const step = Math.max(1, Math.ceil(points.length / 6));
      ctx.fillStyle = '#8892b0';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      points.forEach((p, i) => {
        if (i % step === 0 || i === points.length - 1) {
          const x = pad.left + cw * i / xStepDenom;
          ctx.fillText(p.label, x, h - 5);
        }
      });
    }

    let calendarOverviewDate = new Date();

    function openCalendarOverviewModal() {
      calendarOverviewDate = new Date();
      renderCalendarOverview();
      document.getElementById('calendarOverlay').classList.add('show');
    }

    function closeCalendarOverviewModal(e) {
      if (e && e.target !== document.getElementById('calendarOverlay')) return;
      document.getElementById('calendarOverlay').classList.remove('show');
    }

    function changeCalendarMonth(delta) {
      calendarOverviewDate.setMonth(calendarOverviewDate.getMonth() + delta);
      renderCalendarOverview();
    }

    function renderCalendarOverview() {
      const y = calendarOverviewDate.getFullYear();
      const m = calendarOverviewDate.getMonth();
      document.getElementById('calendarOverviewMonth').textContent = y + '年' + (m + 1) + '月';
      const firstDay = new Date(y, m, 1).getDay();
      const daysInMonth = new Date(y, m + 1, 0).getDate();
      const todayStr = getTodayStr();
      const dailyHabits = [];
      for (const mod of Object.values(data.modules)) {
        if (mod && Array.isArray(mod.habits)) {
          for (const h of mod.habits) {
            if (h.type === 'daily') dailyHabits.push(h);
          }
        }
      }
      const suppItems = (data.modules.supplements && data.modules.supplements.items) || [];
      const goals = (data.modules.manifestation && data.modules.manifestation.goals) || [];
      let cells = '';
      for (let i = 0; i < firstDay; i++) cells += '<div class="cal-day empty"></div>';
      for (let d = 1; d <= daysInMonth; d++) {
        const ds = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        const doneCount = dailyHabits.filter(h => h.records.includes(ds)).length;
        const suppCount = suppItems.filter(i => i.records && i.records.some(r => r.date === ds && r.taken)).length;
        const maniCount = goals.reduce((sum, g) => sum + (g.records ? g.records.filter(r => r.date === ds).length : 0), 0);
        const cls = ['cal-day'];
        if (ds === todayStr) cls.push('today');
        if (doneCount > 0) cls.push('has-check');
        if (suppCount > 0) cls.push('has-supp');
        if (maniCount > 0) cls.push('has-mani');
        cells += `<div class="${cls.join(' ')}"><span class="cal-day-num">${d}</span>${doneCount > 0 ? '<span class="cal-dot check"></span>' : ''}${suppCount > 0 ? '<span class="cal-dot supp"></span>' : ''}${maniCount > 0 ? '<span class="cal-dot mani"></span>' : ''}</div>`;
      }
      const heads = ['日', '一', '二', '三', '四', '五', '六'].map(w => `<div class="cal-head">${w}</div>`).join('');
      document.getElementById('calendarOverviewBody').innerHTML = `<div class="calendar">${heads}${cells}</div>`;
    }

    function resetAllData() {
      if (confirm('⚠️ 确定要重置所有数据吗？\n\n这会删除所有打卡记录、存款、基金、显化目标和补剂数据，恢复到初始状态。\n\n此操作不可恢复！')) {
        createAutoBackup('重置所有数据前');
        localStorage.removeItem(LS_KEY);
        localStorage.removeItem(LS_KEY + '_active');
        location.reload(true);
      }
    }

    function forceRefresh() {
      if (confirm('确定要刷新页面吗？\n\n这会保留你的打卡数据和离线缓存，只更新页面代码。')) {
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.getRegistrations().then(regs => {
            regs.forEach(r => r.update());
          });
        }
        location.reload(true);
      }
    }

    // ========== 显化记录 ==========
    function addManifestGoal() {
      const input = document.getElementById('manifestGoalInput');
      const title = input.value.trim();
      if (!title) return;
      const mod = data.modules.manifestation;
      if (!mod.goals) mod.goals = [];
      mod.goals.push({
        id: Date.now(),
        title: title,
        description: '',
        targetDate: '',
        status: 'active',
        linkModule: '',
        records: [],
        createdAt: getTodayStr()
      });
      saveData();
      input.value = '';
      renderModule('manifestation');
      updateTotalStats();
      renderNav();
    }

    function toggleManifestGoalStatus(goalId) {
      const mod = data.modules.manifestation;
      const goal = mod.goals.find(g => g.id === goalId);
      if (!goal) return;
      goal.status = goal.status === 'active' ? 'achieved' : 'active';
      if (goal.status === 'achieved') {
        goal.achievedAt = getTodayStr();
        vibrate([15, 30, 20]);
        const btn = document.activeElement;
        if (btn) {
          const rect = btn.getBoundingClientRect();
          spawnConfetti(rect.left + rect.width/2, rect.top + rect.height/2);
        }
      } else {
        delete goal.achievedAt;
        vibrate(12);
      }
      saveData();
      renderModule('manifestation');
      updateTotalStats();
      renderNav();
    }

    function deleteManifestGoal(goalId) {
      if (!confirm('确定删除这个显化目标吗？所有记录也会一并删除。')) return;
      createAutoBackup('删除显化目标前');
      captureUndoSnapshot('已删除显化目标');
      const mod = data.modules.manifestation;
      mod.goals = mod.goals.filter(g => g.id !== goalId);
      saveData();
      renderModule('manifestation');
      updateTotalStats();
      renderNav();
    }

    function toggleManifestExpand(goalId) {
      manifestExpandedGoal = manifestExpandedGoal === goalId ? null : goalId;
      renderModule('manifestation');
    }

    function openManifestRecordModal(goalId) {
      manifestPendingGoalId = goalId;
      document.getElementById('manifestRecordDate').value = getTodayStr();
      document.getElementById('manifestRecordContent').value = '';
      document.getElementById('manifestRecordSigns').value = '';
      document.getElementById('manifestRecordGratitude').value = '';
      document.getElementById('manifestRecordOverlay').classList.add('show');
      setTimeout(() => document.getElementById('manifestRecordContent').focus(), 100);
    }

    function closeManifestRecordModal(e) {
      if (e && e.target !== document.getElementById('manifestRecordOverlay')) return;
      document.getElementById('manifestRecordOverlay').classList.remove('show');
      manifestPendingGoalId = null;
    }

    function saveManifestRecord() {
      const goalId = manifestPendingGoalId;
      if (!goalId) return;
      const date = document.getElementById('manifestRecordDate').value || getTodayStr();
      const content = document.getElementById('manifestRecordContent').value.trim();
      const signs = document.getElementById('manifestRecordSigns').value.trim();
      const gratitude = document.getElementById('manifestRecordGratitude').value.trim();
      if (!content && !signs && !gratitude) { alert('请至少填写一项内容'); return; }
      const mod = data.modules.manifestation;
      const goal = mod.goals.find(g => g.id === goalId);
      if (!goal) return;
      if (!goal.records) goal.records = [];
      goal.records.unshift({ id: Date.now(), date, content, signs, gratitude });
      saveData();
      closeManifestRecordModal();
      manifestExpandedGoal = goalId;
      renderModule('manifestation');
      updateTotalStats();
    }

    function deleteManifestRecord(goalId, recordId) {
      if (!confirm('确定删除这条记录吗？')) return;
      const mod = data.modules.manifestation;
      const goal = mod.goals.find(g => g.id === goalId);
      if (!goal || !goal.records) return;
      createAutoBackup('删除显化记录前');
      captureUndoSnapshot('已删除显化记录');
      goal.records = goal.records.filter(r => r.id !== recordId);
      saveData();
      renderModule('manifestation');
      updateTotalStats();
    }

    function renderManifestationModule(container) {
      const mod = data.modules.manifestation;
      const goals = mod.goals || [];
      const cfg = MODULE_CONFIG.manifestation;

      const activeCount = goals.filter(g => g.status === 'active').length;
      const achievedCount = goals.filter(g => g.status === 'achieved').length;
      const totalRecords = goals.reduce((sum, g) => sum + (g.records ? g.records.length : 0), 0);
      const hasGoals = goals.length > 0;

      const goalsHtml = goals.map(goal => {
        const isAchieved = goal.status === 'achieved';
        const isExpanded = manifestExpandedGoal === goal.id;
        const recordCount = goal.records ? goal.records.length : 0;
        const linkedStats = getGoalLinkedStats(goal);
        const recordsHtml = isExpanded && recordCount > 0 ? `
          <div class="manifest-records">
            ${goal.records.map(r => `
              <div class="manifest-record-item">
                <div class="manifest-record-header">
                  <span class="manifest-record-date">📅 ${r.date}</span>
                  <button class="manifest-record-del" onclick="deleteManifestRecord(${goal.id}, ${r.id})" title="删除">×</button>
                </div>
                ${r.content ? `<div class="manifest-record-content">${escapeHtml(r.content)}</div>` : ''}
                ${r.signs ? `<div class="manifest-record-signs">🔮 迹象：${escapeHtml(r.signs)}</div>` : ''}
                ${r.gratitude ? `<div class="manifest-record-gratitude">🙏 感恩：${escapeHtml(r.gratitude)}</div>` : ''}
              </div>
            `).join('')}
          </div>
        ` : '';

        return `
          <div class="manifest-goal-card ${isAchieved ? 'achieved' : ''}">
            <div class="manifest-goal-main" onclick="toggleManifestExpand(${goal.id})">
              <div class="manifest-goal-left">
                <div class="manifest-goal-icon">${isAchieved ? '✅' : '✨'}</div>
                <div class="manifest-goal-info">
                  <div class="manifest-goal-title">${escapeHtml(goal.title)}</div>
                  <div class="manifest-goal-meta">
                    ${goal.targetDate ? '<span>🎯 ' + goal.targetDate + '</span>' : ''}
                    ${recordCount > 0 ? '<span>📝 ' + recordCount + ' 条记录</span>' : ''}
                    ${isAchieved && goal.achievedAt ? '<span style="color:var(--success)">🎉 ' + goal.achievedAt + ' 实现</span>' : ''}
                  </div>
                  ${goal.description ? `<div class="manifest-goal-desc">${escapeHtml(goal.description)}</div>` : ''}
                  <div class="manifest-goal-link">${linkedStats.icon} ${escapeHtml(linkedStats.text)}</div>
                </div>
              </div>
              <div class="manifest-goal-actions">
                <button class="manifest-goal-btn ${isAchieved ? 'active' : ''}" onclick="event.stopPropagation(); toggleManifestGoalStatus(${goal.id})" title="${isAchieved ? '标记为进行中' : '标记为实现'}">${isAchieved ? '↩️' : '✅'}</button>
                <button class="manifest-goal-btn" onclick="event.stopPropagation(); openManifestRecordModal(${goal.id})" title="添加记录">➕</button>
                <button class="manifest-goal-btn" onclick="event.stopPropagation(); openManifestEdit(${goal.id})" title="编辑">✏️</button>
                <button class="manifest-goal-btn del" onclick="event.stopPropagation(); deleteManifestGoal(${goal.id})" title="删除">🗑️</button>
              </div>
            </div>
            ${recordsHtml}
          </div>
        `;
      }).join('');

      container.innerHTML = `
        <div class="module-title-bar">
          <div class="m-icon" style="background:${cfg.bg};border:1px solid ${cfg.color}22">${cfg.icon}</div>
          <div class="m-text">
            <div class="m-name">${cfg.name}</div>
            <div class="m-desc">${cfg.desc}</div>
          </div>
          <div class="m-progress" style="background:linear-gradient(135deg, ${cfg.color}, ${cfg.color}88);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent">${goals.length}</div>
        </div>

        <div class="stats manifest-stats">
          <div class="stat-card">
            <div class="icon-wrap">✨</div>
            <div class="num">${activeCount}</div>
            <div class="label">进行中</div>
          </div>
          <div class="stat-card">
            <div class="icon-wrap">✅</div>
            <div class="num">${achievedCount}</div>
            <div class="label">已实现</div>
          </div>
          <div class="stat-card">
            <div class="icon-wrap">📝</div>
            <div class="num">${totalRecords}</div>
            <div class="label">总记录</div>
          </div>
        </div>

        <div class="add-box">
          <input type="text" id="manifestGoalInput" placeholder="添加显化目标..." maxlength="30"
            onkeypress="if(event.key==='Enter') addManifestGoal()">
          <button onclick="addManifestGoal()">添加</button>
        </div>

        ${hasGoals ? `
          <div class="manifest-goals-list">
            ${goalsHtml}
          </div>
        ` : `
          <div class="empty-state">
            <div class="big">✨</div>
            <p>还没有显化目标，添加一个开始吧</p>
            <p style="font-size:12px;color:var(--text2);margin-top:4px">写下你的愿望，宇宙正在聆听</p>
          </div>
        `}
      `;
    }


    // ========== 补剂明细 ==========
    function getStockStatus(item) {
      if (typeof item.stock !== 'number') return null;
      if (item.stock <= 0) return 'empty';
      const threshold = typeof item.lowStockThreshold === 'number' && item.lowStockThreshold > 0 ? item.lowStockThreshold : 10;
      if (item.stock <= threshold) return 'low';
      if (typeof item.stockTotal === 'number' && item.stockTotal > 0 && item.stock / item.stockTotal <= 0.2) return 'low';
      return 'ok';
    }

    function renderSupplementStockHtml(item) {
      if (typeof item.stock !== 'number') return '';
      const unit = item.stockUnit || '粒';
      const status = getStockStatus(item);
      const totalText = typeof item.stockTotal === 'number' ? ' / ' + item.stockTotal + unit : '';
      const badge = status === 'low' ? '<span class="supplement-low-badge">⚠️ 快吃完</span>' : status === 'empty' ? '<span class="supplement-low-badge empty">🚫 已吃完</span>' : '';
      return `<div class="supplement-stock ${status === 'low' ? 'low' : status === 'empty' ? 'empty' : ''}"><span>📦 余量 ${item.stock}${unit}${totalText}</span>${badge}</div>`;
    }

    function renderLowStockBannerHtml(items) {
      const low = items.filter(i => ['low', 'empty'].includes(getStockStatus(i)));
      if (!low.length) return '';
      return `<div class="low-stock-banner">⚠️ ${low.length} 种补剂需要补货：${low.map(i => escapeHtml(i.name)).join('、')}</div>`;
    }

    // 今日矿物质总量：只把"填了含量"的项目相加，且不含食物来源。
    // 参考值沿用应用里原有的两条提示（锌 40mg、镁 200-400mg），不新增任何医学结论。
    const ZINC_REFERENCE_LIMIT = 40;
    const MG_REFERENCE_TEXT = '参考 200-400 mg';

    function getMineralTotals(dateStr) {
      const items = (data.modules.supplements && data.modules.supplements.items) || [];
      let zincDue = 0, zincTaken = 0, mgDue = 0, mgTaken = 0, zincSources = 0, mgSources = 0, counted = 0;
      const zincFrom = [], mgFrom = [];
      items.forEach(it => {
        if (!shouldTakeSupplement(it, dateStr)) return;   // 停服日不计入
        const taken = isSupplementTakenOn(it, dateStr);
        let used = false;
        if (typeof it.zincMg === 'number' && it.zincMg > 0) {
          zincDue += it.zincMg; if (taken) zincTaken += it.zincMg; zincSources++; used = true;
          zincFrom.push({ name: it.name, mg: it.zincMg, slot: it.timeSlot || 'noon' });
        }
        if (typeof it.magnesiumMg === 'number' && it.magnesiumMg > 0) {
          mgDue += it.magnesiumMg; if (taken) mgTaken += it.magnesiumMg; mgSources++; used = true;
          mgFrom.push({ name: it.name, mg: it.magnesiumMg, slot: it.timeSlot || 'noon' });
        }
        if (used) counted++;
      });
      return { zincDue, zincTaken, mgDue, mgTaken, zincSources, mgSources, counted, total: items.length, zincFrom, mgFrom };
    }

    // 把来源按含量从多到少排好，只显示名字里的品牌/关键字，避免刷屏
    function formatMineralSources(list) {
      return list.slice().sort((a, b) => b.mg - a.mg)
        .map(s => shortSupplementName(s.name) + ' ' + s.mg + 'mg').join(' · ');
    }

    function shortSupplementName(name) {
      const n = String(name || '');
      if (/VORSE/.test(n)) return 'VORSE';
      if (/NOW/.test(n)) return 'NOW';
      if (/RAINBOWBAR/.test(n)) return 'RAINBOWBAR';
      if (/FoYes|EXE.?FIT/i.test(n)) return 'FoYes';
      return n.length > 12 ? n.slice(0, 12) + '…' : n;
    }

    function renderMineralSummaryHtml(dateStr) {
      const t = getMineralTotals(dateStr);
      if (!t.zincSources && !t.mgSources) return '';
      const rows = [];
      if (t.zincSources) {
        const overMg = Math.round(t.zincDue - ZINC_REFERENCE_LIMIT);
        const over = overMg > 0;
        rows.push('<div class="mineral-row"><span>锌（元素）</span><b class="' + (over ? 'over' : '') + '">≈ '
          + Math.round(t.zincDue) + ' mg</b><span class="mineral-ref">参考上限 ' + ZINC_REFERENCE_LIMIT + ' mg'
          + (over ? ' ⚠️ 超出 ' + overMg + ' mg' : '') + '</span></div>');
        rows.push('<div class="mineral-sources">来源：' + escapeHtml(formatMineralSources(t.zincFrom))
          + '　·　分属 ' + new Set(t.zincFrom.map(s => s.slot)).size + ' 个时段</div>');
      }
      if (t.mgSources) {
        rows.push('<div class="mineral-row"><span>镁（元素）</span><b>≈ ' + Math.round(t.mgDue)
          + ' mg</b><span class="mineral-ref">' + MG_REFERENCE_TEXT + '</span></div>');
      }
      const takenParts = [];
      if (t.zincSources) takenParts.push('锌 ' + Math.round(t.zincTaken) + ' mg');
      if (t.mgSources) takenParts.push('镁 ' + Math.round(t.mgTaken) + ' mg');
      return `
        <div class="mineral-summary" id="mineralSummary">
          <div class="mineral-title">📦 ${dateStr === getTodayStr() ? '今日' : '当日'}矿物质总量（按标签折算）</div>
          ${rows.join('')}
          <div class="mineral-foot">已服：${takenParts.join(' · ')}　·　已登记 ${t.counted}/${t.total} 项，未填写含量的项目未计入；不含食物来源。仅供参考。</div>
        </div>
      `;
    }

    function shouldTakeSupplement(item, dateStr) {
      if (item.active === false) return false;   // 已吃完/已停用：不再计入"今天该吃"
      if (!item.cycleEnabled || !item.cycleStart || !item.cycleTakeDays) return true;
      const diff = daysBetween(item.cycleStart, dateStr);
      if (diff < 0) return false;
      const cycleLength = item.cycleTakeDays + (item.cycleStopDays || 0);
      return ((diff % cycleLength) + cycleLength) % cycleLength < item.cycleTakeDays;
    }

    function isSupplementTakenOn(item, dateStr) {
      return !!(item.records && item.records.some(r => r.date === dateStr && r.taken));
    }

    function getSupplementMissedDays(item, endDateStr) {
      if (isSupplementTakenOn(item, endDateStr)) return 0;
      if (!item.records || item.records.length === 0) return 0;
      if (!shouldTakeSupplement(item, endDateStr)) return 0;
      let missed = 0;
      const d = new Date(endDateStr + 'T00:00:00');
      for (let i = 1; i <= 30; i++) {
        const t = new Date(d);
        t.setDate(d.getDate() - i);
        const ds = t.getFullYear() + '-' + String(t.getMonth()+1).padStart(2,'0') + '-' + String(t.getDate()).padStart(2,'0');
        if (item.records && item.records.some(r => r.date === ds && r.taken)) break;
        if (!shouldTakeSupplement(item, ds)) continue;
        missed++;
      }
      return missed;
    }

    function renderSupplementScheduleHtml(item, dateStr) {
      const shouldTake = shouldTakeSupplement(item, dateStr);
      const missed = getSupplementMissedDays(item, dateStr);
      const isToday = dateStr === getTodayStr();
      let html = '';
      if (item.cycleEnabled && item.cycleStart) {
        html += `<div class="supplement-schedule ${shouldTake ? 'take' : 'rest'}"><span>${shouldTake ? (isToday ? '✅ 今日该吃' : '✅ 该吃') : (isToday ? '⏸️ 今日停服' : '⏸️ 停服')}</span></div>`;
      }
      if (shouldTake && !isSupplementTakenOn(item, dateStr)) {
        html += missed > 0
          ? `<div class="supplement-schedule missed"><span>⚠️ 已断服 ${missed} 天</span></div>`
          : `<div class="supplement-schedule pending"><span>${isToday ? '今日未服' : '当日未服'}</span></div>`;
      }
      if (!html) return '';
      return `<div class="supplement-schedule-wrap">${html}</div>`;
    }

    function getSupplementGroups(item) {
      const text = (item.name || '') + ' ' + (item.note || '') + ' ' + (item.warning || '');
      return {
        zinc: /锌|牡蛎/.test(text),
        magnesium: /镁/.test(text),
        calcium: /钙/.test(text),
        fishOil: /鱼油|EPA|DHA/.test(text),
        curcumin: /姜黄/.test(text),
        arginine: /精氨酸|瓜氨酸/.test(text),
        beetroot: /甜菜根/.test(text),
        fenugreek: /葫芦巴/.test(text),
        coq10: /辅酶Q10|辅酶 q10|CoQ10/.test(text),
        sawPalmetto: /锯棕榈|前列腺六合一/.test(text),
        creatine: /肌酸/.test(text),
        milkThistle: /水飞蓟/.test(text),
        cordyceps: /蛹虫草/.test(text),
        maca: /玛咖|玛卡/.test(text),
        multi: /多维|复合维生素|多种维生素/.test(text),
        whey: /增肌粉/.test(text),
        collagen: /胶原蛋白/.test(text),
        rice: /营养米粉/.test(text),
        dapoxetine: /达泊西汀/.test(text),
        tadalafil: /他达拉非/.test(text),
        ayurveda: /阿育吠陀/.test(text),
        // —— 按标签成分补充的归类（只用于"数有几项重叠"和下面那两条提示，不生成新的医学结论）——
        // 姜黄沿用上面的 curcumin 键（它以前定义了却没人用，现在正式用上）
        // 元宝枫籽油按你的要求不做归类
        yohimbine: /育亨宾|yohimbe/i.test(text),
        piperine: /胡椒碱|黑胡椒/.test(text)
      };
    }

    function getSupplementInteractionWarnings(items) {
      // 已吃完/已停用的项目不再参与"相互作用"判断——它们不在你现在吃的东西里
      items = (items || []).filter(i => i && i.active !== false);
      const groups = items.map(getSupplementGroups);
      const count = key => groups.filter(g => g[key]).length;
      const warnings = [];
      if (count('zinc') >= 2) warnings.push({ title: '多个产品含锌', text: '检测到 ' + count('zinc') + ' 个含锌产品，注意每天锌总量不宜长期超过 40mg。' });
      if (count('magnesium') >= 2) warnings.push({ title: '多个产品含镁', text: '检测到 ' + count('magnesium') + ' 个含镁产品，补充剂镁建议每天 200-400mg，过量易腹泻。' });
      if (count('zinc') >= 1 && count('calcium') >= 1) warnings.push({ title: '锌与钙建议错开', text: '锌和钙会互相影响吸收，建议间隔 2 小时以上服用。' });
      const mineralKeys = ['zinc', 'magnesium', 'calcium'].filter(key => count(key) > 0);
      if (mineralKeys.length >= 2) {
        const labels = { zinc: '锌', magnesium: '镁', calcium: '钙' };
        warnings.push({ title: '矿物质吸收竞争', text: '同一天服用 ' + mineralKeys.map(k => labels[k]).join('、') + ' 时，这些矿物质会互相影响吸收，也可能降低四环素、喹诺酮等抗生素吸收，建议间隔 2 小时以上。' });
      }
      const bleedKeys = ['fishOil', 'sawPalmetto', 'fenugreek', 'cordyceps'].filter(key => count(key) > 0);
      if (bleedKeys.length >= 2) {
        warnings.push({ title: '凝血影响叠加', text: '鱼油、锯棕榈、葫芦巴、蛹虫草中的 ' + bleedKeys.length + ' 类可能同时影响凝血，正在服用抗凝药/抗血小板药或准备手术时需提前咨询医生。' });
      }
      const bpKeys = ['coq10', 'beetroot', 'fishOil', 'arginine', 'cordyceps'].filter(key => count(key) > 0);
      if (bpKeys.length >= 2) {
        warnings.push({ title: '降压/扩血管叠加', text: '辅酶Q10、甜菜根、鱼油、精氨酸/瓜氨酸、蛹虫草中的 ' + bpKeys.length + ' 类可能叠加降压或扩血管作用，低血压或服用降压药时注意头晕乏力。' });
      }
      const sugarKeys = ['fenugreek', 'milkThistle', 'cordyceps'].filter(key => count(key) > 0);
      if (sugarKeys.length >= 2) {
        warnings.push({ title: '血糖影响叠加', text: '葫芦巴、水飞蓟、蛹虫草中的 ' + sugarKeys.length + ' 类可能降低血糖，糖尿病或服用降糖药时注意监测。' });
      }
      if (count('creatine') >= 1 && count('whey') >= 1) {
        warnings.push({ title: '肾脏代谢负担', text: '肌酸与水解增肌粉同时使用会增加蛋白质和肌酸代谢负担，肾功能异常或服用影响肾功能的药物时建议避免。' });
      }
      if (count('beetroot') >= 1 && count('calcium') >= 1) {
        warnings.push({ title: '甜菜根与钙', text: '甜菜根含草酸盐，与钙同服可能增加草酸钙结石风险，建议错开时间；有结石史先咨询医生。' });
      }
      if (count('sawPalmetto') >= 1) {
        warnings.push({ title: '锯棕榈注意事项', text: '前列腺六合一中的锯棕榈可能影响凝血并干扰前列腺相关检查，服用抗凝药或做检查前先告知医生。' });
      }
      // 影响肝脏药物代谢的成分（水飞蓟 / 胡椒碱 / 姜黄）合并为一条，避免重复刷屏
      const hepaticParts = [];
      if (count('milkThistle') >= 1) hepaticParts.push('水飞蓟（可能影响经肝脏代谢的药物，如他汀、部分抗过敏药）');
      if (count('piperine') >= 1) hepaticParts.push('胡椒碱／黑胡椒提取物（常被提到会影响 CYP3A4 等药物代谢酶与药物外排转运）');
      if (count('curcumin') >= 1) hepaticParts.push('姜黄／姜黄素（同样有影响药物代谢的讨论，标签另注极少数情况下可能损害肝脏）');
      if (hepaticParts.length) {
        const rxNames = [];
        if (count('dapoxetine') >= 1) rxNames.push('达泊西汀');
        if (count('tadalafil') >= 1) rxNames.push('他达拉非');
        warnings.push({
          title: '影响肝脏代谢的成分',
          text: '清单中含 ' + hepaticParts.join('；') + '。这几类在同服时都可能改变其他药物的血药浓度。'
              + (rxNames.length ? '你正在使用的 ' + rxNames.join('、') + ' 均经肝脏代谢，' : '')
              + '建议把这几种成分一并告知医生或药师，由他们判断是否需要调整。'
        });
      }
      if (count('maca') >= 1) {
        warnings.push({ title: '玛咖注意事项', text: '清单中含玛咖的产品：玛咖与甲状腺/激素类药物同用的证据有限，服用相关药物或做激素检查前建议先咨询医生。' });
      }
      if (count('multi') >= 1 && (count('zinc') >= 1 || count('magnesium') >= 1 || count('calcium') >= 1)) {
        warnings.push({ title: '多维片与矿物质间隔', text: '复合维生素/牡蛎片同时含锌、硒、碘等，与其他锌、镁、钙产品同服时建议错开 2 小时，甲状腺用药也需间隔。' });
      }
      if (count('collagen') >= 1 && (count('whey') >= 1 || count('creatine') >= 1)) {
        warnings.push({ title: '蛋白与肌酸叠加', text: '胶原蛋白与增肌粉/肌酸叠加会增加蛋白和代谢负担，肾功能异常时建议减少或分开使用。' });
      }
      if (count('rice') >= 1 && mineralKeys.length >= 1) {
        warnings.push({ title: '营养米粉与矿物质', text: '营养米粉若添加铁、钙或锌，会参与矿物质吸收竞争，建议与其他矿物质产品错开 2 小时。' });
      }
      if (count('dapoxetine') >= 1 && count('tadalafil') >= 1) {
        warnings.push({ title: '达泊西汀 + 他达拉非', text: '两者都属于处方药，同用可能叠加低血压、头晕、晕厥和心血管风险。仅在医生明确安排并错开服用时使用；出现胸痛、呼吸困难或持续勃起需立即就医。' });
      }
      const dapVasoTitles = ['arginine', 'beetroot'].filter(key => count(key) > 0);
      if (count('dapoxetine') >= 1 && dapVasoTitles.length) {
        warnings.push({ title: '达泊西汀与扩血管补剂', text: '达泊西汀本身可能引起头晕和体位性低血压，与瓜氨酸/精氨酸或甜菜根同用可能增强降压/扩血管作用，建议错开时间并避免站立过快。' });
      }
      if (count('dapoxetine') >= 1 && count('milkThistle') >= 1) {
        warnings.push({ title: '达泊西汀 + 水飞蓟', text: '水飞蓟可能影响肝脏代谢酶，改变达泊西汀血药浓度；同用期间出现恶心、头晕加重时咨询医生。' });
      }
      const tadVaso = ['arginine', 'beetroot', 'coq10', 'fishOil', 'cordyceps'].filter(key => count(key) > 0);
      if (count('tadalafil') >= 1 && tadVaso.length) {
        warnings.push({ title: '他达拉非与扩血管补剂', text: '他达拉非禁止与硝酸酯类药物同用；与瓜氨酸/精氨酸、甜菜根、鱼油、辅酶Q10、蛹虫草等扩血管类补剂同用可能叠加降压，注意头晕乏力。' });
      }
      if (count('ayurveda') >= 1) {
        warnings.push({ title: '阿育吠陀药物成分提示', text: '清单中有阿育吠陀制剂。这类配方常含矿物灰（Bhasm）与 Shilajit，有重金属（铅/汞/砷）超标风险；也可能含南非醉茄（需关注甲状腺、血压、血糖）或刺毛黧豆（含左旋多巴，正在服用帕金森药、抗抑郁药尤其 MAO 抑制剂、抗精神病药者应避免）。建议先咨询医生或药师，并从正规渠道购买。' });
      }
      // 育亨宾：按成分触发，不再依赖"阿育吠陀"这个名字。
      // （否则把条目改成产品名之后，这条警告会静默消失——那正是最不该丢的一条。）
      if (count('yohimbine') >= 1) {
        const hasRx = count('dapoxetine') >= 1 || count('tadalafil') >= 1;
        const names = [];
        if (count('dapoxetine') >= 1) names.push('达泊西汀');
        if (count('tadalafil') >= 1) names.push('他达拉非');
        warnings.push({
          title: '育亨宾（Yohimbe）风险',
          text: '清单中有含育亨宾的产品。育亨宾作用较强，标签警示：应避免与硝酸酯类或其他血管扩张剂同服；有高血压、心脏病、焦虑症，'
              + '或正在服用降压药、抗抑郁药（尤其 MAO 抑制剂）、抗凝药者应避免；可能引起血压升高、心跳加快、焦虑、失眠。'
              + (hasRx ? '你同时在使用处方药（' + names.join('、') + '），这一组合请务必先咨询医生。' : '请务必先咨询医生。')
        });
      }
      // 精氨酸/瓜氨酸类：标签级禁忌（与 PDE5 抑制剂、硝酸酯、降压药同用）
      if (count('arginine') >= 1) {
        const rx = [];
        if (count('tadalafil') >= 1) rx.push('他达拉非');
        if (count('dapoxetine') >= 1) rx.push('达泊西汀');
        warnings.push({
          title: '精氨酸类与处方药',
          text: '清单中有精氨酸/瓜氨酸产品。标签警示：低血压患者，以及正在服用降压药、硝酸甘油或伟哥类（PDE5 抑制剂）药物的人群，'
              + '标签明确标注「绝对禁止服用」，可能导致血压急剧下降。'
              + (rx.length ? '你正在使用：' + rx.join('、') + '，请务必先咨询医生。' : '')
        });
      }
      return warnings;
    }

    function setSupplementTagFilter(tag) {
      supplementTagFilter = tag || 'all';
      renderModule('supplements');
    }

    function formatSupplementDate(dateStr) {
      const d = new Date(dateStr + 'T00:00:00');
      const week = ['周日','周一','周二','周三','周四','周五','周六'];
      return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + week[d.getDay()];
    }

    function setSupplementDate(dateStr) {
      if (!dateStr) return;
      if (dateStr > getTodayStr()) {
        alert('不能记录未来的日期');
        const input = document.getElementById('supplementDateInput');
        if (input) input.value = supplementViewDate;
        return;
      }
      supplementViewDate = dateStr;
      renderModule('supplements');
    }

    function shiftSupplementDate(offset) {
      const d = new Date(supplementViewDate + 'T00:00:00');
      d.setDate(d.getDate() + offset);
      setSupplementDate(getDateStr(d));
    }

    function updateSupplementInPlace(item) {
      const card = document.querySelector(`.supplement-item[data-id="${item.id}"]`);
      if (!card) return false;
      const dateStr = supplementViewDate;
      const isTaken = isSupplementTakenOn(item, dateStr);
      card.classList.toggle('taken', isTaken);
      const btn = card.querySelector('.supplement-check-btn');
      if (btn) {
        btn.classList.toggle('taken', isTaken);
        btn.textContent = isTaken ? '✓' : '';
        btn.title = isTaken ? '取消' : '标记已服用';
      }
      const stockEl = card.querySelector('.supplement-stock');
      if (stockEl) stockEl.outerHTML = renderSupplementStockHtml(item);
      const scheduleWrap = card.querySelector('.supplement-schedule-wrap');
      if (scheduleWrap) scheduleWrap.outerHTML = renderSupplementScheduleHtml(item, dateStr);
      const group = card.closest('.supplement-group');
      if (group) {
        const headerCount = group.querySelector('.supplement-group-count');
        if (headerCount) {
          const slotItems = data.modules.supplements.items.filter(i => i.timeSlot === item.timeSlot && i.active !== false);
          const slotTaken = slotItems.filter(i => isSupplementTakenOn(i, dateStr)).length;
          headerCount.textContent = slotTaken + '/' + slotItems.length;
        }
      }
      const container = document.getElementById('moduleContent');
      const items = data.modules.supplements.items || [];
      // 必须和 renderSupplementsModule 保持一致：只统计"在用"的项目，
      // 否则勾选一次之后进度会显示成含已吃完项目的分母。
      const activeItems = items.filter(i => i.active !== false);
      const visibleItems = supplementTagFilter === 'all' ? activeItems : activeItems.filter(i => (i.tags || []).includes(supplementTagFilter));
      const banner = container.querySelector('.low-stock-banner');
      if (banner) banner.outerHTML = renderLowStockBannerHtml(activeItems);
      const takenCount = visibleItems.filter(i => isSupplementTakenOn(i, dateStr)).length;
      const totalCount = visibleItems.length;
      const pct = totalCount ? Math.round(takenCount / totalCount * 100) : 0;
      const pp = container.querySelector('.module-progress-bar .pp');
      if (pp) pp.textContent = takenCount + '/' + totalCount;
      const pf = container.querySelector('.module-progress-bar .pf');
      if (pf) pf.style.width = pct + '%';
      const mp = container.querySelector('.module-title-bar .m-progress');
      if (mp) mp.textContent = pct + '%';
      const phLabel = container.querySelector('.module-progress-bar .ph span');
      if (phLabel) phLabel.textContent = dateStr === getTodayStr() ? '今日服用进度' : '当日服用进度';
      const summary = container.querySelector('.supplement-day-summary');
      if (summary) {
        summary.innerHTML = `<span>${formatSupplementDate(dateStr)}</span>` + (totalCount > 0
          ? takenCount === totalCount
            ? '<span class="supplement-day-done">已全部记录</span>'
            : '<span class="supplement-day-left">还有 ' + (totalCount - takenCount) + ' 项未记录</span>'
          : '<span class="supplement-day-left">还没有补剂</span>');
      }
      return true;
    }

    function toggleSupplement(id) {
      const mod = data.modules.supplements;
      const item = mod.items.find(i => i.id === id);
      if (!item) return;
      const dateStr = supplementViewDate;
      if (dateStr > getTodayStr()) {
        alert('不能记录未来的日期');
        return;
      }
      const nextTaken = !isSupplementTakenOn(item, dateStr);
      vibrate(nextTaken ? 25 : 12);
      if (!item.records) item.records = [];
      // 重要：不要"删掉当天记录再重建"。用药日志（剂量/时间/反应/备注）就存在这条记录里，
      // 删除重建会把用户填写的内容清空且无法恢复。这里只切换 taken 标记，内容原样保留。
      // 注意要按"当天所有记录"查找（不能只找 taken 的），否则取消后再勾选会新建一条空记录，
      // 把原来填好的反应/备注挤成看不见的孤儿记录。
      const recsForDate = item.records.filter(r => r.date === dateStr);
      if (nextTaken) {
        const takenRec = recsForDate.find(r => r.taken);
        if (takenRec) {
          takenRec.taken = true;
        } else if (recsForDate.length) {
          // 恢复当天已有记录，优先选内容最完整的一条
          const best = recsForDate.slice().sort((a, b) =>
            ((b.reaction ? 1 : 0) + (b.note ? 1 : 0) + (b.dose ? 1 : 0)) -
            ((a.reaction ? 1 : 0) + (a.note ? 1 : 0) + (a.dose ? 1 : 0)))[0];
          best.taken = true;
        } else {
          const now = new Date();
          item.records.push({
            id: Date.now(),
            date: dateStr,
            taken: true,
            time: now.toTimeString().slice(0, 5),
            dose: item.dosage || '',
            reaction: '',
            note: '',
            loggedAt: now.toISOString()
          });
        }
        if (dateStr === getTodayStr()) {
          item.taken = true;
          if (typeof item.stock === 'number' && item.stock > 0) item.stock -= 1;
        }
      } else {
        // 取消服用：记录本体全部保留，只把 taken 置 false（isSupplementTakenOn 会忽略它）
        if (recsForDate.length) recsForDate.forEach(r => { r.taken = false; });
        else item.records = item.records.filter(r => r.date !== dateStr);
        if (dateStr === getTodayStr()) {
          item.taken = false;
          if (typeof item.stock === 'number') {
            // 取消勾选时把余量加回来，但不能超过瓶身总量（否则会凭空多出药）
            const cap = (typeof item.stockTotal === 'number' && item.stockTotal > 0) ? item.stockTotal : Infinity;
            item.stock = Math.min(cap, item.stock + 1);
          }
        }
      }
      saveData();
      const updated = updateSupplementInPlace(item);
      if (!updated) renderModule('supplements');
      // 就地更新不会重画页面顶部的矿物质汇总，这里单独刷新一次
      const mineralEl = document.getElementById('mineralSummary');
      if (mineralEl) {
        const html = renderMineralSummaryHtml(supplementViewDate);
        if (html) mineralEl.outerHTML = html; else mineralEl.remove();
      }
      updateTotalStats();
      renderNav();
      celebrateIfComplete();
    }

    function addSupplement() {
      const input = document.getElementById('supplementInput');
      const name = input.value.trim();
      if (!name) return;
      const mod = data.modules.supplements;
      if (!mod.items) mod.items = [];
      mod.items.push({
        id: Date.now(),
        name: name,
        icon: '💊',
        dosage: '',
        time: '随餐',
        timeSlot: 'noon',
        taken: false,
        records: [],
        stock: null,
        stockTotal: null,
        stockUnit: '粒',
        lowStockThreshold: 10,
        cycleEnabled: false,
        cycleTakeDays: 5,
        cycleStopDays: 2,
        cycleStart: '',
        tags: [],
        note: '',
        warning: ''
      });
      saveData();
      input.value = '';
      renderModule('supplements');
      updateTotalStats();
      renderNav();
    }

    function deleteSupplement(id) {
      if (!confirm('确定删除这个补剂吗？')) return;
      createAutoBackup('删除补剂前');
      captureUndoSnapshot('已删除补剂');
      data.modules.supplements.items = data.modules.supplements.items.filter(i => i.id !== id);
      saveData();
      renderModule('supplements');
      updateTotalStats();
      renderNav();
    }

    // 已吃完 / 已停用：只切换 active 标记，项目与全部历史记录都保留，可随时恢复
    function setSupplementActive(id, active) {
      const item = (data.modules.supplements.items || []).find(i => i.id === id);
      if (!item) return;
      if (active === false && !confirm('把「' + item.name + '」标记为已吃完／已停用？\n\n历史打卡记录会全部保留，之后随时可以点「重新开始」恢复。')) return;
      createAutoBackup(active === false ? '标记补剂已吃完前' : '恢复补剂前');
      captureUndoSnapshot(active === false ? '已停用补剂' : '已恢复补剂');
      item.active = active !== false;
      item.activeUserEdited = true;   // 记下这是你自己改的，以后我更新清单不会覆盖
      saveData();
      renderModule('supplements');
      updateTotalStats();
      renderNav();
    }

    function getLastSupplementTakenDate(item) {
      const dates = (item.records || []).filter(r => r.taken).map(r => r.date).sort();
      return dates.length ? dates[dates.length - 1] : '';
    }

    function renderSupplementsModule(container) {
      const mod = data.modules.supplements;
      const items = mod.items || [];
      // 每日列表、进度、矿物质汇总、相互作用提醒都只统计"在用"的项目；
      // 已吃完/已停用的项目在下方单独列出，历史记录一条不删。
      const allItems = items.filter(i => i.active !== false);
      const inactiveItems = items.filter(i => i.active === false);
      const visibleItems = supplementTagFilter === 'all' ? allItems : allItems.filter(i => (i.tags || []).includes(supplementTagFilter));
      const allTags = [...new Set(allItems.reduce((acc, i) => acc.concat(i.tags || []), []))];
      const cfg = MODULE_CONFIG.supplements;
      const viewDate = supplementViewDate;
      const todayStr = getTodayStr();
      const isToday = viewDate === todayStr;
      const takenCount = visibleItems.filter(i => isSupplementTakenOn(i, viewDate)).length;
      const totalCount = visibleItems.length;
      const pct = totalCount ? Math.round(takenCount / totalCount * 100) : 0;
      const interactionWarnings = getSupplementInteractionWarnings(allItems);

      // 按时间段分组
      const grouped = {};
      Object.keys(SUPPLEMENT_TIME_SLOTS).forEach(k => grouped[k] = []);
      visibleItems.forEach(item => {
        const slot = item.timeSlot || 'noon';
        if (!grouped[slot]) grouped[slot] = [];
        grouped[slot].push(item);
      });

      let groupsHtml = '';
      Object.entries(SUPPLEMENT_TIME_SLOTS).sort((a, b) => a[1].order - b[1].order).forEach(([slotKey, slotInfo]) => {
        const slotItems = grouped[slotKey] || [];
        if (slotItems.length === 0) return;

        const slotTaken = slotItems.filter(i => isSupplementTakenOn(i, viewDate)).length;
        groupsHtml += `
          <div class="supplement-group">
            <div class="supplement-group-header" style="border-left-color:${slotInfo.color}">
              <span class="supplement-group-label" style="color:${slotInfo.color}">${slotInfo.label}</span>
              <span class="supplement-group-count">${slotTaken}/${slotItems.length}</span>
            </div>
            <div class="supplement-items">
              ${slotItems.map(item => {
                const itemTaken = isSupplementTakenOn(item, viewDate);
                return `
                <div class="supplement-item ${itemTaken ? 'taken' : ''}" data-id="${item.id}">
                  <div class="supplement-item-main">
                    <div class="supplement-item-icon">${item.icon}</div>
                    <div class="supplement-item-info">
                      <div class="supplement-item-name">${escapeHtml(item.name)}</div>
                      ${(item.tags || []).length ? `<div class="supplement-tags">${item.tags.map(t => `<span class="supplement-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
                      <div class="supplement-item-meta">
                        <span class="supplement-dosage">${escapeHtml(item.dosage)}</span>
                        <span class="supplement-time">⏰ ${escapeHtml(item.time)}</span>
                      </div>
                      ${item.note ? `<div class="supplement-note">💡 ${escapeHtml(item.note)}</div>` : ''}
                      ${item.warning ? `<div class="supplement-warning">⚠️ ${escapeHtml(item.warning)}</div>` : ''}
                      ${renderSupplementStockHtml(item)}
                      ${renderSupplementScheduleHtml(item, viewDate)}
                    </div>
                  </div>
                  <div class="supplement-item-actions">
                    <button class="supplement-check-btn ${itemTaken ? 'taken' : ''}" onclick="toggleSupplement(${item.id})" title="${itemTaken ? '取消' : '标记已服用'}">
                      ${itemTaken ? '✓' : ''}
                    </button>
                    <button class="supplement-edit-btn" onclick="openSupplementEdit(${item.id})" title="编辑">✏️</button>
                    <button class="supplement-archive-btn" onclick="setSupplementActive(${item.id}, false)" title="已吃完 / 停用">📦</button>
                    <button class="supplement-del-btn" onclick="deleteSupplement(${item.id})" title="删除">×</button>
                  </div>
                </div>
              `;
              }).join('')}
            </div>
          </div>
        `;
      });

      container.innerHTML = `
        <div class="module-title-bar">
          <div class="m-icon" style="background:${cfg.bg};border:1px solid ${cfg.color}22">${cfg.icon}</div>
          <div class="m-text">
            <div class="m-name">${cfg.name}</div>
            <div class="m-desc">${cfg.desc}</div>
          </div>
          <div class="m-progress" style="background:linear-gradient(135deg, ${cfg.color}, ${cfg.color}88);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent">${pct}%</div>
        </div>

        <div class="supplement-day-nav">
          <button class="supplement-day-arrow" onclick="shiftSupplementDate(-1)" title="前一天">‹</button>
          <div class="supplement-day-picker">
            <input type="date" id="supplementDateInput" value="${viewDate}" max="${todayStr}" onchange="setSupplementDate(this.value)">
            <span class="supplement-day-tag ${isToday ? 'today' : ''}">${isToday ? '今天' : '历史记录'}</span>
          </div>
          <button class="supplement-day-arrow" onclick="shiftSupplementDate(1)" title="后一天" ${isToday ? 'disabled' : ''}>›</button>
        </div>

        <div class="supplement-day-summary">
          <span>${formatSupplementDate(viewDate)}</span>
          ${totalCount > 0
            ? takenCount === totalCount
              ? '<span class="supplement-day-done">已全部记录</span>'
              : '<span class="supplement-day-left">还有 ' + (totalCount - takenCount) + ' 项未记录</span>'
            : '<span class="supplement-day-left">还没有补剂</span>'}
        </div>

        <div class="module-progress-bar">
          <div class="ph"><span>${isToday ? '今日服用进度' : '当日服用进度'}</span><span class="pp" style="color:${cfg.color}">${takenCount}/${totalCount}</span></div>
          <div class="pb"><div class="pf" style="width:${pct}%;background:linear-gradient(90deg,${cfg.color},${cfg.color}66)"></div></div>
        </div>

        ${renderMineralSummaryHtml(viewDate)}

        ${renderLowStockBannerHtml(allItems)}

        ${allTags.length ? `
          <div class="supplement-tag-filter">
            <button class="supplement-tag-chip ${supplementTagFilter === 'all' ? 'active' : ''}" data-tag="all" onclick="setSupplementTagFilter(this.dataset.tag)">全部</button>
            ${allTags.map(t => `<button class="supplement-tag-chip ${supplementTagFilter === t ? 'active' : ''}" data-tag="${escapeHtml(t)}" onclick="setSupplementTagFilter(this.dataset.tag)">${escapeHtml(t)}</button>`).join('')}
          </div>
        ` : ''}

        <div class="add-box">
          <input type="text" id="supplementInput" placeholder="添加新补剂..." maxlength="30"
            onkeypress="if(event.key==='Enter') addSupplement()">
          <button onclick="addSupplement()">添加</button>
        </div>

        ${totalCount > 0 ? groupsHtml : `
          <div class="empty-state">
            <div class="big">💊</div>
            <p>还没有添加补剂</p>
            <p style="font-size:12px;color:var(--text2);margin-top:4px">上方输入框添加你的第一瓶补剂</p>
          </div>
        `}

        ${interactionWarnings.length ? `
          <div class="supplement-interactions">
            <div class="supplement-interactions-title">⚠️ 相互作用提醒</div>
            ${interactionWarnings.map(w => `
              <div class="supplement-interaction-item">
                <span class="supplement-interaction-name">${w.title}</span>
                <span class="supplement-interaction-text">${w.text}</span>
              </div>
            `).join('')}
            <div class="supplement-interaction-item">
              <span class="supplement-interaction-name">参考提示</span>
              <span class="supplement-interaction-text">以上为常见相互作用参考，不替代医生或药师建议；正在服药或准备手术前请咨询专业人士。</span>
            </div>
          </div>
        ` : ''}

        ${inactiveItems.length ? `
          <div class="supplement-archived">
            <div class="supplement-archived-title">📦 已吃完 / 已停用（${inactiveItems.length}）</div>
            <div class="supplement-archived-hint">这些项目不再计入今日进度、矿物质汇总和相互作用提醒；历史打卡记录全部保留，可随时恢复。</div>
            ${inactiveItems.map(i => {
              const last = getLastSupplementTakenDate(i);
              return `
              <div class="supplement-archived-row">
                <span class="supplement-archived-name">${i.icon} ${escapeHtml(i.name)}</span>
                <span class="supplement-archived-meta">${(i.records || []).length} 条记录${last ? ' · 最后 ' + last : ''}</span>
                <button class="supplement-archived-restore" onclick="setSupplementActive(${i.id}, true)">重新开始</button>
              </div>`;
            }).join('')}
          </div>
        ` : ''}
      `;
    }

    // ========== 睡眠流程 ==========
    function getSleepStepDefs() {
      return {
      normal: [
        { id: 'dinner', icon: '🍽️', time: '20:00前', text: '吃完晚饭，之后不再吃大餐' },
        { id: 'caffeine', icon: '☕', time: '16:00后', text: '不喝咖啡、茶和酒精' },
        { id: 'wind', icon: '📵', time: '21:30', text: '放下手机，洗漱准备' },
        { id: 'bed', icon: '🌙', time: '22:30', text: '关灯上床' },
        { id: 'wake', icon: '⏰', time: '明早06:30', text: '按时起床，不赖床' }
      ],
      nightA: [
        { id: 'train', icon: '💪', time: '09:30-11:00', text: '中等强度训练' },
        { id: 'lunch', icon: '🍚', time: '12:00前', text: '吃完午饭' },
        { id: 'preSleep', icon: '😴', time: '14:00-16:00', text: '班前觉 2 小时' },
        { id: 'wake', icon: '⏰', time: '16:00', text: '起床，不再碰床' },
        { id: 'prep', icon: '🧴', time: '16:00-19:00', text: '洗漱吃饭准备上班' },
        { id: 'caffeine', icon: '☕', time: '20:00后', text: '停止咖啡因' },
        { id: 'nightSleep', icon: '🌙', time: '22:00-04:00', text: '班内睡 5.5-6 小时' },
        { id: 'alarm', icon: '⏰', time: '04:00', text: '闹钟必设，不睡过交班' }
      ],
      nightB: [
        { id: 'train', icon: '💪', time: '09:30-11:00', text: '中等强度训练' },
        { id: 'lunch', icon: '🍚', time: '12:00-12:30', text: '吃午饭：蛋白质+复合碳水+蔬菜' },
        { id: 'preSleep', icon: '😴', time: '13:00-17:00', text: '班前觉 3-4 小时' },
        { id: 'wake', icon: '⏰', time: '17:00', text: '起床，不再碰床' },
        { id: 'prep', icon: '🧴', time: '17:00-19:00', text: '洗漱吃饭准备上班' },
        { id: 'caffeine', icon: '☕', time: '03:00后', text: '停止咖啡因' },
        { id: 'nightSleep', icon: '🌙', time: '04:00-07:00', text: '班内睡满 3 小时' },
        { id: 'alarm', icon: '⏰', time: '07:00', text: '闹钟必设，不睡过交班' }
      ],
      offA: [
        { id: 'back', icon: '🕶️', time: '下班后', text: '戴墨镜回家，拉窗帘' },
        { id: 'sleep', icon: '😴', time: '到家后', text: '立刻补觉 2.5-3.5 小时' },
        { id: 'wake', icon: '⏰', time: '12:30-13:30', text: '起床' },
        { id: 'train', icon: '💪', time: '16:00-17:30', text: '训练' },
        { id: 'bed', icon: '🌙', time: '22:30-23:00', text: '上床，恢复夜觉' }
      ],
      offB: [
        { id: 'back', icon: '🕶️', time: '下班后', text: '戴墨镜回家，拉窗帘' },
        { id: 'sleep', icon: '😴', time: '到家后', text: '立刻补觉 4 小时' },
        { id: 'wake', icon: '⏰', time: '14:00前', text: '起床' },
        { id: 'train', icon: '💪', time: '16:00-17:30', text: '训练' },
        { id: 'bed', icon: '🌙', time: '22:30-23:00', text: '上床，恢复夜觉' }
      ]
      };
    }

    function getSleepPlan() {
      if (!data.modules.sleepPlan) data.modules.sleepPlan = { records: {}, nightWindows: {} };
      if (!data.modules.sleepPlan.records) data.modules.sleepPlan.records = {};
      if (!data.modules.sleepPlan.nightWindows) data.modules.sleepPlan.nightWindows = {};
      if (!data.modules.sleepPlan.sleepHours) data.modules.sleepPlan.sleepHours = {};
      if (!data.modules.sleepPlan.trainingDone) data.modules.sleepPlan.trainingDone = {};
      return data.modules.sleepPlan;
    }

    function getSleepRecordDate(dateStr) {
      const todayStr = getTodayStr();
      if (dateStr >= todayStr) return dateStr;
      const d = new Date(dateStr + 'T00:00:00');
      d.setDate(d.getDate() + 1);
      const nextDay = getDateStr(d);
      if (getShiftStateForDate(dateStr) === '夜班' && getShiftStateForDate(nextDay) === '下夜班') {
        return nextDay;
      }
      return dateStr;
    }

    function getShiftStateForDate(dateStr) {
      const cycleHabit = (data.modules.cycle && data.modules.cycle.habits || []).find(h => h.id === 16 && h.type === 'cycle');
      if (cycleHabit) return getCycleState(cycleHabit, dateStr);
      return '休息';
    }

    function getSleepNightWindow(dateStr) {
      const w = getSleepPlan().nightWindows[dateStr];
      return w === 'A' ? 'A' : 'B';
    }

    function getPreviousNightWindow(dateStr) {
      const d = new Date(dateStr + 'T00:00:00');
      d.setDate(d.getDate() - 1);
      return getSleepNightWindow(getDateStr(d));
    }

    function getSleepStepsForDate(dateStr) {
      const defs = getSleepStepDefs();
      const state = getShiftStateForDate(dateStr);
      if (state === '夜班') {
        return getSleepNightWindow(dateStr) === 'A' ? defs.nightA : defs.nightB;
      }
      if (state === '下夜班') {
        return getPreviousNightWindow(dateStr) === 'A' ? defs.offA : defs.offB;
      }
      return defs.normal;
    }

    function getSleepTargetText(dateStr) {
      const state = getShiftStateForDate(dateStr);
      if (state === '夜班') return getSleepNightWindow(dateStr) === 'A' ? '约9-11小时' : '约10-11小时';
      if (state === '下夜班') return getPreviousNightWindow(dateStr) === 'A' ? '约10-11小时' : '约11小时';
      return '约8小时';
    }

    function getSleepTargetHours(dateStr) {
      const state = getShiftStateForDate(dateStr);
      if (state === '夜班') return getSleepNightWindow(dateStr) === 'A' ? 10 : 10.5;
      if (state === '下夜班') return getPreviousNightWindow(dateStr) === 'A' ? 10.5 : 11;
      return 8;
    }

    function getSleepActualHours(dateStr) {
      const plan = getSleepPlan();
      const v = plan.sleepHours && plan.sleepHours[dateStr];
      return (typeof v === 'number' && isFinite(v)) ? v : null;
    }

    function saveSleepHours() {
      const input = document.getElementById('sleepHoursInput');
      if (!input) return;
      if (sleepViewDate > getTodayStr()) {
        alert('不能记录未来的日期');
        return;
      }
      const raw = parseFloat(input.value);
      if (isNaN(raw) || raw < 0 || raw > 24) {
        alert('请输入 0-24 之间的小时数');
        return;
      }
      const plan = getSleepPlan();
      if (!plan.sleepHours) plan.sleepHours = {};
      const recordDate = getSleepRecordDate(sleepViewDate);
      if (recordDate !== sleepViewDate) {
        sleepViewDate = recordDate;
        showAchievementToast('睡眠已按醒来当天记录');
      }
      plan.sleepHours[recordDate] = Math.round(raw * 2) / 2;
      saveData();
      renderModule('sleepPlan');
      updateTotalStats();
    }

    function renderSleepHoursCard(dateStr, isFuture) {
      const actual = getSleepActualHours(dateStr);
      const target = getSleepTargetHours(dateStr);
      const status = actual !== null
        ? (actual >= target ? '达标' : '还差 ' + (target - actual).toFixed(1) + ' 小时')
        : '未记录';
      const statusCls = actual !== null ? (actual >= target ? 'ok' : 'low') : 'empty';
      return `
        <div class="sleep-record-card">
          <div class="sleep-record-head">
            <span class="sleep-record-title">💤 实际睡眠记录</span>
            <span class="sleep-record-status ${statusCls}">${status}</span>
          </div>
          <div class="sleep-record-row">
            <input type="number" id="sleepHoursInput" min="0" max="24" step="0.5" placeholder="小时" value="${actual !== null ? actual : ''}" ${isFuture ? 'disabled' : ''}>
            <button onclick="saveSleepHours()" ${isFuture ? 'disabled' : ''}>保存</button>
          </div>
          <div class="sleep-record-hint">计划目标约 ${target} 小时${actual !== null ? ' · 已记录 ' + actual + ' 小时' : ' · 记录后用于近 7 天趋势'}</div>
          <div class="sleep-record-hint">凌晨睡觉也按醒来当天记录，夜班后的睡眠记在今天</div>
        </div>
      `;
    }

    function renderSleepTrendHtml() {
      const days = [];
      const todayStr = getTodayStr();
      for (let i = 6; i >= 0; i--) {
        const d = new Date(todayStr + 'T00:00:00');
        d.setDate(d.getDate() - i);
        const ds = getDateStr(d);
        days.push({ date: ds, label: (d.getMonth() + 1) + '/' + d.getDate(), hours: getSleepActualHours(ds) });
      }
      const hasData = days.some(d => d.hours !== null);
      if (!hasData) {
        return '<div class="sleep-trend-empty">记录睡眠后，这里会显示近 7 天实际睡眠趋势</div>';
      }
      const bars = days.map(d => {
        const pct = d.hours !== null ? Math.min(100, Math.round(d.hours / 12 * 100)) : 0;
        const good = d.hours !== null && d.hours >= getSleepTargetHours(d.date);
        return `
          <div class="trend-bar-item">
            <div class="trend-pair">
              <div class="trend-bar-track"><div class="trend-bar-fill ${good ? 'good' : ''}" style="height:${Math.max(4, pct)}%" title="${d.date} · ${d.hours !== null ? d.hours + ' 小时' : '未记录'}"></div></div>
            </div>
            <div class="trend-bar-label">${d.label}</div>
          </div>
        `;
      }).join('');
      return `
        <div class="sleep-trend-section">
          <div class="sleep-week-title">近 7 天实际睡眠</div>
          <div class="trend-bars">${bars}</div>
        </div>
      `;
    }

    function toggleTrainingDone(dateStr) {
      const plan = getSleepPlan();
      if (!plan.trainingDone) plan.trainingDone = {};
      plan.trainingDone[dateStr] = !plan.trainingDone[dateStr];
      saveData();
      renderModule('sleepPlan');
    }

    function renderSleepTrainingHtml() {
      const plan = getSleepPlan();
      const days = [];
      const todayStr = getTodayStr();
      for (let i = 0; i < 7; i++) {
        const d = new Date(todayStr + 'T00:00:00');
        d.setDate(d.getDate() + i);
        days.push({
          date: getDateStr(d),
          label: i === 0 ? '今天' : i === 1 ? '明天' : formatSleepDate(getDateStr(d)),
          state: getShiftStateForDate(getDateStr(d)),
          train: getSleepTrainText(getDateStr(d)),
          done: !!plan.trainingDone[getDateStr(d)]
        });
      }
      const doneCount = days.filter(d => d.done).length;
      const rows = days.map(d => `
        <div class="sleep-train-row ${d.done ? 'done' : ''}">
          <span class="sleep-train-row-date">${d.label}</span>
          <span class="sleep-train-row-badge">${d.state}</span>
          <span class="sleep-train-row-text">${d.train}</span>
          <button class="sleep-train-check ${d.done ? 'done' : ''}" onclick="toggleTrainingDone('${d.date}')" title="${d.done ? '取消完成' : '标记完成'}">${d.done ? '✓' : ''}</button>
        </div>
      `).join('');
      return `
        <div class="sleep-train-week">
          <div class="sleep-record-head">
            <span class="sleep-record-title">💪 本周训练打卡</span>
            <span class="sleep-record-status ${doneCount >= 3 ? 'ok' : 'low'}">${doneCount}/4 次</span>
          </div>
          <div class="sleep-train-week-list">${rows}</div>
        </div>
      `;
    }

    function getSleepTrainText(dateStr) {
      const state = getShiftStateForDate(dateStr);
      if (state === '夜班') return '09:30-11:00 中等强度训练';
      if (state === '下夜班') return '16:00-17:30 训练';
      return '09:00-11:00 或 17:30-19:00（本周练 3-4 次）';
    }

    function renderSleepFoodCard(dateStr) {
      const state = getShiftStateForDate(dateStr);
      let title = '今日饮食提醒';
      let items = [
        '三餐规律，晚餐 20:00 前吃完',
        '咖啡因不跨过睡前 2 小时',
        '睡前不吃大餐'
      ];
      if (state === '夜班') {
        const windowA = getSleepNightWindow(dateStr) === 'A';
        title = '夜班饮食提醒';
        items = [
          '班前正常吃：蛋白质 + 复合碳水 + 蔬菜',
          '后半夜饿：无糖酸奶、坚果、香蕉、水煮蛋',
          '04:00 后不再吃大餐',
          windowA ? '20:00 后停咖啡因' : '03:00 后停咖啡因'
        ];
      } else if (state === '下夜班') {
        title = '下夜班饮食提醒';
        items = [
          '下班回家先喝温水',
          '补觉前吃清淡早餐，别暴食',
          '白天少喝浓茶咖啡，别影响补觉'
        ];
      }
      return `
        <div class="sleep-food-card">
          <div class="sleep-food-title">🍽️ ${title}</div>
          <div class="sleep-food-list">${items.map(item => `<div class="sleep-food-item">· ${item}</div>`).join('')}</div>
        </div>
      `;
    }

    function formatSleepDate(dateStr) {
      const d = new Date(dateStr + 'T00:00:00');
      const week = ['周日','周一','周二','周三','周四','周五','周六'];
      return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + week[d.getDay()];
    }

    function setSleepDate(dateStr) {
      if (!dateStr) return;
      sleepViewDate = dateStr;
      renderModule('sleepPlan');
    }

    function shiftSleepDate(offset) {
      const d = new Date(sleepViewDate + 'T00:00:00');
      d.setDate(d.getDate() + offset);
      setSleepDate(getDateStr(d));
    }

    function setSleepNightWindow(windowKey) {
      getSleepPlan().nightWindows[sleepViewDate] = windowKey;
      saveData();
      renderModule('sleepPlan');
    }

    function toggleSleepStep(stepId) {
      if (sleepViewDate > getTodayStr()) {
        alert('不能勾选未来的日期');
        return;
      }
      const plan = getSleepPlan();
      if (!plan.records[sleepViewDate]) plan.records[sleepViewDate] = [];
      const arr = plan.records[sleepViewDate];
      const idx = arr.indexOf(stepId);
      let isDone = false;
      if (idx >= 0) {
        arr.splice(idx, 1);
      } else {
        arr.push(stepId);
        isDone = true;
      }
      saveData();
      vibrate(isDone ? 25 : 12);
      renderModule('sleepPlan');
      updateTotalStats();
      renderNav();
      celebrateIfComplete();
    }

    function renderSleepWeekPreviewHtml(selectedDate) {
      const rows = [];
      const todayStr = getTodayStr();
      for (let i = 0; i < 7; i++) {
        const d = new Date(todayStr + 'T00:00:00');
        d.setDate(d.getDate() + i);
        const ds = getDateStr(d);
        const state = getShiftStateForDate(ds);
        const badge = state === '夜班'
          ? `<span class="sleep-preview-badge night">夜班 ${getSleepNightWindow(ds) === 'A' ? '22:00-04:00' : '04:00-07:00'}</span>`
          : `<span class="sleep-preview-badge">${state}</span>`;
        const label = i === 0 ? '今天' : i === 1 ? '明天' : formatSleepDate(ds);
        rows.push(`
          <button class="sleep-preview-row ${ds === selectedDate ? 'active' : ''}" onclick="setSleepDate('${ds}')">
            <span class="sleep-preview-date">${label}</span>
            ${badge}
            <span class="sleep-preview-meta">${getSleepTrainText(ds)}</span>
          </button>
        `);
      }
      return `<div class="sleep-week-list">${rows.join('')}</div>`;
    }

    function renderSleepPlanModule(container) {
      const cfg = MODULE_CONFIG.sleepPlan;
      const dateStr = sleepViewDate;
      const todayStr = getTodayStr();
      const isToday = dateStr === todayStr;
      const isFuture = dateStr > todayStr;
      const prevDay = new Date(todayStr + 'T00:00:00');
      prevDay.setDate(prevDay.getDate() - 1);
      const yesterdayStr = getDateStr(prevDay);
      const nextDay = new Date(todayStr + 'T00:00:00');
      nextDay.setDate(nextDay.getDate() + 1);
      const tomorrowStr = getDateStr(nextDay);
      const state = getShiftStateForDate(dateStr);
      const isNight = state === '夜班';
      const nightWindow = isNight ? getSleepNightWindow(dateStr) : (state === '下夜班' ? getPreviousNightWindow(dateStr) : null);
      const steps = getSleepStepsForDate(dateStr);
      const doneArr = getSleepPlan().records[dateStr] || [];
      const doneCount = steps.filter(s => doneArr.indexOf(s.id) !== -1).length;
      const pct = steps.length ? Math.round(doneCount / steps.length * 100) : 0;

      const stepHtml = steps.map(step => {
        const isDone = doneArr.indexOf(step.id) !== -1;
        return `
          <div class="sleep-step ${isDone ? 'done' : ''}">
            <div class="sleep-step-icon">${step.icon}</div>
            <div class="sleep-step-info">
              <span class="sleep-step-time">${step.time}</span>
              <div class="sleep-step-text">${step.text}</div>
            </div>
            <button class="sleep-check-btn ${isDone ? 'done' : ''}" ${isFuture ? 'disabled' : ''} onclick="toggleSleepStep('${step.id}')" title="${isDone ? '取消完成' : '标记完成'}">${isDone ? '✓' : ''}</button>
          </div>
        `;
      }).join('');

      const nightPicker = isNight ? `
        <div class="sleep-window-picker">
          <span class="sleep-window-label">夜班睡眠窗口</span>
          <button class="sleep-window-btn ${nightWindow === 'A' ? 'active' : ''}" onclick="setSleepNightWindow('A')">A · 22:00-04:00</button>
          <button class="sleep-window-btn ${nightWindow === 'B' ? 'active' : ''}" onclick="setSleepNightWindow('B')">B · 04:00-07:00</button>
        </div>
      ` : '';

      const dateTag = isFuture ? '计划' : isToday ? '今天' : '历史';
      const summaryText = isFuture
        ? '尚未到执行时间'
        : doneCount === steps.length
          ? '流程已全部完成'
          : '还有 ' + (steps.length - doneCount) + ' 项未完成';

      container.innerHTML = `
        <div class="module-title-bar">
          <div class="m-icon" style="background:${cfg.bg};border:1px solid ${cfg.color}22">${cfg.icon}</div>
          <div class="m-text">
            <div class="m-name">${cfg.name}</div>
            <div class="m-desc">${cfg.desc}</div>
          </div>
          <div class="m-progress" style="background:linear-gradient(135deg, ${cfg.color}, ${cfg.color}88);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent">${pct}%</div>
        </div>

        <div class="sleep-day-nav">
          <button class="sleep-day-arrow" onclick="shiftSleepDate(-1)" title="前一天">‹</button>
          <div class="sleep-day-picker">
            <input type="date" id="sleepDateInput" value="${dateStr}" onchange="setSleepDate(this.value)">
            <span class="sleep-day-tag ${isToday ? 'today' : ''}">${dateTag}</span>
          </div>
          <button class="sleep-day-arrow" onclick="shiftSleepDate(1)" title="后一天">›</button>
        </div>

        <div class="sleep-day-summary">
          <span>${formatSleepDate(dateStr)} · ${state}</span>
          <span class="${doneCount === steps.length ? 'sleep-day-done' : 'sleep-day-left'}">${summaryText}</span>
        </div>

        <div class="stats sleep-plan-stats">
          <div class="stat-card">
            <div class="icon-wrap">💼</div>
            <div class="num">${state}</div>
            <div class="label">今日班次</div>
          </div>
          <div class="stat-card">
            <div class="icon-wrap">😴</div>
            <div class="num">${getSleepTargetText(dateStr)}</div>
            <div class="label">睡眠目标</div>
          </div>
          <div class="stat-card">
            <div class="icon-wrap">✅</div>
            <div class="num">${doneCount}/${steps.length}</div>
            <div class="label">流程完成</div>
          </div>
        </div>

        ${nightPicker}

        <div class="module-progress-bar">
          <div class="ph"><span>${isToday ? '今日流程进度' : '当日流程进度'}</span><span class="pp" style="color:${cfg.color}">${doneCount}/${steps.length}</span></div>
          <div class="pb"><div class="pf" style="width:${pct}%;background:linear-gradient(90deg,${cfg.color},${cfg.color}66)"></div></div>
        </div>

        ${renderSleepHoursCard(dateStr, isFuture)}
        ${renderSleepTrendHtml()}

        <div class="sleep-train-card">💪 今日训练窗口：${getSleepTrainText(dateStr)}</div>
        ${renderSleepFoodCard(dateStr)}

        ${steps.length ? `
          <div class="sleep-step-list">${stepHtml}</div>
        ` : `
          <div class="empty-state">
            <div class="big">😴</div>
            <p>今天还没有可执行的流程</p>
          </div>
        `}

        <div class="sleep-supp-note">💊 补剂照常：肌酸软糖每天 2 颗固定早餐后；镁片睡前 30-60 分钟。</div>

        <div class="sleep-quick-nav">
          <button class="sleep-quick-btn ${dateStr === yesterdayStr ? 'active' : ''}" onclick="setSleepDate('${yesterdayStr}')">昨天</button>
          <button class="sleep-quick-btn ${isToday ? 'active' : ''}" onclick="setSleepDate('${todayStr}')">今天</button>
          <button class="sleep-quick-btn ${dateStr === tomorrowStr ? 'active' : ''}" onclick="setSleepDate('${tomorrowStr}')">明天</button>
        </div>

        <div class="sleep-week-title">未来 7 天排班</div>
        ${renderSleepWeekPreviewHtml(dateStr)}
      `;
    }

    // ========== 身体记录 ==========
    const BODY_CATEGORY_META = {
      '健身': { icon: '💪', cls: 'fit' },
      '补剂': { icon: '💊', cls: 'supp' },
      '整体': { icon: '🧬', cls: 'overall' },
      '睡眠': { icon: '😴', cls: 'sleep' },
      '其他': { icon: '📝', cls: 'other' }
    };

    function getBodyRecords() {
      return (data.modules.body && data.modules.body.records) || [];
    }

    function renderBodyRatingPicker() {
      const el = document.getElementById('bodyRatingOptions');
      if (!el) return;
      el.innerHTML = [1, 2, 3, 4, 5].map(v => `
        <button type="button" class="body-rating-btn ${v === bodyRating ? 'active' : ''}" onclick="selectBodyRating(${v})" title="${v}分">${v}</button>
      `).join('');
    }

    function selectBodyRating(v) {
      bodyRating = v;
      renderBodyRatingPicker();
    }

    function openBodyModal(id) {
      const rec = id ? getBodyRecords().find(r => r.id === id) : null;
      bodyEditId = rec ? rec.id : null;
      bodyRating = rec && rec.rating ? rec.rating : 4;
      document.getElementById('bodyModalTitle').textContent = rec ? '编辑身体记录' : '记录身体变化';
      document.getElementById('bodyDate').value = rec ? rec.date : getTodayStr();
      document.getElementById('bodyCategory').value = rec ? rec.category : '健身';
      document.getElementById('bodyPhase').value = rec ? (rec.phase || '第1周') : '第1周';
      document.getElementById('bodyContent').value = rec ? rec.content : '';
      const num = (v) => (rec && typeof rec[v] === 'number' ? rec[v] : '');
      document.getElementById('bodyWeight').value = num('weight');
      document.getElementById('bodyWaist').value = num('waist');
      document.getElementById('bodyRhr').value = num('restingHeartRate');
      document.getElementById('bodySleep').value = num('sleepHours');
      document.getElementById('bodySys').value = num('systolic');
      document.getElementById('bodyDia').value = num('diastolic');
      renderBodyRatingPicker();
      document.getElementById('bodyOverlay').classList.add('show');
    }

    function closeBodyModal(e) {
      if (e && e.target !== document.getElementById('bodyOverlay')) return;
      document.getElementById('bodyOverlay').classList.remove('show');
      bodyEditId = null;
    }

    // 一条身体记录只要有"文字"或"任意一项测量值"就算有效
    function bodyRecordHasData(rec) {
      if (!rec || !rec.id) return false;
      if (rec.content) return true;
      return BODY_METRIC_KEYS.some(k => typeof rec[k] === 'number' && !isNaN(rec[k]));
    }

    function saveBodyRecord() {
      const content = sanitizeText(document.getElementById('bodyContent').value);
      const date = document.getElementById('bodyDate').value || getTodayStr();
      // 带边界校验的数值读取
      const readNum = (id, type) => {
        const el = document.getElementById(id);
        if (!el || !el.value.trim()) return null;
        const result = clampValue(el.value, type);
        if (!result.valid) {
          alert(result.msg);
          el.focus();
          throw new Error('Validation failed: ' + type);
        }
        return result.value;
      };
      try {
        var weight = readNum('bodyWeight', 'weight');
        var waist = readNum('bodyWaist', 'waist');
        var restingHeartRate = readNum('bodyRhr', 'heartRate');
        var sleepHours = readNum('bodySleep', 'sleepHours');
        var systolic = readNum('bodySys', 'systolic');
        var diastolic = readNum('bodyDia', 'diastolic');
      } catch (e) {
        return; // 校验失败，alert 已在 readNum 中弹出
      }
      const metrics = { weight, waist, restingHeartRate, sleepHours, systolic, diastolic };
      const hasMetric = Object.keys(metrics).some(k => typeof metrics[k] === 'number');
      if (!content && !hasMetric) {
        alert('请填写具体变化，或者至少填一项测量数据（体重／腰围／静息心率／血压／睡眠）');
        return;
      }
      // 血压逻辑校验：收缩压必须大于舒张压
      if (typeof systolic === 'number' && typeof diastolic === 'number' && systolic <= diastolic) {
        alert('收缩压必须大于舒张压');
        return;
      }
      const records = getBodyRecords();
      const category = sanitizeText(document.getElementById('bodyCategory').value || '其他', 50);
      const phase = sanitizeText(document.getElementById('bodyPhase').value || '刚开始', 50);
      if (bodyEditId) {
        const rec = records.find(r => r.id === bodyEditId);
        if (rec) {
          rec.date = date;
          rec.category = category;
          rec.phase = phase;
          rec.content = content;
          rec.rating = bodyRating;
          Object.assign(rec, metrics);
        }
      } else {
        const fresh = { id: Date.now(), date: date, category: category, phase: phase, content: content, rating: bodyRating };
        Object.assign(fresh, metrics);
        records.unshift(fresh);
      }
      data.modules.body.records = records;
      saveData();
      closeBodyModal();
      renderModule('body');
      updateTotalStats();
      renderNav();
    }

    function deleteBodyRecord(id) {
      if (!confirm('确定删除这条身体记录吗？')) return;
      createAutoBackup('删除身体记录前');
      captureUndoSnapshot('已删除身体记录');
      data.modules.body.records = getBodyRecords().filter(r => r.id !== id);
      saveData();
      renderModule('body');
      updateTotalStats();
      renderNav();
    }

    function renderNumericTrendHtml(title, unit, items) {
      if (!items.length) return '';
      const sorted = items.slice().sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(-12);
      const values = sorted.map(r => r.value);
      const latest = values[values.length - 1];
      const min = Math.min(...values);
      const max = Math.max(...values);
      const range = max - min || 1;
      const bars = sorted.map(r => {
        const h = Math.max(8, Math.round((r.value - min) / range * 100));
        return `
          <div class="trend-bar-item">
            <div class="trend-pair">
              <div class="trend-bar-track"><div class="trend-bar-fill" style="height:${h}%" title="${r.date} · ${r.value}${unit}"></div></div>
            </div>
            <div class="trend-bar-label">${String(r.date).slice(5)}</div>
          </div>
        `;
      }).join('');
      return `
        <div class="trend-section">
          <div class="trend-section-title">${title} · 最新 ${latest}${unit}</div>
          <div class="trend-bars">${bars}</div>
        </div>
      `;
    }

    // 用于"变化对比"的指标定义。只呈现数值变化，不做"好/坏"判断。
    const BODY_METRIC_DEFS = [
      { key: 'weight',           label: '体重',     unit: 'kg',    icon: '⚖️', digits: 1, seriesTitle: '⚖️ 体重趋势' },
      { key: 'waist',            label: '腰围',     unit: 'cm',    icon: '📏', digits: 1, seriesTitle: '📏 腰围趋势' },
      { key: 'restingHeartRate', label: '静息心率', unit: '次/分', icon: '❤️', digits: 0, seriesTitle: '❤️ 静息心率趋势' },
      { key: 'systolic',         label: '收缩压',   unit: 'mmHg',  icon: '🩺', digits: 0, seriesTitle: '🩺 收缩压趋势' },
      { key: 'diastolic',        label: '舒张压',   unit: 'mmHg',  icon: '🩺', digits: 0, seriesTitle: '🩺 舒张压趋势' },
      { key: 'sleepHours',       label: '睡眠',     unit: '小时',  icon: '😴', digits: 1, seriesTitle: '😴 睡眠趋势' },
      { key: 'rating',           label: '主观状态', unit: '分',    icon: '🙂', digits: 1, seriesTitle: '🙂 主观状态趋势' }
    ];

    function getBodyMetricPoints(key) {
      return getBodyRecords()
        .filter(r => r && typeof r[key] === 'number' && !isNaN(r[key]) && r[key] > 0)
        .map(r => ({ date: String(r.date || ''), value: r[key] }))
        .sort((a, b) => a.date.localeCompare(b.date));
    }

    function formatMetricValue(def, v) {
      return def.digits === 0 ? String(Math.round(v)) : v.toFixed(def.digits);
    }

    const BODY_COMPARE_WINDOW_DAYS = 28;

    function renderBodyComparisonHtml() {
      const DAY = 86400000;
      const todayMs = new Date(getTodayStr() + 'T00:00:00').getTime();
      const rows = [];
      BODY_METRIC_DEFS.forEach(def => {
        const pts = getBodyMetricPoints(def.key);
        if (!pts.length) return;
        const first = pts[0], last = pts[pts.length - 1];
        const ago = p => (todayMs - new Date(p.date + 'T00:00:00').getTime()) / DAY;
        const recent = pts.filter(p => { const d = ago(p); return d >= 0 && d < BODY_COMPARE_WINDOW_DAYS; });
        const prev = pts.filter(p => { const d = ago(p); return d >= BODY_COMPARE_WINDOW_DAYS && d < BODY_COMPARE_WINDOW_DAYS * 2; });
        const avg = arr => arr.length ? arr.reduce((s, p) => s + p.value, 0) / arr.length : null;
        const recentAvg = avg(recent), prevAvg = avg(prev);
        const delta = last.value - first.value;
        rows.push({
          def, first, last, count: pts.length,
          arrow: delta > 0 ? '↑' : delta < 0 ? '↓' : '→',
          absDelta: Math.abs(delta),
          changed: pts.length > 1 && Math.abs(delta) > 0.0001,
          periodText: (recentAvg !== null && prevAvg !== null)
            ? ('近 4 周均值 ' + formatMetricValue(def, recentAvg) + ' ／ 前 4 周 ' + formatMetricValue(def, prevAvg)
               + '（' + (recentAvg - prevAvg >= 0 ? '+' : '-') + formatMetricValue(def, Math.abs(recentAvg - prevAvg)) + '）')
            : ('数据点还不足以做 4 周对比（各 1 条以上才行）')
        });
      });
      if (!rows.length) {
        return `
          <div class="body-compare">
            <div class="body-compare-title">📈 变化对比</div>
            <div class="body-compare-empty">还没有可对比的测量数据。点下方「＋ 记录身体变化」，至少填一项测量值（体重／腰围／静息心率／血压／睡眠）就能开始建立基线。</div>
          </div>`;
      }
      return `
        <div class="body-compare">
          <div class="body-compare-title">📈 变化对比（最早 → 最新）</div>
          ${rows.map(r => `
            <div class="body-compare-row">
              <div class="body-compare-head">
                <span class="body-compare-name">${r.def.icon} ${r.def.label}</span>
                <span class="body-compare-val">${formatMetricValue(r.def, r.first.value)} → <b>${formatMetricValue(r.def, r.last.value)}</b> ${r.def.unit}${r.changed ? ` <span class="body-compare-arrow">${r.arrow}${formatMetricValue(r.def, r.absDelta)}</span>` : ''}</span>
              </div>
              <div class="body-compare-meta">${r.count} 次测量 · ${r.first.date} → ${r.last.date}</div>
              <div class="body-compare-period">${r.periodText}</div>
            </div>
          `).join('')}
          <div class="body-compare-foot">只呈现你自己记录的数据变化，不做"好／坏"判断。测量条件尽量一致（同一时间、同一状态），数据点越多越可靠，单次波动不代表趋势。</div>
        </div>
      `;
    }

    function renderBodyTrendsHtml(records) {
      const defs = BODY_METRIC_DEFS.filter(d => d.key !== 'rating');
      const blocks = defs.map(def => {
        const pts = records
          .filter(r => typeof r[def.key] === 'number' && !isNaN(r[def.key]))
          .map(r => ({ date: r.date, value: r[def.key] }));
        return renderNumericTrendHtml(def.seriesTitle, def.unit, pts);
      }).filter(Boolean);
      if (!blocks.length) return '';
      return `<div class="body-trend-grid">${blocks.join('')}</div>`;
    }

    function renderBodyModule(container) {
      const records = getBodyRecords().slice().sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
      const cfg = MODULE_CONFIG.body;
      const total = records.length;
      const fitnessCount = records.filter(r => r.category === '健身').length;
      const supplementCount = records.filter(r => r.category === '补剂').length;

      const recordsHtml = records.map(rec => {
        const meta = BODY_CATEGORY_META[rec.category] || BODY_CATEGORY_META['其他'];
        const rating = rec.rating ? Math.min(5, Math.max(1, rec.rating)) : 0;
        const stars = rating ? '★'.repeat(rating) + '☆'.repeat(5 - rating) : '';
        return `
          <div class="body-record-card">
            <div class="body-record-head">
              <span class="body-record-date">📅 ${rec.date}</span>
              <div class="body-record-actions">
                <button class="body-record-btn" onclick="openBodyModal(${rec.id})" title="编辑">✏️</button>
                <button class="body-record-btn del" onclick="deleteBodyRecord(${rec.id})" title="删除">×</button>
              </div>
            </div>
            <div class="body-record-tags">
              <span class="body-tag ${meta.cls}">${meta.icon} ${escapeHtml(rec.category)}</span>
              ${rec.phase ? `<span class="body-phase">${escapeHtml(rec.phase)}</span>` : ''}
              ${stars ? `<span class="body-record-rating">${stars}</span>` : ''}
            </div>
            <div class="body-record-content">${escapeHtml(rec.content)}</div>
          </div>
        `;
      }).join('');

      container.innerHTML = `
        <div class="module-title-bar">
          <div class="m-icon" style="background:${cfg.bg};border:1px solid ${cfg.color}22">${cfg.icon}</div>
          <div class="m-text">
            <div class="m-name">${cfg.name}</div>
            <div class="m-desc">${cfg.desc}</div>
          </div>
          <div class="m-progress" style="background:linear-gradient(135deg, ${cfg.color}, ${cfg.color}88);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent">${total}</div>
        </div>

        <div class="stats body-record-stats">
          <div class="stat-card">
            <div class="icon-wrap">🧬</div>
            <div class="num">${total}</div>
            <div class="label">总记录</div>
          </div>
          <div class="stat-card">
            <div class="icon-wrap">💪</div>
            <div class="num">${fitnessCount}</div>
            <div class="label">健身后</div>
          </div>
          <div class="stat-card">
            <div class="icon-wrap">💊</div>
            <div class="num">${supplementCount}</div>
            <div class="label">补剂后</div>
          </div>
        </div>

        ${renderBodyTrendsHtml(getBodyRecords())}

        ${renderBodyComparisonHtml()}

        <button class="body-add-btn" onclick="openBodyModal()">＋ 记录身体变化</button>

        ${records.length ? `
          <div class="body-record-list">${recordsHtml}</div>
        ` : `
          <div class="empty-state">
            <div class="big">🧬</div>
            <p>还没有身体记录</p>
            <p style="font-size:12px;color:var(--text2);margin-top:4px">健身或吃补剂一段时间后，记录下身体的变化和感受</p>
          </div>
        `}
      `;
    }

    // ========== 看书记录 ==========
    function getReadingRecords() {
      return (data.modules.reading && data.modules.reading.records) || [];
    }

    function formatReadingDuration(minutes) {
      const m = Number(minutes) || 0;
      if (m <= 0) return '0 分钟';
      if (m < 60) return m + ' 分钟';
      const h = Math.floor(m / 60);
      const rest = m % 60;
      return rest ? h + ' 小时 ' + rest + ' 分钟' : h + ' 小时';
    }

    function getReadingWeekTrend(records) {
      const days = [];
      const now = new Date();
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const date = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        days.push({ date: date, label: (d.getMonth() + 1) + '/' + d.getDate(), minutes: 0 });
      }
      records.forEach(r => {
        const day = days.find(d => d.date === r.date);
        if (day) day.minutes += Number(r.durationMinutes) || 0;
      });
      return days;
    }

    function renderReadingWeekTrendHtml(records) {
      const days = getReadingWeekTrend(records);
      const max = Math.max(1, ...days.map(d => d.minutes));
      const bars = days.map(d => {
        const h = Math.max(3, Math.round(d.minutes / max * 100));
        return `
          <div class="trend-bar-item">
            <div class="trend-pair">
              <div class="trend-bar-track"><div class="trend-bar-fill" style="height:${h}%" title="${d.date} · ${d.minutes} 分钟"></div></div>
            </div>
            <div class="trend-bar-label">${d.label}</div>
          </div>
        `;
      }).join('');
      return `
        <div class="trend-section">
          <div class="trend-section-title">📖 最近 7 天阅读时长</div>
          <div class="trend-bars">${bars}</div>
        </div>
      `;
    }

    function openReadingModal(id) {
      const rec = id ? getReadingRecords().find(r => r.id === id) : null;
      readingEditId = rec ? rec.id : null;
      document.getElementById('readingModalTitle').textContent = rec ? '编辑读书记录' : '记录读书';
      document.getElementById('readingId').value = rec ? rec.id : '';
      document.getElementById('readingBookName').value = rec ? rec.bookName : '';
      document.getElementById('readingAuthor').value = rec ? (rec.author || '') : '';
      document.getElementById('readingDate').value = rec ? rec.date : getTodayStr();
      document.getElementById('readingMinutes').value = rec ? rec.durationMinutes : '';
      document.getElementById('readingPages').value = rec ? rec.pages : '';
      document.getElementById('readingStatus').value = rec ? (rec.status || '在读') : '在读';
      document.getElementById('readingNote').value = rec ? (rec.note || '') : '';
      document.getElementById('readingOverlay').classList.add('show');
      setTimeout(() => document.getElementById('readingBookName').focus(), 100);
    }

    function closeReadingModal(e) {
      if (e && e.target !== document.getElementById('readingOverlay')) return;
      document.getElementById('readingOverlay').classList.remove('show');
      readingEditId = null;
    }

    function saveReadingRecord() {
      const bookName = document.getElementById('readingBookName').value.trim();
      const author = document.getElementById('readingAuthor').value.trim();
      const date = document.getElementById('readingDate').value || getTodayStr();
      const durationMinutes = Math.max(0, parseInt(document.getElementById('readingMinutes').value, 10) || 0);
      const pages = Math.max(0, parseInt(document.getElementById('readingPages').value, 10) || 0);
      const status = document.getElementById('readingStatus').value || '在读';
      const note = document.getElementById('readingNote').value.trim();
      if (!bookName) {
        alert('请输入书名');
        return;
      }
      const records = getReadingRecords();
      if (readingEditId) {
        const rec = records.find(r => r.id === readingEditId);
        if (rec) {
          rec.bookName = bookName;
          rec.author = author;
          rec.date = date;
          rec.durationMinutes = durationMinutes;
          rec.pages = pages;
          rec.status = status;
          rec.note = note;
        }
      } else {
        records.unshift({
          id: Date.now(),
          bookName: bookName,
          author: author,
          date: date,
          durationMinutes: durationMinutes,
          pages: pages,
          status: status,
          note: note
        });
      }
      data.modules.reading.records = records;
      saveData();
      closeReadingModal();
      renderModule('reading');
      renderNav();
    }

    function deleteReadingRecord(id) {
      if (!confirm('确定删除这条读书记录吗？')) return;
      createAutoBackup('删除看书记录前');
      captureUndoSnapshot('已删除看书记录');
      data.modules.reading.records = getReadingRecords().filter(r => r.id !== id);
      saveData();
      renderModule('reading');
      renderNav();
    }

    function getShoppingItems() {
      return (data.modules.shopping && data.modules.shopping.items) || [];
    }

    function createShoppingPlanItems() {
      const now = Date.now();
      return [
        {
          id: now + 1,
          name: 'ECU 原厂电脑刷写（配万虎中尾段）',
          price: 4500,
          date: getTodayStr(),
          places: '改装店 · 动力匹配',
          practicality: 5,
          happiness: 4,
          note: '按中尾段排气+高流量空滤做标定，优先找带马力机的店；预算3000-6000元。',
          status: 'plan'
        },
        {
          id: now + 2,
          name: 'DNA 高流量空滤 R-AG6S13-0R',
          price: 1000,
          date: getTodayStr(),
          places: '进气系统',
          practicality: 5,
          happiness: 4,
          note: '配合 ECU 刷写改善低扭；预算800-1200元。',
          status: 'plan'
        },
        {
          id: now + 3,
          name: 'EBC HH 刹车皮 FA447HH + FA266HH',
          price: 1200,
          date: getTodayStr(),
          places: '前/后刹车卡钳',
          practicality: 5,
          happiness: 4,
          note: '前两套+后一套；装好后轻刹磨合几十公里。预算800-1500元。',
          status: 'plan'
        },
        {
          id: now + 4,
          name: '全车刹车钢喉 Hel/Galfer/Fren Tubo',
          price: 1400,
          date: getTodayStr(),
          places: '刹车油管',
          practicality: 5,
          happiness: 4,
          note: '下单前确认 ABS/非 ABS 版本；预算900-1800元。',
          status: 'plan'
        },
        {
          id: now + 5,
          name: 'Motul RBF 660 刹车油 500ml ×2',
          price: 300,
          date: getTodayStr(),
          places: '刹车系统',
          practicality: 5,
          happiness: 4,
          note: '换钢喉时一起换并排空气；预算200-400元。',
          status: 'plan'
        }
      ];
    }

    function renderShoppingRatingPicker(kind) {
      const el = document.getElementById(kind === 'practicality' ? 'shoppingPracticalityOptions' : 'shoppingHappinessOptions');
      if (!el) return;
      const value = kind === 'practicality' ? shoppingPracticality : shoppingHappiness;
      el.innerHTML = [1, 2, 3, 4, 5].map(v => `
        <button type="button" class="body-rating-btn ${v === value ? 'active' : ''}" onclick="selectShoppingRating(${v}, '${kind}')" title="${v}分">${v}</button>
      `).join('');
    }

    function selectShoppingRating(v, kind) {
      if (kind === 'practicality') shoppingPracticality = v;
      else shoppingHappiness = v;
      renderShoppingRatingPicker(kind);
    }

    function openShoppingModal(id) {
      const rec = id ? getShoppingItems().find(r => r.id === id) : null;
      shoppingEditId = rec ? rec.id : null;
      shoppingPracticality = rec && rec.practicality ? Math.min(5, Math.max(1, rec.practicality)) : 3;
      shoppingHappiness = rec && rec.happiness ? Math.min(5, Math.max(1, rec.happiness)) : 4;
      document.getElementById('shoppingModalTitle').textContent = rec ? '编辑购物项目' : '添加购物项目';
      document.getElementById('shoppingName').value = rec ? rec.name : '';
      document.getElementById('shoppingStatus').value = rec ? (rec.status === 'plan' ? 'plan' : 'bought') : 'bought';
      document.getElementById('shoppingPrice').value = rec && typeof rec.price === 'number' ? rec.price : '';
      document.getElementById('shoppingDate').value = rec ? rec.date : getTodayStr();
      document.getElementById('shoppingPlaces').value = rec ? (rec.places || '') : '';
      document.getElementById('shoppingNote').value = rec ? (rec.note || '') : '';
      renderShoppingRatingPicker('practicality');
      renderShoppingRatingPicker('happiness');
      document.getElementById('shoppingOverlay').classList.add('show');
      setTimeout(() => document.getElementById('shoppingName').focus(), 100);
    }

    function closeShoppingModal(e) {
      if (e && e.target !== document.getElementById('shoppingOverlay')) return;
      document.getElementById('shoppingOverlay').classList.remove('show');
      shoppingEditId = null;
    }

    function saveShoppingItem() {
      const name = document.getElementById('shoppingName').value.trim();
      const price = Math.max(0, parseFloat(document.getElementById('shoppingPrice').value) || 0);
      const date = document.getElementById('shoppingDate').value || getTodayStr();
      const places = document.getElementById('shoppingPlaces').value.trim();
      const note = document.getElementById('shoppingNote').value.trim();
      const status = document.getElementById('shoppingStatus').value === 'plan' ? 'plan' : 'bought';
      if (!name) {
        alert('请输入物品名称');
        return;
      }
      const items = getShoppingItems();
      if (shoppingEditId) {
        const rec = items.find(r => r.id === shoppingEditId);
        if (rec) {
          rec.name = name;
          rec.price = price;
          rec.date = date;
          rec.status = status;
          rec.places = places;
          rec.practicality = shoppingPracticality;
          rec.happiness = shoppingHappiness;
          rec.note = note;
        }
      } else {
        items.unshift({
          id: Date.now(),
          name: name,
          price: price,
          date: date,
          status: status,
          places: places,
          practicality: shoppingPracticality,
          happiness: shoppingHappiness,
          note: note
        });
      }
      data.modules.shopping.items = items;
      saveData();
      closeShoppingModal();
      renderModule('shopping');
      renderNav();
    }

    function toggleShoppingStatus(id) {
      const rec = getShoppingItems().find(r => r.id === id);
      if (!rec) return;
      rec.status = rec.status === 'plan' ? 'bought' : 'plan';
      saveData();
      renderModule('shopping');
      renderNav();
    }

    function deleteShoppingItem(id) {
      if (!confirm('确定删除这条购物记录吗？')) return;
      createAutoBackup('删除购物记录前');
      captureUndoSnapshot('已删除购物记录');
      data.modules.shopping.items = getShoppingItems().filter(r => r.id !== id);
      saveData();
      renderModule('shopping');
      renderNav();
    }

    function shoppingStars(rating) {
      const r = Math.min(5, Math.max(0, Number(rating) || 0));
      return '★'.repeat(r) + '☆'.repeat(5 - r);
    }

    function shoppingScoreLabel(rating) {
      const r = Number(rating) || 0;
      if (r >= 4) return '很好';
      if (r >= 3) return '还行';
      if (r >= 1) return '一般';
      return '';
    }

    function getShoppingVerdict(rec) {
      const p = Number(rec.practicality) || 0;
      const h = Number(rec.happiness) || 0;
      if (p >= 4 && h >= 4) return { text: '值了', cls: 'worth' };
      if (p + h >= 7) return { text: '还不错', cls: 'good' };
      if (p + h >= 5) return { text: '一般般', cls: 'ok' };
      return { text: '不太值', cls: 'waste' };
    }

    function formatShoppingMoney(num) {
      return '¥' + Number(num).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
    }

    function renderShoppingModule(container) {
      const records = getShoppingItems().slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || b.id - a.id);
      const cfg = MODULE_CONFIG.shopping;
      const boughtItems = records.filter(r => r.status !== 'plan');
      const planItems = records.filter(r => r.status === 'plan');
      const totalSpent = boughtItems.reduce((sum, r) => sum + (Number(r.price) || 0), 0);
      const planBudget = planItems.reduce((sum, r) => sum + (Number(r.price) || 0), 0);
      const avgScore = (() => {
        const rated = boughtItems.filter(r => (Number(r.practicality) || 0) > 0 && (Number(r.happiness) || 0) > 0);
        if (!rated.length) return '--';
        return (rated.reduce((sum, r) => sum + ((Number(r.practicality) || 0) + (Number(r.happiness) || 0)) / 2, 0) / rated.length).toFixed(1);
      })();

      const recordsHtml = records.map(rec => {
        const verdict = getShoppingVerdict(rec);
        const practical = rec.practicality ? shoppingScoreLabel(rec.practicality) : '';
        const happy = rec.happiness ? shoppingScoreLabel(rec.happiness) : '';
        const isPlan = rec.status === 'plan';
        const statusBtn = `<button class="shopping-status-btn ${isPlan ? 'plan' : 'bought'}" onclick="toggleShoppingStatus(${rec.id})" title="点击切换状态">${isPlan ? '📋 计划中' : '✅ 已购买'}</button>`;
        return `
          <div class="shopping-card">
            <div class="shopping-head">
              <span class="shopping-date">📅 ${escapeHtml(rec.date || '未填写日期')}</span>
              <div class="shopping-actions">
                <button class="body-record-btn" onclick="openShoppingModal(${rec.id})" title="编辑">✏️</button>
                <button class="body-record-btn del" onclick="deleteShoppingItem(${rec.id})" title="删除">×</button>
              </div>
            </div>
            <div class="shopping-name-row">
              <div class="shopping-name">🛍️ ${escapeHtml(rec.name)}</div>
              ${statusBtn}
              <span class="shopping-price">${formatShoppingMoney(rec.price)}</span>
              <span class="shopping-verdict ${verdict.cls}">${verdict.text}</span>
            </div>
            ${rec.places ? `
              <div class="shopping-field">
                <span class="shopping-field-label">📍 用在</span>
                <span>${escapeHtml(rec.places)}</span>
              </div>
            ` : ''}
            <div class="shopping-rating-row">
              <div class="shopping-rating">
                <span class="shopping-field-label">实用度</span>
                <span class="shopping-rating-stars">${shoppingStars(rec.practicality)}</span>
                ${practical ? `<span class="shopping-rating-note">${practical}</span>` : ''}
              </div>
              <div class="shopping-rating">
                <span class="shopping-field-label">买后开心</span>
                <span class="shopping-rating-stars">${shoppingStars(rec.happiness)}</span>
                ${happy ? `<span class="shopping-rating-note">${happy}</span>` : ''}
              </div>
            </div>
            ${rec.note ? `<div class="shopping-note">💬 ${escapeHtml(rec.note)}</div>` : ''}
          </div>
        `;
      }).join('');

      container.innerHTML = `
        <div class="module-title-bar">
          <div class="m-icon" style="background:${cfg.bg};border:1px solid ${cfg.color}22">${cfg.icon}</div>
          <div class="m-text">
            <div class="m-name">${cfg.name}</div>
            <div class="m-desc">${cfg.desc}</div>
          </div>
          <div class="m-progress" style="background:linear-gradient(135deg, ${cfg.color}, ${cfg.color}88);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent">${records.length}</div>
        </div>

        <div class="shopping-stats">
          <div class="shopping-stat-card">
            <div class="num">${boughtItems.length}/${records.length}</div>
            <div class="label">已购买</div>
          </div>
          <div class="shopping-stat-card">
            <div class="num">${formatShoppingMoney(totalSpent)}</div>
            <div class="label">已购花费</div>
          </div>
          <div class="shopping-stat-card">
            <div class="num">${formatShoppingMoney(planBudget)}</div>
            <div class="label">计划预算</div>
          </div>
          <div class="shopping-stat-card">
            <div class="num">${avgScore}</div>
            <div class="label">已购平均评分</div>
          </div>
        </div>

        <button class="shopping-add-btn" onclick="openShoppingModal()">＋ 添加项目</button>

        ${records.length ? `
          <div class="shopping-list">${recordsHtml}</div>
        ` : `
          <div class="empty-state">
            <div class="big">🛒</div>
            <p>还没有购物项目</p>
            <p style="font-size:12px;color:var(--text2);margin-top:4px">可以添加计划中的项目，或记录已经买过的物品</p>
          </div>
        `}
      `;
    }

    function renderReadingModule(container) {
      const records = getReadingRecords().slice().sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.id - a.id);
      const cfg = MODULE_CONFIG.reading;
      const totalSessions = records.length;
      const totalMinutes = records.reduce((sum, r) => sum + (Number(r.durationMinutes) || 0), 0);
      const uniqueBooks = new Set(records.map(r => String(r.bookName || '').trim()).filter(Boolean)).size;

      const recordsHtml = records.map(rec => `
        <div class="body-record-card">
          <div class="body-record-head">
            <span class="body-record-date">📅 ${rec.date} · ${escapeHtml(rec.status || '在读')}</span>
            <div class="body-record-actions">
              <button class="body-record-btn" onclick="openReadingModal(${rec.id})" title="编辑">✏️</button>
              <button class="body-record-btn del" onclick="deleteReadingRecord(${rec.id})" title="删除">×</button>
            </div>
          </div>
          <div class="reading-book-title">📖 ${escapeHtml(rec.bookName)}</div>
          <div class="reading-meta">
            <span>⏱ ${formatReadingDuration(rec.durationMinutes)}</span>
            ${rec.pages ? '<span>📄 ' + rec.pages + ' 页</span>' : ''}
            ${rec.author ? '<span>✍️ ' + escapeHtml(rec.author) + '</span>' : ''}
          </div>
          ${rec.note ? `<div class="reading-note">${escapeHtml(rec.note)}</div>` : ''}
        </div>
      `).join('');

      container.innerHTML = `
        <div class="module-title-bar">
          <div class="m-icon" style="background:${cfg.bg};border:1px solid ${cfg.color}22">${cfg.icon}</div>
          <div class="m-text">
            <div class="m-name">${cfg.name}</div>
            <div class="m-desc">${cfg.desc}</div>
          </div>
          <div class="m-progress" style="background:linear-gradient(135deg, ${cfg.color}, ${cfg.color}88);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent">${totalSessions}</div>
        </div>

        <div class="reading-stats">
          <div class="reading-stat-card">
            <div class="num">${totalSessions}</div>
            <div class="label">记录次数</div>
          </div>
          <div class="reading-stat-card">
            <div class="num">${formatReadingDuration(totalMinutes)}</div>
            <div class="label">累计阅读</div>
          </div>
          <div class="reading-stat-card">
            <div class="num">${uniqueBooks}</div>
            <div class="label">读过的书</div>
          </div>
        </div>

        ${renderReadingWeekTrendHtml(records)}

        <button class="reading-add-btn" onclick="openReadingModal()">＋ 记录读书</button>

        ${records.length ? `
          <div class="body-record-list">${recordsHtml}</div>
        ` : `
          <div class="empty-state">
            <div class="big">📖</div>
            <p>还没有看书记录</p>
            <p style="font-size:12px;color:var(--text2);margin-top:4px">记录书名、阅读时长、页数和感想</p>
          </div>
        `}
      `;
    }

    function toggleCheck(moduleId, id) {
      const h = data.modules[moduleId].habits.find(x => x.id === id);
      if (!h) return;

      if (h.name === '加油') {
        openFuelModal(moduleId, id);
        return;
      }

      if (h.type === 'period' && isPeriodDay(h, today) && !h.records.includes(today)) {
        if (h.name === '起飞') {
          pendingNoteId = id;
          pendingNoteModule = moduleId;
          document.getElementById('noteModalTitle').textContent = '🚀 起飞 — 记录数据';
          document.getElementById('noteInput').value = h.notes && h.notes[today] ? h.notes[today] : '';
          document.getElementById('noteOverlay').classList.add('show');
          return;
        }
      }

      doToggle(moduleId, id);
    }

    function updateDailyCardInPlace(moduleId, h) {
      const card = document.querySelector(`.habit-card[data-module="${moduleId}"][data-id="${h.id}"]`);
      if (!card) return false;
      const isDone = h.records.includes(today);
      card.classList.toggle('done', isDone);
      const btn = card.querySelector('.check-btn');
      if (btn) {
        btn.classList.toggle('done', isDone);
        btn.textContent = isDone ? '✓' : '';
      }
      const meta = card.querySelector('.meta');
      if (meta) {
        const streak = getStreak(h.records);
        meta.innerHTML = `<span>${h.records.length} 天已坚持</span>` + (streak > 0 ? `<span>·</span><span class="streak">${streak} 天</span>` : '');
      }
      const badges = card.querySelector('.achievement-badges');
      if (badges) badges.innerHTML = renderHabitAchievementBadgesHtml(h);
      const container = document.getElementById('moduleContent');
      let modNeed = 0, modDone = 0;
      for (const x of data.modules[moduleId].habits) {
        if (x.type === 'cycle') {
          modNeed++;
          const state = getCycleState(x, today);
          if (!isCycleCheckable(x, state) || x.records.includes(today)) modDone++;
        }
        else if (x.type === 'period') {
          if (isPeriodDay(x, today)) { modNeed++; if (x.records.includes(today)) modDone++; }
        } else { modNeed++; if (x.records.includes(today)) modDone++; }
      }
      const pct = modNeed ? Math.round(modDone / modNeed * 100) : 0;
      const pp = container.querySelector('.module-progress-bar .pp');
      if (pp) pp.textContent = modDone + '/' + modNeed;
      const pf = container.querySelector('.module-progress-bar .pf');
      if (pf) pf.style.width = pct + '%';
      const mp = container.querySelector('.module-title-bar .m-progress');
      if (mp) mp.textContent = pct + '%';
      const weekly = container.querySelector('.weekly-rate');
      if (weekly) weekly.outerHTML = renderWeeklyRateHtml(moduleId);
      return true;
    }

    function renderHabitAchievementBadgesHtml(h) {
      const unlocked = (data.achievements && data.achievements[h.id]) || [];
      if (!unlocked.length) return '';
      return unlocked.map(m => `<span class="achievement-badge">🏆 ${m}天</span>`).join('');
    }

    function checkHabitAchievements(h) {
      if (!data.achievements) data.achievements = {};
      const streak = getStreak(h.records);
      const unlocked = data.achievements[h.id] || [];
      const newly = ACHIEVEMENT_MILESTONES.filter(m => streak >= m && !unlocked.includes(m));
      if (newly.length) {
        data.achievements[h.id] = [...new Set([...unlocked, ...newly])].sort((a, b) => a - b);
        saveData();
      }
      return newly;
    }

    function showAchievementToast(text) {
      const toast = document.getElementById('achievementToast');
      if (!toast) return;
      toast.textContent = text;
      toast.style.display = 'flex';
      clearTimeout(achievementToastTimer);
      achievementToastTimer = setTimeout(() => { toast.style.display = 'none'; }, 4000);
    }

    function openAchievementsModal() {
      renderAchievementsModal();
      document.getElementById('achievementsOverlay').classList.add('show');
    }

    function closeAchievementsModal(e) {
      if (e && e.target !== document.getElementById('achievementsOverlay')) return;
      document.getElementById('achievementsOverlay').classList.remove('show');
    }

    function renderAchievementsModal() {
      const listEl = document.getElementById('achievementsList');
      const dailyHabits = [];
      for (const mod of Object.values(data.modules)) {
        if (mod && Array.isArray(mod.habits)) {
          for (const h of mod.habits) {
            if (h.type === 'daily') dailyHabits.push(h);
          }
        }
      }
      if (!dailyHabits.length) {
        listEl.innerHTML = '<div class="backup-empty">还没有每日打卡项目</div>';
        return;
      }
      listEl.innerHTML = dailyHabits.map(h => {
        const streak = getStreak(h.records);
        const unlocked = (data.achievements && data.achievements[h.id]) || [];
        const next = ACHIEVEMENT_MILESTONES.find(m => !unlocked.includes(m));
        return `
          <div class="achievement-item">
            <div class="achievement-item-head">
              <span class="achievement-item-name">${h.icon} ${escapeHtml(h.name)}</span>
              <span class="achievement-item-streak">${streak} 天</span>
            </div>
            <div class="achievement-item-badges">${unlocked.length ? unlocked.map(m => `<span class="achievement-badge">🏆 ${m}天</span>`).join('') : '<span class="achievement-empty">暂无成就</span>'}</div>
            <div class="achievement-item-next">${next ? '下一成就：连续 ' + next + ' 天' : '全部成就已达成 🎉'}</div>
          </div>
        `;
      }).join('');
    }

    function doToggle(moduleId, id, note) {
      const h = data.modules[moduleId].habits.find(x => x.id === id);
      if (!h) return;
      const wasDone = h.records.includes(today);
      const idx = h.records.indexOf(today);
      if (idx >= 0) {
        h.records.splice(idx, 1);
        if (h.notes) delete h.notes[today];
      } else {
        h.records.push(today);
        if (note && h.notes !== undefined) h.notes[today] = note;
      }
      saveData();
      const triggerEl = document.activeElement && document.activeElement.getBoundingClientRect ? document.activeElement : null;
      const triggerRect = triggerEl ? triggerEl.getBoundingClientRect() : null;
      const isDone = h.records.includes(today);
      const newAchievements = isDone && h.type === 'daily' ? checkHabitAchievements(h) : [];
      let updatedInPlace = false;
      if (h.type === 'daily') {
        updatedInPlace = updateDailyCardInPlace(moduleId, h);
      }
      if (!updatedInPlace) {
        skipCardEntryAnim = true;
        renderModule(activeModule);
        skipCardEntryAnim = false;
      }
      updateTotalStats();
      renderNav();
      vibrate(isDone ? 25 : 12);
      celebrateIfComplete();
      if (newAchievements.length) {
        showAchievementToast('🏆 ' + h.name + '：连续 ' + newAchievements.join('/') + ' 天成就达成！');
      }

      // 只让当前打卡按钮播放动效，避免整张列表重新入场
      if (isDone && !wasDone) {
        const btnEl = document.querySelector(`.check-btn[data-module="${moduleId}"][data-id="${id}"]`);
        if (btnEl) {
          btnEl.classList.add('burst');
          const rect = btnEl.getBoundingClientRect();
          spawnConfetti(rect.left + rect.width/2, rect.top + rect.height/2);
        } else if (triggerRect) {
          const rect = triggerRect;
          spawnConfetti(rect.left + rect.width/2, rect.top + rect.height/2);
        }
      }
    }

    function confirmNote() {
      const note = document.getElementById('noteInput').value.trim();
      if (pendingNoteId && pendingNoteModule) {
        doToggle(pendingNoteModule, pendingNoteId, note);
      }
      closeNoteModal();
    }

    function closeNoteModal(e) {
      if (e && e.target !== document.getElementById('noteOverlay')) return;
      document.getElementById('noteOverlay').classList.remove('show');
      pendingNoteId = null;
      pendingNoteModule = null;
    }

    function openFuelModal(moduleId, id) {
      const h = data.modules[moduleId] && data.modules[moduleId].habits.find(x => x.id === id);
      if (!h) return;
      pendingFuelModule = moduleId;
      pendingFuelId = id;
      const rec = h.fuelRecords && h.fuelRecords[today] ? h.fuelRecords[today] : null;
      const now = new Date();
      const currentTime = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
      document.getElementById('fuelDate').value = today;
      document.getElementById('fuelTime').value = rec ? (rec.time || currentTime) : currentTime;
      document.getElementById('fuelLiters').value = rec ? (rec.liters !== undefined ? rec.liters : '') : '';
      document.getElementById('fuelDistance').value = rec ? (rec.distance !== undefined ? rec.distance : '') : '';
      const deleteBtn = document.getElementById('fuelDeleteBtn');
      if (deleteBtn) deleteBtn.style.display = h.records.includes(today) ? 'inline-flex' : 'none';
      document.getElementById('fuelOverlay').classList.add('show');
    }

    function closeFuelModal(e) {
      if (e && e.target !== document.getElementById('fuelOverlay')) return;
      document.getElementById('fuelOverlay').classList.remove('show');
      pendingFuelId = null;
      pendingFuelModule = null;
    }

    function saveFuelRecord() {
      if (!pendingFuelId || !pendingFuelModule) return;
      const h = data.modules[pendingFuelModule].habits.find(x => x.id === pendingFuelId);
      if (!h) return;
      const date = document.getElementById('fuelDate').value || today;
      if (date > today) {
        alert('不能记录未来的日期');
        return;
      }
      const time = document.getElementById('fuelTime').value.trim();
      const liters = parseFloat(document.getElementById('fuelLiters').value);
      const distance = parseFloat(document.getElementById('fuelDistance').value);
      if (!time) { alert('请输入加油时间'); return; }
      if (isNaN(liters) || liters <= 0) { alert('请输入正确的加油量（升）'); return; }
      if (isNaN(distance) || distance < 0) { alert('请输入正确的行驶公里数'); return; }
      if (!h.fuelRecords) h.fuelRecords = {};
      h.fuelRecords[date] = {
        time: time,
        liters: Math.round(liters * 100) / 100,
        distance: Math.round(distance * 10) / 10
      };
      if (!h.records.includes(date)) h.records.push(date);
      saveData();
      closeFuelModal();
      renderModule(activeModule);
      updateTotalStats();
      renderNav();
      celebrateIfComplete();
    }

    function deleteFuelRecord() {
      if (!pendingFuelId || !pendingFuelModule) return;
      const h = data.modules[pendingFuelModule].habits.find(x => x.id === pendingFuelId);
      if (!h) return;
      const date = document.getElementById('fuelDate').value || today;
      const idx = h.records.indexOf(date);
      if (idx >= 0) h.records.splice(idx, 1);
      if (h.fuelRecords) delete h.fuelRecords[date];
      saveData();
      closeFuelModal();
      renderModule(activeModule);
      updateTotalStats();
      renderNav();
    }

    function renderFuelMetaHtml(h) {
      const fuelRecords = h.fuelRecords || {};
      const dates = Object.keys(fuelRecords).sort().reverse();
      if (!dates.length) return '';
      let totalLiters = 0;
      let totalDistance = 0;
      dates.forEach(d => {
        const r = fuelRecords[d];
        totalLiters += Number(r.liters) || 0;
        totalDistance += Number(r.distance) || 0;
      });
      const last = fuelRecords[dates[0]];
      const parts = [h.records.length + ' 次'];
      if (totalLiters > 0) parts.push(totalLiters.toFixed(1) + ' L');
      if (totalDistance > 0) parts.push(totalDistance.toFixed(0) + ' km');
      return `
        <div class="fuel-summary">
          <span>⛽ ${parts.join(' · ')}</span>
          <span>最近：${last.time || '--'} · ${Number(last.liters) || 0}L · ${Number(last.distance) || 0}km</span>
        </div>
      `;
    }

    function getWeeklyCompletion(moduleId) {
      const mod = data.modules[moduleId];
      const habits = mod && Array.isArray(mod.habits) ? mod.habits : [];
      const now = new Date();
      const day = now.getDay() || 7;
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1);
      let need = 0, done = 0;
      for (let d = new Date(monday); d <= now; d.setDate(d.getDate() + 1)) {
        const ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        habits.forEach(h => {
          if (h.type === 'cycle') {
            if (isCycleCheckable(h, getCycleState(h, ds))) {
              need++;
              if (h.records.includes(ds)) done++;
            }
            return;
          }
          if (h.type === 'period' && !isPeriodDay(h, ds)) return;
          need++;
          if (h.records.includes(ds)) done++;
        });
      }
      return { need: need, done: done, pct: need ? Math.round(done / need * 100) : 0 };
    }

    function renderWeeklyRateHtml(moduleId) {
      const w = getWeeklyCompletion(moduleId);
      if (!w.need) return '';
      return `
        <div class="weekly-rate">
          <span>本周完成率</span>
          <div class="mini-bar"><div style="width:${w.pct}%"></div></div>
          <span class="weekly-num">${w.done}/${w.need} · ${w.pct}%</span>
        </div>
      `;
    }

    function openMakeupModal(moduleId, id) {
      const h = data.modules[moduleId] && data.modules[moduleId].habits.find(x => x.id === id);
      if (!h) return;
      document.getElementById('makeupHabitId').value = id;
      document.getElementById('makeupModuleId').value = moduleId;
      document.getElementById('makeupDate').value = getTodayStr();
      document.getElementById('makeupNote').value = (h.notes && h.notes[getTodayStr()]) || '';
      document.getElementById('makeupOverlay').classList.add('show');
    }

    function closeMakeupModal(e) {
      if (e && e.target !== document.getElementById('makeupOverlay')) return;
      document.getElementById('makeupOverlay').classList.remove('show');
    }

    function saveMakeupRecord() {
      const moduleId = document.getElementById('makeupModuleId').value;
      const id = parseInt(document.getElementById('makeupHabitId').value, 10);
      const date = document.getElementById('makeupDate').value;
      const note = document.getElementById('makeupNote').value.trim();
      if (!date) { alert('请选择补卡日期'); return; }
      if (date > getTodayStr()) { alert('不能补未来的日期'); return; }
      const h = data.modules[moduleId] && data.modules[moduleId].habits.find(x => x.id === id);
      if (!h) return;
      if (h.records.includes(date)) {
        alert('该日期已经打卡，无需补卡');
        return;
      }
      h.records.push(date);
      if (note) {
        if (!h.notes) h.notes = {};
        h.notes[date] = note;
      }
      saveData();
      closeMakeupModal();
      renderModule(activeModule);
      updateTotalStats();
      renderNav();
      celebrateIfComplete();
    }

    function deleteHabit(moduleId, id) {
      if (!confirm('确定删除这个目标吗？历史记录也会一并删除。')) return;
      createAutoBackup('删除打卡目标前');
      captureUndoSnapshot('已删除打卡目标');
      const h = data.modules[moduleId] && data.modules[moduleId].habits.find(x => x.id === id);
      if (h && h.name === '加油' && moduleId === 'free') data.modules.free.fuelSeeded = 'removed';
      data.modules[moduleId].habits = data.modules[moduleId].habits.filter(x => x.id !== id);
      saveData();
      renderModule(activeModule);
      updateTotalStats();
      renderNav();
    }

    function qaCatClass(cat) {
      if (cat === '睡眠') return 'sleep';
      if (cat === '健身') return 'fitness';
      if (cat === '补剂') return 'supplements';
      return '';
    }

    function saveQaExpanded() {
      if (!data.modules.qa) data.modules.qa = { expanded: [] };
      data.modules.qa.expanded = Array.from(qaExpanded);
      saveData();
    }

    function toggleQaExpanded(id) {
      if (qaExpanded.has(id)) qaExpanded.delete(id); else qaExpanded.add(id);
      saveQaExpanded();
      renderQaModule(document.getElementById('moduleContent'));
    }

    function setQaFilter(cat) {
      qaFilter = cat || '全部';
      renderQaModule(document.getElementById('moduleContent'));
    }

    function renderQaModule(container) {
      const cfg = MODULE_CONFIG.qa;
      const qaTitleBar = `
          <div class="module-title-bar">
            <div class="m-icon" style="background:${cfg.bg};border:1px solid ${cfg.color}22">${cfg.icon}</div>
            <div class="m-text">
              <div class="m-name">${cfg.name}</div>
              <div class="m-desc">${cfg.desc}</div>
            </div>
          </div>`;
      if (!qaData) {
        // 注意：这里以前是 `if (qaLoading) return;` —— 什么都不渲染就返回，
        // 会让"问题档案"标签下显示上一个模块的内容。现在每次都渲染载入态。
        if (!qaLoading) {
          qaLoading = true;
          fetch('questions.json')
            .then(r => { if (!r.ok) throw new Error('load fail'); return r.json(); })
            .then(json => {
              qaData = json;
              qaLoading = false;
              // 异步回调必须确认用户还在"问题档案"页，否则会把内容盖到别的模块上
              if (activeModule === 'qa') renderQaModule(document.getElementById('moduleContent'));
            })
            .catch(() => {
              qaLoading = false;
              if (activeModule !== 'qa') return;
              const mc = document.getElementById('moduleContent');
              if (!mc) return;
              mc.innerHTML = qaTitleBar + `
                <div class="qa-status">
                  <div class="big">⚠️</div>
                  <p>问题档案加载失败，请确认 questions.json 已随应用一起部署。</p>
                </div>`;
            });
        }
        container.innerHTML = qaTitleBar + `
          <div class="qa-status">
            <div class="big">📦</div>
            <p>正在载入问题档案...</p>
          </div>`;
        return;
      }

      const cats = ['全部'].concat(Array.from(new Set((qaData.questions || []).map(q => q.category).filter(Boolean))));
      const filtered = (qaData.questions || []).filter(q => qaFilter === '全部' || q.category === qaFilter);
      const cardsHtml = filtered.map(q => {
        const open = qaExpanded.has(q.id);
        const answerHtml = (q.answer || []).map(p => '<p>' + escapeHtml(p) + '</p>').join('');
        const pointsHtml = (q.keyPoints && q.keyPoints.length) ? `
          <div class="qa-points">
            <ul>
              ${q.keyPoints.map(p => '<li>' + escapeHtml(p) + '</li>').join('')}
            </ul>
          </div>
        ` : '';
        const sourcesHtml = (q.sources && q.sources.length) ? `
          <div class="qa-sources">
            ${q.sources.map(s => '<a href="' + escapeHtml(s.url) + '" target="_blank" rel="noopener">' + escapeHtml(s.label) + '</a>').join('')}
          </div>
        ` : '';
        return `
          <div class="qa-card ${open ? 'open' : ''}">
            <div class="qa-card-head" onclick="toggleQaExpanded(${q.id})">
              <span class="qa-cat ${qaCatClass(q.category)}">${escapeHtml(q.category)}</span>
              <div class="qa-q">
                <div>${escapeHtml(q.title)}</div>
                <div style="font-size:11px;color:var(--text2);font-weight:500;margin-top:4px">📅 ${escapeHtml(q.date || '')}</div>
              </div>
              <span class="qa-arrow">▼</span>
            </div>
            <div class="qa-body">
              <div class="qa-answer">${answerHtml}</div>
              ${pointsHtml}
              ${sourcesHtml}
            </div>
          </div>
        `;
      }).join('');

      container.innerHTML = `
        <div class="module-title-bar">
          <div class="m-icon" style="background:${cfg.bg};border:1px solid ${cfg.color}22">${cfg.icon}</div>
          <div class="m-text">
            <div class="m-name">${cfg.name}</div>
            <div class="m-desc">${cfg.desc}</div>
          </div>
          <div class="m-progress" style="background:linear-gradient(135deg, ${cfg.color}, ${cfg.color}88);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent">${qaData.questions ? qaData.questions.length : 0} 条</div>
        </div>
        <div class="qa-filter-bar">
          ${cats.map(c => `
            <button class="qa-filter-btn ${qaFilter === c ? 'active' : ''}" data-cat="${escapeHtml(c)}" onclick="setQaFilter(this.dataset.cat)">${escapeHtml(c)}</button>
          `).join('')}
        </div>
        ${cardsHtml || `
          <div class="qa-status">
            <div class="big">🌱</div>
            <p>这个分类还没有问题，换一个看看。</p>
          </div>
        `}
      `;
    }

    function renderModule(moduleId) {
      if (moduleId !== activeModule) return;
      const container = document.getElementById('moduleContent');
      const mod = data.modules[moduleId];
      const cfg = MODULE_CONFIG[moduleId];
      if (!mod) return;
      container.setAttribute('data-module', moduleId);
      container.style.setProperty('--module-color', cfg.color);
      // 带上透明度的派生色：CSS 里不能写成 var(--x)88（var() 替换不是字符串拼接，整条声明会失效），
      // 所以在 JS 里拼好再注入。
      container.style.setProperty('--module-color-a88', cfg.color + '88');
      container.style.setProperty('--module-color-a33', cfg.color + '33');
      container.style.setProperty('--module-color-a44', cfg.color + '44');

      if (moduleId === 'finance') {
        renderFinanceModule(container);
        return;
      }
      if (moduleId === 'manifestation') {
        renderManifestationModule(container);
        return;
      }
      if (moduleId === 'supplements') {
        renderSupplementsModule(container);
        return;
      }
      if (moduleId === 'body') {
        renderBodyModule(container);
        return;
      }
      if (moduleId === 'reading') {
        renderReadingModule(container);
        return;
      }
      if (moduleId === 'shopping') {
        renderShoppingModule(container);
        return;
      }
      if (moduleId === 'qa') {
        renderQaModule(container);
        return;
      }
      if (moduleId === 'sleepPlan') {
        renderSleepPlanModule(container);
        return;
      }

      let modNeed = 0, modDone = 0;
      const habitHtml = mod.habits.map(h => {
        if (h.type === 'cycle') {
          modNeed++;
          const state = getCycleState(h, today);
          if (!isCycleCheckable(h, state) || h.records.includes(today)) modDone++;
          return renderCycleItem(moduleId, h);
        } else if (h.type === 'period') {
          const isDue = isPeriodDay(h, today);
          const isDone = h.records.includes(today);
          if (isDue) { modNeed++; if (isDone) modDone++; }
          return renderPeriodItem(moduleId, h, isDue, isDone);
        } else {
          const isDone = h.records.includes(today);
          modNeed++; if (isDone) modDone++;
          const streak = getStreak(h.records);
          return renderDailyItem(moduleId, h, isDone, streak);
        }
      }).join('');

      const pct = modNeed ? Math.round(modDone / modNeed * 100) : 0;
      const hasHabits = mod.habits.length > 0;

      container.innerHTML = `
        <div class="module-title-bar">
          <div class="m-icon" style="background:${cfg.bg};border:1px solid ${cfg.color}22">${cfg.icon}</div>
          <div class="m-text">
            <div class="m-name">${cfg.name}</div>
            <div class="m-desc">${cfg.desc}</div>
          </div>
          <div class="m-progress" style="background:linear-gradient(135deg, ${cfg.color}, ${cfg.color}88);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent">${pct}%</div>
        </div>

        ${moduleId === 'daily' ? renderWorkbenchHtml() : ''}

        <div class="add-box">
          <input type="text" id="moduleInput" placeholder="添加${cfg.name}目标..." maxlength="20"
            onkeypress="if(event.key==='Enter') addHabit()">
          <button onclick="addHabit()">添加</button>
        </div>

        ${moduleId === 'daily' ? renderTomorrowPlanHtml() : ''}

        ${moduleId === 'fitness' ? renderSleepTrainingHtml() : ''}

        ${hasHabits ? `
          ${renderWeeklyRateHtml(moduleId)}
          <div class="module-progress-bar">
            <div class="ph"><span>模块进度</span><span class="pp" style="color:${cfg.color}">${modDone}/${modNeed}</span></div>
            <div class="pb"><div class="pf" style="width:${pct}%;background:linear-gradient(90deg,${cfg.color},${cfg.color}66)"></div></div>
          </div>
          <div class="habit-list${skipCardEntryAnim ? ' ready' : ''}">
            ${habitHtml}
          </div>
        ` : `
          <div class="empty-state">
            <div class="big">🌱</div>
            <p>还没有目标，添加一个开始吧</p>
          </div>
        `}
      `;
    }

    function renderDailyItem(moduleId, h, isDone, streak) {
      const isFuel = h.name === '加油';
      const fuelMeta = isFuel ? renderFuelMetaHtml(h) : '';
      const makeupBtn = isFuel ? '' : `<button class="makeup-btn" onclick="openMakeupModal('${moduleId}', ${h.id})" title="补卡">↩</button>`;
      const remark = h.remark || DAILY_HABIT_REMARKS[h.name] || '';
      return `
        <div class="habit-card ${isDone ? 'done' : ''}" data-module="${moduleId}" data-id="${h.id}">
          <div class="icon">${h.icon}</div>
          <div class="habit-info" onclick="showCalendar('${moduleId}', ${h.id})" style="cursor:pointer">
            <div class="name">${escapeHtml(h.name)} <span class="achievement-badges" data-habit="${h.id}">${renderHabitAchievementBadgesHtml(h)}</span></div>
            <div class="meta">
              <span>${h.records.length} 天已坚持</span>
              ${streak > 0 ? '<span>·</span><span class="streak">' + streak + ' 天</span>' : ''}
            </div>
            ${remark ? '<div class="remark">' + escapeHtml(remark) + '</div>' : ''}
            ${fuelMeta}
          </div>
          <button class="check-btn ${isDone ? 'done' : ''}" data-module="${moduleId}" data-id="${h.id}" onclick="toggleCheck('${moduleId}', ${h.id})" title="${isFuel ? '记录加油' : '点击打卡'}">
            ${isDone ? '✓' : ''}
          </button>
          ${makeupBtn}
          <button class="edit-btn" onclick="openHabitEdit('${moduleId}', ${h.id})" title="编辑">✏️</button>
          <button class="del-btn" onclick="deleteHabit('${moduleId}', ${h.id})" title="删除">×</button>
        </div>
      `;
    }

    function renderCycleItem(moduleId, h) {
      const state = getCycleState(h, today);
      const stateClass = getCycleStateClass(state);
      const canCheck = isCycleCheckable(h, state);
      const isDone = h.records.includes(today);
      const checkBtn = canCheck
        ? `<button class="check-btn ${isDone ? 'done' : ''}" data-module="${moduleId}" data-id="${h.id}" onclick="toggleCheck('${moduleId}', ${h.id})" title="${isDone ? '取消打卡' : '点击打卡'}">${isDone ? '✓' : ''}</button>`
        : '';
      const previews = [];
      const d = new Date();
      for (let i = 1; i <= 3; i++) {
        d.setDate(d.getDate() + 1);
        const ds = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
        const s = getCycleState(h, ds);
        const dayLabel = i === 1 ? '明天' : i === 2 ? '后天' : '大后天';
        previews.push(`${dayLabel}${escapeHtml(s)}`);
      }
      return `
        <div class="habit-card" data-module="${moduleId}" data-id="${h.id}">
          <div class="icon">${h.icon}</div>
          <div class="habit-info" onclick="showCycleCalendar('${moduleId}', ${h.id})" style="cursor:pointer">
            <div class="name">
              ${escapeHtml(h.name)}
              <span class="cycle-badge ${stateClass}">今日${escapeHtml(state)}</span>
            </div>
            <div class="meta">${previews.join(' · ')}</div>
          </div>
          ${checkBtn}
          <button class="edit-btn" onclick="openHabitEdit('${moduleId}', ${h.id})" title="编辑">✏️</button>
          <button class="del-btn" onclick="deleteHabit('${moduleId}', ${h.id})" title="删除">×</button>
        </div>
      `;
    }

    function renderPeriodItem(moduleId, h, isDue, isDone) {
      const daysLeft = getDaysUntilNext(h, today);
      let statusHtml = '';
      let btnHtml = '';

      if (isDue) {
        statusHtml = `<span class="period-badge due">📅 今日需打卡</span>`;
        btnHtml = `<button class="check-btn ${isDone ? 'done' : ''}" data-module="${moduleId}" data-id="${h.id}" onclick="toggleCheck('${moduleId}', ${h.id})" title="点击打卡">${isDone ? '✓' : ''}</button>`;
      } else {
        statusHtml = `<span class="period-badge wait">⏳ 无需打卡</span>`;
        btnHtml = `<button class="check-btn disabled" title="${daysLeft}天后需打卡" disabled>·</button>`;
      }

      const noteHtml = (isDone && h.notes && h.notes[today]) ? `<div class="note-tag">📝 ${escapeHtml(h.notes[today])}</div>` : '';
      const nextDate = new Date();
      nextDate.setDate(nextDate.getDate() + daysLeft);
      const nextStr = `${nextDate.getMonth()+1}月${nextDate.getDate()}日`;

      return `
        <div class="habit-card ${isDone ? 'done' : ''}" data-module="${moduleId}" data-id="${h.id}">
          <div class="icon">${h.icon}</div>
          <div class="habit-info" onclick="showCalendar('${moduleId}', ${h.id})" style="cursor:pointer">
            <div class="name">${escapeHtml(h.name)} ${statusHtml}</div>
            <div class="meta">
              <span>${h.records.length} 次已记录</span>
              ${!isDue ? '<span>·</span><span>下次 ' + nextStr + '（还有' + daysLeft + '天）</span>' : ''}
            </div>
            ${noteHtml}
          </div>
          ${btnHtml}
          <button class="edit-btn" onclick="openHabitEdit('${moduleId}', ${h.id})" title="编辑">✏️</button>
          <button class="del-btn" onclick="deleteHabit('${moduleId}', ${h.id})" title="删除">×</button>
        </div>
      `;
    }

    function getTomorrowPlans() {
      return (data.modules.daily && data.modules.daily.tomorrowPlans) || [];
    }

    function getTomorrowDateStr() {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      return getDateStr(d);
    }

    function getPlanDateLabel(dateStr) {
      if (dateStr === getTodayStr()) return '今天';
      if (dateStr === getTomorrowDateStr()) return '明天';
      const d = new Date(dateStr + 'T00:00:00');
      if (isNaN(d.getTime())) return dateStr;
      return (d.getMonth() + 1) + '月' + d.getDate() + '日';
    }

    function addTomorrowPlan() {
      const input = document.getElementById('tomorrowPlanInput');
      if (!input) return;
      const text = input.value.trim();
      if (!text) {
        alert('请先写下明天要做的事');
        return;
      }
      const plans = getTomorrowPlans();
      plans.push({
        id: Date.now(),
        text: text,
        targetDate: getTomorrowDateStr(),
        createdAt: getTodayStr(),
        doneDate: ''
      });
      data.modules.daily.tomorrowPlans = plans;
      saveData();
      input.value = '';
      renderModule('daily');
      updateDailyHero();
      showInfoToast('已写进明天待办');
    }

    function markTomorrowPlanDone(id) {
      const plan = getTomorrowPlans().find(p => p.id === id);
      if (!plan) return;
      if (plan.targetDate <= getTodayStr() && !plan.doneDate) {
        plan.doneDate = getTodayStr();
        saveData();
        renderModule('daily');
        updateDailyHero();
        showInfoToast('已记录完成');
      }
    }

    function deleteTomorrowPlan(id) {
      if (!confirm('确定删除这条待办吗？')) return;
      data.modules.daily.tomorrowPlans = getTomorrowPlans().filter(p => p.id !== id);
      saveData();
      renderModule('daily');
      updateDailyHero();
    }

    function renderTomorrowPlanHtml() {
      const todayStr = getTodayStr();
      const plans = getTomorrowPlans().slice().sort((a, b) => String(a.targetDate).localeCompare(String(b.targetDate)) || a.id - b.id);
      const pendingItems = plans.filter(p => p.targetDate <= todayStr && !p.doneDate);
      const doneTodayItems = plans.filter(p => p.targetDate === todayStr && p.doneDate);
      const futureItems = plans.filter(p => p.targetDate > todayStr && !p.doneDate);
      const pendingHtml = pendingItems.map(p => `
        <div class="tomorrow-plan-item due">
          <span class="tomorrow-plan-date">⏰ ${getPlanDateLabel(p.targetDate)}</span>
          <span class="tomorrow-plan-text">${escapeHtml(p.text)}</span>
          <button class="tomorrow-plan-check" onclick="markTomorrowPlanDone(${p.id})" title="记录完成">✓</button>
          <button class="tomorrow-plan-del" onclick="deleteTomorrowPlan(${p.id})" title="删除">×</button>
        </div>
      `).join('');
      const doneHtml = doneTodayItems.map(p => `
        <div class="tomorrow-plan-item done">
          <span class="tomorrow-plan-date">✅ ${getPlanDateLabel(p.targetDate)}</span>
          <span class="tomorrow-plan-text">${escapeHtml(p.text)}</span>
          <button class="tomorrow-plan-check done" title="今天已记录">✓</button>
          <button class="tomorrow-plan-del" onclick="deleteTomorrowPlan(${p.id})" title="删除">×</button>
        </div>
      `).join('');
      const futureHtml = futureItems.map(p => `
        <div class="tomorrow-plan-item future">
          <span class="tomorrow-plan-date">📅 ${getPlanDateLabel(p.targetDate)}</span>
          <span class="tomorrow-plan-text">${escapeHtml(p.text)}</span>
          <button class="tomorrow-plan-del" onclick="deleteTomorrowPlan(${p.id})" title="删除">×</button>
        </div>
      `).join('');
      const hasAny = pendingHtml || doneHtml || futureHtml;
      return `
        <div class="tomorrow-plan-card">
          <div class="tomorrow-plan-title">📌 明日待办</div>
          <div class="tomorrow-plan-input-row">
            <input type="text" id="tomorrowPlanInput" placeholder="写下明天要做的事..." maxlength="60" onkeypress="if(event.key==='Enter') addTomorrowPlan()">
            <button onclick="addTomorrowPlan()">写好明天</button>
          </div>
          ${pendingHtml ? '<div class="tomorrow-plan-section-title">⏰ 昨天写好的今天待办</div>' : ''}
          ${pendingHtml}
          ${doneHtml ? '<div class="tomorrow-plan-section-title">✅ 今天已记录的待办</div>' : ''}
          ${doneHtml}
          ${futureHtml ? '<div class="tomorrow-plan-section-title">🗓 已写好的未来待办</div>' : ''}
          ${futureHtml}
          ${!hasAny ? '<div class="tomorrow-plan-empty">今天先写一件明天要做的事，明天会自动提醒你记录。</div>' : ''}
        </div>
      `;
    }

    function getTodayCompletion() {
      return getCompletionForDate(today);
    }

    function getDateStr(d) {
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function hasRecordOnDate(dateStr) {
      for (const modId of ['daily', 'study', 'game', 'fitness', 'free']) {
        const mod = data.modules[modId];
        if (!mod || !Array.isArray(mod.habits)) continue;
        for (const h of mod.habits) {
          if (h.type === 'daily' && h.records.includes(dateStr)) return true;
          if (h.type === 'period' && isPeriodDay(h, dateStr) && h.records.includes(dateStr)) return true;
        }
      }
      return false;
    }

    function getOverallStreak() {
      const d = new Date();
      if (!hasRecordOnDate(getDateStr(d))) d.setDate(d.getDate() - 1);
      let streak = 0;
      while (hasRecordOnDate(getDateStr(d))) {
        streak++;
        d.setDate(d.getDate() - 1);
      }
      return streak;
    }

    function getDayOfYear(d) {
      return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24));
    }

    function updateDailyHero() {
      const hero = document.getElementById('dailyHero');
      if (!hero) return;
      const now = new Date();
      const h = now.getHours();
      let greeting = '晚上好';
      if (h < 6) greeting = '夜深了';
      else if (h < 11) greeting = '早上好';
      else if (h < 13) greeting = '中午好';
      else if (h < 18) greeting = '下午好';
      document.getElementById('dailyGreeting').textContent = greeting + '，今天继续';
      document.getElementById('dailyQuote').textContent = DAILY_QUOTES[getDayOfYear(now) % DAILY_QUOTES.length];
      const s = getTodayCompletion();
      const pct = s.totalNeed ? Math.round(s.totalDone / s.totalNeed * 100) : 0;
      document.getElementById('overallStreak').textContent = getOverallStreak();
      document.getElementById('heroDone').textContent = s.totalDone + '/' + s.totalNeed;
      document.getElementById('heroPct').textContent = pct + '%';
      const ring = document.getElementById('heroRing');
      if (ring) ring.style.background = `conic-gradient(#64ffda ${pct * 3.6}deg, rgba(255,255,255,0.08) 0deg)`;
      renderDailyTips();
    }

    // ========== 个人工作台 ==========
    function getCompletionForDate(dateStr) {
      let totalHabits = 0, totalNeed = 0, totalDone = 0;
      for (const [modId, mod] of Object.entries(data.modules)) {
        if (modId === 'supplements') {
          if (mod.items) {
            const needItems = mod.items.filter(i => shouldTakeSupplement(i, dateStr));
            totalHabits += mod.items.length;
            totalNeed += needItems.length;
            totalDone += needItems.filter(i => isSupplementTakenOn(i, dateStr)).length;
          }
          continue;
        }
        if (modId === 'sleepPlan') {
          const steps = getSleepStepsForDate(dateStr);
          const doneSteps = getSleepPlan().records[dateStr] || [];
          totalHabits += steps.length;
          totalNeed += steps.length;
          totalDone += steps.filter(s => doneSteps.indexOf(s.id) !== -1).length;
          continue;
        }
        if (!mod.habits) continue;
        totalHabits += mod.habits.length;
        for (const h of mod.habits) {
          if (h.type === 'cycle') {
            totalNeed++;
            const state = getCycleState(h, dateStr);
            if (!isCycleCheckable(h, state) || h.records.includes(dateStr)) totalDone++;
          } else if (h.type === 'period') {
            if (isPeriodDay(h, dateStr)) {
              totalNeed++;
              if (h.records.includes(dateStr)) totalDone++;
            }
          } else {
            totalNeed++;
            if (h.records.includes(dateStr)) totalDone++;
          }
        }
      }
      return { totalHabits, totalNeed, totalDone, pct: totalNeed ? Math.round(totalDone / totalNeed * 100) : 0 };
    }

    function getTrendCompletionPct(dateStr, days) {
      const dates = [];
      const d = new Date(dateStr + 'T00:00:00');
      for (let i = 0; i < days; i++) {
        dates.push(getDateStr(d));
        d.setDate(d.getDate() - 1);
      }
      let sum = 0, count = 0;
      dates.forEach(ds => {
        const c = getCompletionForDate(ds);
        if (c.totalNeed > 0) { sum += c.pct; count++; }
      });
      return count ? Math.round(sum / count) : 0;
    }

    function getGrowthScore(dateStr) {
      const c = getCompletionForDate(dateStr);
      const suppItems = (data.modules.supplements && data.modules.supplements.items) || [];
      const needItems = suppItems.filter(i => shouldTakeSupplement(i, dateStr));
      const suppDone = needItems.filter(i => isSupplementTakenOn(i, dateStr)).length;
      const suppPct = needItems.length ? Math.round(suppDone / needItems.length * 100) : 100;
      const steps = getSleepStepsForDate(dateStr);
      const doneSteps = getSleepPlan().records[dateStr] || [];
      const sleepPct = steps.length ? Math.round(steps.filter(s => doneSteps.indexOf(s.id) !== -1).length / steps.length * 100) : 100;
      const reading = getReadingRecords().some(r => r.date === dateStr) ? 12 : 0;
      const body = getBodyRecords().some(r => r.date === dateStr) ? 10 : 0;
      const maniGoals = (data.modules.manifestation && data.modules.manifestation.goals) || [];
      const mani = maniGoals.some(g => g.records && g.records.some(r => r.date === dateStr)) ? 8 : 0;
      const extra = Math.min(30, reading + body + mani);
      const trend = getTrendCompletionPct(dateStr, 7);
      const raw = c.pct * 0.35 + suppPct * 0.2 + sleepPct * 0.2 + trend * 0.15 + extra * 0.1;
      return Math.max(0, Math.min(100, Math.round(raw)));
    }

    function getGrowthStats(dates) {
      return dates.map(date => ({ value: getGrowthScore(date), label: date.slice(5).replace('-', '/') }));
    }

    function getMonthHighlights() {
      const now = new Date();
      const monthKey = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
      const monthPrefix = monthKey + '-';
      const items = [];
      let bestHabit = null, bestStreak = 0;
      for (const mod of Object.values(data.modules)) {
        if (!mod || !Array.isArray(mod.habits)) continue;
        for (const h of mod.habits) {
          const s = getStreak(h.records);
          if (s > bestStreak) { bestStreak = s; bestHabit = h; }
        }
      }
      if (bestHabit && bestStreak > 0) items.push({ icon: '🔥', label: '本月连续', text: bestHabit.name + ' 已连续 ' + bestStreak + ' 天' });
      const readingRecords = getReadingRecords().filter(r => String(r.date || '').indexOf(monthPrefix) === 0);
      const readMin = readingRecords.reduce((s, r) => s + (Number(r.durationMinutes) || 0), 0);
      if (readMin > 0) items.push({ icon: '📖', label: '本月阅读', text: formatReadingDuration(readMin) + ' · ' + readingRecords.length + ' 次' });
      const bodyCount = getBodyRecords().filter(r => String(r.date || '').indexOf(monthPrefix) === 0).length;
      if (bodyCount > 0) items.push({ icon: '🧬', label: '身体记录', text: '本月记录 ' + bodyCount + ' 次变化与感受' });
      const finance = getFinanceStats();
      if (finance.target > 0) items.push({ icon: '💰', label: '存款进度', text: formatMoney(finance.current) + ' / ' + formatMoney(finance.target) });
      const maniCount = ((data.modules.manifestation && data.modules.manifestation.goals) || []).reduce((sum, g) => sum + (g.records ? g.records.filter(r => String(r.date || '').indexOf(monthPrefix) === 0).length : 0), 0);
      if (maniCount > 0) items.push({ icon: '✨', label: '显化记录', text: '本月写下 ' + maniCount + ' 次显化记录' });
      const sleepActual = getSleepActualHours(getTodayStr());
      if (sleepActual !== null) items.push({ icon: '😴', label: '昨晚睡眠', text: '实际睡眠 ' + sleepActual + ' 小时' });
      return items.slice(0, 4);
    }

    function getPendingTodayItems() {
      const items = [];
      const dateStr = getTodayStr();
      for (const [modId, mod] of Object.entries(data.modules)) {
        if (!mod || !Array.isArray(mod.habits)) continue;
        const cfg = MODULE_CONFIG[modId];
        for (const h of mod.habits) {
          let due = false;
          if (h.type === 'cycle') {
            const state = getCycleState(h, dateStr);
            due = isCycleCheckable(h, state) && !h.records.includes(dateStr);
          } else if (h.type === 'period') {
            due = isPeriodDay(h, dateStr) && !h.records.includes(dateStr);
          } else {
            due = !h.records.includes(dateStr);
          }
          if (due) items.push({ moduleId: modId, id: h.id, name: h.name, icon: h.icon, moduleName: cfg ? cfg.name : modId });
        }
      }
      const suppItems = (data.modules.supplements && data.modules.supplements.items) || [];
      suppItems.filter(i => shouldTakeSupplement(i, dateStr) && !isSupplementTakenOn(i, dateStr)).forEach(i => {
        items.push({ moduleId: 'supplements', id: i.id, name: i.name, icon: i.icon, moduleName: '补剂明细', supplement: true });
      });
      const steps = getSleepStepsForDate(dateStr);
      const doneSteps = getSleepPlan().records[dateStr] || [];
      const pendingSleep = steps.filter(s => doneSteps.indexOf(s.id) === -1).length;
      if (pendingSleep > 0) items.push({ moduleId: 'sleepPlan', id: 'sleep', name: '睡眠流程还有 ' + pendingSleep + ' 项', icon: '😴', moduleName: '睡眠流程', sleep: true });
      return items;
    }

    function renderTimeCardHtml() {
      const now = new Date();
      const h = now.getHours();
      const todayStr = getTodayStr();
      const pendingItems = getPendingTodayItems();
      const completion = getCompletionForDate(todayStr);
      if (h >= 5 && h < 12) {
        const d = new Date(todayStr + 'T00:00:00');
        d.setDate(d.getDate() - 1);
        const y = getDateStr(d);
        const yc = getCompletionForDate(y);
        const plans = getTomorrowPlans().filter(p => p.targetDate === todayStr && !p.doneDate);
        return `
          <div class="wb-time-card morning">
            <div class="wb-time-card-title">☀️ 晨间卡片</div>
            <div class="wb-time-card-text">昨天完成 <b>${yc.totalDone}/${yc.totalNeed}</b>（${yc.pct}%）；今天还有 <b>${pendingItems.length}</b> 项待办。${plans.length ? '今天已提前写好 <b>' + plans.length + '</b> 件事。' : '今天还没写待办，可以顺手写一件。'}</div>
          </div>
        `;
      }
      if (h >= 18 || h < 5) {
        const plans = getTomorrowPlans().filter(p => p.targetDate === getTomorrowDateStr() && !p.doneDate);
        return `
          <div class="wb-time-card evening">
            <div class="wb-time-card-title">🌙 睡前复盘</div>
            <div class="wb-time-card-text">今日完成 <b>${completion.totalDone}/${completion.totalNeed}</b>（${completion.pct}%），还有 <b>${pendingItems.length}</b> 项没完成。${plans.length ? '明天已写好 <b>' + plans.length + '</b> 件事，按计划来就行。' : '明天还没有待办，睡前写一件会让早上更轻松。'}</div>
          </div>
        `;
      }
      return '';
    }

    // ========== 主页今日周期提醒 ==========
    // 扫描所有模块的周期任务：cycle 类型今天处于"可打卡状态"（如喂食）、period 类型今天到期的，
    // 汇总到主页工作台显示，点击可跳转到对应模块。
    function getTodayCycleReminders() {
      const list = [];
      Object.keys(data.modules).forEach(moduleId => {
        const mod = data.modules[moduleId];
        if (!mod || !Array.isArray(mod.habits)) return;
        mod.habits.forEach(h => {
          if (h.type === 'cycle') {
            const state = getCycleState(h, today);
            if (isCycleCheckable(h, state)) {
              list.push({ moduleId, icon: h.icon, name: h.name, label: state, done: h.records.includes(today) });
            }
          } else if (h.type === 'period') {
            if (isPeriodDay(h, today)) {
              list.push({ moduleId, icon: h.icon, name: h.name, label: '今天', done: h.records.includes(today) });
            }
          }
        });
      });
      return list;
    }

    function renderCycleReminderHtml() {
      const items = getTodayCycleReminders();
      if (!items.length) return '';
      const allDone = items.every(i => i.done);
      const chips = items.map(i => {
        const cfg = MODULE_CONFIG[i.moduleId] || {};
        return `<button class="cr-chip ${i.done ? 'done' : ''}" onclick="switchModule('${i.moduleId}')">
          <span class="cr-icon">${i.icon}</span>
          <span class="cr-name">${escapeHtml(i.name)}</span>
          <span class="cr-label">${escapeHtml(i.label)}</span>
          <span class="cr-mark">${i.done ? '✓' : ''}</span>
        </button>`;
      }).join('');
      return `
        <div class="cycle-reminder ${allDone ? 'all-done' : ''}">
          <div class="cr-head">${allDone ? '✅ 今日周期提醒（全部完成）' : '⏰ 今日周期提醒'}</div>
          <div class="cr-chips">${chips}</div>
        </div>`;
    }

    function renderWorkbenchHtml() {
      const s = getCompletionForDate(today);
      const score = getGrowthScore(today);
      return `
        <div class="workbench-box" id="workbenchBox">
          <div class="workbench-top">
            <div class="growth-score">
              <div class="growth-score-ring" style="--score:${score}"><span>${score}</span></div>
              <div>
                <div class="growth-score-title">今日成长评分</div>
                <div class="growth-score-sub">综合打卡 · 补剂 · 睡眠</div>
              </div>
            </div>
            <div class="workbench-summary">
              <div>今日完成<b>${s.totalDone}/${s.totalNeed}</b></div>
              <div>连续坚持<b>${getOverallStreak()} 天</b></div>
            </div>
          </div>
          ${renderTimeCardHtml()}
          ${renderCycleReminderHtml()}
        </div>
      `;
    }

    function refreshWorkbench() {
      if (activeModule !== 'daily') return;
      const box = document.getElementById('workbenchBox');
      if (!box) return;
      const wrap = document.createElement('div');
      wrap.innerHTML = renderWorkbenchHtml();
      const next = wrap.firstElementChild;
      if (next) box.outerHTML = next.outerHTML;
    }

    // ========== 快捷入口排序 ==========
    function getQuickEntryOrder() {
      const defaults = ['sleepPlan', 'fitness', 'supplements', 'finance', 'manifestation', 'body'];
      try {
        const saved = JSON.parse(localStorage.getItem(LS_KEY + '_quickOrder'));
        if (Array.isArray(saved) && saved.length) return saved.filter(id => MODULE_CONFIG[id]);
      } catch(e) {}
      return defaults;
    }

    function saveQuickEntryOrder(order) {
      localStorage.setItem(LS_KEY + '_quickOrder', JSON.stringify(order));
      refreshWorkbench();
    }

    // ========== 视觉个性化 ==========
    const THEME_PRESETS = [
      { id: 'default', name: '经典青绿', color: '#64ffda', color2: '#00d4ff' },
      { id: 'sun', name: '暖阳', color: '#ffd93d', color2: '#ff9f43' },
      { id: 'ocean', name: '深海', color: '#4d96ff', color2: '#00d4ff' },
      { id: 'neon', name: '霓虹紫', color: '#bd34fe', color2: '#00d4ff' },
      { id: 'forest', name: '森林绿', color: '#6bcb77', color2: '#00e676' }
    ];

    function getUiPrefs() {
      try {
        const p = JSON.parse(localStorage.getItem(LS_KEY + '_uiPrefs'));
        if (p && p.mode && p.theme) return p;
      } catch(e) {}
      return { mode: 'rich', theme: 'default' };
    }

    function saveUiPrefs(prefs) {
      localStorage.setItem(LS_KEY + '_uiPrefs', JSON.stringify(prefs));
      applyUiPrefs();
    }

    function applyUiPrefs() {
      const p = getUiPrefs();
      document.body.classList.toggle('ui-simple', p.mode === 'simple');
      document.body.classList.remove('theme-sun', 'theme-ocean', 'theme-neon', 'theme-forest');
      if (p.theme && p.theme !== 'default') document.body.classList.add('theme-' + p.theme);
    }

    function openPersonalizeModal() {
      renderPersonalizeContent();
      document.getElementById('personalizeOverlay').classList.add('show');
    }

    function closePersonalizeModal(e) {
      const overlay = document.getElementById('personalizeOverlay');
      if (!overlay) return;
      if (e && e.target !== overlay) return;
      overlay.classList.remove('show');
    }

    function renderPersonalizeContent() {
      const p = getUiPrefs();
      const themeHtml = THEME_PRESETS.map(t => `
        <button class="theme-swatch ${p.theme === t.id ? 'active' : ''}" onclick="selectUiTheme('${t.id}')">
          <span class="theme-swatch-dot" style="background:linear-gradient(135deg, ${t.color}, ${t.color2})"></span>
          <span>${t.name}</span>
        </button>
      `).join('');
      const order = getQuickEntryOrder();
      const orderHtml = order.map((id, idx) => {
        const cfg = MODULE_CONFIG[id];
        if (!cfg) return '';
        return `
          <div class="quick-order-item">
            <span class="qoi-icon">${cfg.icon}</span>
            <span class="qoi-name">${cfg.name}</span>
            <button onclick="moveQuickOrder(${idx}, -1)" ${idx === 0 ? 'disabled' : ''} title="上移">↑</button>
            <button onclick="moveQuickOrder(${idx}, 1)" ${idx === order.length - 1 ? 'disabled' : ''} title="下移">↓</button>
          </div>
        `;
      }).join('');
      document.getElementById('personalizeContent').innerHTML = `
        <div class="personalize-section">
          <div class="personalize-section-title">显示模式</div>
          <div class="mode-tabs">
            <button class="mode-tab ${p.mode === 'rich' ? 'active' : ''}" onclick="setUiMode('rich')">✨ 丰富模式</button>
            <button class="mode-tab ${p.mode === 'simple' ? 'active' : ''}" onclick="setUiMode('simple')">简洁模式</button>
          </div>
        </div>
        <div class="personalize-section">
          <div class="personalize-section-title">主题配色</div>
          <div class="theme-swatches">${themeHtml}</div>
        </div>
        <div class="personalize-section">
          <div class="personalize-section-title">首页快捷入口顺序</div>
          <div class="quick-order-list">${orderHtml || '<div class="supp-log-empty">暂无快捷入口</div>'}</div>
        </div>
      `;
    }

    function selectUiTheme(theme) {
      const p = getUiPrefs();
      p.theme = theme;
      saveUiPrefs(p);
      renderPersonalizeContent();
    }

    function setUiMode(mode) {
      const p = getUiPrefs();
      p.mode = mode;
      saveUiPrefs(p);
      renderPersonalizeContent();
    }

    function moveQuickOrder(index, delta) {
      const order = getQuickEntryOrder();
      const target = index + delta;
      if (target < 0 || target >= order.length) return;
      const tmp = order[index];
      order[index] = order[target];
      order[target] = tmp;
      saveQuickEntryOrder(order);
      renderPersonalizeContent();
      showInfoToast('快捷入口顺序已更新');
    }

    // ========== 备份复制 / 剪贴板导入 ==========
    function fallbackCopyText(text, done) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        if (done) done();
      } catch(e) {
        alert('复制失败，请手动复制备份文本');
      }
      document.body.removeChild(ta);
    }

    function copyBackupToClipboard() {
      const payload = { app: 'growth-checkin', version: APP_VERSION, exportedAt: new Date().toISOString(), data: data };
      payload.checksum = simpleHash(JSON.stringify(payload.data));
      const text = JSON.stringify(payload);
      const done = () => showInfoToast('备份已复制，可粘贴到微信/文件传输助手保存');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopyText(text, done));
      } else {
        fallbackCopyText(text, done);
      }
    }

    function pasteBackupFromClipboard() {
      if (!navigator.clipboard || !navigator.clipboard.readText) {
        alert('当前浏览器不支持读取剪贴板，请用“导入备份”选择文件');
        return;
      }
      navigator.clipboard.readText().then(text => {
        try {
          applyImportedBackup(JSON.parse(text));
          closeBackupModal();
        } catch(err) {
          alert('导入失败：' + err.message);
        }
      }).catch(err => alert('读取剪贴板失败：' + err.message));
    }

    function copyStatsReport() {
      const rows = getDailyReportRows(statsRange);
      const dates = getStatsDates(statsRange);
      const growth = getGrowthStats(dates);
      const lines = rows.map((r, i) => [r.date, growth[i] ? growth[i].value : '', r.checkin, r.supplement, r.manifest].join(' | '));
      const text = '成长打卡统计（' + statsRange + '天）\n' + ['日期', '成长评分', '打卡完成率(%)', '补剂服用', '显化记录'].join(' | ') + '\n' + lines.join('\n');
      const done = () => showInfoToast('统计报告已复制');
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopyText(text, done));
      else fallbackCopyText(text, done);
    }

    // 用药日志 / 复诊小结 已按要求移除。
    // 数据不删：item.records 里的历史服药记录（剂量/时间/反应/备注）与 supplements.reviewNote
    // 仍保留在本地数据中，导出备份时依然包含，只是不再有界面入口。

    // ========== 显化目标真实数据联动 ==========
    function getGoalLinkedStats(goal) {
      const text = ((goal.title || '') + ' ' + (goal.description || '')).toLowerCase();
      const finance = getFinanceStats();
      const weekDays = getWeekDates();
      const reading = getWeeklyReadingStats(weekDays);
      const weeklyHabit = getWeeklyHabitStats(weekDays);
      const bodyCount = getBodyRecords().length;
      const sleepActual = getSleepActualHours(getTodayStr());
      if (goal.linkModule === 'finance' || /攒钱|存钱|存款|财务|挣钱|收入/.test(text)) return { icon: '💰', text: '存款 ' + formatMoney(finance.current) + ' / ' + formatMoney(finance.target) };
      if (goal.linkModule === 'reading' || /读书|阅读|看书|学习/.test(text)) return { icon: '📖', text: '本周阅读 ' + reading.minutes + ' 分钟 · ' + reading.sessions + ' 次' };
      if (goal.linkModule === 'fitness' || /健身|锻炼|训练|增肌|减肥|瘦/.test(text)) return { icon: '💪', text: '本周打卡 ' + weeklyHabit.done + '/' + weeklyHabit.need + ' · 身体记录 ' + bodyCount + ' 条' };
      if (goal.linkModule === 'sleepPlan' || /睡眠|早睡|作息/.test(text)) return { icon: '😴', text: sleepActual !== null ? '昨晚实际睡眠 ' + sleepActual + ' 小时' : '今日睡眠目标 ' + getSleepTargetText(getTodayStr()) };
      return { icon: '📈', text: '今日成长评分 ' + getGrowthScore(getTodayStr()) };
    }

    function renderDailyTips() {
      const el = document.getElementById('dailyTips');
      if (!el) return;
      const tips = [];
      const todayStr = getTodayStr();
      let pendingHabits = 0;
      for (const mod of Object.values(data.modules)) {
        if (!mod || !Array.isArray(mod.habits)) continue;
        for (const h of mod.habits) {
          if (h.type === 'daily' && !h.records.includes(todayStr)) pendingHabits++;
          if (h.type === 'period' && isPeriodDay(h, todayStr) && !h.records.includes(todayStr)) pendingHabits++;
          if (h.type === 'cycle' && isCycleCheckable(h, getCycleState(h, todayStr)) && !h.records.includes(todayStr)) pendingHabits++;
        }
      }
      const suppItems = (data.modules.supplements && data.modules.supplements.items) || [];
      const pendingSupps = suppItems.filter(i => shouldTakeSupplement(i, todayStr) && !isSupplementTakenOn(i, todayStr));
      const sleepSteps = getSleepStepsForDate(todayStr);
      const sleepDone = getSleepPlan().records[todayStr] || [];
      const pendingSleep = sleepSteps.filter(s => sleepDone.indexOf(s.id) === -1);
      const readingToday = getReadingRecords().some(r => r.date === todayStr);
      const finance = getFinanceStats();
      if (isBackupReminderDue()) tips.push({ text: '超过 7 天未导出备份，建议尽快备份', cls: 'warn' });
      if (pendingHabits) tips.push({ text: '还有 ' + pendingHabits + ' 个打卡未完成', cls: 'warn' });
      const planItems = getTomorrowPlans();
      const pendingPlans = planItems.filter(p => p.targetDate <= todayStr && !p.doneDate);
      const futurePlans = planItems.filter(p => p.targetDate > todayStr && !p.doneDate);
      if (pendingPlans.length) {
        const names = pendingPlans.slice(0, 2).map(p => p.text).join('、');
        tips.push({ text: '昨天写的待办还没记录：' + names + (pendingPlans.length > 2 ? ' 等' + pendingPlans.length + '项' : ''), cls: 'warn' });
      } else if (futurePlans.length) {
        tips.push({ text: '明天有 ' + futurePlans.length + ' 件事，已提前写好', cls: '' });
      }
      if (pendingSupps.length) tips.push({ text: '还有 ' + pendingSupps.length + ' 种补剂未服用', cls: 'warn' });
      if (pendingSleep.length) tips.push({ text: '睡眠流程还有 ' + pendingSleep.length + ' 项未完成', cls: 'warn' });
      if (!readingToday) tips.push({ text: '今天还没有看书', cls: '' });
      if (finance.budget > 0 && finance.monthSpent > finance.budget) tips.push({ text: '本月预算已超支', cls: 'danger' });
      if (!tips.length) tips.push({ text: '今日目标已全部完成', cls: 'good' });
      // t.text 里包含用户填写的"明日待办"文本，必须转义后再拼进 innerHTML
      // （其它待办渲染路径 renderTomorrowPlanHtml 已经转义，这里以前漏了）
      el.innerHTML = tips.map(t => `<span class="tip-chip ${escapeHtml(t.cls)}">${escapeHtml(t.text)}</span>`).join('');
    }

    function celebrateIfComplete() {
      const celebratedKey = LS_KEY + '_celebrated';
      if (localStorage.getItem(celebratedKey) === getTodayStr()) return;
      const s = getTodayCompletion();
      if (!s.totalNeed || s.totalDone < s.totalNeed) return;
      localStorage.setItem(celebratedKey, getTodayStr());
      const w = window.innerWidth || document.documentElement.clientWidth || 0;
      spawnConfetti(w / 2, 130);
      showAchievementToast('今日全部完成，你真的很棒');
    }

    function updateTotalStats() {
      const stats = getTodayCompletion();
      const totalHabits = stats.totalHabits;
      const totalNeed = stats.totalNeed;
      const totalDone = stats.totalDone;
      document.getElementById('sTotal').textContent = totalHabits;
      document.getElementById('sDone').textContent = totalDone;
      const rate = totalNeed ? Math.round(totalDone / totalNeed * 100) : 0;
      document.getElementById('sRate').textContent = rate + '%';
      updateDailyHero();
      refreshWorkbench();
    }

    function showCalendar(moduleId, id) {
      const h = data.modules[moduleId].habits.find(x => x.id === id);
      if (!h) return;
      document.getElementById('modalTitle').textContent = h.icon + ' ' + h.name + ' — 本月记录';
      const set = new Set(h.records);
      const now = new Date();
      const y = now.getFullYear(), m = now.getMonth();
      const firstDay = new Date(y, m, 1).getDay();
      const daysInMonth = new Date(y, m+1, 0).getDate();

      let html = '<div class="cal-head">日</div><div class="cal-head">一</div><div class="cal-head">二</div><div class="cal-head">三</div><div class="cal-head">四</div><div class="cal-head">五</div><div class="cal-head">六</div>';
      for (let i = 0; i < firstDay; i++) html += '<div></div>';
      for (let d = 1; d <= daysInMonth; d++) {
        const ds = y + '-' + String(m+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
        const isToday = ds === today;
        const ok = set.has(ds);
        html += `<div class="cal-day ${ok ? 'ok' : ''} ${isToday ? 'today' : ''}">${d}</div>`;
      }
      document.getElementById('calendar').innerHTML = html;
      document.getElementById('overlay').classList.add('show');
    }

    function showCycleCalendar(moduleId, id) {
      const h = data.modules[moduleId].habits.find(x => x.id === id);
      if (!h || h.type !== 'cycle') return;
      document.getElementById('modalTitle').textContent = h.icon + ' ' + h.name + ' — 本月状态';
      const now = new Date();
      const y = now.getFullYear(), m = now.getMonth();
      const firstDay = new Date(y, m, 1).getDay();
      const daysInMonth = new Date(y, m+1, 0).getDate();

      let html = '<div class="cal-head">日</div><div class="cal-head">一</div><div class="cal-head">二</div><div class="cal-head">三</div><div class="cal-head">四</div><div class="cal-head">五</div><div class="cal-head">六</div>';
      for (let i = 0; i < firstDay; i++) html += '<div></div>';
      for (let d = 1; d <= daysInMonth; d++) {
        const ds = y + '-' + String(m+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
        const isToday = ds === today;
        const state = getCycleState(h, ds);
        const cls = getCycleStateClass(state);
        const checked = h.records.includes(ds);
        html += `<div class="cal-day cycle-${cls} ${checked ? 'ok' : ''} ${isToday ? 'today' : ''}">${d}</div>`;
      }
      document.getElementById('calendar').innerHTML = html;
      document.getElementById('overlay').classList.add('show');
    }

    function closeModal(e) {
      if (e && e.target !== document.getElementById('overlay')) return;
      document.getElementById('overlay').classList.remove('show');
    }

    // ========== 无障碍：全局键盘支持 ==========
    const OVERLAY_IDS = [
      'overlay', 'noteOverlay', 'fuelOverlay', 'makeupOverlay', 'targetOverlay',
      'txOverlay', 'backupOverlay', 'editOverlay', 'weeklyOverlay', 'statsOverlay',
      'calendarOverlay', 'manifestRecordOverlay', 'diagOverlay', 'bodyOverlay',
      'readingOverlay', 'suppDetailOverlay', 'reminderOverlay', 'pinOverlay',
      'navMoreOverlay', 'headerMenuOverlay', 'personalizeOverlay',
      'achievementsOverlay', 'lockOverlay'
    ];

    function getVisibleOverlay() {
      for (const id of OVERLAY_IDS) {
        const el = document.getElementById(id);
        if (el && el.classList.contains('show')) return { id, el };
      }
      return null;
    }

    function closeOverlayById(id) {
      switch (id) {
        case 'overlay': closeModal(); break;
        case 'noteOverlay': closeNoteModal(); break;
        case 'fuelOverlay': closeFuelModal(); break;
        case 'makeupOverlay': closeMakeupModal(); break;
        case 'targetOverlay': closeTargetModal(); break;
        case 'txOverlay': closeTxModal(); break;
        case 'backupOverlay': closeBackupModal(); break;
        case 'editOverlay': closeEditModal(); break;
        case 'weeklyOverlay': closeWeeklyReport(); break;
        case 'statsOverlay': closeStatsModal(); break;
        case 'calendarOverlay': closeCalendarOverviewModal(); break;
        case 'manifestRecordOverlay': closeManifestRecordModal(); break;
        case 'diagOverlay': document.getElementById('diagOverlay').classList.remove('show'); break;
        case 'bodyOverlay': closeBodyModal(); break;
        case 'readingOverlay': closeReadingModal(); break;
        case 'suppDetailOverlay': closeSuppDetail(); break;
        case 'reminderOverlay': closeReminderModal(); break;
        case 'pinOverlay': closePinModal(); break;
        case 'navMoreOverlay': closeNavMore(); break;
        case 'headerMenuOverlay': closeHeaderMenu(); break;
        case 'personalizeOverlay': closePersonalizeModal(); break;
        case 'achievementsOverlay': closeAchievementsModal(); break;
        case 'lockOverlay': closeLockModal(); break;
        default: {
          const el = document.getElementById(id);
          if (el) el.classList.remove('show');
        }
      }
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const visible = getVisibleOverlay();
        if (visible) {
          e.preventDefault();
          closeOverlayById(visible.id);
        }
      }
      // 锁屏输入框按 Enter 解锁
      if (e.key === 'Enter' && document.activeElement && document.activeElement.id === 'lockPinInput') {
        e.preventDefault();
        unlockApp();
      }
      // 快速导航：Ctrl/Cmd + 数字键切换模块
      if ((e.ctrlKey || e.metaKey) && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const idx = parseInt(e.key, 10) - 1;
        const keys = Object.keys(MODULE_ORDER);
        if (keys[idx]) switchModule(keys[idx]);
      }
    });