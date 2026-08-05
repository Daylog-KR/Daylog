// [B] edit by smsong - 기기별 테마 색상(포인트색) 커스터마이징.
//  · localStorage('daylog_accent')에 기기 로컬로만 저장(백엔드 미연동) — 다크모드('daylog_theme')와 동일 패턴.
//  · :root[data-accent="..."] 가 --primary 계열 토큰을 오버라이드(CSS는 main/rooms/login .css 에 정의).
//  · 설정 메뉴의 #accent-swatches 컨테이너에 스와치를 그려 클릭 즉시 적용/저장.
(function () {
    var KEY = 'daylog_accent';
    var DEFAULT = 'slate';
    var ACCENTS = [
        { id: 'slate',    name: '슬레이트',   color: '#647394' },
        { id: 'indigo',   name: '인디고',     color: '#5a6cf0' },
        { id: 'violet',   name: '바이올렛',   color: '#7c5cff' },
        { id: 'teal',     name: '틸',         color: '#13b183' },
        { id: 'rose',     name: '로즈',       color: '#e0658a' },
        { id: 'amber',    name: '앰버',       color: '#d9903a' },
        { id: 'graphite', name: '그래파이트', color: '#3f4557' }
    ];

    function saved() { try { return localStorage.getItem(KEY) || DEFAULT; } catch (e) { return DEFAULT; } }

    function apply(id) {
        if (!id) return;
        document.documentElement.setAttribute('data-accent', id);
        try { localStorage.setItem(KEY, id); } catch (e) {}
        mark(id);
    }

    function mark(id) {
        var wrap = document.getElementById('accent-swatches');
        if (!wrap) return;
        Array.prototype.forEach.call(wrap.querySelectorAll('.accent-sw'), function (el) {
            var on = el.getAttribute('data-accent') === id;
            el.classList.toggle('on', on);
            el.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
    }

    function render() {
        var wrap = document.getElementById('accent-swatches');
        if (!wrap || wrap.dataset.ready) return;
        wrap.dataset.ready = '1';
        var cur = saved();
        ACCENTS.forEach(function (a) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'accent-sw' + (a.id === cur ? ' on' : '');
            b.setAttribute('data-accent', a.id);
            b.setAttribute('aria-label', a.name);
            b.setAttribute('aria-pressed', a.id === cur ? 'true' : 'false');
            b.title = a.name;
            b.style.setProperty('--c', a.color);
            b.innerHTML = '<span class="accent-dot"></span>' +
                '<svg class="accent-chk" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
            b.addEventListener('click', function () { apply(a.id); });
            wrap.appendChild(b);
        });
    }

    function init() {
        document.documentElement.setAttribute('data-accent', saved()); // 확실히 재적용
        render();
    }

    window.Daylog = window.Daylog || {};
    window.Daylog.applyAccent = apply;

    if (document.readyState === 'complete' || document.readyState === 'interactive') init();
    else document.addEventListener('DOMContentLoaded', init);
})();
