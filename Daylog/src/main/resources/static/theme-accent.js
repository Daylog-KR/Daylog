// [B] edit by smsong - 기기별 테마 색상(포인트색) 커스터마이징.
//  · localStorage('daylog_accent')에 기기 로컬로만 저장(백엔드 미연동) — 다크모드('daylog_theme')와 동일 패턴.
//  · :root[data-accent="..."] 가 --primary 계열을 오버라이드(CSS는 main/rooms/login .css).
//  · 설정 메뉴의 #btn-accent 버튼 클릭 → 색상 선택 모달(#accent-modal)로 전환.
//    - rooms: .room-modal 이라 nav.js 기본 제공자가 뒤로가기로 닫아줌.
//    - main : main.js openLayerStack 에 accent-modal 을 추가해 뒤로가기 처리.
(function () {
    var KEY = 'daylog_accent';
    var DEFAULT = 'slate';
    var ACCENTS = [
        { id:'slate', name:'슬레이트', color:'#647394' },
        { id:'graphite', name:'그래파이트', color:'#3f4557' },
        { id:'indigo', name:'인디고', color:'#5a6cf0' },
        { id:'blue', name:'블루', color:'#2f7fe0' },
        { id:'cyan', name:'시안', color:'#0ca5c9' },
        { id:'teal', name:'틸', color:'#12b183' },
        { id:'emerald', name:'에메랄드', color:'#1a9d5a' },
        { id:'lime', name:'라임', color:'#5a9e2a' },
        { id:'amber', name:'앰버', color:'#d9903a' },
        { id:'orange', name:'오렌지', color:'#e07a35' },
        { id:'coral', name:'코랄', color:'#ec6a52' },
        { id:'rose', name:'로즈', color:'#e0658a' },
        { id:'pink', name:'핑크', color:'#d957b0' },
        { id:'crimson', name:'크림슨', color:'#d94a5a' },
        { id:'violet', name:'바이올렛', color:'#7c5cff' },
        { id:'purple', name:'퍼플', color:'#9a55d4' }
    ];

    function saved() { try { return localStorage.getItem(KEY) || DEFAULT; } catch (e) { return DEFAULT; } }

    function apply(id) {
        if (!id) return;
        document.documentElement.setAttribute('data-accent', id);
        try { localStorage.setItem(KEY, id); } catch (e) {}
        markTiles(id);
        // 현재색 점(.accent-current)은 background:var(--primary) 라 자동 반영됨
    }

    function markTiles(id) {
        var grid = document.getElementById('ac-grid');
        if (!grid) return;
        Array.prototype.forEach.call(grid.querySelectorAll('.ac-tile'), function (el) {
            var on = el.getAttribute('data-accent') === id;
            el.classList.toggle('on', on);
            el.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
    }

    var modal = null;
    function modalClass() {
        var btn = document.getElementById('btn-accent');
        return (btn && btn.getAttribute('data-modal-class')) || 'modal';
    }

    function buildModal() {
        if (modal) return modal;
        modal = document.createElement('div');
        modal.id = 'accent-modal';
        modal.className = modalClass() + ' hidden';
        var check = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        var tiles = '';
        ACCENTS.forEach(function (a) {
            tiles += '<button type="button" class="ac-tile" data-accent="' + a.id + '" style="--c:' + a.color + '" aria-label="' + a.name + '">' +
                '<span class="ac-dot"></span><span class="ac-nm">' + a.name + '</span>' +
                '<span class="ac-ck">' + check + '</span></button>';
        });
        modal.innerHTML =
            '<div id="ac-card" role="dialog" aria-modal="true" aria-label="테마 색상 선택">' +
                '<div class="ac-head"><h3>테마 색상</h3>' +
                    '<button type="button" class="ac-x" aria-label="닫기">&times;</button></div>' +
                '<p class="ac-desc">이 기기에만 적용되는 포인트 색상이에요.</p>' +
                '<div id="ac-grid" class="ac-grid">' + tiles + '</div>' +
            '</div>';
        document.body.appendChild(modal);

        modal.addEventListener('click', function (e) {
            if (e.target === modal) close();            // 배경 클릭
        });
        modal.querySelector('.ac-x').addEventListener('click', close);
        modal.querySelector('#ac-grid').addEventListener('click', function (e) {
            var t = e.target.closest('.ac-tile');
            if (!t) return;
            apply(t.getAttribute('data-accent'));
            setTimeout(close, 180);                     // 선택 → 잠깐 보여주고 닫기
        });
        return modal;
    }

    function open() {
        buildModal();
        markTiles(saved());
        modal.classList.remove('hidden');
        try { if (window.DaylogNav && window.DaylogNav.sync) window.DaylogNav.sync(); } catch (e) {}
    }
    function close() {
        if (modal) modal.classList.add('hidden');
        try { if (window.DaylogNav && window.DaylogNav.sync) window.DaylogNav.sync(); } catch (e) {}
    }

    function onKey(e) { if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) close(); }

    function init() {
        document.documentElement.setAttribute('data-accent', saved()); // 확실히 재적용
        var btn = document.getElementById('btn-accent');
        if (btn) btn.addEventListener('click', function (e) { e.preventDefault(); open(); });
        document.addEventListener('keydown', onKey);
    }

    window.Daylog = window.Daylog || {};
    window.Daylog.applyAccent = apply;
    window.Daylog.openAccentPicker = open;

    if (document.readyState === 'complete' || document.readyState === 'interactive') init();
    else document.addEventListener('DOMContentLoaded', init);
})();
