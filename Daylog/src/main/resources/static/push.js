// [B] edit by smsong - 웹푸시 구독 스크립트 (main.html / rooms.html 공용)
//  · 서비스워커(sw.js) 등록 + VAPID 공개키로 구독 → 백엔드에 저장
//  · '알림 켜기' 버튼(#btn-enable-push) 클릭(사용자 제스처)에서 권한 요청 (iOS 필수)
//  · 이미 권한 허용 + 로그인 상태면 자동 재구독(프롬프트 없음)
(function () {
    var API = (window.APP_CONFIG && window.APP_CONFIG.BACKEND_BASE) || '';

    function authHeaders(json) {
        var h = {};
        var t = localStorage.getItem('accessToken');
        if (t) h['Authorization'] = 'Bearer ' + t;
        if (json) h['Content-Type'] = 'application/json';
        return h;
    }

    function urlB64ToUint8Array(base64String) {
        var padding = '='.repeat((4 - base64String.length % 4) % 4);
        var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        var raw = atob(base64);
        var arr = new Uint8Array(raw.length);
        for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
        return arr;
    }

    function toast(msg) {
        if (typeof window.showToast === 'function') { window.showToast(msg); return; }
        var t = document.getElementById('toast');
        if (t) { t.textContent = msg; t.classList.add('show'); setTimeout(function () { t.classList.remove('show'); }, 2500); }
    }

    function supported() {
        return ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window);
    }

    var swReg = null;
    function registerSW() {
        if (!('serviceWorker' in navigator)) return Promise.resolve(null);
        return navigator.serviceWorker.register('sw.js').then(function (reg) { swReg = reg; return reg; })
            .catch(function (e) { console.warn('SW 등록 실패', e); return null; });
    }

    function getPublicKey() {
        return fetch(API + '/api/push/public-key', { headers: authHeaders() })
            .then(function (r) { return r.json(); })
            .then(function (d) { return d && d.publicKey; });
    }

    function subscribe() {
        if (!supported()) return Promise.resolve(false);
        return (swReg ? Promise.resolve(swReg) : navigator.serviceWorker.ready).then(function (reg) {
            if (!reg) return false;
            return getPublicKey().then(function (key) {
                if (!key) { console.warn('VAPID 공개키 없음(백엔드 설정 필요)'); return false; }
                return reg.pushManager.getSubscription().then(function (existing) {
                    if (existing) return existing;
                    return reg.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey: urlB64ToUint8Array(key)
                    });
                }).then(function (sub) {
                    var json = sub.toJSON();
                    return fetch(API + '/api/push/subscribe', {
                        method: 'POST',
                        headers: authHeaders(true),
                        body: JSON.stringify({ endpoint: sub.endpoint, keys: json.keys })
                    }).then(function () { return true; });
                });
            });
        }).catch(function (e) { console.warn('구독 실패', e); return false; });
    }

    // 사용자 제스처에서 호출: 권한 요청 + 구독
    function enablePush() {
        if (!supported()) { toast('이 브라우저는 알림을 지원하지 않아요'); return Promise.resolve(false); }
        if (Notification.permission === 'denied') { toast('알림이 차단되어 있어요. 브라우저 설정에서 허용해주세요.'); return Promise.resolve(false); }
        var permReq = (Notification.permission === 'granted')
            ? Promise.resolve('granted')
            : Notification.requestPermission();
        return Promise.resolve(permReq).then(function (perm) {
            if (perm !== 'granted') { toast('알림 권한이 필요해요'); return false; }
            return registerSW().then(subscribe).then(function (ok) {
                toast(ok ? '알림이 켜졌어요' : '알림 설정에 실패했어요');
                return ok;
            });
        });
    }

    function autoInit() {
        registerSW();
        try {
            if (supported() && Notification.permission === 'granted' && localStorage.getItem('accessToken')) {
                subscribe();
            }
        } catch (e) {}
        var btn = document.getElementById('btn-enable-push');
        if (btn) btn.addEventListener('click', enablePush);
    }

    window.Daylog = window.Daylog || {};
    window.Daylog.enablePush = enablePush;

    if (document.readyState === 'complete' || document.readyState === 'interactive') autoInit();
    else document.addEventListener('DOMContentLoaded', autoInit);
})();
