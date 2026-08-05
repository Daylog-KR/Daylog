// ==========================================================================
// location-tracker.js  —  [B] edit by smsong
//
//  사용자 위치를 주기적으로 DB(POST /api/locations)에만 적재한다.
//  화면에 표시되는 UI 요소는 전혀 없다. 순수 백그라운드 수집 전용.
//
//   · 네이티브(Capacitor + background-geolocation) 안이면 → 앱이 꺼져도 계속 적재
//   · 순수 웹(브라우저/PWA)이면 → 앱이 열려 있는 동안만 적재 (웹 표준 한계, 자동 폴백)
//
//  ┌───────────────────────────────────────────────────────────────┐
//  │  ★ on / off 는 화면이 아니라 "이 소스"에서 직접 바꾼다           │
//  │       var ENABLED = true;   // true = 수집, false = 완전 중지    │
//  │     값을 바꿔 재배포(파일 ?v= 올림)하면 반영된다.               │
//  └───────────────────────────────────────────────────────────────┘
//
//  · 로그인(accessToken) 상태에서만 전송. 서버가 9분 throttle 하므로 클라도 10분 간격.
//  · 백그라운드 중 토큰이 만료되면 앱과 동일한 /user/refresh 로 재발급 후 재전송.
// ==========================================================================
(function (global) {
    'use strict';

    // ============================ on / off ============================
    var ENABLED = true;   // ← 여기만 바꾼다. false 로 배포하면 수집이 완전히 멈춘다.
    // ==================================================================

    // ---- 설정 -------------------------------------------------------------
    var CFG = global.APP_CONFIG || {};
    var API_BASE = (CFG && CFG.BACKEND_BASE) || 'http://localhost:8086'; // rooms.js 와 동일 계산
    var TOKEN_KEY = 'accessToken';

    var LOCATION_URL = API_BASE + '/api/locations'; // UserLocationController: @RequestMapping("/api/locations") + @PostMapping
    var REFRESH_URL  = API_BASE + '/user/refresh';  // 기기 세션(DB 토큰) 슬라이딩 갱신

    var KEY_WID = 'daylog_loc_watcher_id';  // 네이티브 watcher id (재실행 시 중복 적재 방지, 내부용·비표시)
    var MIN_INTERVAL_MS = 10 * 60 * 1000;   // 전송 최소 간격 (서버 9분 throttle 과 맞춤)
    var DISTANCE_FILTER = 20;               // m — 네이티브: 이만큼 이동해야 콜백

    // ---- 상태 -------------------------------------------------------------
    var lastSentAt = 0;
    var webWatchId = null;
    var nativeHandle = null;
    var refreshing = null;

    // ---- 유틸 -------------------------------------------------------------
    function token() { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }

    // JSR-310 LocalDateTime 파싱용: 'Z'/offset 없이 초까지의 로컬 ISO
    function toLocalISO(ms) {
        var d = new Date(ms || Date.now());
        var p = function (n) { return String(n).padStart(2, '0'); };
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
            + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    }

    // ---- 토큰 갱신 (앱 rooms.js/refreshToken 과 동일 계약) -----------------
    function refreshToken() {
        if (refreshing) return refreshing;
        var cur = token();
        if (!cur) return Promise.resolve(false);
        refreshing = fetch(REFRESH_URL, { method: 'POST', headers: { 'Authorization': 'Bearer ' + cur } })
            .then(function (res) {
                if (!res.ok) return false;
                return res.json().then(function (d) {
                    var nt = d && (d.token || d.accessToken || d.jwt);
                    if (nt) { try { localStorage.setItem(TOKEN_KEY, nt); } catch (e) {} return true; }
                    return false;
                });
            })
            .catch(function () { return false; })
            .then(function (ok) { refreshing = null; return ok; });
        return refreshing;
    }

    // ---- 서버 전송 (401 시 refresh 후 1회 재시도) -------------------------
    function post(body, t, allowRefresh) {
        return fetch(LOCATION_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t },
            body: JSON.stringify(body),   // undefined 필드는 자동 제외
            keepalive: true               // 페이지 종료 직전 전송도 최대한 살림
        }).then(function (res) {
            if ((res.status === 401 || res.status === 403) && allowRefresh) {
                return refreshToken().then(function (ok) {
                    if (!ok) throw new Error('auth');
                    return post(body, token(), false);   // 새 토큰으로 재전송
                });
            }
            if (!res.ok) throw new Error('http ' + res.status);
            return true;
        });
    }

    function send(c, capturedMs, source) {
        if (!ENABLED) return;
        if (!c || c.latitude == null || c.longitude == null) return;
        var now = Date.now();
        if (now - lastSentAt < MIN_INTERVAL_MS) return;   // 클라 throttle
        var t = token();
        if (!t) return;                                    // 로그인 상태에서만
        lastSentAt = now;
        var body = {
            lat: c.latitude,
            lng: c.longitude,
            accuracy: c.accuracy != null ? c.accuracy : undefined,
            altitude: c.altitude != null ? c.altitude : undefined,
            speed: c.speed != null ? c.speed : undefined,
            heading: c.heading != null ? c.heading : undefined,
            capturedAt: toLocalISO(capturedMs),
            source: source || 'web'
        };
        post(body, t, true).catch(function () { lastSentAt = 0; /* 실패 시 다음 기회에 재시도 */ });
    }

    // ---- 네이티브 경로 (Capacitor background-geolocation) ----------------
    function hasNative() {
        return !!(global.Capacitor
            && typeof global.Capacitor.registerPlugin === 'function'
            && global.Capacitor.isNativePlatform
            && global.Capacitor.isNativePlatform());
    }
    function pluginRef() {
        if (nativeHandle) return nativeHandle;
        try { nativeHandle = global.Capacitor.registerPlugin('BackgroundGeolocation'); } catch (e) { nativeHandle = null; }
        return nativeHandle;
    }
    function startNative() {
        var bg = pluginRef();
        if (!bg) return;
        var prev = null; try { prev = localStorage.getItem(KEY_WID); } catch (e) {}
        if (prev) { try { bg.removeWatcher({ id: prev }); } catch (e) {} }   // 중복 watcher 방지
        bg.addWatcher({
            backgroundTitle: 'Daylog',
            backgroundMessage: '위치를 기록하는 중이에요',
            requestPermissions: true,
            stale: false,
            distanceFilter: DISTANCE_FILTER
        }, function (location, error) {
            if (error || !location) return;
            send({
                latitude: location.latitude, longitude: location.longitude,
                accuracy: location.accuracy, altitude: location.altitude,
                speed: location.speed, heading: location.bearing
            }, location.time, 'background');
        }).then(function (id) {
            try { localStorage.setItem(KEY_WID, id); } catch (e) {}
        }).catch(function () {});
    }
    function stopNative() {
        var bg = pluginRef();
        var prev = null; try { prev = localStorage.getItem(KEY_WID); } catch (e) {}
        if (bg && prev) { try { bg.removeWatcher({ id: prev }); } catch (e) {} }
        try { localStorage.removeItem(KEY_WID); } catch (e) {}
    }

    // ---- 웹 폴백 경로 (앱이 열려 있을 때만) ------------------------------
    function once() {
        navigator.geolocation.getCurrentPosition(
            function (p) { send(p.coords, p.timestamp, 'foreground'); },
            function () {},
            { enableHighAccuracy: false, maximumAge: 60000, timeout: 20000 });
    }
    function onVis() {
        if (document.visibilityState === 'visible' && ENABLED && !hasNative()) once();
    }
    function startWeb() {
        if (!('geolocation' in navigator)) return;
        once();
        webWatchId = navigator.geolocation.watchPosition(
            function (p) { send(p.coords, p.timestamp, 'foreground'); },
            function (err) { if (err && err.code === 1) stopWeb(); },   // 권한 거부 → 조용히 중지(표시 없음)
            { enableHighAccuracy: false, maximumAge: 60000, timeout: 20000 });
        document.addEventListener('visibilitychange', onVis, false);
    }
    function stopWeb() {
        if (webWatchId != null) { try { navigator.geolocation.clearWatch(webWatchId); } catch (e) {} webWatchId = null; }
        document.removeEventListener('visibilitychange', onVis, false);
    }

    // ---- 부트 (UI 없음. ENABLED 상수만 따른다) ---------------------------
    function boot() {
        if (ENABLED) {
            if (hasNative()) startNative(); else startWeb();
        } else {
            stopNative();   // 소스에서 false 로 바꿔 배포하면 남아있던 네이티브 watcher 도 정리
        }
    }
    if (document.readyState === 'complete' || document.readyState === 'interactive') boot();
    else document.addEventListener('DOMContentLoaded', boot);
})(window);
// [E] edit by smsong
