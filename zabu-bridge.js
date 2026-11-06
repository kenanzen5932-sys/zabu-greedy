/*!
 * Zabu Greedy — Native köprüsü (Flutter WebView ⇄ Cocos oyunu)
 *
 * Güvenlik:
 *  - Bu sayfa HİÇBİR token / gizli anahtar tutmaz. Bahisleri Flutter kendi
 *    oturumuyla sunucuya gönderir; sonuçları sunucu belirler.
 *  - Oyundan Flutter'a sadece izin verilen action'lar iletilir.
 *  - Eski sağlayıcının hata/olay raporlama sunucusu kapalıdır (getAppRequestHost → null).
 *
 * Akış:
 *  Flutter → window.__zabuInit(user)       : kullanıcı bilgisini verir, oyunu başlatır
 *  Flutter → window.__zabuEmit(event, p)   : RTM olayı (greedy_baby_init/state/bet/diamond_sync)
 *  Flutter → window.__zabuVisibility(bool) : popup görünür/gizli (ses + render durur)
 *  Oyun    → ZabuBridge.postMessage(json)  : {type:'rtm'|'close'|'recharge'|'loaded'|'displayed'}
 */
(function () {
  'use strict';

  var GAME_ID = 22;
  var ALLOWED_ACTIONS = ['GreedyBaby:init', 'GreedyBaby:join', 'GreedyBaby:bet', 'GreedyBaby:charge'];

  var user = null;
  var booted = false;
  var bootQueue = [];

  function post(msg) {
    try {
      if (window.ZabuBridge && typeof window.ZabuBridge.postMessage === 'function') {
        window.ZabuBridge.postMessage(JSON.stringify(msg));
      }
    } catch (e) { /* yok say */ }
  }

  function userJson() {
    if (!user) return '{}';
    return JSON.stringify({
      userId: user.userId,
      funId: user.userId,
      userName: user.name,
      nickName: user.name,
      avatar: user.avatar || '',
      token: 'zabu',            // gerçek token DEĞİL; oyun sadece boş olmamasını bekliyor
      coin: user.coin || 0,
      gold: user.coin || 0,
      roomId: String(user.roomId || ''),
      uiLang: user.lang || 'tr',
      appVersion: '1.0.0',
      packageName: 'com.zabuchat.app'
    });
  }

  function safeStorageGet(k) {
    try { return window.localStorage.getItem('zabu_' + k) || ''; } catch (e) { return ''; }
  }
  function safeStorageSet(raw) {
    try {
      var o = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (o && o.key) window.localStorage.setItem('zabu_' + o.key, String(o.value == null ? '' : o.value));
    } catch (e) { /* yok say */ }
  }

  var noop = function () { return ''; };
  var close = function () { post({ type: 'close' }); return ''; };
  var recharge = function () { post({ type: 'recharge' }); return ''; };

  // Oyunun SDK'sı senkron cevapları {"params": "<json>"} zarfında bekler
  // (zarfsız gelirse kullanıcı bilgisini undefined görüp açılışta takılıyor).
  function wrap(v) {
    return JSON.stringify({ params: typeof v === 'string' ? v : JSON.stringify(v) });
  }
  function wrapped(fn) { return function (p) { return wrap(fn(p)); }; }

  var api = {
    getUserInfo: userJson,
    getUserInfoNew: userJson,
    GetUserInfo: userJson,
    getUserCoin: function () { return user ? user.coin : 0; },
    getRoomId: function () { return user ? String(user.roomId || '') : ''; },
    getToken: function () { return 'zabu'; },
    getFunId: function () { return user ? user.userId : ''; },
    getAppVersionCode: function () { return '10000'; },
    isNativeAsset: function () { return false; },
    getAppPerformance: function () { return JSON.stringify({ memory: (user && user.memory) || 4096 }); },
    getDeviceMemory: function () { return (user && user.memory) || 4096; },
    getAppRequestHost: function () { return null; },      // eski firmaya rapor YOK
    getAppRequestHostNew: function () { return null; },
    getMicAndSoundState: function () { return JSON.stringify({ mic: false, sound: true }); },
    getWebLocalData: safeStorageGet,
    setNewWebLocalData: function (raw) { safeStorageSet(raw); return ''; },
    closePage: close,
    closePageNew: close,
    closeLoadingPage: function () { post({ type: 'loaded' }); return ''; },
    closeLoadingPageNew: function () { post({ type: 'loaded' }); return ''; },
    popUpBottomRecharge: recharge,
    showRechargeDialog: recharge,
    requestMsg: function (raw) {
      var req = raw;
      if (typeof raw === 'string') {
        try { req = JSON.parse(raw); } catch (e) { return ''; }
      }
      if (!req || typeof req.action !== 'string') return '';
      if (ALLOWED_ACTIONS.indexOf(req.action) < 0) return '';
      if (req.action === 'GreedyBaby:charge') { recharge(); return ''; }
      post({ type: 'rtm', action: req.action, params: req.params || {} });
      return '';
    },
    h5ToNative: function (raw) {
      try {
        var o = JSON.parse(raw);
        if (!o) return '';
        if (o.actionName === 'closePage') close();
        else if (o.actionName === 'event_h5game_displayed') post({ type: 'displayed' });
        else if (o.actionName === 'popUpBottomRecharge' || o.actionName === 'showRechargeDialog') recharge();
      } catch (e) { /* yok say */ }
      return '';
    }
  };

  // Değer döndüren getter'ları zarfla (eylem metotları hariç)
  ['getUserInfo', 'getUserInfoNew', 'GetUserInfo', 'getUserCoin', 'getRoomId', 'getToken', 'getFunId',
   'getAppVersionCode', 'isNativeAsset', 'getAppPerformance', 'getDeviceMemory', 'getMicAndSoundState',
   'getWebLocalData'].forEach(function (k) { api[k] = wrapped(api[k]); });

  // Oyunun çağırabileceği bilinmeyen metotlar hata fırlatmasın
  window.fun = typeof Proxy === 'function'
    ? new Proxy(api, { get: function (t, k) { return k in t ? t[k] : noop; } })
    : api;

  // iOS / Android dışı yol: oyunun HTML'i getter'ları window.prompt(method) ile çağırıyor.
  // Sadece bilinen metotlar cevaplanır; gerçek bir prompt diyaloğu asla açılmaz.
  window.prompt = function (method, param) {
    if (typeof method !== 'string') return null;
    if (method === 'h5ToNative') return api.h5ToNative(param);
    if (Object.prototype.hasOwnProperty.call(api, method)) {
      try { return api[method](param); } catch (e) { return null; }
    }
    return null;
  };

  // ── Flutter → Oyun ────────────────────────────────────────────────────
  window.__zabuEmit = function (event, params) {
    if (typeof window.RTMResponseMsg !== 'function') return;
    try {
      window.RTMResponseMsg(JSON.stringify({ gameId: GAME_ID, events: [{ event: event, params: params || {} }] }));
    } catch (e) { /* yok say */ }
  };

  window.__zabuSetCoin = function (coin) {
    if (user) user.coin = coin;
  };

  window.__zabuVisibility = function (visible) {
    try {
      var cc = window.cc;
      if (!cc || !cc.game) return;
      if (visible) {
        if (cc.game.isPaused && cc.game.isPaused()) cc.game.resume();
        if (cc.Game && cc.Game.EVENT_SHOW) cc.game.emit(cc.Game.EVENT_SHOW);
      } else {
        if (cc.Game && cc.Game.EVENT_HIDE) cc.game.emit(cc.Game.EVENT_HIDE);
        cc.game.pause();
      }
    } catch (e) { /* yok say */ }
  };

  // ── Boot kilidi: kullanıcı bilgisi gelmeden Cocos yüklenmez ─────────────
  window.__zabuBoot = function (fn) {
    if (booted) { fn(); } else { bootQueue.push(fn); }
  };

  window.__zabuInit = function (u) {
    if (!u || !u.userId) return;
    user = u;
    if (booted) return;
    booted = true;
    var q = bootQueue.splice(0);
    for (var i = 0; i < q.length; i++) { try { q[i](); } catch (e) { console.error(e); } }
  };

  // Tarayıcıda tek başına açılırsa (Flutter yok) bilgi ver
  setTimeout(function () {
    if (!booted && !window.ZabuBridge) {
      document.body && (document.body.style.background = '#111');
      console.warn('[ZabuBridge] Flutter köprüsü yok — oyun yalnızca Zabu uygulaması içinde çalışır.');
    }
  }, 3000);
})();
