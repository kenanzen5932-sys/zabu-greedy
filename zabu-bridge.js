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
 *  Oyun    → ZabuBridge.postMessage(json)  : {type:'rtm'|'close'|'recharge'|'loaded'|'displayed'|'records'}
 *  Flutter → window.__zabuRecords(id, res) : oyun kayıtları cevabı
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
    event_h5game_displayed: function () { post({ type: 'displayed' }); return ''; },
    event_webview_success: function () { post({ type: 'loaded' }); return ''; },
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

  // ── Oyun içi HTTP istekleri (kayıtlar / sıralama / profil) ──────────────
  // Oyun bunları eski sağlayıcının sunucusuna XHR ile atıyordu → sonsuz
  // "yükleniyor". Burada yakalanır: kayıtlar Flutter'dan (kendi oturumuyla)
  // gelir, diğerleri ağa hiç çıkmadan boş cevaplanır.
  var HTTP_RE = /\/greedy-baby-rank\/|\/game\/operation\//;
  var httpSeq = 0;
  var httpPending = {};

  function fakeRespond(xhr, obj) {
    try {
      var body = xhr.responseType === 'json' ? obj : JSON.stringify(obj);
      Object.defineProperty(xhr, 'readyState', { value: 4, configurable: true });
      Object.defineProperty(xhr, 'status', { value: 200, configurable: true });
      Object.defineProperty(xhr, 'response', { value: body, configurable: true });
      if (xhr.responseType !== 'json') {
        Object.defineProperty(xhr, 'responseText', { value: body, configurable: true });
      }
    } catch (e) { /* yok say */ }
    setTimeout(function () {
      try { if (typeof xhr.onreadystatechange === 'function') xhr.onreadystatechange(); } catch (e) { /* */ }
      try { if (typeof xhr.onload === 'function') xhr.onload(); } catch (e) { /* */ }
    }, 0);
  }

  // Tur no: sunucudaki mutlak no (epoch/25) yerine günün kaçıncı turu
  // (İstanbul saatiyle 00:00'da 1'den başlar; günde 3456 tur)
  function dailyRound(id) {
    var n = Number(id);
    if (!isFinite(n)) return id;
    return Math.floor(((n * 25 + 10800) % 86400) / 25) + 1;
  }

  function mapRecords(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i] || {};
      var betMap = {};
      var bets = r.bets || [];
      for (var j = 0; j < bets.length; j++) {
        var b = bets[j] || {};
        var k = String(b.food_id);
        betMap[k] = (betMap[k] || 0) + (Number(b.amount) || 0);
      }
      out.push({
        roundId: dailyRound(r.round_id),
        settleTime: Date.parse(r.time) || Date.now(),
        foodId: r.result_food,
        win: Number(r.win) || 0,
        bet: Number(r.bet) || 0,
        betMap: betMap
      });
    }
    return out;
  }

  function handleFakeHttp(xhr, url) {
    var q = {};
    try { new URL(url, location.href).searchParams.forEach(function (v, k) { q[k] = v; }); } catch (e) { /* */ }
    if (url.indexOf('/bet-recored') < 0 || !window.ZabuBridge) {
      fakeRespond(xhr, { code: 404, message: 'disabled' });
      return;
    }
    var page = Math.max(0, parseInt(q.page, 10) || 0);
    var size = Math.min(Math.max(parseInt(q.size, 10) || 10, 1), 20);
    var id = ++httpSeq;
    httpPending[id] = { xhr: xhr, page: page, size: size };
    // Flutter cevap vermezse oyun 2 sn sonra kendisi tekrar dener
    httpPending[id].timer = setTimeout(function () {
      if (httpPending[id]) { delete httpPending[id]; fakeRespond(xhr, { code: 500, message: 'timeout' }); }
    }, 10000);
    post({ type: 'records', id: id, offset: page * size, limit: size + 1 });
  }

  // Flutter → kayıt cevabı: res = {ok, records:[...]}
  window.__zabuRecords = function (id, res) {
    var p = httpPending[id];
    if (!p) return;
    delete httpPending[id];
    clearTimeout(p.timer);
    if (!res || res.ok !== true) { fakeRespond(p.xhr, { code: 500, message: 'error' }); return; }
    var list = res.records || [];
    fakeRespond(p.xhr, {
      code: 200,
      data: { page: p.page, more: list.length > p.size, records: mapRecords(list.slice(0, p.size)) }
    });
  };

  var xOpen = XMLHttpRequest.prototype.open;
  var xSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__zabuUrl = (typeof url === 'string' && HTTP_RE.test(url)) ? url : null;
    return xOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (this.__zabuUrl) { handleFakeHttp(this, this.__zabuUrl); return; }
    return xSend.apply(this, arguments);
  };

  // ── Oyun yamaları (önbellekteki paket dosyalarına dokunmadan) ──────────
  // 1) Parmak: oyun her init'te parmak sayacını sıfırlıyor ama görünen parmağı
  //    gizlemiyordu → kapat/aç sonrası 2-3 parmak. Sıfırlamada 8'ini de gizle.
  // 2) Avatar: yuvarlak avatar materyali, resim sonradan yüklenince çizmiyordu
  //    (kazanan popup'ında isim var avatar yok). Yüklemeden sonra materyali
  //    yeniden ata.
  var patched = { finger: false, avatar: false, record: false, lang: false };
  function tryPatch() {
    var cc = window.cc;
    if (!cc || !cc.js || typeof cc.js.getClassByName !== 'function') return false;

    if (!patched.finger) {
      var GM = cc.js.getClassByName('GameMain');
      if (GM && GM.prototype && typeof GM.prototype.updateItemFingerState === 'function') {
        var origFinger = GM.prototype.updateItemFingerState;
        GM.prototype.updateItemFingerState = function (t) {
          if (t < 0 || this._lastFingerIndex < 0) {
            try {
              var kids = (this._contentTop && this._contentTop.children) || [];
              for (var i = 0; i < kids.length && i < 8; i++) {
                var f = kids[i] && kids[i].getChildByName('finger');
                if (f) f.active = false;
              }
            } catch (e) { /* */ }
            if (t < 0) { this._lastFingerIndex = t; return; }
            this._lastFingerIndex = -1;
          }
          return origFinger.call(this, t);
        };
        patched.finger = true;
      }
    }

    if (!patched.avatar) {
      var SA = cc.js.getClassByName('SpriteAdapter');
      if (SA && SA.prototype && typeof SA.prototype.setSpiteFrame === 'function') {
        var origSet = SA.prototype.setSpiteFrame;
        SA.prototype.setSpiteFrame = function (frame) {
          var r = origSet.apply(this, arguments);
          try {
            var sp = this.sprite;
            if (sp && frame) {
              var mat = this.__zabuMat || sp.customMaterial;
              if (mat) {
                this.__zabuMat = mat;
                if (String(this._url || '').indexOf('data:') === 0) {
                  // Flutter'dan gelen hazır yuvarlak avatar: shader'a gerek yok
                  sp.customMaterial = null;
                } else {
                  sp.customMaterial = null; sp.customMaterial = mat;
                }
              }
            }
          } catch (e) { /* */ }
          return r;
        };
        patched.avatar = true;
      }
    }
    // 3) Kayıt satırı: "Altın Bakiyesi" verisi yok → boş "->" yerine satırı gizle
    if (!patched.record) {
      var RI = cc.js.getClassByName('RecordItem');
      if (RI && RI.prototype && typeof RI.prototype.updateView === 'function') {
        var origView = RI.prototype.updateView;
        RI.prototype.updateView = function (t) {
          var r = origView.apply(this, arguments);
          try {
            if (t && typeof t.assetNum !== 'number' && this._foodLayout && this._foodLayout.node) {
              var row = this._foodLayout.node.getChildByName('item_last_coin');
              if (row && row.active) { row.active = false; this._foodLayout.updateLayout(true); }
            }
          } catch (e) { /* */ }
          return r;
        };
        patched.record = true;
      }
    }

    // 4) Türkçe çeviri düzeltmeleri ("Round" → "Yuvarlak" vb.)
    if (!patched.lang) {
      var langs = window.languages;
      if (langs) {
        for (var key in langs) {
          var L = langs[key];
          if (L && L.Round === 'Yuvarlak') {
            L.Round = 'Tur';
            L.Bet = 'Bahis';
            L['Win coins'] = 'Kazanılan';
            L['Winning friuts'] = 'Kazanan yiyecek';
            L.record_tips_1 = 'Son 7 günün en fazla 200 oyun kaydı gösterilir.';
            L.record_tips_2 = 'Son 7 günün en fazla 200 oyun kaydı gösterilir.';
            L.today_win = 'Bugünkü kazanç';
            L.rule_2 = 'Her turda yiyecek seçmek için 15 saniyeniz var, ardından kazanan yiyecek çekilir.';
            patched.lang = true;
          }
        }
      }
    }
    return patched.finger && patched.avatar && patched.record && patched.lang;
  }
  // ── Ekran uyumu ────────────────────────────────────────────────────────
  // Tasarım 750×1334 ve FIXED_WIDTH: alan bu orandan kısaysa (kısa telefon,
  // tablet) üst bar kesiliyordu. Kısa alanda SHOW_ALL → oyunun tamamı görünür,
  // yanlar şeffaf kalır. Uzun alanda FIXED_WIDTH (tam genişlik) kalır.
  var lastPolicy = null;
  function fitScreen() {
    var cc = window.cc;
    if (!cc || !cc.view || !cc.ResolutionPolicy || !cc.game || !cc.game.inited) return false;
    var w = window.innerWidth || 1, h = window.innerHeight || 1;
    // Uzun alan: NO_BORDER → oyun alanı tamamen kaplar (üstte ince boş/siyah
    // şerit kalmaz; fark birkaç piksel, yanlardan kırpılır). Kısa alan: SHOW_ALL.
    var tall = h / w >= (1334 / 750) - 0.02;
    var pol = tall ? cc.ResolutionPolicy.NO_BORDER : cc.ResolutionPolicy.SHOW_ALL;
    if (pol !== lastPolicy) {
      try { cc.view.setDesignResolutionSize(750, 1334, pol); lastPolicy = pol; } catch (e) { /* */ }
    }
    return true;
  }
  var fitTimer = 0;
  window.addEventListener('resize', function () {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(fitScreen, 120);
  });

  var patchTries = 0;
  var patchTimer = setInterval(function () {
    var fitted = lastPolicy !== null || fitScreen();
    if ((tryPatch() && fitted) || ++patchTries > 600) clearInterval(patchTimer); // en fazla ~2 dk
  }, 200);

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
