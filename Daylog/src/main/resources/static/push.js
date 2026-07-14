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

    // [B] edit by smsong - 전체 알림 on/off 토글 스위치
    var _pushOn = false;
    function applyPushSwitch() {
        var btn = document.getElementById('btn-enable-push');
        if (!btn) return;
        btn.classList.toggle('on', !!_pushOn);
        btn.setAttribute('aria-pressed', _pushOn ? 'true' : 'false');
    }
    function refreshPushState() {
        if (!supported() || Notification.permission !== 'granted') { _pushOn = false; applyPushSwitch(); return Promise.resolve(false); }
        return (swReg ? Promise.resolve(swReg) : navigator.serviceWorker.getRegistration())
            .then(function (reg) { return reg ? reg.pushManager.getSubscription() : null; })
            .then(function (sub) { _pushOn = !!sub; applyPushSwitch(); return _pushOn; })
            .catch(function () { _pushOn = false; applyPushSwitch(); return false; });
    }
    function disablePush() {
        return (swReg ? Promise.resolve(swReg) : navigator.serviceWorker.getRegistration())
            .then(function (reg) { return reg ? reg.pushManager.getSubscription() : null; })
            .then(function (sub) {
                if (!sub) return false;
                var endpoint = sub.endpoint;
                return sub.unsubscribe().then(function () {
                    try {
                        fetch(API + '/api/push/unsubscribe', { method: 'POST', headers: authHeaders(true), body: JSON.stringify({ endpoint: endpoint }) }).catch(function () {});
                    } catch (e) {}
                    return true;
                });
            })
            .then(function () { _pushOn = false; applyPushSwitch(); toast('알림을 껐어요'); return true; })
            .catch(function () { return false; });
    }
    function togglePush() {
        if (_pushOn) { disablePush(); return; }
        enablePush().then(function (ok) { _pushOn = !!ok; applyPushSwitch(); });
    }

    // ===== 로그인 후 최초 1회: 알림 동의 안내 모달 (A안) =====
    var CONSENT_KEY = 'daylog_perm_prompt_seen';

    function anyModalOpen() {
        return !!document.querySelector('.modal:not(.hidden), .room-modal:not(.hidden), #nickname-modal:not(.hidden)');
    }

    function injectConsentStyle() {
        if (document.getElementById('pc-style')) return;
        var css =
            '#pc-overlay{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(45,38,32,0.5);animation:pcFade .2s ease;}' +
            '#pc-overlay .pc-card{width:100%;max-width:360px;background:#fffdf9;border-radius:20px;padding:26px 22px 20px;box-shadow:0 18px 50px rgba(0,0,0,0.25);text-align:center;font-family:inherit;animation:pcPop .32s cubic-bezier(.2,.8,.3,1);}' +
            '#pc-overlay .pc-ic{width:56px;height:56px;border-radius:16px;margin:0 auto 14px;display:flex;align-items:center;justify-content:center;background:#f3e9dd;color:#9c6644;}' +
            '#pc-overlay .pc-title{font-size:1.18rem;font-weight:700;color:#3a3128;margin:0 0 8px;}' +
            '#pc-overlay .pc-desc{font-size:0.9rem;line-height:1.5;color:#7a6f63;margin:0 0 16px;}' +
            '#pc-overlay .pc-list{list-style:none;padding:0;margin:0 0 20px;text-align:left;display:flex;flex-direction:column;gap:10px;}' +
            '#pc-overlay .pc-list li{display:flex;align-items:center;gap:10px;font-size:0.9rem;color:#4a4038;background:#f7f1e8;border-radius:12px;padding:11px 13px;}' +
            '#pc-overlay .pc-list svg{flex-shrink:0;color:#b08968;}' +
            '#pc-overlay .pc-btn{width:100%;border:none;border-radius:13px;padding:14px;font-size:0.98rem;font-weight:700;font-family:inherit;cursor:pointer;transition:filter .15s,transform .1s;}' +
            '#pc-overlay .pc-btn:active{transform:scale(.98);}' +
            '#pc-overlay .pc-btn.primary{background:#b08968;color:#fff;margin-bottom:8px;}' +
            '#pc-overlay .pc-btn.primary:hover{filter:brightness(.96);}' +
            '#pc-overlay .pc-btn.ghost{background:transparent;color:#9a8f82;}' +
            '@keyframes pcFade{from{opacity:0}to{opacity:1}}' +
            '@keyframes pcPop{from{opacity:0;transform:translateY(12px) scale(.96)}to{opacity:1;transform:none}}';
        var st = document.createElement('style');
        st.id = 'pc-style';
        st.textContent = css;
        document.head.appendChild(st);
    }

    function closeConsent() {
        var ov = document.getElementById('pc-overlay');
        if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    }

    function showConsentModal() {
        injectConsentStyle();
        var bell = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
        var bellBig = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
        var ov = document.createElement('div');
        ov.id = 'pc-overlay';
        ov.innerHTML =
            '<div class="pc-card" role="dialog" aria-modal="true">' +
                '<div class="pc-ic">' + bellBig + '</div>' +
                '<h3 class="pc-title">알림을 켜볼까요?</h3>' +
                '<p class="pc-desc">새 소식을 놓치지 않고 바로 받아보세요.</p>' +
                '<ul class="pc-list">' +
                    '<li>' + bell + ' 새 댓글·답글, 방 입장 요청/수락 알림</li>' +
                '</ul>' +
                '<button id="pc-allow" class="pc-btn primary" type="button">허용하기</button>' +
                '<button id="pc-later" class="pc-btn ghost" type="button">다음에</button>' +
            '</div>';
        document.body.appendChild(ov);

        try { localStorage.setItem(CONSENT_KEY, '1'); } catch (e) {} // 노출 시점에 1회 기록

        document.getElementById('pc-later').addEventListener('click', closeConsent);
        document.getElementById('pc-allow').addEventListener('click', function () {
            var btn = this; btn.disabled = true; btn.textContent = '설정 중…';
            // iOS 정책: 알림 권한요청은 이 클릭(제스처) 안에서 실행
            enablePush().then(function () { closeConsent(); })
                        .catch(function () { closeConsent(); });
        });
    }

    function maybeShowConsent() {
        try {
            if (!localStorage.getItem('accessToken')) return;          // 로그인 상태만
            if (localStorage.getItem(CONSENT_KEY)) return;             // 이미 1회 노출
            // 이미 알림을 허용한 사용자에겐 안내하지 않음
            if (('Notification' in window) && Notification.permission === 'granted') return;
            // 알림이 차단(denied)된 경우: 버튼으로 다시 못 켜므로 굳이 안 띄움
            if (('Notification' in window) && Notification.permission === 'denied') return;
        } catch (e) { return; }

        // 다른 모달(닉네임/환영 등)이 떠 있으면 이번엔 양보하고 다음 기회에
        var tries = 0;
        (function waitClear() {
            if (!anyModalOpen()) { showConsentModal(); return; }
            if (tries++ > 8) return; // 약 4초간 대기 후 포기(다음 진입 때 재시도 위해 flag 미기록)
            setTimeout(waitClear, 500);
        })();
    }

    function autoInit() {
        registerSW();
        try {
            if (supported() && Notification.permission === 'granted' && localStorage.getItem('accessToken')) {
                subscribe().then(function () { refreshPushState(); });
            }
        } catch (e) {}
        var btn = document.getElementById('btn-enable-push');
        if (btn) btn.addEventListener('click', togglePush); // [B] edit by smsong - on/off 토글
        refreshPushState(); // [B] 현재 구독 상태로 스위치 표시

        // [A안] 로그인 후 최초 1회 알림 동의 안내 (약간의 지연 후, 다른 모달과 겹치지 않게)
        setTimeout(maybeShowConsent, 1200);
    }

    window.Daylog = window.Daylog || {};
    window.Daylog.enablePush = enablePush;

    if (document.readyState === 'complete' || document.readyState === 'interactive') autoInit();
    else document.addEventListener('DOMContentLoaded', autoInit);
})();
