// [B] edit by smsong - 알림함(인스타 하트 목록). main.html / rooms.html 공용.
//  상단 하트(#btn-notif) 클릭 → 알림 목록 패널. 항목 클릭 → 관련 페이지로 이동. 배지 = 안읽음 수.
(function () {
    var API = (window.APP_CONFIG && window.APP_CONFIG.BACKEND_BASE) || '';

    function authHeaders(json) {
        var h = {};
        var t = localStorage.getItem('accessToken');
        if (t) h['Authorization'] = 'Bearer ' + t;
        if (json) h['Content-Type'] = 'application/json';
        return h;
    }
    function loggedIn() { return !!localStorage.getItem('accessToken'); }
    // [B] edit by smsong - #1 main.html 은 방별 알림. window.__NOTIF_ROOM_ID__ 있으면 그 방으로 스코프
    function roomScope() {
        var r = (typeof window !== 'undefined') ? window.__NOTIF_ROOM_ID__ : null;
        return (r === undefined || r === null || r === '') ? null : r;
    }
    function scopeQS(prefix) {
        var r = roomScope();
        return r ? (prefix + 'roomId=' + encodeURIComponent(r)) : '';
    }

    function esc(s) {
        return (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function relTime(iso) {
        if (!iso) return '';
        var t = new Date(iso).getTime();
        if (isNaN(t)) return '';
        var diff = Math.floor((Date.now() - t) / 1000);
        if (diff < 60) return '방금';
        if (diff < 3600) return Math.floor(diff / 60) + '분 전';
        if (diff < 86400) return Math.floor(diff / 3600) + '시간 전';
        if (diff < 604800) return Math.floor(diff / 86400) + '일 전';
        var d = new Date(iso);
        return (d.getMonth() + 1) + '.' + d.getDate();
    }

    function injectStyle() {
        if (document.getElementById('ni-style')) return;
        var css =
            '#ni-overlay{position:fixed;inset:0;z-index:9998;background:rgba(45,38,32,0.28);animation:niFade .18s ease;}' +
            '#ni-panel{position:fixed;top:0;right:0;z-index:9999;width:min(420px,100%);height:100%;background:#fffdf9;box-shadow:-8px 0 40px rgba(0,0,0,0.18);display:flex;flex-direction:column;animation:niSlide .26s cubic-bezier(.2,.8,.3,1);}' +
            '#ni-panel .ni-head{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid #efe7db;}' +
            '#ni-panel .ni-head h3{margin:0;font-size:1.08rem;font-weight:700;color:#3a3128;}' +
            '#ni-panel .ni-close{border:none;background:transparent;font-size:1.5rem;line-height:1;color:#9a8f82;cursor:pointer;padding:2px 6px;}' +
            '#ni-list{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;}' +
            '.ni-item{display:flex;gap:11px;align-items:flex-start;padding:13px 16px;border-bottom:1px solid #f4eee4;cursor:pointer;transition:background .12s;}' +
            '.ni-item:hover{background:#faf5ec;}' +
            '.ni-item.unread{background:#f5efe4;}' +
            '.ni-dot{width:8px;height:8px;border-radius:50%;margin-top:6px;flex-shrink:0;background:transparent;}' +
            '.ni-item.unread .ni-dot{background:#c0392b;}' +
            '.ni-body{min-width:0;flex:1;}' +
            '.ni-title{font-size:0.92rem;font-weight:700;color:#3a3128;line-height:1.35;}' +
            '.ni-text{font-size:0.88rem;color:#6f645a;line-height:1.4;margin-top:2px;word-break:break-word;}' +
            '.ni-time{font-size:0.76rem;color:#a99e90;margin-top:4px;}' +
            '.ni-empty{padding:48px 20px;text-align:center;color:#a99e90;font-size:0.92rem;}' +
            '.notif-btn{position:relative;}' +
            '.notif-badge{position:absolute;top:-5px;right:-5px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#e5322d;color:#fff;font-size:0.68rem;font-weight:800;line-height:18px;text-align:center;box-shadow:0 0 0 2px #fff;z-index:3;pointer-events:none;}' +
            '.notif-badge.hidden{display:none;}' +
            '@keyframes niFade{from{opacity:0}to{opacity:1}}' +
            '@keyframes niSlide{from{transform:translateX(100%)}to{transform:none}}';
        var st = document.createElement('style');
        st.id = 'ni-style';
        st.textContent = css;
        document.head.appendChild(st);
    }

    function setBadge(n) {
        var b = document.getElementById('notif-badge');
        if (!b) return;
        if (n && n > 0) { b.textContent = n > 99 ? '99+' : String(n); b.classList.remove('hidden'); }
        else { b.classList.add('hidden'); }
    }

    function refreshBadge() {
        if (!loggedIn()) { setBadge(0); return; }
        fetch(API + '/api/notifications/unread-count' + scopeQS('?'), { headers: authHeaders() })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) { if (d) setBadge(d.count); })
            .catch(function () {});
    }

    function closePanel() {
        var ov = document.getElementById('ni-overlay');
        var pn = document.getElementById('ni-panel');
        if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
        if (pn && pn.parentNode) pn.parentNode.removeChild(pn);
        try { refreshBadge(); } catch (e) {} // [B] edit by smsong - 닫을 때 배지 갱신
    }

    function renderList(items) {
        var list = document.getElementById('ni-list');
        if (!list) return;
        if (!items || !items.length) {
            list.innerHTML = '<div class="ni-empty">아직 알림이 없어요</div>';
            return;
        }
        var html = '';
        items.forEach(function (n) {
            html +=
                '<div class="ni-item' + (n.read ? '' : ' unread') + '" data-url="' + esc(n.url || '') + '">' +
                    '<div class="ni-dot"></div>' +
                    '<div class="ni-body">' +
                        '<div class="ni-title">' + esc(n.title || '') + '</div>' +
                        (n.body ? '<div class="ni-text">' + esc(n.body) + '</div>' : '') +
                        '<div class="ni-time">' + relTime(n.createdAt) + '</div>' +
                    '</div>' +
                '</div>';
        });
        list.innerHTML = html;
        Array.prototype.forEach.call(list.querySelectorAll('.ni-item'), function (el) {
            el.addEventListener('click', function () {
                var url = el.getAttribute('data-url');
                if (url) { location.href = url; }
                else closePanel();
            });
        });
    }

    function openPanel() {
        if (!loggedIn()) return;
        injectStyle();
        closePanel();
        var ov = document.createElement('div');
        ov.id = 'ni-overlay';
        var pn = document.createElement('div');
        pn.id = 'ni-panel';
        pn.innerHTML =
            '<div class="ni-head"><h3>알림</h3><button class="ni-close" type="button" aria-label="닫기">&times;</button></div>' +
            '<div id="ni-list"><div class="ni-empty">불러오는 중…</div></div>';
        document.body.appendChild(ov);
        document.body.appendChild(pn);
        ov.addEventListener('click', closePanel);
        pn.querySelector('.ni-close').addEventListener('click', closePanel);

        fetch(API + '/api/notifications?limit=50' + scopeQS('&'), { headers: authHeaders() })
            .then(function (r) { return r.ok ? r.json() : []; })
            .then(function (items) { renderList(items); })
            .catch(function () { renderList([]); });

        // 열면 모두 읽음 처리 + 배지 제거
        fetch(API + '/api/notifications/read-all' + scopeQS('?'), { method: 'POST', headers: authHeaders() })
            .then(function () { setBadge(0); })
            .catch(function () {});
    }

    function init() {
        injectStyle(); // [B] edit by smsong - 배지 CSS를 처음부터 주입(빨간 원 배지가 로드 즉시 보이도록)
        var btn = document.getElementById('btn-notif');
        if (btn) btn.addEventListener('click', function (e) { e.preventDefault(); openPanel(); });
        refreshBadge();
        // 주기적/포커스 시 배지 갱신
        setInterval(refreshBadge, 30000);
        document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshBadge(); });
        window.addEventListener('focus', refreshBadge);
    }

    window.Daylog = window.Daylog || {};
    window.Daylog.openNotifications = openPanel;
    window.Daylog.refreshNotifBadge = refreshBadge;

    if (document.readyState === 'complete' || document.readyState === 'interactive') init();
    else document.addEventListener('DOMContentLoaded', init);
})();
