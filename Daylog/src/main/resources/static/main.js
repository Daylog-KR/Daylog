// ==========================================
// 1. JWT 인증 및 공통 유틸 (부동산 프로젝트 패턴 동일)
// ==========================================

// 뒤로가기로 oauth-redirect.html 등 이전 페이지로 빠져나가 OAuth 절차가 꼬이는 것 방지:
// main.html 진입 시 히스토리에 가드 항목을 넣고, 뒤로가기를 가로채 현재 페이지에 머무르게 한다.
(function preventBackToOAuth() {
    try {
        history.pushState(null, '', location.href);
        window.addEventListener('popstate', function () {
            history.pushState(null, '', location.href);
        });
    } catch (e) { /* noop */ }
})();

// [B] edit by smsong - bfcache(뒤로가기 캐시) 복원 시 로딩 오버레이가 켜진 채 남아 '무한 로딩'되는 것 방지.
//  (핵심 원인은 rooms.js 이지만 main.html 로 되돌아오는 경로에서도 안전하게 오버레이를 끈다.)
window.addEventListener('pageshow', function () {
    try {
        var ov = document.getElementById('loading-overlay');
        if (ov) { ov.classList.remove('show'); ov.setAttribute('aria-hidden', 'true'); }
    } catch (e) {}
});
// [E] edit by smsong

// [B] edit by smsong - #1 다크 모드 (main 설정 메뉴)
//  · 저장 키 'daylog_theme' 는 rooms.js 와 완전히 동일 → rooms 에서 켠 다크가 main 에서도 그대로 유지되고,
//    main 에서 바꾼 값이 rooms 로도 그대로 전달된다(페이지별 불일치/충돌 없음).
//  · FOUC 방지용 선반영 스크립트는 main.html <head> 에 이미 있음.
//  · 다른 탭/창에서 바꾼 경우에도 storage 이벤트로 즉시 동기화한다.
(function daylogTheme() {
    var THEME_KEY = 'daylog_theme';
    function isDark() { try { return localStorage.getItem(THEME_KEY) === 'dark'; } catch (e) { return false; } }
    function applyTheme() {
        var dark = isDark();
        document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
        // 모바일 주소창 색상도 함께 전환
        try {
            var meta = document.querySelector('meta[name="theme-color"]');
            if (meta) meta.setAttribute('content', dark ? '#171513' : '#9c6644');
        } catch (e) {}
        var btn = document.getElementById('btn-dark-toggle');
        if (btn) {
            btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
            btn.classList.toggle('on', dark); // CSS 스위치(해/달 + 노브 슬라이드) 처리
        }
    }
    function toggleTheme() {
        var next = !isDark();
        try { localStorage.setItem(THEME_KEY, next ? 'dark' : 'light'); } catch (e) {}
        applyTheme();
    }
    function bind() {
        var btn = document.getElementById('btn-dark-toggle');
        if (btn && !btn.__bound) { btn.__bound = true; btn.addEventListener('click', toggleTheme); }
        applyTheme();
    }
    // 다른 탭(rooms.html 등)에서 테마가 바뀌면 이 탭에도 즉시 반영
    window.addEventListener('storage', function (e) { if (!e || e.key === THEME_KEY) applyTheme(); });
    // bfcache 복귀 시에도 최신 값으로 재반영
    window.addEventListener('pageshow', applyTheme);
    if (document.readyState === 'complete' || document.readyState === 'interactive') bind();
    else document.addEventListener('DOMContentLoaded', bind);
    window.Daylog = window.Daylog || {};
    window.Daylog.applyTheme = applyTheme;
})();
// [E] edit by smsong

// ==========================================================================
// [B] edit by smsong - #2 피드 페이저 (무한 스크롤 + 가상 스크롤)
//
//  왜 필요한가
//   · 추억/가볼곳이 수백 건이 되면 renderTimeline() 이 카드 수백 개를 한 번에 DOM 에 그린다.
//     → 탭 전환이 멈추고, 이미지 디코딩이 몰려 스크롤이 끊기고, 저사양 기기에서는 탭이 죽는다.
//
//  이 블록이 하는 일
//   1) 최초에는 최신순 5개만 노출한다.                        (pageSize)
//   2) 바닥 근처까지 스크롤하면 로딩 폼(.lo-spinner)을 띄우고 5개씩 더 노출한다.
//   3) 노출된 항목이 몇 개든, 실제 DOM 에 남기는 행은 화면에 보이는 5~10행뿐이다.
//      위/아래로 다시 스크롤하면 그 구간을 다시 그린다. (가상 스크롤)
//   4) 사라진 행의 자리는 위/아래 스페이서 <div> 높이가 대신하므로 스크롤바 길이가 유지된다.
//
//  필요한 CSS 는 이 블록이 직접 <style> 로 주입한다(main.css 수정 불필요).
//  나중에 서버 페이징(GET ?offset=&size=)으로 바꾸려면 opts.fetchMore 만 채우면 된다.
// ==========================================================================
(function (global) {
    'use strict';

    var DEF = {
        pageSize: 5,      // 한 번에 더 노출할 '항목' 수
        windowRows: 10,   // DOM 에 동시에 유지할 최소 '행' 수 (화면이 더 길면 필요한 만큼만 늘어남)
        buffer: 200,      // 화면 위/아래 여유 px (스크롤 시 빈 칸이 보이지 않게)
        estimate: 116,    // 아직 한 번도 그려보지 않은 행의 높이 추정치(px)
        loadDelay: 280,   // 로딩 폼이 최소한 이만큼은 보이도록 (깜빡임 방지)
        nearBottom: 240,  // 바닥에서 이만큼 남으면 다음 페이지 요청
        loadingText: '불러오는 중...',
        endText: '모두 확인했습니다'
    };

    // 가상 스크롤용 CSS 주입 (한 번만)
    function injectStyle() {
        if (document.getElementById('vf-style')) return;
        var css =
            /* 화면 밖 행의 자리를 대신 차지하는 스페이서 — 아무 장식도 없어야 한다 */
            '.vf-spacer{width:100%;pointer-events:none;}' +
            /* flow-root: 카드의 margin 이 밖으로 새지 않게 가둔다.
               행 높이를 offsetTop 차이로 재기 때문에 이 한 줄이 스크롤 정확도를 좌우한다 */
            '.vf-rows{display:flow-root;}' +
            /* 추가 조회 중 로딩 폼 — 전역 로딩 오버레이(.lo-spinner/.lo-text)와 같은 모양을 목록 안에 둔다 */
            '.vf-more{display:none;align-items:center;justify-content:center;gap:10px;padding:18px 0 22px;}' +
            '.vf-more.show{display:flex;}' +
            '.vf-more .lo-spinner{width:22px;height:22px;border-width:2.5px;}' +
            '.vf-more .lo-text{font-size:0.82rem;}' +
            '.vf-end{display:none;text-align:center;padding:18px 0 26px;font-size:0.8rem;color:var(--gray-500,#a99e90);}' +
            '@media (prefers-reduced-motion: reduce){.vf-more .lo-spinner{animation-duration:1.6s;}}';
        var st = document.createElement('style');
        st.id = 'vf-style';
        st.textContent = css;
        document.head.appendChild(st);
    }

    function div(cls, css) {
        var d = document.createElement('div');
        if (cls) d.className = cls;
        if (css) d.style.cssText = css;
        return d;
    }

    /**
     * opts = {
     *   feedEl        : 목록이 그려질 컨테이너 (#timeline-feed / #checklist-feed)
     *   scrollEl      : 실제로 스크롤되는 요소 (main.container)
     *   rowsOf(items) : 노출할 항목 배열 → 행 배열 [{ key, type, est, ... }] (날짜 헤더 포함 가능)
     *   renderRow(row): 행 1개 → HTMLElement
     *   emptyHtml     : 항목이 0개일 때 보여줄 HTML
     *   sigOf(items)  : 목록 동일 여부 판정 키 (기본: id 나열)
     *   onWindow(els) : 창을 다시 그릴 때마다 호출 (댓글 배지 재적용 등)
     *   onData(items) : 데이터가 실제로 바뀌었을 때 1회 호출 (댓글 수 조회 등)
     *   fetchMore(offset, size) -> Promise<Array>   (선택) 서버 페이징 훅
     * }
     */
    function create(opts) {
        var o = {}, k;
        for (k in DEF) o[k] = DEF[k];
        for (k in opts) o[k] = opts[k];

        var feedEl = o.feedEl, scrollEl = o.scrollEl;
        if (!feedEl || !scrollEl) return null;
        injectStyle();

        // ---- 내부 상태 ----
        var items = [];        // 전체 항목(정렬된 원본)
        var rows = [];         // 현재 '노출된' 항목으로 만든 행 배열
        var loaded = 0;        // 노출된 항목 수 (5 → 10 → 15 …)
        var heights = {};      // row.key → 실제 측정 높이(px, margin 포함)
        var winStart = -1, winEnd = -1;
        var busy = false;
        var sig = null;

        // ---- 고정 DOM 골격 ----
        var spTop = div('vf-spacer', 'height:0px');
        var rowsEl = div('vf-rows');
        var spBot = div('vf-spacer', 'height:0px');
        var moreEl = div('vf-more');
        moreEl.innerHTML = '<div class="lo-spinner"></div><div class="lo-text vf-more-text"></div>';
        moreEl.querySelector('.vf-more-text').textContent = o.loadingText;
        var endEl = div('vf-end');
        endEl.textContent = o.endText;

        function mount() {
            feedEl.innerHTML = '';
            feedEl.appendChild(spTop);
            feedEl.appendChild(rowsEl);
            feedEl.appendChild(spBot);
            feedEl.appendChild(moreEl);
            feedEl.appendChild(endEl);
        }

        function rowH(i) {
            var r = rows[i];
            return heights[r.key] || r.est || o.estimate;
        }

        // 피드 상단이 스크롤 컨테이너 기준 몇 px 지점인지
        function feedTop() {
            var f = feedEl.getBoundingClientRect();
            var s = scrollEl.getBoundingClientRect();
            return (f.top - s.top) + scrollEl.scrollTop;
        }

        // 탭이 숨겨져 있으면(display:none) 측정이 무의미 → 보일 때 다시 계산한다
        function visible() {
            return !!(feedEl.offsetParent || feedEl.offsetWidth || feedEl.offsetHeight);
        }

        function buildRows() {
            rows = o.rowsOf(items.slice(0, loaded)) || [];
        }

        // 렌더된 행들의 실제 높이를 측정해 heights 에 반영.
        // offsetTop 차이로 재므로 margin(및 margin collapsing)이 자연스럽게 포함된다.
        function measure() {
            var kids = rowsEl.children;
            if (!kids.length) return false;
            var bottom = rowsEl.offsetTop + rowsEl.offsetHeight;
            var changed = false;
            for (var i = 0; i < kids.length; i++) {
                var key = kids[i].getAttribute('data-vf-key');
                if (!key) continue;
                var next = (i + 1 < kids.length) ? kids[i + 1].offsetTop : bottom;
                var h = next - kids[i].offsetTop;
                if (h > 0 && heights[key] !== h) { heights[key] = h; changed = true; }
            }
            return changed;
        }

        function prefixOf(n) {
            var pre = new Array(n + 1);
            pre[0] = 0;
            for (var i = 0; i < n; i++) pre[i + 1] = pre[i] + rowH(i);
            return pre;
        }

        function setSpacers(pre, s, e) {
            spTop.style.height = pre[s] + 'px';
            spBot.style.height = Math.max(0, pre[rows.length] - pre[e]) + 'px';
        }

        // ---- 창(window) 계산 + 그리기 ----
        function layout(force) {
            if (!items.length || !visible()) return;

            var n = rows.length;
            var pre = prefixOf(n);
            var viewTop = scrollEl.scrollTop - feedTop();
            var viewH = scrollEl.clientHeight || global.innerHeight || 700;

            var s = 0;
            while (s < n - 1 && pre[s + 1] < viewTop - o.buffer) s++;
            var e = s;
            while (e < n && pre[e] < viewTop + viewH + o.buffer) e++;
            if (e - s < o.windowRows) e = s + o.windowRows;   // 최소 windowRows 행 유지
            if (e > n) e = n;

            if (force || s !== winStart || e !== winEnd) {
                var beforeTop = pre[s];
                winStart = s; winEnd = e;

                var frag = document.createDocumentFragment();
                var made = [];
                for (var j = s; j < e; j++) {
                    var el = o.renderRow(rows[j]);
                    if (!el) continue;
                    el.setAttribute('data-vf-key', rows[j].key);
                    frag.appendChild(el);
                    made.push(el);
                }
                rowsEl.innerHTML = '';
                rowsEl.appendChild(frag);
                setSpacers(pre, s, e);

                if (measure()) {
                    pre = prefixOf(n);
                    // 창 위쪽 높이가 달라졌으면 스크롤이 튀지 않게 보정
                    var delta = pre[s] - beforeTop;
                    if (delta) scrollEl.scrollTop += delta;
                    setSpacers(pre, s, e);
                }
                if (o.onWindow) { try { o.onWindow(made); } catch (err) { console.warn('[Daylog] onWindow:', err); } }
            } else {
                setSpacers(pre, s, e);
            }

            // 바닥 근처 → 다음 5개
            var hasMore = loaded < items.length;
            endEl.style.display = (!hasMore && items.length > o.pageSize) ? '' : 'none';
            if (hasMore && !busy && (viewTop + viewH) > (pre[n] - o.nearBottom)) loadMore();
        }

        function loadMore() {
            if (busy || loaded >= items.length) return;
            busy = true;
            moreEl.classList.add('show');

            var next = Math.min(items.length, loaded + o.pageSize);
            var t0 = Date.now();
            var task = o.fetchMore ? Promise.resolve(o.fetchMore(loaded, o.pageSize)) : Promise.resolve(null);

            task.then(function (more) {
                // fetchMore 가 배열을 돌려주면 뒤에 붙인다 (서버 페이징 모드)
                if (more && more.length) { items = items.concat(more); next = loaded + more.length; }
            }).catch(function (err) {
                console.warn('[Daylog] 추가 조회 실패:', err);
            }).then(function () {
                var wait = Math.max(0, o.loadDelay - (Date.now() - t0));
                setTimeout(function () {
                    loaded = next;
                    buildRows();
                    moreEl.classList.remove('show');
                    busy = false;
                    layout(true);
                }, wait);
            });
        }

        // ---- 스크롤/리사이즈 연결 ----
        var ticking = false;
        function onScroll() {
            if (ticking) return;
            ticking = true;
            global.requestAnimationFrame(function () { ticking = false; layout(false); });
        }
        scrollEl.addEventListener('scroll', onScroll, { passive: true });
        global.addEventListener('resize', function () { layout(true); });

        // ---- 외부 API ----
        return {
            /** 전체 목록 교체. 내용이 같으면 지금까지 펼친 페이지/스크롤을 유지한다. */
            setItems: function (list) {
                var arr = list || [];
                var newSig = o.sigOf ? o.sigOf(arr)
                                     : arr.map(function (x) { return x && x.id; }).join(',');
                var same = (newSig === sig && feedEl.contains(rowsEl));
                sig = newSig;
                items = arr;

                if (!items.length) {
                    rows = []; loaded = 0; winStart = winEnd = -1;
                    feedEl.innerHTML = o.emptyHtml || '';
                    return;
                }
                if (same) {
                    loaded = Math.min(Math.max(loaded, o.pageSize), items.length);
                } else {
                    loaded = Math.min(o.pageSize, items.length);
                    winStart = winEnd = -1;
                    mount();
                    if (o.onData) { try { o.onData(items); } catch (err) { console.warn('[Daylog] onData:', err); } }
                }
                buildRows();
                layout(true);
            },
            /** 탭 전환 등으로 보이게 됐을 때 다시 계산 */
            relayout: function () { layout(true); },
            /** 첫 페이지로 되돌림 */
            reset: function () {
                loaded = Math.min(o.pageSize, items.length);
                winStart = winEnd = -1;
                buildRows();
                layout(true);
            },
            /** 디버그용 — 콘솔에서 확인 */
            count: function () { return { loaded: loaded, total: items.length, dom: rowsEl.children.length }; }
        };
    }

    global.DaylogFeed = { create: create };
})(window);
// [E] edit by smsong

// ==========================================================================
// [B] edit by smsong - #7 상세보기 몰입형 개편 (필름 & 페이지)
//
//  구조
//   · .dtl-stage  — 사진. 화면 상단에 sticky 로 고정되고, 아래 종이가 그 위를 덮으며 올라온다.
//   · .dtl-page   — 종이. 큰 상단 라운드로 사진 위에 26px 겹쳐 얹힌다.
//   · 헤더(닫기/수정/휴지통)와 드래그 핸들은 사진 위에 떠 있는 반투명 원형 칩이 된다.
//
//  적용 방식
//   · 시트 '껍데기'를 바꾸는 규칙은 :has() 로 조회 화면이 떠 있을 때만 걸린다.
//     → 수정 폼(#detail-edit-form)이 뜨면 자동으로 기존 시트 모양으로 돌아간다.
//       JS 에서 클래스를 토글할 필요가 없어, 편집 진입/이탈 경로가 늘어도 어긋나지 않는다.
//   · :has() 미지원 브라우저는 껍데기 규칙만 빠지고 내용 스타일은 그대로 적용된다.
//
//  main.css 는 건드리지 않는다. 되돌리려면 이 블록만 지우면 된다.
// ==========================================================================
(function () {
    'use strict';
    if (document.getElementById('dtl-imm-style')) return;

    // 조회 화면이 떠 있는 상세 시트에만 적용
    var BASE = ['.detail-sheet .detail-content:has(#detail-view:not(.hidden) .dtl)',
                '.detail-sheet .detail-content:has(#cl-detail-view:not(.hidden) .dtl)'];

    // 시트 껍데기용 규칙: 두 모달 각각에 대해 셀렉터를 전개
    function g(sels, body) {
        var out = [];
        BASE.forEach(function (b) { sels.forEach(function (x) { out.push(b + x); }); });
        return out.join(',') + body;
    }
    function s(sel, body) { return g([sel], body); }

    var css = [
        // ================= [B] edit by smsong - #8 상·하단 네비 숨김 =================
        //  추억/가볼곳 상세가 완전히 열려 있는 동안에는 상단바(.navbar)와 하단 네비(.bottom-nav)를
        //  감춰 화면 전체를 상세에 내준다.
        //
        //   · opacity 로만 감춘다. display:none 으로 지우면 .navbar 가 문서 흐름에서 빠지면서
        //     .container 높이(calc(100dvh - header - nav))와 어긋나 뒤 화면이 통째로 리플로우된다.
        //   · 상단바는 z:100, 시트는 z:90 이라 원래 시트 위쪽 60px 이 상단바 뒤에 깔려 있었다.
        //     투명해지면 그 아래 시트가 그대로 비치므로, 가려져 있던 닫기/수정/휴지통 칩도 같이 보인다.
        //   · .at-full 은 시트가 'full' 스냅일 때만 붙는다(createDetailSheet.snap).
        //     → 시트를 1/3 로 내려 뒤 화면을 보는 순간 네비가 즉시 돌아온다.
        //   · 수정 폼(#detail-edit-form)이 뜨면 :has() 조건이 깨져 네비가 돌아온다.
        '.navbar,.bottom-nav{transition:opacity .2s ease;}',
        'body:has(#detail-modal.at-full:not(.hidden) #detail-view:not(.hidden) .dtl) .navbar,' +
        'body:has(#detail-modal.at-full:not(.hidden) #detail-view:not(.hidden) .dtl) .bottom-nav,' +
        'body:has(#checklist-detail-modal.at-full:not(.hidden) #cl-detail-view:not(.hidden) .dtl) .navbar,' +
        'body:has(#checklist-detail-modal.at-full:not(.hidden) #cl-detail-view:not(.hidden) .dtl) .bottom-nav' +
        '{opacity:0;pointer-events:none;}',
        // [E] edit by smsong

        // ================= 시트 껍데기: 화면 꽉 채우기 =================
        s('', '{height:100dvh;max-height:100dvh;min-height:100dvh;border-radius:0;box-shadow:none;background:var(--bg-color);}'),
        s(' .sheet-body', '{padding:0;}'),

        // 드래그 핸들 — 사진 위 반투명 알약 (안내 문구는 몰입형에서 제거)
        s(' .sheet-handle', '{position:absolute;top:calc(env(safe-area-inset-top) + 12px);left:0;right:0;z-index:6;padding:6px 0;}'),
        s(' .sheet-handle::before', '{width:38px;height:4px;background:rgba(253,251,247,.62);}'),
        s(' .sheet-handle::after', '{content:none;}'),

        // 헤더 — 사진 위에 뜨는 원형 칩. row-reverse 라 닫기가 왼쪽, 수정/휴지통이 오른쪽.
        s(' .detail-modal-header',
          '{position:absolute;top:0;left:0;right:0;z-index:7;margin:0;border:none;background:none;' +
          'padding:calc(env(safe-area-inset-top) + 24px) 14px 0;' +
          'display:flex;flex-direction:row-reverse;justify-content:space-between;align-items:center;}'),
        s(' .detail-modal-header .detail-header-actions', '{gap:9px;}'),
        g([' .detail-modal-header .close-modal',
           ' .detail-modal-header .detail-edit-btn',
           ' .detail-modal-header .detail-trash-btn'],
          '{width:34px;height:34px;min-width:34px;padding:0;margin:0;border:none;border-radius:50%;' +
          'background:rgba(36,31,27,.44);color:#fdfbf7;opacity:1;' +
          'display:flex;align-items:center;justify-content:center;font-size:1.3rem;line-height:1;}'),
        g([' .detail-modal-header .close-modal:hover',
           ' .detail-modal-header .detail-edit-btn:hover',
           ' .detail-modal-header .detail-trash-btn:hover'],
          '{background:rgba(36,31,27,.64);color:#fdfbf7;}'),

        // ================= 무대(사진) =================
        //  height 는 첫 장의 비율에 맞춰 Daylog._fitDetailStage() 가 인라인으로 덮어쓴다.
        //  아래 값은 이미지 로드 전 잠깐 쓰이는 기본값 (레이아웃 점프 방지용).
        s(' .dtl-stage', '{height:52dvh;min-height:0;background:#241f1b;}'),
        s(' .dtl-stage.empty', '{height:23dvh;min-height:23dvh;background:var(--primary);}'),
        s(' .dtl-stage .detail-image-wrap', '{height:100%;border-radius:0;box-shadow:none;background:transparent;}'),
        s(' .dtl-stage .detail-image-wrap img', '{width:100%;height:100%;max-height:none;object-fit:cover;}'),
        s(' .dtl-stage .detail-carousel', '{height:100%;margin:0;}'),
        // _fitCarousel 이 인라인 height 를 넣으므로 !important 로 덮는다
        s(' .dtl-stage .carousel-track', '{height:100%!important;}'),
        s(' .dtl-stage .carousel-slide img', '{width:100%;height:100%;object-fit:cover;}'),
        g([' .dtl-stage .carousel-count', ' .dtl-stage .carousel-arrow'], '{display:none;}'),
        // 점 인디케이터 → 분절 바 (몇 장 중 몇 번째인지 한눈에)
        s(' .dtl-stage .carousel-dots',
          '{position:absolute;left:16px;right:16px;bottom:40px;top:auto;transform:none;' +
          'display:flex;gap:5px;margin:0;padding:0;z-index:3;}'),
        s(' .dtl-stage .carousel-dot',
          '{flex:1 1 auto;width:auto;height:3px;border-radius:2px;margin:0;box-shadow:none;' +
          'background:rgba(253,251,247,.36);}'),
        s(' .dtl-stage .carousel-dot.active', '{background:#fdfbf7;transform:none;}'),

        // ================= 내용 (:has() 없어도 적용되도록 스코프 밖) =================
        '.dtl{display:block;}',
        // sticky — 종이가 올라오는 동안 사진은 제자리에 머문다
        '.dtl-stage{position:sticky;top:0;z-index:0;overflow:hidden;display:flex;align-items:center;justify-content:center;}',
        '.dtl-stage.empty .dtl-stage-ic{color:rgba(253,251,247,.55);}',
        '.dtl-page{position:relative;z-index:1;margin-top:-26px;background:var(--bg-color);' +
        'border-radius:26px 26px 0 0;min-height:58dvh;' +
        // [B] edit by smsong - #8 하단 네비가 숨겨지므로 그만큼 비워 두던 여백을 줄인다.
        //  (되돌리려면 아래 줄을 calc(var(--bottom-nav-height) + env(safe-area-inset-bottom) + 30px) 로)
        'padding:20px 20px calc(env(safe-area-inset-bottom) + 44px);}',
        // [E] edit by smsong
        '.dtl-eyebrow{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin:0 0 9px;' +
        'font-size:0.72rem;letter-spacing:0.02em;color:var(--gray-400);}',
        '.dtl-eyebrow .dtl-sep{color:var(--gray-200);}',
        '.dtl-loc{display:inline-flex;align-items:center;gap:4px;cursor:pointer;}',
        '.dtl-loc:active{opacity:.6;}',
        '.dtl-title{font-family:var(--font-logo),var(--font-main);font-size:1.44rem;font-weight:600;' +
        'line-height:1.34;color:var(--gray-800);margin:0 0 13px;word-break:keep-all;}',
        '.dtl-badges{display:flex;flex-wrap:wrap;gap:7px;margin:0 0 12px;}',
        '.dtl-author{display:flex;align-items:center;gap:8px;margin:0 0 17px;}',
        '.dtl-text{font-size:0.94rem;line-height:1.82;color:var(--gray-600);}',
        '.dtl-text p{margin:0;white-space:pre-line;}',
        '.dtl-comments{margin-top:24px;padding-top:19px;border-top:1px solid var(--gray-200);}',

        // ================= [B] edit by smsong - #9 목록 모달: 2열 사진 그리드 =================
        '.lm-grid-mode .list-modal-body{padding:12px 14px calc(env(safe-area-inset-bottom) + 28px);}',
        '.lm-grid-mode .modal-header h3{font-family:var(--font-logo),var(--font-main);font-size:1.3rem;' +
        'font-weight:600;display:flex;align-items:center;gap:9px;}',
        '.lm-count{font-family:var(--font-main);font-size:0.74rem;font-weight:600;color:var(--primary-dark);' +
        'background:var(--primary-light);border-radius:999px;padding:2px 9px;line-height:1.6;}',
        '.lm-grid{display:block;}',
        '.lm-grid-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;}',
        '.lm-tile{display:flex;flex-direction:column;gap:7px;padding:0;border:none;background:none;' +
        'text-align:left;cursor:pointer;font-family:inherit;min-width:0;}',
        '.lm-tile:active{transform:scale(.975);}',
        '.lm-tile{transition:transform .14s var(--ease-soft);}',
        '.lm-tile-art{position:relative;display:flex;align-items:center;justify-content:center;' +
        'aspect-ratio:1/1;width:100%;border-radius:15px;overflow:hidden;background:var(--gray-100);}',
        '.lm-tile-art.empty{background:var(--primary-light);color:var(--primary-dark);}',
        '.lm-tile-img{width:100%;height:100%;object-fit:cover;display:block;opacity:0;' +
        'transition:opacity .25s ease;}',
        '.lm-tile-img.is-loaded{opacity:1;}',
        '.lm-tile-chip{position:absolute;left:8px;bottom:8px;display:inline-flex;align-items:center;gap:3px;' +
        'font-size:0.66rem;font-weight:600;line-height:1;padding:5px 8px;border-radius:999px;' +
        'background:rgba(36,31,27,.56);color:#fdfbf7;}',
        '.lm-tile-chip.done{background:rgba(46,110,86,.82);}',
        '.lm-tile-title{font-size:0.86rem;font-weight:600;color:var(--gray-800);line-height:1.35;' +
        'overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}',
        '.lm-tile-meta{font-size:0.72rem;color:var(--gray-400);line-height:1.3;' +
        'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',

        // ================= [B] edit by smsong - #11 커플 기념일 축하 폼 =================
        '#anniv-modal{position:fixed;inset:0;z-index:3000;display:flex;align-items:center;' +
        'justify-content:center;padding:24px;background:rgba(45,38,32,.52);animation:annivFade .22s ease;}',
        '#anniv-modal .anniv-card{position:relative;width:100%;max-width:340px;background:var(--white);' +
        'border-radius:24px;padding:34px 24px 0;text-align:center;box-shadow:0 20px 56px rgba(0,0,0,.28);' +
        'animation:annivPop .38s cubic-bezier(.2,.8,.3,1);cursor:pointer;overflow:hidden;}',
        // 닫기 — 저장 없이 닫힌다(다음 진입 때 다시 뜸)
        '#anniv-modal .anniv-x{position:absolute;top:10px;right:10px;width:32px;height:32px;padding:0;' +
        'border:none;background:transparent;color:var(--gray-400);font-size:1.5rem;line-height:1;' +
        'cursor:pointer;border-radius:50%;}',
        '#anniv-modal .anniv-x:active{background:var(--gray-100);}',
        // 시그니처 — 숫자를 크게 새긴 원형 메달
        '#anniv-modal .anniv-medal{width:104px;height:104px;margin:0 auto 18px;border-radius:50%;' +
        'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;' +
        'background:var(--primary-light);color:var(--primary-dark);' +
        'box-shadow:inset 0 0 0 3px var(--white),0 6px 18px rgba(176,137,104,.34);}',
        '#anniv-modal .anniv-big{font-family:var(--font-logo),var(--font-main);font-size:2.3rem;' +
        'font-weight:600;line-height:1;letter-spacing:-.01em;}',
        '#anniv-modal .anniv-unit{font-size:0.78rem;font-weight:600;letter-spacing:.06em;opacity:.82;}',
        '#anniv-modal .anniv-title{margin:0 0 7px;font-size:1.1rem;font-weight:700;line-height:1.45;' +
        'color:var(--gray-800);word-break:keep-all;}',
        '#anniv-modal .anniv-sub{margin:0 0 4px;font-size:0.82rem;color:var(--gray-500);}',
        // 카드 폭을 꽉 채우는 하단 바 — 누르면 저장하고 바로 닫힌다
        '#anniv-modal .anniv-nomore{display:block;width:calc(100% + 48px);margin:24px -24px 0;' +
        'padding:16px;border:none;border-top:1px solid var(--gray-200);background:transparent;' +
        'font-family:inherit;font-size:0.82rem;font-weight:600;color:var(--gray-400);cursor:pointer;}',
        '#anniv-modal .anniv-nomore:active{background:var(--gray-100);color:var(--gray-500);}',
        '@keyframes annivFade{from{opacity:0}to{opacity:1}}',
        '@keyframes annivPop{from{opacity:0;transform:translateY(16px) scale(.94)}to{opacity:1;transform:none}}'
    ].join('');

    var st = document.createElement('style');
    st.id = 'dtl-imm-style';
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
})();
// [E] edit by smsong

const API_BASE_URL = (window.APP_CONFIG && window.APP_CONFIG.BACKEND_BASE) || 'http://localhost:8086';
const TOKEN_KEY = 'accessToken';

// SNS 기본 프로필 이미지 (회색 실루엣) — 외부 파일 없이 SVG 데이터 URI 사용
const DEFAULT_AVATAR = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    '<rect width="100" height="100" fill="#e7e0d6"/>' +
    '<circle cx="50" cy="40" r="17" fill="#b9afa1"/>' +
    '<path d="M50 61c-17 0-29 11-29 27v12h58V88c0-16-12-27-29-27z" fill="#b9afa1"/>' +
    '</svg>'
);

function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }

// JWT payload 디코드 (base64url)
function decodeJwt(token) {
    try {
        const part = token.split('.')[1];
        if (!part) return null;
        let b64 = part.replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4) b64 += '=';
        const json = decodeURIComponent(
            atob(b64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
        );
        return JSON.parse(json);
    } catch { return null; }
}

function getUid() {
    const t = getToken();
    if (t) {
        const p = decodeJwt(t);
        if (p && (p.sub || p.uid || p.username)) return p.sub || p.uid || p.username;
    }
    try {
        const cu = JSON.parse(localStorage.getItem('currentUser') || 'null');
        if (cu && cu.uid) return cu.uid;
    } catch (_) {}
    return '';
}

// 토큰 존재 + 만료 검사
function isTokenValid() {
    const t = getToken();
    if (!t) return false;
    const p = decodeJwt(t);
    if (!p) return false;
    if (p.exp && Date.now() >= p.exp * 1000) return false; // 만료
    return true;
}

// [B] edit by smsong : 로그인 유지(슬라이딩 만료) — 만료 임박 시 서버에 갱신 요청해 새 토큰으로 교체.
var _REFRESH_LEAD_MS = 5 * 60 * 1000;
var _refreshing = null;
var _expireTimer = null;
function _tokenExpMs() { const p = decodeJwt(getToken()); return (p && p.exp) ? p.exp * 1000 : 0; }
function refreshToken() {
    if (_refreshing) return _refreshing;
    const cur = getToken();
    if (!cur) return Promise.resolve(false);
    _refreshing = fetch(API_BASE_URL + '/user/refresh', {
        method: 'POST', headers: { 'Authorization': 'Bearer ' + cur }
    }).then(function (res) {
        if (!res.ok) return false;
        return res.json().then(function (data) {
            const nt = data && (data.token || data.accessToken || data.jwt);
            if (nt) {
                localStorage.setItem(TOKEN_KEY, nt);
                try { if (data.user) localStorage.setItem('currentUser', JSON.stringify(data.user)); } catch (_) {}
                scheduleTokenRefresh();
                return true;
            }
            return false;
        });
    }).catch(function () { return false; }).then(function (ok) { _refreshing = null; return ok; });
    return _refreshing;
}
function ensureFreshToken() {
    const t = getToken();
    if (!t) return Promise.resolve(false);
    const exp = _tokenExpMs();
    if (!exp) return Promise.resolve(true);
    const left = exp - Date.now();
    if (left > _REFRESH_LEAD_MS) return Promise.resolve(true);
    if (left <= 0) return Promise.resolve(false);
    return refreshToken();
}
function scheduleTokenRefresh() {
    if (_expireTimer) clearTimeout(_expireTimer);
    const exp = _tokenExpMs();
    if (!exp) return;
    const left = exp - Date.now();
    if (left <= 0) return;
    const refreshAt = Math.max(left - _REFRESH_LEAD_MS, 0);
    _expireTimer = setTimeout(function () {
        refreshToken().then(function (ok) {
            if (!ok) { /* 갱신 실패 → 다음 요청에서 401 로 로그인 유도 */ }
        });
    }, Math.min(refreshAt, 2147483000));
}
// [E] edit by smsong

function authHeaders(withJson) {
    const h = {};
    if (withJson) h['Content-Type'] = 'application/json';
    const t = getToken();
    if (t) h['Authorization'] = 'Bearer ' + t;
    const rid = localStorage.getItem('selectedRoomId'); // [smsong] 방 스코프 — 모든 요청에 현재 방 첨부
    if (rid) h['X-Room-Id'] = rid;
    return h;
}

// 토큰/사용자 정보 제거 (로그인 루프 방지)
function logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem('currentUser');
    localStorage.removeItem('auth');
}

// 로그인 페이지로 이동 (토큰 없음/만료 시)
let _authRedirecting = false;
function redirectToLogin(msg) {
    if (_authRedirecting) return;          // 같은 페이지 내 중복 알림 방지
    _authRedirecting = true;
    alert(msg || '토큰이 만료되었거나 존재하지 않습니다. 다시 로그인해주십시오.');
    logout();                              // accessToken 제거 → login.js 되튕김 방지
    location.href = 'login.html';
}

// 유효하지 않으면 로그인 페이지로 보냄
function requireAuthOrRedirect() {
    if (!isTokenValid()) { redirectToLogin(); return false; }
    // [smsong] 방 미선택 시 방 목록으로 (방 스코프 진입 강제)
    if (!localStorage.getItem('selectedRoomId')) { location.replace('rooms.html'); return false; }
    // [B][E] edit by smsong : 로그인 유지 — 만료 임박 자동 갱신 스케줄(중복 호출은 내부에서 정리)
    scheduleTokenRefresh();
    return true;
}

// [B] edit by smsong : 명시적 로그아웃 — 서버의 이 기기 세션을 먼저 제거(기기 목록에서 사라지도록) 후 이동.
function serverLogoutThenRedirect(msg) {
    var token = getToken();
    var done = function () { redirectToLogin(msg); };
    if (!token) { done(); return; }
    try {
        fetch(API_BASE_URL + '/user/logout', {
            method: 'POST', headers: { 'Authorization': 'Bearer ' + token }
        }).then(done).catch(done);
    } catch (_) { done(); }
}
// [E] edit by smsong

// 공통 fetch 응답 처리
async function handleResponse(res) {
    // 업로드 용량 초과 → 로그인 튕김 대신 친절한 안내
    if (res.status === 413) {
        throw new Error('이미지 용량이 너무 큽니다. 사진 수를 줄이거나 더 작은 이미지를 사용해주십시오.');
    }
    // [B] edit by smsong - 403(서비스 접근 권한 없음)은 로그인 튕김 대신 '권한 없음' 화면(요청 버튼) 표시
    if (res.status === 403) {
        try { if (typeof blockUnauthorizedUser === 'function') blockUnauthorizedUser(); } catch (e) {}
        throw new Error('서비스 접근 권한이 없습니다');
    }
    // [E] edit by smsong
    // 1. 401(Unauthorized) 또는 500(Internal Server Error)이 발생하면 튕겨냄
    if (res.status === 401 || res.status === 500) {
        redirectToLogin('토큰이 만료되었거나 존재하지 않습니다. 다시 로그인해주십시오.');
        throw new Error('인증 만료 또는 서버 에러 발생');
    }

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        // 2. 에러 텍스트 내부에 토큰 관련 키워드가 있거나 500 에러 오브젝트 구조가 보이면 튕겨냄
        if (/jwt|token|expired|signature|malformed|unauthor|forbidden|authentication|Internal Server Error/i.test(text)) {
            redirectToLogin('토큰이 만료되었거나 존재하지 않습니다. 다시 로그인해주십시오.');
            throw new Error('인증이 만료되었습니다');
        }
        throw new Error(text || (res.status + ' ' + res.statusText));
    }
    if (res.status === 204) return null;
    // 본문이 빈 200 응답(휴지통 이동/삭제 등) 안전 처리
    const text = await res.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) { return text; }
}

// ==========================================
// 1-b. 접근 권한은 '방별' 관리 — 관리자 = 각 방의 방장 (하드코딩 uid 없음)
// ==========================================
const ME_ALIAS = ['송성민', 's s'];             // (표시용) '송성민'으로 정규화할 이름

// [smsong] 방(공유 공간) 컨텍스트 헬퍼
function getRoomId() { return localStorage.getItem('selectedRoomId') || ''; }
// [B] edit by smsong - #10 마지막으로 들어간 방을 기록해 둔다 (rooms.html 자동 입장용).
//  · 푸시 알림 딥링크(main.html?room=..)로 바로 들어온 경우도 여기서 잡힌다.
//  · 로그아웃하면 rooms.js 의 AUTH_KEYS 정리에서 이 키도 함께 지워진다
//    → 재로그인 시에는 자동 입장하지 않고 방 목록이 뜬다.
(function rememberLastRoom() {
    try {
        var id = localStorage.getItem('selectedRoomId');
        if (!id) return;
        localStorage.setItem('daylog_last_room', JSON.stringify({
            id: id,
            name: localStorage.getItem('selectedRoomName') || '',
            type: localStorage.getItem('selectedRoomType') || '',
            ownerUid: localStorage.getItem('selectedRoomOwnerUid') || ''
        }));
    } catch (e) {}
})();
// [E] edit by smsong
// [B] edit by smsong - #2 방 타입은 서버에서 받은 roomInfo.type(권위) 우선, 없으면 localStorage.
//  (알림 딥링크로 진입 시 localStorage 가 비어/오래돼 COUPLE 로 오판하던 버그 해결)
function getRoomType() {
    var t = (window.Daylog && Daylog.roomInfo && Daylog.roomInfo.type)
        ? Daylog.roomInfo.type
        : localStorage.getItem('selectedRoomType');
    return (t || '').toUpperCase();
}
function getRoomOwnerUid() { return localStorage.getItem('selectedRoomOwnerUid') || ''; }
function isRoomOwner() { return !!(getUid() && getUid() === getRoomOwnerUid()); }
function isCoupleRoom() { return getRoomType() === 'COUPLE'; }

// 여러 소스(localStorage / JWT)에서 로그인 사용자 name 을 최대한 확보 (표시용)
function readLocalName() {
    try {
        const cu = JSON.parse(localStorage.getItem('currentUser') || 'null');
        if (cu && (cu.name || cu.username)) return cu.name || cu.username;
    } catch (_) {}
    try {
        const a = JSON.parse(localStorage.getItem('auth') || 'null');
        if (a) {
            if (a.user && (a.user.name || a.user.username)) return a.user.name || a.user.username;
            if (a.name) return a.name;
        }
    } catch (_) {}
    const p = decodeJwt(getToken());
    if (p && (p.name || p.username)) return p.name || p.username;
    return '';
}


// 표시용 정규화: 송성민/s s -> '송성민', 그 외 -> '강미르'
function normalizeDisplayName(name) {
    const n = String(name || '').trim().toLowerCase();
    if (ME_ALIAS.map(s => s.toLowerCase()).includes(n)) return '송성민';
    return '송성민';
}

let _blocked = false;
function blockUnauthorizedUser() {
    if (_blocked) return;
    _blocked = true;
    // 토큰은 '권한 요청'에 필요하므로 즉시 폐기하지 않고, 화면 이동 시 폐기

    const ov = document.createElement('div');
    ov.id = 'auth-block-overlay';
    ov.innerHTML =
        '<div class="abx-card">' +
        '<div class="abx-icon">' + icon('lock',40) + '</div>' +
        '<p class="abx-msg">아직 접근 권한이 없습니다.<br>관리자 승인 후 이용할 수 있습니다.</p>' +
        '<button type="button" id="abx-request-btn" class="abx-request-btn">권한 요청하기</button>' +
        '<button type="button" id="abx-login-btn" class="abx-login-btn">방 화면으로</button>' +
        '<div class="abx-sub">권한을 요청하면 관리자에게 전달됩니다.</div>' +
        '</div>';
    document.body.appendChild(ov);

    var rq = document.getElementById('abx-request-btn');
    if (rq) rq.addEventListener('click', requestAccessFromBlock);
    var lg = document.getElementById('abx-login-btn');
    // 방 화면으로: 토큰을 유지한 채 방 목록으로 이동 (logout 호출 X → rooms.js 가 로그인으로 되튕기지 않음)
    if (lg) lg.addEventListener('click', function () { location.replace('rooms.html'); });
}

// ==========================================
// 1-c. 상세 모달/리스트 모달에서 공유할 컨텍스트 & 공용 헬퍼
// ==========================================
const Daylog = {
    currentUid: '',
    api: API_BASE_URL,
    memories: [],
    meUid: null,
    partnerUid: null,
    reload: function () {},
    authHeaders: function () { return {}; },
    handleResponse: async function (r) { return r; },
    // [B] edit by smsong - 프로필 이미지 즉시 반영용 캐시버스터.
    //  같은 GCS 경로로 사진을 덮어쓰면 브라우저가 예전 이미지를 캐시해 새 사진이 안 보이는 문제 해결.
    //  프로필이 바뀔 때마다 _imgVer 를 올려 src 뒤에 ?v= 를 갱신 → 강제 재다운로드.
    _imgVer: Date.now(),
    bustImg: function (url) {
        if (!url) return url;
        // 서명된 URL(GCS signed 등)에는 쿼리를 덧붙이면 서명이 깨지므로 그대로 둔다.
        if (/[?&](x-goog-|goog-|signature=|expires=|googleaccessid=|token=)/i.test(url)) return url;
        var sep = url.indexOf('?') >= 0 ? '&' : '?';
        return url + sep + 'v=' + Daylog._imgVer;
    },
    bumpImgVer: function () { Daylog._imgVer = Date.now(); }
    // [E] edit by smsong
};

// ==========================================
// 라인 아이콘 시스템 — 기본 이모지 대체 (Daylog 웜톤 톤, currentColor 상속)
// 하단 네비/헤더와 통일된 부드러운 라인 스타일.
// ==========================================
const ICON_PATHS = {
    search:   '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    pin:      '<path d="M21 10c0 6-9 12-9 12s-9-6-9-12a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    camera:   '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l2-3h8l2 3h3a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="3.5"/>',
    bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
    target:   '<circle cx="12" cy="12" r="7"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/>',
    book:     '<path d="M2 4h7a3 3 0 0 1 3 3v13a2.5 2.5 0 0 0-2.5-2.5H2z"/><path d="M22 4h-7a3 3 0 0 0-3 3v13a2.5 2.5 0 0 1 2.5-2.5H22z"/>',
    map:      '<polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>',
    user:     '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    edit:     '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    trash:    '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
    logout:   '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    refresh:  '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    rotate:   '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
    maximize: '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>',
    scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/>',
    check:    '<polyline points="20 6 9 17 4 12"/>',
    close:    '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    plus:     '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    heart:    '<path d="M20.8 5.1a5.4 5.4 0 0 0-7.7 0L12 6.2l-1.1-1.1a5.4 5.4 0 1 0-7.7 7.6l1.1 1.1L12 21l7.7-7.2 1.1-1.1a5.4 5.4 0 0 0 0-7.6z"/>',
    comment:  '<path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.4 8.6 8.6 0 0 1-4-.9L3 20l1.1-4.9A8.4 8.4 0 0 1 12.5 3 8.4 8.4 0 0 1 21 11.5z"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    sparkle:  '<path d="M12 3l1.7 4.8L18.5 9l-4.8 1.2L12 15l-1.7-4.8L5.5 9l4.8-1.2z"/><path d="M19 13l.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6z"/>',
    image:    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="M21 15l-5-5L5 21"/>',
    lock:     '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    coffee:   '<path d="M17 8h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M3 8h14v6a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z"/><line x1="6" y1="2" x2="6" y2="4.5"/><line x1="10" y1="2" x2="10" y2="4.5"/><line x1="14" y1="2" x2="14" y2="4.5"/>',
    food:     '<path d="M7 2v8M10 2v8M7 10a1.5 1.5 0 0 0 3 0M8.5 10v12"/><path d="M16 2c-1.4 0-2.5 2.2-2.5 5s1.1 3.8 2.5 3.8V22"/>'
};
// icon(name, size, extraStyle, filled) → 인라인 SVG 문자열
function icon(name, size, extraStyle, filled) {
    const sz = size || 16;
    const sw = sz <= 18 ? 1.9 : 1.7;
    const fill = filled ? 'currentColor' : 'none';
    const stroke = filled ? 'none' : 'currentColor';
    return '<svg class="ic ic-' + name + '" width="' + sz + '" height="' + sz + '" viewBox="0 0 24 24" '
        + 'fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + sw + '" stroke-linecap="round" '
        + 'stroke-linejoin="round" style="vertical-align:middle;flex-shrink:0;' + (extraStyle || '') + '" '
        + 'aria-hidden="true">' + (ICON_PATHS[name] || '') + '</svg>';
}
// 위치(핀) 텍스트 — 배지/메타용. 동적 텍스트는 escape.
function pinText(t) { return icon('pin', 14) + ' ' + escapeHtml(t == null ? '' : t); }

// 가볼곳(체크리스트) 타입 메타 — 라벨/아이콘/색상을 한 곳에서 관리 (emoji → 라인 아이콘)
const CHECKLIST_TYPES = {
    CAFE: { label: '카페', iconKey: 'coffee',  color: '#b06a4f', get emoji() { return icon(this.iconKey, 15, 'color:' + this.color + ';'); } },
    FOOD: { label: '식당', iconKey: 'food',    color: '#3f7fb0', get emoji() { return icon(this.iconKey, 15, 'color:' + this.color + ';'); } },
    SPOT: { label: '장소', iconKey: 'pin',     color: '#5f9e6f', get emoji() { return icon(this.iconKey, 15, 'color:' + this.color + ';'); } },
    ETC:  { label: '기타', iconKey: 'sparkle', color: '#7a756e', get emoji() { return icon(this.iconKey, 15, 'color:' + this.color + ';'); } }
};
function checklistType(t) { return CHECKLIST_TYPES[t] || CHECKLIST_TYPES.ETC; }
function fmtDate(s) { return s ? String(s).substring(0, 10).replace(/-/g, '.') : ''; }
// [B] edit by smsong - 권한은 서버(권한 메뉴/DB) 기준. Daylog.myPerm 에 내 '실효' 권한 플래그 보관.
//  소유자 우회 없이 순수 권한 기준 → 권한이 회수되면 해당 버튼(생성/수정/휴지통/삭제)이 모두 사라짐.
function _myPerm() { return (Daylog && Daylog.myPerm) ? Daylog.myPerm : null; }
function isAdminUser() { var p = _myPerm(); return !!(p && p.admin); }
function canCreateObject() { var p = _myPerm(); return !!(p && (p.admin || p.canCreate)); } // 생성 권한
function isPrivilegedUser() { var p = _myPerm(); return !!(p && (p.admin || p.canEdit)); }   // (구) 수정 권한
// [B] edit by smsong - #2 작성자(본인) 또는 관리자(방장)만 수정/휴지통/삭제 가능
function _isAdminPerm() { var p = _myPerm(); return !!(p && p.admin); }
function isOwnerOf(item) { return !!(item && item.ownerUid && Daylog.currentUid && item.ownerUid === Daylog.currentUid); }
function canManageObject(item) { var p = _myPerm(); return _isAdminPerm() || (isOwnerOf(item) && !!(p && p.canEdit)); }   // 수정 버튼
function canTrashObject(item) { var p = _myPerm(); return _isAdminPerm() || (isOwnerOf(item) && !!(p && p.canTrash)); }   // 휴지통 버튼
function canDeleteObject(item) { var p = _myPerm(); return _isAdminPerm() || (isOwnerOf(item) && !!(p && p.canDelete)); } // 영구삭제 버튼
// 생성 FAB 표시/차단 (권한 없으면 숨김)
function applyPermButtons() {
    var show = canCreateObject();
    ['btn-timeline-add', 'btn-checklist-add'].forEach(function (id) {
        var b = document.getElementById(id);
        if (b) b.style.display = show ? '' : 'none';
    });
}
if (Daylog) Daylog.applyPermButtons = applyPermButtons;
// [E] edit by smsong
// [B] edit by smsong - 권한 로딩 / 관리자 권한 메뉴 / 접근 요청
function applyMyPermUI() {
    var p = (Daylog && Daylog.myPerm) ? Daylog.myPerm : null;
    var admin = (p && p.admin) || isRoomOwner(); // [smsong] 방장 = 관리자 (하드코딩 uid 제거)
    var btn = document.getElementById('btn-perm-admin');
    if (btn) btn.style.display = admin ? '' : 'none';
    applyPermButtons(); // 생성 FAB 표시/차단 반영
}
// 앱 진입 시: 방별 권한을 서버에 등록(upsert)하고 받아와 게이트/관리자 메뉴 결정
//  관리자 = 방장. 미승인 멤버는 차단 화면(권한 요청 폼) 표시.
function loadMyPermission() {
    if (!(Daylog && Daylog.api)) return Promise.resolve(null);
    return withLoading(fetch(Daylog.api + '/api/permissions/register', { method: 'POST', headers: Daylog.authHeaders(true) })
        .then(function (res) {
            if (!res.ok) { console.error('[Daylog] 권한 등록(register) 실패 - HTTP ' + res.status); throw new Error('HTTP ' + res.status); }
            return res.json();
        })
        .then(function (p) {
            Daylog.myPerm = p || null;
            applyMyPermUI();
            try { applyRoomNotifToggle(); } catch (e) {} // [B] edit by smsong - #3 방 알림 토글 상태 반영
            if (p && !p.accessAllowed && !p.admin) { blockUnauthorizedUser(); } // 접근 미허용 → 차단
            // [B] edit by smsong - 방장(관리자)이면 진입 시 대기중 접근 요청 알림 확인
            else if ((p && p.admin) || isRoomOwner()) { try { checkPendingAccessRequests(); } catch (e) {} }
            // [B] edit by smsong - 승인된 일반 멤버 최초 진입: 환영/이용수칙 폼 1회 표시
            if (p && p.accessAllowed && !p.admin && !isRoomOwner() && p.welcomeSeen === false) {
                try { showWelcomeModal(); } catch (e) {}
            }
            // [E] edit by smsong
            return p;
        })
        .catch(function () {
            // 서버 확인 불가 → 방장(로컬 판정, 하드코딩 아님)만 전권 폴백, 그 외는 차단
            if (isRoomOwner()) {
                Daylog.myPerm = { admin: true, accessAllowed: true, canCreate: true, canEdit: true, canTrash: true, canDelete: true };
                applyMyPermUI();
            } else {
                Daylog.myPerm = null;
                applyMyPermUI();
                blockUnauthorizedUser();
            }
            return null;
        }), '방 정보를 불러오는 중...'); // [smsong] 로딩
}
if (Daylog) Daylog.loadMyPermission = loadMyPermission;

// [smsong] ===== 방 멤버 관리 (방장 전용: 목록 + 강퇴) =====
function _escHtml(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function openRoomMembers() {
    var modal = document.getElementById('room-members-modal');
    var body = document.getElementById('room-members-body');
    if (!modal || !body) return;
    modal.classList.remove('hidden');
    body.innerHTML = '<div class="perm-loading">불러오는 중...</div>';
    var roomId = getRoomId();
    fetch(Daylog.api + '/api/rooms/' + encodeURIComponent(roomId) + '/members', { headers: Daylog.authHeaders(true) })
        .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
        .then(function (room) { renderRoomMembers(room); })
        .catch(function (err) {
            body.innerHTML = '<div class="perm-error" style="padding:16px;color:#8a8178;">멤버를 불러오지 못했습니다.</div>';
            console.error('[Daylog] 멤버 조회 실패:', err);
        });
}
function renderRoomMembers(room) {
    var body = document.getElementById('room-members-body');
    if (!body) return;
    var members = (room && room.members) || [];
    var myUid = getUid();
    var amOwner = !!(room && room.ownerUid === myUid);
    var html = '<div class="rm-head">구성원 ' + members.length + '명</div><div class="rm-list">';
    members.forEach(function (m) {
        var name = m.nickname || m.name || m.uid;
        var avatar = m.profileURL
            ? '<img src="' + _escHtml(m.profileURL) + '" alt="" class="rm-avatar-img">'
            : '<span class="rm-avatar-fallback">' + icon('user', 20) + '</span>';
        var badge = m.owner ? '<span class="rm-badge">방장</span>' : '';
        var action = (amOwner && !m.owner)
            ? '<button class="rm-kick" data-uid="' + _escHtml(m.uid) + '" data-name="' + _escHtml(name) + '">강퇴하기</button>'
            : '';
        html += '<div class="rm-item">' +
                    '<span class="rm-avatar">' + avatar + '</span>' +
                    '<span class="rm-name">' + _escHtml(name) + ' ' + badge + '</span>' +
                    action +
                '</div>';
    });
    html += '</div>';
    body.innerHTML = html;
    body.querySelectorAll('.rm-kick').forEach(function (btn) {
        btn.addEventListener('click', function () {
            kickRoomMember(btn.getAttribute('data-uid'), btn.getAttribute('data-name'));
        });
    });
}
function kickRoomMember(targetUid, name) {
    var nm = name || (((Daylog._permList || []).find(function (x) { return x.uid === targetUid; }) || {}).nickname) || targetUid;
    // [B] edit by smsong - prompt()는 일부 PWA/웹뷰에서 차단(null 반환)되어 강퇴가 조용히 취소됨.
    //  → 앱 내부 DOM 모달(promptRejectReason)을 강퇴 사유 입력에도 재사용한다.
    //  확인=문자열(빈 문자열 허용) → 강퇴 진행, 취소=null → 아무 것도 안 함.
    if (typeof promptRejectReason !== 'function') return;
    promptRejectReason({
        title: '멤버 강퇴',
        desc: "'" + nm + "' 님을 강퇴합니다. 사유를 남기면 해당 멤버에게 전달돼요. (선택)\n강퇴된 멤버는 다시 입장하면 환영·동의 화면을 처음부터 다시 보게 됩니다.",
        placeholder: '예: 방 성격과 맞지 않아요.',
        confirmText: '강퇴하기'
    }).then(function (reason) {
        if (reason === null) return; // 취소
        var roomId = getRoomId();
        var kickUrl = Daylog.api + '/api/rooms/' + encodeURIComponent(roomId) + '/members/' + encodeURIComponent(targetUid) +
            '?uid=' + encodeURIComponent(getUid());
        if (reason && reason.trim()) kickUrl += '&reason=' + encodeURIComponent(reason.trim());
        withLoading(fetch(kickUrl,
            { method: 'DELETE', headers: Daylog.authHeaders(true) }), '강퇴하는 중...')
            .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return true; })
            .then(function () {
                showToast('멤버를 강퇴했습니다');
                if (typeof openPermissionAdmin === 'function') openPermissionAdmin(); // 목록 새로고침
                if (Daylog.refreshMemberProfile) Daylog.refreshMemberProfile();
                if (Daylog.loadRoomInfo) Daylog.loadRoomInfo(true);
            })
            .catch(function (err) { showToast('강퇴 실패'); console.error(err); });
    });
    // [E] edit by smsong
}
function closeRoomMembers() {
    var modal = document.getElementById('room-members-modal');
    if (modal) modal.classList.add('hidden');
}
if (Daylog) { Daylog.openRoomMembers = openRoomMembers; }


// 권한 API 전용 fetch: handleResponse(자동 로그아웃/차단 튕김)를 쓰지 않고 상태코드를 그대로 표면화
// [B] edit by smsong - #3 방 알림 켜기/끄기 토글
function applyRoomNotifToggle() {
    var btn = document.getElementById('btn-room-notif-toggle');
    if (!btn) return;
    var muted = !!(window.Daylog && Daylog.myPerm && Daylog.myPerm.notifyMuted);
    var on = !muted;
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.classList.toggle('on', on); // CSS 스위치가 ON/OFF 표시
}
function toggleRoomNotif() {
    if (!(window.Daylog && Daylog.api)) return;
    var curMuted = !!(Daylog.myPerm && Daylog.myPerm.notifyMuted);
    var newMuted = !curMuted;
    withLoading(_permFetch('/api/permissions/notify-mute?muted=' + newMuted, { method: 'POST', headers: Daylog.authHeaders(true) }), '변경 중...')
        .then(function (res) { return res.json ? res.json() : res; })
        .then(function (d) {
            if (Daylog.myPerm) Daylog.myPerm.notifyMuted = (d && typeof d.notifyMuted === 'boolean') ? d.notifyMuted : newMuted;
            applyRoomNotifToggle();
            showToast(newMuted ? '이 방 알림 꺼짐' : '이 방 알림 켜짐');
        })
        .catch(function () { showToast('변경에 실패했어요'); });
}

function _permFetch(path, opts) {
    return fetch(Daylog.api + path, opts || { headers: Daylog.authHeaders(true) })
        .then(function (res) {
            if (!res.ok) {
                return res.text().then(function (t) {
                    var e = new Error('HTTP ' + res.status + (t ? (' · ' + String(t).substring(0, 140)) : ''));
                    e.status = res.status;
                    throw e;
                });
            }
            return res.text().then(function (t) { return t ? JSON.parse(t) : null; });
        });
}

// [B] edit by smsong - 승인된 멤버 최초 진입: 환영 + 이용수칙 동의 폼
function showWelcomeModal() {
    var modal = document.getElementById('welcome-modal');
    if (!modal) return;
    var nameEl = document.getElementById('welcome-room-name');
    if (nameEl) nameEl.textContent = localStorage.getItem('selectedRoomName') || '우리';
    var chk = document.getElementById('welcome-consent-check');
    var btn = document.getElementById('welcome-enter-btn');
    if (chk) chk.checked = false;
    if (btn) btn.disabled = true;
    modal.classList.remove('hidden');
    setTimeout(fireWelcomeBurst, 120); // 로고 팝 애니메이션 직후 축포(팡)
}
// [B] edit by smsong - #3 축포 엔진 (캔버스 파티클)
//  ── 왜 다시 만들었나 ────────────────────────────────────────────────────────
//   기존은 탭 1회마다 span 376개를 만들고 CSS animation 으로 굴렸다. 그래서
//    · 탭해도 animation-delay(최대 1.1초) 때문에 즉시 안 터짐
//    · 연타하면 수천 개 노드가 쌓여 프레임이 무너짐(끊김 = '버그'로 보임)
//    · 노드 정리 타이밍과 탭 타이밍이 엉켜 이전 축포가 튀거나 사라짐
//   → 캔버스 1장 + requestAnimationFrame 물리 루프로 교체.
//
//  ── 동작 ────────────────────────────────────────────────────────────────────
//   · 탭 1회 = 즉시 터지는 폭죽 1발 + 하늘로 쏘아 올라 정점에서 터지는 포탄 3발
//     + 위에서 자연스럽게 내려오는 색종이. 전부 중력/공기저항으로 낙하한다.
//   · 탭할 때마다 파티클을 '추가'만 한다. 초기화·제거가 없으므로
//     이전 축포 위에 계속 겹쳐서 덮이고, 각자 수명이 끝나면 알아서 사라진다.
//   · 파티클이 0이 되면 루프가 자동으로 멈춘다(평소 CPU 사용 0).
//   · #welcome-fx 는 body 직속 position:fixed 라 디데이 폼을 내려도 축포는 끝까지 떨어진다.
var WFX = (function () {
    var COLORS = ['#b08968', '#e6ccb2', '#9c6644', '#cf8b8b', '#e8b4b4', '#c9a27e',
                  '#f0d9b5', '#f2c14e', '#e07a5f', '#81b29a', '#d1cbc1'];
    var MAX_PARTICLES = 2200;   // 연타 시 상한(넘으면 가장 오래된 것부터 제거)
    var GRAVITY = 980;          // px/s^2 — 중력
    var DRAG = 0.86;            // 공기저항(초당 감쇠율)

    var canvas = null, ctx = null, dpr = 1, vw = 0, vh = 0;
    var parts = [], raf = 0, last = 0, resizeBound = false;

    function rand(a, b) { return a + Math.random() * (b - a); }
    function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

    function resize() {
        if (!canvas) return;
        dpr = Math.min(window.devicePixelRatio || 1, 2); // 2 초과는 이득 없이 느리기만 함
        vw = window.innerWidth || 360;
        vh = window.innerHeight || 640;
        canvas.width = Math.floor(vw * dpr);
        canvas.height = Math.floor(vh * dpr);
        canvas.style.width = vw + 'px';
        canvas.style.height = vh + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function ensure() {
        var fx = document.getElementById('welcome-fx');
        if (!fx) return false;
        if (!canvas || canvas.parentNode !== fx) {
            fx.innerHTML = '';
            canvas = document.createElement('canvas');
            canvas.className = 'wfx-canvas';
            fx.appendChild(canvas);
            ctx = canvas.getContext('2d');
            resize();
            if (!resizeBound) {
                resizeBound = true;
                window.addEventListener('resize', resize);
                window.addEventListener('orientationchange', function () { setTimeout(resize, 120); });
            }
        }
        return true;
    }

    // ===== 파티클 생성기 =====

    // 정점에서 터질 포탄(쏘아 올라가는 동안 꼬리를 남김)
    function addShell(targetY) {
        var x = rand(vw * 0.12, vw * 0.88);
        // 정점이 targetY 가 되도록 초기 속도 역산: v = sqrt(2 * g * h)
        var h = Math.max(40, vh - targetY);
        parts.push({
            k: 'shell', x: x, y: vh + 8,
            vx: rand(-40, 40), vy: -Math.sqrt(2 * GRAVITY * h),
            color: pick(COLORS), life: 3, age: 0
        });
    }

    // 한 점에서 사방으로 터지는 불꽃
    function explode(cx, cy, color, count, power) {
        for (var i = 0; i < count; i++) {
            var ang = (Math.PI * 2) * (i / count) + rand(-0.18, 0.18);
            var sp = power * rand(0.45, 1.0);
            var life = rand(1.1, 2.0);
            parts.push({
                k: 'spark', x: cx, y: cy,
                vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
                r: rand(2.0, 4.6),
                color: (i % 6 === 0) ? pick(COLORS) : color,
                life: life, age: 0,
                sq: (i % 5 === 0) // 일부는 각진 조각
            });
        }
    }

    // 위에서 팔랑거리며 내려오는 색종이
    function addRibbons(n) {
        for (var i = 0; i < n; i++) {
            parts.push({
                k: 'ribbon',
                x: rand(-20, vw + 20), y: rand(-vh * 0.35, -10),
                vx: rand(-45, 45), vy: rand(90, 190),
                w: rand(5, 9), h: rand(9, 16),
                rot: rand(0, Math.PI * 2), vrot: rand(-5, 5),
                ph: rand(0, Math.PI * 2), pv: rand(4, 9),  // 팔랑임 위상/속도
                sw: rand(0.5, 1.1),                        // 좌우 흔들림 폭
                color: pick(COLORS),
                life: rand(3.2, 5.0), age: 0
            });
        }
    }

    // ===== 탭 1회 = 이 함수 1회 =====
    function fire(opts) {
        if (!ensure()) return;
        opts = opts || {};
        var scale = opts.scale || 1;

        // 1) 즉시 터지는 한 발 — 탭 반응이 바로 보이도록(대기 시간 0)
        explode(rand(vw * 0.2, vw * 0.8), rand(vh * 0.2, vh * 0.5),
                pick(COLORS), Math.round(46 * scale), rand(240, 340));

        // 2) 쏘아 올라가 정점에서 터질 포탄들 — 사방팔방
        var shells = Math.round((opts.shells || 3) * scale);
        for (var i = 0; i < shells; i++) addShell(rand(vh * 0.10, vh * 0.45));

        // 3) 위에서 내려오는 색종이
        addRibbons(Math.round((opts.ribbons || 34) * scale));

        trim();
        start();
    }

    function trim() {
        var over = parts.length - MAX_PARTICLES;
        if (over > 0) parts.splice(0, over); // 오래된 것부터 정리
    }

    // ===== 루프 =====
    function start() {
        if (raf) return;
        last = 0;
        raf = requestAnimationFrame(step);
    }

    function step(ts) {
        if (!last) last = ts;
        var dt = (ts - last) / 1000;
        last = ts;
        if (dt > 0.05) dt = 0.05;      // 탭 전환 복귀 시 순간이동 방지
        if (dt <= 0) dt = 0.016;

        var drag = Math.pow(DRAG, dt);
        ctx.clearRect(0, 0, vw, vh);

        for (var i = parts.length - 1; i >= 0; i--) {
            var p = parts[i];
            p.age += dt;

            if (p.k === 'shell') {
                p.vy += GRAVITY * dt;
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                // 정점 도달(상승→하강 전환) 순간 폭발
                if (p.vy >= 0) {
                    explode(p.x, p.y, p.color, 40, rand(230, 330));
                    parts.splice(i, 1);
                    continue;
                }
                // 꼬리
                ctx.globalAlpha = 0.9;
                ctx.fillStyle = p.color;
                ctx.beginPath();
                ctx.ellipse(p.x, p.y, 1.8, 5.5, 0, 0, Math.PI * 2);
                ctx.fill();
                continue;
            }

            if (p.k === 'spark') {
                p.vx *= drag; p.vy *= drag;
                p.vy += GRAVITY * 0.55 * dt;   // 불꽃은 중력을 조금 약하게(둥실 느낌)
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                var t = p.age / p.life;
                if (t >= 1 || p.y > vh + 40) { parts.splice(i, 1); continue; }
                ctx.globalAlpha = (t < 0.65) ? 1 : (1 - (t - 0.65) / 0.35); // 끝에서만 페이드
                ctx.fillStyle = p.color;
                var r = p.r * (1 - t * 0.45);
                if (p.sq) {
                    ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
                } else {
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
                    ctx.fill();
                }
                continue;
            }

            // ribbon
            p.ph += p.pv * dt;
            p.vy += GRAVITY * 0.16 * dt;              // 종이라 천천히 가속
            if (p.vy > 260) p.vy = 260;               // 종단속도
            p.x += (p.vx + Math.sin(p.ph) * 60 * p.sw) * dt;
            p.y += p.vy * dt;
            p.rot += p.vrot * dt;
            var rt = p.age / p.life;
            if (p.y > vh + 30 || rt >= 1) { parts.splice(i, 1); continue; }
            ctx.globalAlpha = (rt < 0.8) ? 1 : (1 - (rt - 0.8) / 0.2);
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.scale(Math.cos(p.ph) * 0.8 + 0.2, 1); // 앞뒤로 뒤집히는 팔랑임
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            ctx.restore();
        }

        ctx.globalAlpha = 1;

        if (parts.length) {
            raf = requestAnimationFrame(step);
        } else {
            raf = 0;                 // 파티클이 없으면 루프 정지(평소 CPU 0)
            ctx.clearRect(0, 0, vw, vh);
        }
    }

    // 탭이 백그라운드로 갔다 오면 dt 튀는 것 방지
    document.addEventListener('visibilitychange', function () { last = 0; });

    return { fire: fire };
})();

// 기존 호출부 호환(환영 모달 · 디데이 폼에서 그대로 fireWelcomeBurst() 사용)
function fireWelcomeBurst(opts) {
    // 이벤트 객체가 그대로 넘어와도 안전하도록 옵션만 골라 쓴다
    var o = (opts && typeof opts === 'object' && !opts.type) ? opts : null;
    WFX.fire(o || {});
}
// [E] edit by smsong
function closeWelcomeModal() {
    var modal = document.getElementById('welcome-modal');
    if (modal) modal.classList.add('hidden');
}
function confirmWelcome() {
    // 서버에 '봤음' 기록(실패해도 방 이용은 진행) 후 닫기
    if (Daylog && Daylog.api) {
        _permFetch('/api/permissions/welcome-seen', { method: 'POST', headers: Daylog.authHeaders(true) })
            .then(function () {}).catch(function () {});
    }
    if (Daylog && Daylog.myPerm) Daylog.myPerm.welcomeSeen = true;
    closeWelcomeModal();
}
// [E] edit by smsong

// 차단 화면에서 '권한 요청하기' (실패해도 반드시 화면에 사유 표시)
function requestAccessFromBlock() {
    var btn = document.getElementById('abx-request-btn');
    var sub = document.querySelector('#auth-block-overlay .abx-sub');
    if (!(Daylog && Daylog.api)) {
        if (sub) sub.textContent = '요청을 보낼 수 없습니다(설정 미완료). 새로고침 후 다시 시도해 주십시오.';
        return;
    }
    if (btn) { btn.disabled = true; btn.textContent = '요청 중...'; }
    _permFetch('/api/permissions/request', { method: 'POST', headers: Daylog.authHeaders(true) })
        .then(function () {
            if (sub) sub.textContent = '권한 요청이 전송되었습니다. 관리자 승인 후 이용할 수 있습니다.';
            if (btn) { btn.textContent = '요청 완료'; btn.disabled = true; }
        })
        .catch(function (err) {
            if (btn) { btn.disabled = false; btn.textContent = '권한 요청하기'; }
            var msg = (err && err.message) ? err.message : '알 수 없는 오류';
            if (sub) sub.textContent = '요청 전송 실패: ' + msg + ' — 관리자에게 문의해 주십시오.';
            console.error('[Daylog] 권한 요청 실패:', err);
        });
}

// ===== 관리자 권한 메뉴 =====
function openPermissionAdmin() {
    var modal = document.getElementById('perm-modal');
    var body = document.getElementById('perm-modal-body');
    if (!modal || !body) return;
    body.innerHTML = '<div class="perm-loading">불러오는 중...</div>';
    modal.classList.remove('hidden');
    withLoading(_permFetch('/api/permissions/users', { headers: Daylog.authHeaders(true) }), '불러오는 중...')
        .then(function (list) { renderPermissionList(list || []); })
        .catch(function (err) {
            var msg = (err && err.message) ? err.message : '';
            body.innerHTML = '<div class="perm-empty">목록을 불러오지 못했습니다.' +
                '<br><span style="font-size:0.78rem;color:#c0392b;">' + escapeHtml(msg) + '</span>' +
                '<br><span style="font-size:0.76rem;color:#8a8178;line-height:1.5;">권한 API가 정상 응답하지 않습니다. 서버의 SecurityConfig에서 <b>/api/permissions/**</b> 가 인증 통과되는지, Permission 모듈이 배포됐는지 확인해 주십시오.</span></div>';
            console.error('[Daylog] 권한 목록 실패:', err);
        });
}
function closePermissionAdmin() {
    var modal = document.getElementById('perm-modal');
    if (modal) modal.classList.add('hidden');
}
function permStatusLabel(p) {
    if (p.admin) return '<span class="perm-badge perm-admin">관리자</span>';
    if (p.accessAllowed) return '<span class="perm-badge perm-ok">접근 허용</span>';
    if (p.requestStatus === 'PENDING') return '<span class="perm-badge perm-pending">요청 대기</span>';
    if (p.requestStatus === 'REJECTED') return '<span class="perm-badge perm-rejected">거절됨</span>';
    return '<span class="perm-badge perm-none">미허용</span>';
}
function permToggle(p, key, label, disabled) {
    var on = !!p[key] || p.admin || p.bootstrap;
    return '<button type="button" class="perm-chip' + (on ? ' on' : '') + '"' + (disabled ? ' disabled' : '') +
        ' onclick="togglePerm(\'' + p.uid + '\',\'' + key + '\')">' + label + '</button>';
}
function renderPermissionList(list) {
    var body = document.getElementById('perm-modal-body');
    if (!body) return;
    if (!list.length) { body.innerHTML = '<div class="perm-empty">표시할 사용자가 없습니다.</div>'; return; }
    list.sort(function (a, b) {
        function rank(x) { if (x.admin) return 0; if (x.requestStatus === 'PENDING') return 1; if (x.accessAllowed) return 2; return 3; }
        return rank(a) - rank(b);
    });
    Daylog._permList = list;
    var html = '';
    list.forEach(function (p) {
        var name = (p.nickname && String(p.nickname).trim()) ? p.nickname : (p.name || p.uid);
        var avatar = p.profileURL
            ? '<img src="' + p.profileURL + '" class="perm-ava" alt="">'
            : '<div class="perm-ava perm-ava-empty">' + icon('user', 18) + '</div>';
        var lockToggles = (!p.accessAllowed || p.admin || p.bootstrap); // 관리자/부트스트랩(송성민·강미르)은 상시 전권 → 잠금
        html += '<div class="perm-row" data-uid="' + p.uid + '">' +
            '<div class="perm-user">' + avatar +
              '<div class="perm-user-meta"><div class="perm-name">' + escapeHtml(name) + '</div>' + permStatusLabel(p) + '</div>' +
            '</div>' +
            '<div class="perm-access">' +
              (p.admin ? '' :
                // [B] edit by smsong - '내보내기' 버튼 제거 + '접근 거절'을 '강퇴하기'(실제 강퇴)로 통합.
                //  강퇴 시 방에서 제거되며, 다시 입장하면 환영/동의 화면을 다시 보게 됨.
                (p.accessAllowed
                  ? '<button type="button" class="perm-btn perm-kick-btn" onclick="kickRoomMember(\'' + p.uid + '\')">강퇴하기</button>'
                  : '<button type="button" class="perm-btn perm-approve" onclick="decideAccess(\'' + p.uid + '\',true)">접근 허용</button>')) +
                // [E] edit by smsong
            '</div>' +
            // [B] edit by smsong - #3 4개 토글 → 역할(일반/멤버) 선택. 관리자는 라벨만.
            permRoleSelector(p, lockToggles) +
        '</div>';
    });
    body.innerHTML = html;
    // [B] edit by smsong - #4 저장 후 스크롤 위치 복원
    if (Daylog._permScrollKeep != null) {
        var _kp = Daylog._permScrollKeep; Daylog._permScrollKeep = null;
        body.scrollTop = _kp;
        requestAnimationFrame(function () { body.scrollTop = _kp; }); // 레이아웃 확정 후 한 번 더
    }
}

// [B] edit by smsong - #3 역할 선택 UI (일반 유저 / 멤버). 관리자(방장)는 잠금 라벨.
function permRoleSelector(p, lock) {
    if (p.admin) return '<div class="perm-role-label">관리자</div>';
    if (!p.accessAllowed) return ''; // 접근 허용 전에는 역할 선택 없음
    var isMember = !!p.canCreate;    // 멤버 = 생성권한 보유(생성/수정/삭제 가능)
    var dis = lock ? ' disabled' : '';
    return '<div class="perm-role">' +
        '<button type="button" class="perm-role-btn' + (!isMember ? ' active' : '') + '"' + dis + ' onclick="setPermRole(\'' + p.uid + '\',\'general\')">일반</button>' +
        '<button type="button" class="perm-role-btn' + (isMember ? ' active' : '') + '"' + dis + ' onclick="setPermRole(\'' + p.uid + '\',\'member\')">멤버</button>' +
    '</div>';
}
function setPermRole(uid, role) {
    var p = (Daylog._permList || []).find(function (x) { return x.uid === uid; });
    if (!p || p.admin) return;
    if (!p.accessAllowed) { showToast('먼저 접근을 허용해 주십시오'); return; }
    var member = (role === 'member');
    if (member === !!p.canCreate) return; // 변화 없으면 무시
    // 멤버: 생성/수정/삭제 가능(단, 수정·삭제는 본인 게시글만) · 일반: 조회+댓글만
    putPermission(uid, { accessAllowed: true, canCreate: member, canEdit: member, canTrash: member, canDelete: member });
}
function togglePerm(uid, key) {
    var p = (Daylog._permList || []).find(function (x) { return x.uid === uid; });
    if (!p || p.admin) return;
    if (!p.accessAllowed) { showToast('먼저 접근을 허용해 주십시오'); return; }
    var patch = { accessAllowed: !!p.accessAllowed, canCreate: !!p.canCreate, canEdit: !!p.canEdit, canTrash: !!p.canTrash, canDelete: !!p.canDelete };
    patch[key] = !p[key];
    putPermission(uid, patch);
}
// [B] edit by smsong - 사유 입력 모달 (Promise 반환: 확인=문자열(빈 문자열 허용), 취소=null)
//  거절/강퇴 등 상황별로 title·desc·placeholder·확인버튼 문구를 옵션으로 바꿔 재사용. 옵션 없으면 '입장 요청 거절' 기본.
var _rejectReasonResolver = null;
function promptRejectReason(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
        var modal = document.getElementById('reject-reason-modal');
        var input = document.getElementById('reject-reason-input');
        if (!modal || !input) { resolve(''); return; } // 모달 없으면 사유 없이 진행
        var titleEl = document.getElementById('reject-reason-title');
        var descEl = document.getElementById('reject-reason-desc');
        var confirmEl = document.getElementById('reject-reason-confirm');
        if (titleEl) titleEl.textContent = opts.title || '입장 요청 거절';
        if (descEl) descEl.textContent = opts.desc || '거절 사유를 남기면 요청한 사용자에게 전달됩니다. (선택 사항)';
        if (confirmEl) confirmEl.textContent = opts.confirmText || '거절하기';
        input.value = '';
        input.setAttribute('placeholder', opts.placeholder || '예: 아는 사람만 참여할 수 있는 방이에요.');
        _rejectReasonResolver = resolve;
        modal.classList.remove('hidden');
        setTimeout(function () { try { input.focus(); } catch (e) {} }, 50);
    });
}
function _closeRejectReason(result) {
    var modal = document.getElementById('reject-reason-modal');
    if (modal) modal.classList.add('hidden');
    var r = _rejectReasonResolver; _rejectReasonResolver = null;
    if (r) r(result); // null = 거절 자체를 취소
}
// 거절 시 사유를 붙여 /decide 호출 (approve=false 전용)
function _decideRejectUrl(uid, reason) {
    var u = '/api/permissions/' + encodeURIComponent(uid) + '/decide?approve=false';
    if (reason && String(reason).trim()) u += '&reason=' + encodeURIComponent(String(reason).trim());
    return u;
}
// [E] edit by smsong

function decideAccess(uid, approve) {
    // [B] edit by smsong - 거절이면 사유 입력 후 진행 (취소 시 아무 것도 안 함)
    if (!approve) {
        promptRejectReason().then(function (reason) {
            if (reason === null) return; // 사유 모달에서 취소
            withLoading(_permFetch(_decideRejectUrl(uid, reason),
                { method: 'POST', headers: Daylog.authHeaders(true) }), '거절하는 중...')
                .then(function () { openPermissionAdmin(); })
                .catch(function (err) { showToast('변경 실패: ' + (err && err.message ? err.message : '')); });
        });
        return;
    }
    withLoading(_permFetch('/api/permissions/' + encodeURIComponent(uid) + '/decide?approve=true',
        { method: 'POST', headers: Daylog.authHeaders(true) }), '허용하는 중...')
        .then(function () { openPermissionAdmin(); })
        .catch(function (err) { showToast('변경 실패: ' + (err && err.message ? err.message : '')); });
}
function putPermission(uid, patch) {
    // [B] edit by smsong - #4 권한 변경 후 목록 재렌더 시 스크롤 위치 유지
    var _pb = document.getElementById('perm-modal-body');
    Daylog._permScrollKeep = _pb ? _pb.scrollTop : 0;
    withLoading(_permFetch('/api/permissions/' + encodeURIComponent(uid),
        { method: 'PUT', headers: Daylog.authHeaders(true), body: JSON.stringify(patch) }), '저장하는 중...')
        .then(function () { openPermissionAdmin(); })
        .catch(function (err) { showToast('변경 실패: ' + (err && err.message ? err.message : '')); });
}
// [E] edit by smsong

// [B] edit by smsong - 방장 진입 시: 대기중(PENDING) 접근 요청 알림 폼
//  loadMyPermission 이후 방장/관리자면 checkPendingAccessRequests() 호출 →
//  요청이 있으면 모달을 띄우고, 각 요청을 즉시 수락/거절(기존 /decide API 재사용).
function checkPendingAccessRequests() {
    if (!(Daylog && Daylog.api)) return;
    _permFetch('/api/permissions/pending', { headers: Daylog.authHeaders(true) })
        .then(function (list) {
            if (!list || !list.length) return;         // 대기중 요청 없으면 조용히 종료
            renderAccessRequests(list);
            var modal = document.getElementById('access-request-modal');
            if (modal) modal.classList.remove('hidden');
        })
        .catch(function (err) { console.warn('[Daylog] 대기중 접근 요청 조회 실패:', err); });
}
function renderAccessRequests(list) {
    var body = document.getElementById('access-request-body');
    if (!body) return;
    if (!list || !list.length) { closeAccessRequestModal(); return; }
    var html = '';
    list.forEach(function (p) {
        var name = (p.nickname && String(p.nickname).trim()) ? p.nickname : (p.name || p.uid);
        var avatar = p.profileURL
            ? '<img src="' + escapeHtml(p.profileURL) + '" class="perm-ava" alt="">'
            : '<div class="perm-ava perm-ava-empty">' + icon('user', 18) + '</div>';
        var when = p.requestedAt ? fmtDateTime(p.requestedAt) : '';
        html += '<div class="perm-row areq-row" data-uid="' + escapeHtml(p.uid) + '">' +
            '<div class="perm-user">' + avatar +
              '<div class="perm-user-meta">' +
                '<div class="perm-name">' + escapeHtml(name) + '</div>' +
                '<span class="perm-badge perm-pending">' + (when ? (when + ' 요청') : '접근 요청') + '</span>' +
              '</div>' +
            '</div>' +
            '<div class="perm-access">' +
              '<button type="button" class="perm-btn perm-approve" onclick="decideAccessRequest(\'' + p.uid + '\',true,this)">수락</button>' +
              '<button type="button" class="perm-btn perm-revoke" onclick="decideAccessRequest(\'' + p.uid + '\',false,this)">거절</button>' +
            '</div>' +
        '</div>';
    });
    body.innerHTML = html;
}
function decideAccessRequest(uid, approve, btnEl) {
    var row = btnEl ? btnEl.closest('.areq-row') : null;
    // [B] edit by smsong - 거절이면 사유 입력 후 진행
    if (!approve) {
        promptRejectReason().then(function (reason) {
            if (reason === null) return; // 취소
            _sendDecideRequest(uid, false, reason, row);
        });
        return;
    }
    _sendDecideRequest(uid, true, null, row);
}
// [B] edit by smsong - 접근 요청 수락/거절 실제 전송 (거절 시 reason 포함)
function _sendDecideRequest(uid, approve, reason, row) {
    var url = approve
        ? '/api/permissions/' + encodeURIComponent(uid) + '/decide?approve=true'
        : _decideRejectUrl(uid, reason);
    withLoading(_permFetch(url, { method: 'POST', headers: Daylog.authHeaders(true) }),
        approve ? '수락하는 중...' : '거절하는 중...')
        .then(function () {
            showToast(approve ? '접근을 수락했습니다' : '접근을 거절했습니다');
            if (row && row.parentNode) row.parentNode.removeChild(row);
            var body = document.getElementById('access-request-body');
            if (body && !body.querySelector('.areq-row')) closeAccessRequestModal(); // 남은 요청 없으면 닫기
            // 권한 관리 모달이 열려 있으면 목록 동기화
            var permModal = document.getElementById('perm-modal');
            if (permModal && !permModal.classList.contains('hidden') && typeof openPermissionAdmin === 'function') openPermissionAdmin();
        })
        .catch(function (err) { showToast('처리 실패: ' + (err && err.message ? err.message : '')); });
}
function closeAccessRequestModal() {
    var modal = document.getElementById('access-request-modal');
    if (modal) modal.classList.add('hidden');
}
if (Daylog) { Daylog.checkPendingAccessRequests = checkPendingAccessRequests; }
// [E] edit by smsong
// 마지막 수정 일시 포맷 (YYYY.MM.DD HH:mm)
function fmtDateTime(s) {
    if (!s) return '';
    var t = String(s);
    var d = t.substring(0, 10).replace(/-/g, '.');
    var hm = (t.length >= 16) ? t.substring(11, 16) : '';
    return hm ? (d + ' ' + hm) : d;
}
// 상세보기 '마지막 수정' 줄 (수정 일시 + 수정자 프로필/닉네임). 2인 전용 usersByUid 에서 조회
// [B] edit by smsong - 전역 로딩 오버레이 헬퍼 (CRUD API 처리 중 클릭 차단 · 중복 제출 방지)
var _loadingCount = 0;
function showLoading(msg) {
    _loadingCount++;
    var ov = document.getElementById('loading-overlay');
    if (ov) {
        var t = ov.querySelector('.lo-text');
        if (t) t.textContent = msg || '처리 중입니다...';
        ov.classList.add('show');
        ov.setAttribute('aria-hidden', 'false');
    }
}
function hideLoading() {
    _loadingCount = Math.max(0, _loadingCount - 1);
    if (_loadingCount === 0) {
        var ov = document.getElementById('loading-overlay');
        if (ov) { ov.classList.remove('show'); ov.setAttribute('aria-hidden', 'true'); }
    }
}
// fetch(...) 프로미스를 감싸 로딩 표시/해제. 기존 .then/.catch 체인은 그대로 이어짐.
function withLoading(promise, msg) {
    showLoading(msg);
    return Promise.resolve(promise).finally(hideLoading);
}
if (Daylog) { Daylog.showLoading = showLoading; Daylog.hideLoading = hideLoading; Daylog.withLoading = withLoading; }
// [E] edit by smsong
// [B] edit by smsong - 휴지통 항목별 '며칠 뒤 자동 삭제' 텍스트 (백엔드 daysUntilAutoDelete 사용)
function autoDeleteText(o) {
    if (!o || o.daysUntilAutoDelete == null) return '';
    var d = o.daysUntilAutoDelete;
    var label = (d <= 0) ? '곧 자동 삭제됩니다' : (d + '일 뒤 자동 삭제됩니다');
    return '<div class="trash-autodel">' + label + '</div>';
}
// [E] edit by smsong
// [B] edit by smsong - 현재 미사용. 상세보기에서 '마지막 수정' 줄을 없앴다.
//  다시 표시하려면 openDetailModal / openChecklistDetail 의 view.innerHTML 안에
//  editedByHtml(memory) + / editedByHtml(item) + 한 줄만 되살리면 된다.
// [E] edit by smsong
function editedByHtml(item) {
    // [smsong] 실제 수정 이력이 없으면(미수정) 표시하지 않음 → 빈 줄 없이 위치~사진 간격만 유지
    if (!item || !item.updatedAt) return '';
    if (item.createdAt && String(item.updatedAt).substring(0,16) === String(item.createdAt).substring(0,16)) return '';
    var uid = item.lastEditorUid || item.ownerUid;
    var when = item.updatedAt;
    var u = (Daylog.usersByUid && uid) ? Daylog.usersByUid[uid] : null;
    var name = '';
    if (u) {
        name = (u.nickname && String(u.nickname).trim()) ? u.nickname
             : (typeof normalizeDisplayName === 'function' ? normalizeDisplayName(u.name) : (u.name || ''));
    }
    var photo = (u && u.profileURL) ? u.profileURL : DEFAULT_AVATAR;
    if (!when && !name) return '';
    return '<div class="detail-edited">' +
        '<span class="de-text">' + icon('edit',12) + ' 마지막 수정 ' + escapeHtml(fmtDateTime(when)) + '</span>' +
        '<span class="de-by"><span class="de-avatar" style="background-image:url(\'' + photo + '\')"></span>' + escapeHtml(name || '알 수 없음') + '</span>' +
        '</div>';
}
// [E] edit by smsong

// 카드 썸네일 HTML — 이미지가 있으면 배경이미지, 없으면 같은 크기의 '이미지 없음' 자리표시
// [B] edit by smsong - 목록 썸네일: CSS background-image(원본 풀사이즈, lazy 불가) → REMS 방식 <img>.
//  서버 소형 썸네일(thumb_) + loading="lazy"(뷰포트 근처에서만 로드) + decoding="async"(디코딩 비동기)
//  + onerror 폴백(구버전/HEIC는 원본으로). 목록 스크롤 시 버벅임/멈춤/깜빡임 제거.
function thumbHtml(mediaURL, cls) {
    const c = cls || 'tl-thumb';
    if (mediaURL) {
        const thumb = Daylog.thumbUrlOf(mediaURL);
        return '<div class="' + c + ' has-img"><img src="' + thumb + '" data-full="' + mediaURL +
            '" loading="lazy" decoding="async" alt="" onload="this.classList.add(\'is-loaded\')" onerror="Daylog._thumbFallback(this)"></div>';
    }
    return '<div class="' + c + ' thumb-empty"><span class="thumb-empty-icon">' + icon('image',22) + '</span><span class="thumb-empty-text">이미지 없음</span></div>';
}
// [E] edit by smsong

// [B] edit by smsong - 원본 이미지 URL → 서버가 만든 소형 썸네일(thumb_ 접두) URL 파생.
//  지도 마커/목록에서 원본(수 MB) 대신 썸네일을 써서 줌 인/아웃 시 재합성 부담 제거.
Daylog.thumbUrlOf = function (url) {
    if (!url) return url;
    var i = url.lastIndexOf('/');
    if (i < 0) return 'thumb_' + url;
    return url.substring(0, i + 1) + 'thumb_' + url.substring(i + 1);
};
// 썸네일이 아직 없거나(구버전 기록/HEIC 등) 로드 실패하면 원본으로 폴백
// [B] edit by smsong - 원본 1회 재시도(data-fb 가드) → 서버 썸네일 404 여도 항상 원본이 뜨게. 흰 썸네일 방지.
Daylog._thumbFallback = function (img) {
    try {
        var full = img.getAttribute('data-full');
        if (full && img.getAttribute('data-fb') !== '1' && img.src !== full) {
            img.setAttribute('data-fb', '1');
            img.src = full;               // onerror 유지 → 원본도 실패하면 다시 호출
            return;
        }
    } catch (e) {}
    img.onerror = null;                   // 원본까지 실패 → 중단(더 이상 재시도 안 함)
    img.classList.add('is-loaded');       // fade 클래스 보장(투명 잔상 방지)
};
// [B] edit by smsong - 목록(내 목록/댓글 목록 등) lm-thumb 도 동일하게 <img> + 서버 썸네일 + lazy/async.
Daylog.lmThumbHtml = function (mediaURL, emptyInner) {
    if (mediaURL) {
        var thumb = Daylog.thumbUrlOf(mediaURL);
        return '<div class="lm-thumb has-img"><img src="' + thumb + '" data-full="' + mediaURL +
            '" loading="lazy" decoding="async" alt="" onload="this.classList.add(\'is-loaded\')" onerror="Daylog._thumbFallback(this)"></div>';
    }
    return '<div class="lm-thumb lm-thumb-empty">' + (emptyInner || '') + '</div>';
};
// [E] edit by smsong
// [E] edit by smsong

// [smsong] 이미지 프리로드: 목록 로드 시 썸네일/마커/상세 첫 이미지를 미리 브라우저 캐시에 적재 → 즉시 표시
const _preloadedImgs = new Set();
function preloadImages(urls) {
    if (!urls) return;
    urls.forEach(u => {
        if (!u || _preloadedImgs.has(u)) return;
        _preloadedImgs.add(u);
        try { const im = new Image(); im.decoding = 'async'; im.src = u; } catch (e) {}
    });
}

// 좌표 → 주소 역지오코딩 (캐시 사용)
const _geoCache = {};
// [B] edit by smsong - 사용자 실시간 위치를 10분 단위로 서버(/api/locations)에 저장
//  ※ 웹(브라우저) 한계: 앱(탭)이 '실행 중'일 때만 동작. 앱을 완전히 종료한 백그라운드 상태에서의
//    자동 10분 저장은 브라우저 정책상 불가하며, 네이티브(iOS/Android, 예: Capacitor 백그라운드
//    위치 플러그인) 래핑이 필요함. 아래는 포그라운드 자동 적재 구현.
var _locTrackTimer = null;
function postCurrentLocation(source) {
    if (!(Daylog && Daylog.api && Daylog.currentUid)) return;
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(function (pos) {
        var c = pos.coords;
        reverseGeocode(c.latitude, c.longitude, function (addr) {
            var split = (typeof splitKoreanAddress === 'function') ? splitKoreanAddress(addr) : { placeName: '' };
            var body = {
                lat: c.latitude,
                lng: c.longitude,
                address: addr || '',           // 도로명 주소까지 상세
                roadAddress: addr || '',
                placeName: split.placeName || '',
                accuracy: (c.accuracy != null ? c.accuracy : null),
                altitude: (c.altitude != null ? c.altitude : null),
                speed: (c.speed != null ? c.speed : null),
                heading: (c.heading != null ? c.heading : null),
                source: source || 'foreground'
                // capturedAt 은 서버에서 현재 시각으로 기록
            };
            fetch(Daylog.api + '/api/locations', {
                method: 'POST',
                headers: Daylog.authHeaders(true),
                body: JSON.stringify(body)
            }).catch(function () { /* 적재 실패는 조용히 무시 */ });
        });
    }, function () { /* 위치 권한 거부/실패 시 조용히 무시 */ },
    { enableHighAccuracy: true, maximumAge: 60000, timeout: 15000 });
}
function startLocationTracking() {
    if (_locTrackTimer) return;
    postCurrentLocation('foreground');                                   // 진입 즉시 1회
    _locTrackTimer = setInterval(function () { postCurrentLocation('foreground'); }, 10 * 60 * 1000); // 10분 주기
    document.addEventListener('visibilitychange', function () {          // 앱 복귀 시 1회 갱신
        if (document.visibilityState === 'visible') postCurrentLocation('resume');
    });
}
if (Daylog) Daylog.startLocationTracking = startLocationTracking;
// [E] edit by smsong

function reverseGeocode(lat, lng, cb) {
    if (lat == null || lng == null) { cb(''); return; }
    const key = Number(lat).toFixed(5) + ',' + Number(lng).toFixed(5);
    if (_geoCache[key] !== undefined) { cb(_geoCache[key]); return; }
    if (!(window.naver && naver.maps.Service && naver.maps.Service.reverseGeocode)) { cb(''); return; }
    naver.maps.Service.reverseGeocode({
        coords: new naver.maps.LatLng(lat, lng),
        orders: [naver.maps.Service.OrderType.ROAD_ADDR, naver.maps.Service.OrderType.ADDR].join(',')
    }, (status, response) => {
        let addr = '';
        if (status === naver.maps.Service.Status.OK) {
            const r = response.v2;
            addr = (r && r.address) ? (r.address.roadAddress || r.address.jibunAddress || '') : '';
        }
        _geoCache[key] = addr;
        cb(addr);
    });
}

// 전체 주소를 큰 영역(시/도 + 시·군·구)과 상세 주소로 분리
//  예) '경기도 수원시 영통구 법조로 25 광교 SK VIEW Lake'
//      → placeName: '경기도 수원시', address: '영통구 법조로 25 광교 SK VIEW Lake'
//  예) '서울특별시 강남구 테헤란로 123' → placeName: '서울특별시 강남구', address: '테헤란로 123'
function splitKoreanAddress(full) {
    const s = String(full || '').trim();
    if (!s) return { placeName: '', address: '' };
    const parts = s.split(/\s+/);
    if (parts.length <= 2) return { placeName: parts.join(' '), address: '' };
    return {
        placeName: parts.slice(0, 2).join(' '),
        address: parts.slice(2).join(' ')
    };
}

function sortByDateDesc(a, b) { return new Date(b.createdAt) - new Date(a.createdAt); }

// ==========================================
// 2. 메인 앱 로직
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // 페이지 진입 시 가장 먼저 인증 체크
    if (!requireAuthOrRedirect()) return;

    // [B][E] edit by smsong : 앱 복귀 시 만료 임박이면 토큰 갱신(로그인 유지)
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'visible') return;
        if (isTokenValid()) { ensureFreshToken(); scheduleTokenRefresh(); }
    });

    // [B] edit by smsong - 접근 권한은 서버(권한 메뉴/DB) 기준으로 판정 (loadMyPermission)
    //  하드코딩 이름 즉시 차단은 제거 — DB에서 승인된 사용자도 통과해야 하므로 서버 응답으로 게이트.
    //  (서버 조회 실패 시에만 loadMyPermission 내부에서 이름 기반으로 폴백 차단)
    // [E] edit by smsong

    let map = null;
    let selectedFile = null;
    let currentLatLng = null;
    let currentLocationMeta = { placeName: '', address: '' }; // 장소명/상세주소 캡처
    window._pendingPlaceTitle = '';   // 장소 검색으로 고른 상호명(제목 자동입력용 · 추억/체크리스트 공용)
    let isWaitingForMapClick = false;
    let mapClickListener = null;
    let memoryList = [];
    let markers = []; // 지도 마커 인스턴스 보관 (중복 생성 방지)
    let cameraMode = false;        // 라이브 카메라로 촬영한 추억인지
    let pickReturnsToForm = false; // 위치 재설정 후 작성 폼으로 복귀(데이터 유지)
    let checklistList = [];        // 가볼곳(체크리스트) 목록
    let mapMode = 'memory';        // 지도 표시 데이터: 'memory' | 'checklist'
    let _mapMemDate = '';          // 지도 필터: 추억 날짜 (''=전체)
    let _mapClVisited = 'ALL';     // 지도 필터: 가볼곳 방문여부 (ALL | VISITED | TODO)
    let _mapClCat = 'ALL';         // 지도 필터: 가볼곳 카테고리 (ALL | CAFE | FOOD | SPOT | ETC)
    let _suppressDrop = false;     // 위치 클릭(focus) 시 마커 등장(markerDrop) 애니메이션 억제 → 흔들기만
    let pickTarget = 'memory';     // 위치 선택 후 열 폼: 'memory' | 'checklist'
    // [B] edit by smsong - '수정' 중 위치 재설정 복귀 컨텍스트
    let _editLocReturn = null;     // null | 'memory' | 'checklist'
    let _editLocItem = null;       // 편집 중이던 원본 아이템(시트 닫힘으로 _detailMemory/_detailChecklist 가 비워지므로 보관)
    let _editFormSnapshot = null;  // 편집 폼 입력값 스냅샷(복원용)
    // [E] edit by smsong
    let checklistLoaded = false;   // 체크리스트 최초 로드 여부
    let profilesLoaded = false;    // 프로필 최초 로드 여부 (탭 전환 시 매번 재요청 방지)
    let _memSig = null, _clSig = null, _profSig = null; // 변경 감지용 시그니처(같으면 재렌더 생략)
    function _listSig(v) { try { return JSON.stringify(v); } catch (e) { return String(Math.random()); } }
    let _clFilter = 'ALL';         // 가볼곳 카테고리 필터
    let _clVisitedFilter = 'ALL';  // 가볼곳 방문여부 필터 (ALL | VISITED | TODO)
    let _tlPlaceFilter = '';       // 타임라인 장소(placeName) 필터 (''=전체)
    let _tlKeyword = '';           // 타임라인 검색어 (제목/내용/위치)
    let _clKeyword = '';           // 가볼곳 검색어 (제목/내용/위치)

    const currentUid = getUid();

    // 상세/리스트 모달(전역 함수)에서 사용할 컨텍스트 주입
    Daylog.currentUid = currentUid;
    Daylog.api = API_BASE_URL;
    Daylog.authHeaders = authHeaders;
    Daylog.handleResponse = handleResponse;
    Daylog.reload = () => loadMemoriesFromServer();
    Daylog.reloadChecklists = () => loadChecklistsFromServer();
    // [B] edit by smsong - 로그인 상태면 실시간 위치 10분 단위 적재 시작
    if (currentUid) { try { startLocationTracking(); } catch (e) { console.warn('위치 추적 시작 실패', e); } }
    // 서버 권한 로딩 → 접근 게이트 + 관리자 메뉴 노출 (먼저 로컬 이름으로 메뉴 즉시 판정)
    try { applyPermButtons(); } catch (e) {} // 권한 확인 전엔 생성 FAB 숨김
    try { applyMyPermUI(); } catch (e) {}
    if (currentUid) { try { loadMyPermission(); } catch (e) { console.warn('권한 로딩 실패', e); } }
    // [B] edit by smsong - #4 방 멤버(작성자/수정자 이름)를 초기에 미리 로드 → 상세 진입 시 '작성자' 폴백 방지
    if (currentUid) { try { ensureRoomInfoThen(function () {}); } catch (e) {} }
    // [E] edit by smsong
    Daylog.openChecklistDetailById = (id) => {
        const c = checklistList.find(x => x.id === id);
        if (c) openChecklistDetail(c);
    };
    // [B] edit by smsong - 푸시 딥링크: 게시글 상세 열고 해당 댓글로 스크롤 (데이터 로드까지 폴링)
    Daylog.openMemoryDetailById = (id) => {
        const m = memoryList.find(x => String(x.id) === String(id));
        if (m) { openDetailModal(m); return true; }
        return false;
    };
    Daylog._openByDeepLink = function (type, id) {
        if (type === 'memory') {
            const m = memoryList.find(x => String(x.id) === String(id));
            if (m) { openDetailModal(m); return true; }
        } else if (type === 'checklist') {
            const c = checklistList.find(x => String(x.id) === String(id));
            if (c) { openChecklistDetail(c); return true; }
        }
        return false;
    };
    Daylog.handleDeepLink = function () {
        try {
            const p = new URLSearchParams(location.search);
            const type = p.get('type'), id = p.get('id'), comment = p.get('comment');
            if (!type || !id) return;
            let tries = 0;
            (function attempt() {
                if (Daylog._openByDeepLink(type, id)) {
                    if (comment) _scrollToComment(comment);
                    try { history.replaceState(null, '', 'main.html'); } catch (e) {}
                    return;
                }
                if (tries++ < 40) setTimeout(attempt, 250); // 최대 ~10초 데이터 대기
            })();
        } catch (e) {}
    };
    function _scrollToComment(commentId) {
        let tries = 0;
        (function attempt() {
            const el = document.querySelector('.comment-item[data-id="' + commentId + '"]');
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.classList.add('comment-highlight');
                setTimeout(function () { el.classList.remove('comment-highlight'); }, 2600);
                return;
            }
            if (tries++ < 30) setTimeout(attempt, 200); // 댓글 로드 대기
        })();
    }
    setTimeout(function () { try { Daylog.handleDeepLink(); } catch (e) {} }, 400);

    // 해당 마커를 잠깐 빠르게 흔들어 "여기입니다" 표시
    function shakeMarker(memory) {
        if (!memory) return;
        const m = markers.find(mk => mk._memoryId === memory.id);
        if (!m || typeof m.getElement !== 'function') return;
        const el = m.getElement();
        if (!el) return;
        const target = el.querySelector('.custom-marker') || el.querySelector('.marker-heart') || el.firstElementChild || el;
        target.classList.remove('marker-shake');
        void target.offsetWidth; // 애니메이션 재시작을 위한 리플로우
        target.classList.add('marker-shake');
        setTimeout(() => target.classList.remove('marker-shake'), 900);
    }

    // 상세보기에서 위치 클릭 → '지도' 탭으로 이동 후 해당 위치로 이동 + 마커 흔들기
    Daylog.focusOnMap = function (memory) {
        if (!memory || memory.lat == null || memory.lng == null) return;
        closeDetailModal();
        try { closeListModal(); } catch (e) {} // [B] edit by smsong - 설정 멤버뷰 등에서 열린 목록 모달도 닫아 지도가 보이게
        const mapNav = document.querySelector('.nav-item[data-tab="tab-map"]');
        if (mapNav) mapNav.click(); // 탭 전환 + map resize 트리거
        _suppressDrop = true;       // 등장 애니메이션 끄고 '흔들기'만
        _mapMemDate = '';           // 날짜 필터로 가려지지 않게
        // 가볼곳 모드였다면 추억 모드로 전환하며 추억 마커 렌더
        if (mapMode !== 'memory') setMapMode('memory');
        else refreshMapMarkers();
        setTimeout(() => {
            if (!map) return;
            // [B] edit by smsong - 현재 지도 위치에서 대상까지 중앙+줌을 한 번에 부드럽게 이동(morph)
            const target = new naver.maps.LatLng(memory.lat, memory.lng);
            if (typeof map.morph === 'function') {
                map.morph(target, 16, { duration: 650, easing: 'easeOutCubic' });
                setTimeout(() => shakeMarker(memory), 720);
            } else {
                map.setZoom(16);
                map.panTo(target);
                setTimeout(() => shakeMarker(memory), 460);
            }
            // [E] edit by smsong
        }, 120);
        setTimeout(() => { _suppressDrop = false; }, 1600);
    };

    // 가볼곳 상세에서 위치 클릭 → 지도(체크리스트 모드)로 이동 + 마커 흔들기
    function shakeChecklistMarker(item) {
        if (!item) return;
        const m = markers.find(mk => mk._checklistId === item.id);
        if (!m || typeof m.getElement !== 'function') return;
        const el = m.getElement();
        if (!el) return;
        const target = el.querySelector('.cl-marker') || el.firstElementChild || el;
        target.classList.remove('marker-shake');
        void target.offsetWidth;
        target.classList.add('marker-shake');
        setTimeout(() => target.classList.remove('marker-shake'), 900);
    }
    Daylog.focusChecklistOnMap = function (item) {
        if (!item || item.lat == null || item.lng == null) return;
        closeChecklistDetail();
        try { closeListModal(); } catch (e) {} // [B] edit by smsong - 설정 멤버뷰 등에서 열린 목록 모달도 닫아 지도가 보이게
        const mapNav = document.querySelector('.nav-item[data-tab="tab-map"]');
        if (mapNav) mapNav.click();
        _suppressDrop = true;        // 등장 애니메이션 끄고 '흔들기'만
        _mapClVisited = 'ALL';       // 방문여부 필터로 가려지지 않게
        _mapClCat = 'ALL';           // 카테고리 필터로 가려지지 않게
        if (mapMode !== 'checklist') setMapMode('checklist');
        else refreshMapMarkers();
        setTimeout(() => {
            if (!map) return;
            // [B] edit by smsong - 현재 지도 위치에서 대상까지 중앙+줌을 한 번에 부드럽게 이동(morph)
            const target = new naver.maps.LatLng(item.lat, item.lng);
            if (typeof map.morph === 'function') {
                map.morph(target, 16, { duration: 650, easing: 'easeOutCubic' });
                setTimeout(() => shakeChecklistMarker(item), 720);
            } else {
                map.setZoom(16);
                map.panTo(target);
                setTimeout(() => shakeChecklistMarker(item), 460);
            }
            // [E] edit by smsong
        }, 120);
        setTimeout(() => { _suppressDrop = false; }, 1600);
    };

    const mapWrapper = document.getElementById('map-wrapper');
    const locationMode = document.getElementById('location-mode');
    const fileInput = document.getElementById('memory-file');

    // --- 디데이 (방 커플 기준일로 표시, 커플 방에만) ---
    applyDdayVisibility();

    // --- 로그아웃 (헤더 버튼은 알림으로 교체됨 → null 가드. 로그아웃은 설정 메뉴 버튼 사용) ---
    var _btnLogout = document.getElementById('btn-logout');
    if (_btnLogout) _btnLogout.addEventListener('click', (e) => {
        e.preventDefault();
        if (confirm('로그아웃을 진행합니다.')) serverLogoutThenRedirect('로그아웃 되었습니다.');
    });

    // [B] edit by smsong - main 상단 좌측 Daylog 로고 → 확인 후 방 목록으로 이동 (main 페이지 전용)
    const navLogo = document.querySelector('.navbar .logo');
    if (navLogo) {
        navLogo.style.cursor = 'pointer';
        navLogo.setAttribute('title', '방 목록으로 이동');
        navLogo.addEventListener('click', () => {
            if (confirm('방 목록으로 이동합니다.')) location.href = 'rooms.html';
        });
        // [B] edit by smsong - #1 키보드(Enter/Space)도 confirm 경유
        navLogo.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (confirm('방 목록으로 이동합니다.')) location.href = 'rooms.html'; }
        });
    }
    // [E] edit by smsong

    // --- 탭 전환 ---
    const navItems = document.querySelectorAll('.nav-item');
    const tabContents = document.querySelectorAll('.tab-content');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            const targetTab = item.getAttribute('data-tab');
            if (!targetTab) return;
            // [smsong] 상세보기가 열려 있으면 메뉴 전환 시 자동으로 내려감(닫기)
            if (_memorySheet && _memorySheet.isOpen()) closeDetailModal();
            if (_clSheet && _clSheet.isOpen()) closeChecklistDetail();
            // [smsong] 탭 전환 시 필터 팝오버 닫기
            ['tl-filter-pop', 'cl-filter-pop'].forEach(id => { var pe = document.getElementById(id); if (pe) pe.classList.add('hidden'); });
            document.body.setAttribute('data-active-tab', targetTab);
            tabContents.forEach(tab => {
                tab.style.display = (tab.id === targetTab) ? 'block' : 'none';
            });
            // 메뉴 이동 시 항상 맨 위로 (이전 스크롤 위치 잔존 방지)
            const containerScroll = document.querySelector('main.container');
            if (containerScroll) containerScroll.scrollTop = 0;
            window.scrollTo(0, 0);
            document.body.classList.remove('map-immersive'); // 지도 몰입모드 해제 → 헤더/하단바 복귀
            // [B] edit by smsong - #2 탭 전환 시 피드를 첫 페이지(최신 5개)로 되돌린다.
            //  탭을 벗어났다 돌아오면 이전에 스크롤로 펼쳐 둔 항목이 그대로 남아 있으므로 초기화.
            //  (스크롤은 바로 위에서 이미 맨 위로 올려 둔 상태)
            if (Daylog._resetFeeds) Daylog._resetFeeds();
            // display:none 상태에서는 높이를 잴 수 없으니, 보이게 된 뒤 한 번 더 계산
            requestAnimationFrame(function () { if (Daylog._relayoutFeeds) Daylog._relayoutFeeds(); });
            // [E] edit by smsong
            if (targetTab === 'tab-map' && map) {
                naver.maps.Event.trigger(map, 'resize');
            }
            // 즉시 캐시 화면을 보여주고(이미 그려져 있음), 백그라운드에서 조용히 최신화.
            // 데이터가 실제로 바뀐 경우에만 다시 그리므로 전환 속도 유지 + 깜빡임 없음.
            if (targetTab === 'tab-profile') loadProfiles();
            if (targetTab === 'tab-checklist') {
                loadChecklistsFromServer();
                // [B][E] edit by smsong - #13 달력 보기 상태면 달력 데이터도 갱신
                if (Daylog._calendarView && Daylog._calendarView() === 'calendar' && Daylog._reloadCalendar) Daylog._reloadCalendar();
            }
            if (targetTab === 'tab-timeline') loadMemoriesFromServer();
        });
    });

    // --- 네이버 지도 초기화 ---
    if (window.APP_CONFIG && window.APP_CONFIG.NAVER_MAP_CLIENT_ID) {
        const script = document.createElement('script');
        script.src = 'https://openapi.map.naver.com/openapi/v3/maps.js?submodules=geocoder&ncpKeyId=' + window.APP_CONFIG.NAVER_MAP_CLIENT_ID;
        script.async = true;
        script.onload = () => initMap();
        script.onerror = () => showMapFallback('지도 조회 실패. 네트워크나 키 설정을 확인해주십시오.');
        document.head.appendChild(script);
    } else {
        showMapFallback('지도 키가 설정되지 않음. config.js의 NAVER_MAP_CLIENT_ID를 확인해주십시오.');
    }

    function showMapFallback(msg) {
        const mapEl = document.getElementById('naver-map');
        if (!mapEl) return;
        mapEl.innerHTML = '<div class="map-fallback"><span class="mf-icon">' + icon('map',38) + '</span><p>' + escapeHtml(msg) + '</p></div>';
    }

    let currentLocMarker = null; // 내 현재 위치(파란 점) 마커

    function placeMyLocation(lat, lng) {
        if (!map || !(window.naver && naver.maps)) return;
        const pos = new naver.maps.LatLng(lat, lng);
        if (!currentLocMarker) {
            currentLocMarker = new naver.maps.Marker({
                position: pos, map: map, zIndex: 50, clickable: false,
                icon: {
                    content: '<div class="my-loc-dot"><span class="my-loc-pulse"></span><span class="my-loc-beam"></span></div>', /* [smsong] 방향 빔 추가 */
                    anchor: new naver.maps.Point(11, 11)
                }
            });
        } else {
            currentLocMarker.setPosition(pos);
            if (!currentLocMarker.getMap()) currentLocMarker.setMap(map);
        }
    }

    // [B] edit by smsong - 네이버 지도 앱 스타일: 현재 위치 마커에 방향(나침반) 빔 표시
    let _compassOn = false, _hdgPrev = null, _hdgAccum = 0, _hdgRaf = 0, _hdgPending = null;
    function _setMyLocHeading(deg) {
        const dot = document.querySelector('.my-loc-dot');
        if (!dot) return;
        // 0/360 경계에서 한 바퀴 도는 현상 방지: 최단경로 누적각 사용
        if (_hdgPrev == null) { _hdgPrev = deg; _hdgAccum = deg; }
        else {
            let d = deg - _hdgPrev;
            if (d > 180) d -= 360; else if (d < -180) d += 360;
            _hdgAccum += d; _hdgPrev = deg;
        }
        dot.style.setProperty('--heading', _hdgAccum.toFixed(1) + 'deg');
        dot.classList.add('has-heading');
    }
    function _onOrient(e) {
        let h = null;
        if (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading)) {
            h = e.webkitCompassHeading;                 // iOS: 이미 나침반값(북=0, 시계방향)
        } else if (e.absolute === true && typeof e.alpha === 'number') {
            h = (360 - e.alpha) % 360;                  // Android(절대): alpha(반시계) → 나침반(시계)
        }
        if (h == null) return;
        // 화면 회전(가로모드 등) 보정
        const so = (screen.orientation && typeof screen.orientation.angle === 'number') ? screen.orientation.angle : (window.orientation || 0);
        h = (h + so + 360) % 360;
        _hdgPending = h;
        if (!_hdgRaf) _hdgRaf = requestAnimationFrame(() => { _hdgRaf = 0; if (_hdgPending != null) _setMyLocHeading(_hdgPending); });
    }
    function enableCompass() {
        if (_compassOn) return;
        const start = () => {
            if (_compassOn) return;
            _compassOn = true;
            if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', _onOrient, true);
            window.addEventListener('deviceorientation', _onOrient, true);
        };
        const D = window.DeviceOrientationEvent;
        if (D && typeof D.requestPermission === 'function') {   // iOS 13+: 사용자 제스처에서 권한 요청
            D.requestPermission().then(s => { if (s === 'granted') start(); }).catch(() => {});
        } else { start(); }                                     // Android 등: 권한 불필요
    }
    window._enableCompass = enableCompass;
    // [E] edit by smsong

    // 현재 GPS 위치를 가져와 마커 표시 (recenter=true 면 지도 화면도 이동, announce=true 면 실패 시 안내)
    function locateMe(recenter, announce) {
        if (!navigator.geolocation) { if (announce) showToast('위치 기능을 사용할 수 없습니다'); return; }
        navigator.geolocation.getCurrentPosition((pos) => {
            const lat = pos.coords.latitude, lng = pos.coords.longitude;
            placeMyLocation(lat, lng);
            if (recenter && map) { map.setCenter(new naver.maps.LatLng(lat, lng)); map.setZoom(15); }
        }, (err) => {
            console.warn('현재 위치 실패:', err);
            if (announce) showToast('현재 위치를 가져오지 못했습니다');
        }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 });
    }

    function initMap() {
        map = new naver.maps.Map('naver-map', {
            center: new naver.maps.LatLng(37.5665, 126.9780),
            zoom: 14
        });
        loadMemoriesFromServer();
        locateMe(true, false); // 지도 처음 진입 시 현재 위치로 이동 + 마커 (실패해도 조용히)
        enableCompass(); // [B] edit by smsong - 방향(나침반) 빔 시작 (안드로이드는 권한 불필요) / [E] edit by smsong

        // 지도(빈 영역) 탭 → 헤더/하단바 숨김·표시 토글 (마커 클릭은 상세보기라 제외)
        naver.maps.Event.addListener(map, 'click', () => {
            if (isWaitingForMapClick) return; // 위치 선택 중에는 토글 안 함
            document.body.classList.toggle('map-immersive');
            // [smsong] 몰입모드(헤더/하단바 숨김) 진입 시 상세보기도 함께 닫기
            if (document.body.classList.contains('map-immersive')) {
                if (_memorySheet && _memorySheet.isOpen()) closeDetailModal();
                if (_clSheet && _clSheet.isOpen()) closeChecklistDetail();
            }
            // [smsong] 지도는 뷰포트에 고정(fixed)되어 크기가 변하지 않으므로 resize() 불필요 → 버벅임/이동 제거
        });
    }

    // 지도 우하단 '내 위치' 버튼 → 현재 위치로 이동
    const myLocBtn = document.getElementById('btn-my-location');
    if (myLocBtn) myLocBtn.addEventListener('click', () => { enableCompass(); locateMe(true, true); }); // [smsong] iOS 나침반 권한은 탭(제스처)에서 요청

    // --- 위치 선택 모드 (지도 중앙 점 기준) ---
    let mapIdleListener = null;
    let centerLabelTimer = null;

    function enterPickMode() {
        // [B] edit by smsong - 각 메뉴에서 추가 시작 시 위치 선택을 위해 지도 탭으로 전환
        if (document.body.getAttribute('data-active-tab') !== 'tab-map') {
            const _mapNav = document.querySelector('.nav-item[data-tab="tab-map"]');
            if (_mapNav) _mapNav.click();
        }
        // [E] edit by smsong
        isWaitingForMapClick = true;
        window._pendingPlaceTitle = '';
        document.body.classList.remove('map-immersive'); // 헤더(검색창) 필요하므로 몰입모드 해제
        locationMode.classList.remove('hidden');
        mapWrapper.classList.add('picking');
        document.body.classList.add('picking');
        // [B] edit by smsong - #1 위치 설정 화면에서는 지도만 보이도록 기존 마커 제거
        clearAllMarkers();
        // 현재 위치 점(파란 점)까지 숨기려면 아래 주석을 해제하십시오.
        // if (currentLocMarker) currentLocMarker.setMap(null);
        // [E] edit by smsong

        // 지도를 탭하면 그 지점으로 중앙(점)을 이동 — 확정은 버튼으로
        if (mapClickListener) naver.maps.Event.removeListener(mapClickListener);
        mapClickListener = naver.maps.Event.addListener(map, 'click', (event) => {
            if (!isWaitingForMapClick) return;
            map.panTo(event.coord);
        });

        // 지도 이동/줌이 멈출 때마다 중앙 점의 주소를 표시
        if (mapIdleListener) naver.maps.Event.removeListener(mapIdleListener);
        mapIdleListener = naver.maps.Event.addListener(map, 'idle', () => {
            clearTimeout(centerLabelTimer);
            centerLabelTimer = setTimeout(updateCenterLabel, 250);
        });
        updateCenterLabel();
    }

    // 지도 중앙 점의 좌표 → 주소를 배너에 표시
    function updateCenterLabel() {
        if (!isWaitingForMapClick || !map) return;
        const label = document.getElementById('lm-center-label');
        const c = map.getCenter();
        if (!c) return;
        if (label) label.innerHTML = '<span class="lm-pin">' + icon('pin',15) + '</span> 위치 확인 중…';
        if (!(window.naver && naver.maps.Service && naver.maps.Service.reverseGeocode)) {
            if (label) label.innerHTML = '<span class="lm-pin">' + icon('pin',15) + '</span> 중앙 지점을 선택해주십시오';
            return;
        }
        naver.maps.Service.reverseGeocode({
            coords: c,
            orders: [naver.maps.Service.OrderType.ROAD_ADDR, naver.maps.Service.OrderType.ADDR].join(',')
        }, (status, response) => {
            if (!isWaitingForMapClick) return;
            let addr = '중앙 지점을 선택해주십시오';
            if (status === naver.maps.Service.Status.OK) {
                const r = response.v2;
                addr = (r && r.address) ? (r.address.roadAddress || r.address.jibunAddress || addr) : addr;
            }
            if (label) label.innerHTML = '<span class="lm-pin">' + icon('pin',15) + '</span> ' + escapeHtml(addr);
        });
    }

    // 좌표를 최종 확정 → 작성 폼으로 (중앙 점 / 현재 위치 공통)
    function confirmLocation(lat, lng, prefix) {
        currentLatLng = { lat: lat, lng: lng };
        // [B] edit by smsong - '수정' 중 위치 재설정이면 편집 폼으로 복귀
        if (_editLocReturn) { finishEditLocationPick(lat, lng); return; }
        // [E] edit by smsong
        reverseGeocodeAndLabel(lat, lng, prefix || icon('pin',14));
        exitPickMode();
        pickReturnsToForm = false;
        if (pickTarget === 'checklist') openChecklistModal(); else openMemoryModal();
    }

    // [B] edit by smsong - ===== '수정' 중 위치 재설정 흐름 =====
    // 편집 폼(추억/가볼곳)에서 '위치 다시 설정하기' → 폼 상태 스냅샷 후 위치 선택 모드 진입
    function startEditLocationPick(kind) {
        if (kind === 'memory') {
            if (!_detailMemory) return;
            const mgr = window._memEditMgr;
            _editLocItem = _detailMemory;
            _editFormSnapshot = {
                date: (document.getElementById('edit-memory-date') || {}).value || '',
                title: (document.getElementById('edit-memory-title') || {}).value || '',
                content: (document.getElementById('edit-memory-content') || {}).value || '',
                order: mgr ? mgr.getMediaOrder() : [],
                files: mgr ? mgr.getNewFiles() : []
            };
            _editLocReturn = 'memory';
            pickTarget = 'memory';
            closeDetailModal();
        } else {
            if (!_detailChecklist) return;
            const mgr = window._clEditMgr;
            _editLocItem = _detailChecklist;
            _editFormSnapshot = {
                title: (document.getElementById('cl-edit-title') || {}).value || '',
                content: (document.getElementById('cl-edit-content') || {}).value || '',
                type: window._clEditSelectedType || (_detailChecklist && _detailChecklist.type) || 'ETC',
                visited: !!(document.getElementById('cl-edit-visited') || {}).checked,
                visitedDate: (document.getElementById('cl-edit-visited-date') || {}).value || '',
                order: mgr ? mgr.getMediaOrder() : [],
                files: mgr ? mgr.getNewFiles() : []
            };
            _editLocReturn = 'checklist';
            pickTarget = 'checklist';
            closeChecklistDetail();
        }
        _editLocPicked = null;
        // 시트가 내려가는 애니메이션이 끝난 뒤 위치 선택 모드 진입
        setTimeout(function () { enterPickMode(); }, 260);
    }

    // 위치 확정 → 새 좌표의 주소를 역지오코딩한 뒤 편집 폼 복원
    function finishEditLocationPick(lat, lng) {
        exitPickMode();
        var applyAndReopen = function (meta) {
            _editLocPicked = {
                lat: lat, lng: lng,
                placeName: (meta && meta.placeName) || '',
                address: (meta && meta.address) || ''
            };
            reopenEditWithSnapshot(true);
        };
        if (window.naver && naver.maps.Service && naver.maps.Service.reverseGeocode) {
            naver.maps.Service.reverseGeocode({
                coords: new naver.maps.LatLng(lat, lng),
                orders: [naver.maps.Service.OrderType.ROAD_ADDR, naver.maps.Service.OrderType.ADDR].join(',')
            }, function (status, response) {
                var meta = { placeName: '', address: '' };
                if (status === naver.maps.Service.Status.OK) {
                    var r = response.v2;
                    var addr = (r && r.address) ? (r.address.roadAddress || r.address.jibunAddress) : '';
                    meta = splitKoreanAddress(addr || '');
                }
                applyAndReopen(meta);
            });
        } else { applyAndReopen({ placeName: '', address: '' }); }
    }

    // 미디어 매니저를 저장된 순서/새 파일로 재구성(사진 편집 상태 보존)
    function _rebuildMediaMgr(mgr, order, files) {
        if (!mgr) return;
        var f = (files || []).slice();
        var items = (order || []).map(function (o) {
            return o === '$NEW$' ? { kind: 'file', file: f.shift() } : { kind: 'url', url: o };
        }).filter(function (it) { return it.kind === 'url' || it.file; });
        mgr.reset(items);
    }

    // 편집 폼 위치 라벨을 새 위치로 갱신
    function _applyEditLocLabel(elId) {
        var el = document.getElementById(elId);
        if (!el || !_editLocPicked) return;
        var t = [_editLocPicked.placeName, _editLocPicked.address].filter(Boolean).join(' ') || '지정한 위치';
        el.innerHTML = pinText(t) + ' <span class="loc-changed-tag">변경됨</span>';
    }

    // 상세 시트를 다시 열고 편집 모드로 진입 → 스냅샷 복원 (changed=true면 새 위치 라벨 적용)
    function reopenEditWithSnapshot(changed) {
        var kind = _editLocReturn;
        var item = _editLocItem;
        var snap = _editFormSnapshot;
        _editLocReturn = null; _editLocItem = null; _editFormSnapshot = null; // 소비
        if (!item) return;
        window._editLocRestoring = true; // exitDetailEdit/exitChecklistEdit 가 _editLocPicked 를 지우지 않도록
        try {
            if (kind === 'memory') {
                openDetailModal(item);
                enterDetailEdit(item);
                if (snap) {
                    var d = document.getElementById('edit-memory-date'); if (d) d.value = snap.date;
                    var t = document.getElementById('edit-memory-title'); if (t) t.value = snap.title;
                    var c = document.getElementById('edit-memory-content'); if (c) c.value = snap.content;
                    _rebuildMediaMgr(window._memEditMgr, snap.order, snap.files);
                }
                if (changed) _applyEditLocLabel('edit-loc');
            } else {
                openChecklistDetail(item);
                enterChecklistEdit(item);
                if (snap) {
                    var ct = document.getElementById('cl-edit-title'); if (ct) ct.value = snap.title;
                    var cc = document.getElementById('cl-edit-content'); if (cc) cc.value = snap.content;
                    if (snap.type) {
                        window._clEditSelectedType = snap.type;
                        document.querySelectorAll('#cl-edit-type-options .cl-type-chip').forEach(function (chip) {
                            chip.classList.toggle('selected', chip.dataset.type === snap.type);
                        });
                    }
                    var chk = document.getElementById('cl-edit-visited');
                    var dt = document.getElementById('cl-edit-visited-date');
                    if (chk) chk.checked = !!snap.visited;
                    if (dt) { dt.disabled = !snap.visited; dt.value = snap.visitedDate || ''; }
                    if (chk) { var lbl = chk.closest('.cl-check-label'); if (lbl) lbl.classList.toggle('checked', !!snap.visited); }
                    _rebuildMediaMgr(window._clEditMgr, snap.order, snap.files);
                }
                if (changed) _applyEditLocLabel('cl-edit-loc');
            }
        } finally {
            window._editLocRestoring = false;
        }
    }

    // 편집 폼의 '위치 다시 설정하기' 버튼 바인딩
    var _editResetLoc = document.getElementById('edit-reset-location');
    if (_editResetLoc) _editResetLoc.addEventListener('click', function () { startEditLocationPick('memory'); });
    var _clEditResetLoc = document.getElementById('cl-edit-reset-location');
    if (_clEditResetLoc) _clEditResetLoc.addEventListener('click', function () { startEditLocationPick('checklist'); });
    // [B] edit by smsong - 위치 텍스트(배지)를 눌러도 바로 위치 변경 열리게
    var _editLocLine = document.getElementById('edit-loc');
    if (_editLocLine) {
        _editLocLine.setAttribute('title', '눌러서 위치 변경');
        _editLocLine.addEventListener('click', function () { startEditLocationPick('memory'); });
    }
    var _clEditLocLine = document.getElementById('cl-edit-loc');
    if (_clEditLocLine) {
        _clEditLocLine.setAttribute('title', '눌러서 위치 변경');
        _clEditLocLine.addEventListener('click', function () { startEditLocationPick('checklist'); });
    }
    // [E] edit by smsong

    // 좌표 → 상세 주소 (역지오코딩)로 배지 문구 채우기
    function setBadgeManual(text) {
        const b = document.getElementById('location-status-badge');
        b.innerHTML = text;
        b.className = 'location-badge manual';
    }
    function reverseGeocodeAndLabel(lat, lng, prefix) {
        const tag = prefix || icon('pin',14);
        currentLocationMeta = { placeName: '', address: '' };
        setBadgeManual(tag + ' 위치를 확인하는 중...');
        if (!(window.naver && naver.maps.Service && naver.maps.Service.reverseGeocode)) {
            setBadgeManual(tag + ' 지정한 위치로 설정되었습니다');
            return;
        }
        naver.maps.Service.reverseGeocode({
            coords: new naver.maps.LatLng(lat, lng),
            orders: [naver.maps.Service.OrderType.ROAD_ADDR, naver.maps.Service.OrderType.ADDR].join(',')
        }, (status, response) => {
            if (status !== naver.maps.Service.Status.OK) {
                setBadgeManual(tag + ' 지정한 위치로 설정되었습니다');
                return;
            }
            const r = response.v2;
            const addr = (r && r.address) ? (r.address.roadAddress || r.address.jibunAddress) : '';
            currentLocationMeta = splitKoreanAddress(addr);
            setBadgeManual(tag + ' ' + escapeHtml(addr || '지정한 위치로 설정되었습니다'));
        });
    }

    // --- 위치 다시 설정하기 (작성 폼 내용은 유지) ---
    const resetLocBtn = document.getElementById('btn-reset-location');
    function _startMemoryLocationPick() {
        pickReturnsToForm = true; // 위치만 다시 고르고 폼으로 복귀
        document.getElementById('memory-modal').classList.add('hidden'); // reset() 호출 안 함 → 입력 유지
        enterPickMode();
    }
    if (resetLocBtn) {
        resetLocBtn.addEventListener('click', _startMemoryLocationPick);
    }
    // [B] edit by smsong - 위치 배지를 눌러도 바로 위치 변경
    const _memLocBadge = document.getElementById('location-status-badge');
    if (_memLocBadge) {
        _memLocBadge.setAttribute('title', '눌러서 위치 변경');
        _memLocBadge.addEventListener('click', _startMemoryLocationPick);
    }
    // [E] edit by smsong

    function exitPickMode() {
        isWaitingForMapClick = false;
        locationMode.classList.add('hidden');
        mapWrapper.classList.remove('picking');
        document.body.classList.remove('picking');
        const si = document.getElementById('lm-search-input');
        if (si) si.value = '';
        const sg = document.getElementById('lm-suggestions');
        if (sg) { sg.classList.add('hidden'); sg.innerHTML = ''; }
        if (mapClickListener) { naver.maps.Event.removeListener(mapClickListener); mapClickListener = null; }
        if (mapIdleListener) { naver.maps.Event.removeListener(mapIdleListener); mapIdleListener = null; }
        clearTimeout(centerLabelTimer);
        // [B] edit by smsong - #1 위치 설정이 끝나면(확정/취소 모두) 마커 복구
        // if (currentLocMarker && map) currentLocMarker.setMap(map); // 위에서 숨겼다면 함께 해제
        refreshMapMarkers();
        // [E] edit by smsong
    }

    // '이 위치로 설정하기' — 지도 중앙 점을 위치로 확정
    const lmConfirmBtn = document.getElementById('lm-confirm');
    if (lmConfirmBtn) lmConfirmBtn.addEventListener('click', () => {
        if (!map) return;
        const c = map.getCenter();
        confirmLocation(c.lat(), c.lng(), icon('pin',14));
    });

    // '현재 위치로 설정' — 현재 GPS 위치로 지도 중앙을 이동
    const lmCurrentBtn = document.getElementById('lm-current');
    if (lmCurrentBtn) lmCurrentBtn.addEventListener('click', () => {
        if (!navigator.geolocation) { showToast('위치 기능을 사용할 수 없습니다'); return; }
        lmCurrentBtn.disabled = true;
        const prev = lmCurrentBtn.innerText;
        lmCurrentBtn.innerText = '현재 위치 찾는 중…';
        navigator.geolocation.getCurrentPosition((pos) => {
            lmCurrentBtn.disabled = false; lmCurrentBtn.innerText = prev;
            const lat = pos.coords.latitude, lng = pos.coords.longitude;
            if (map) { map.setCenter(new naver.maps.LatLng(lat, lng)); map.setZoom(16); }
            updateCenterLabel();
            showToast("현재 위치로 이동했습니다. '이 위치로 설정하기'를 눌러 확정하십시오.");
        }, (err) => {
            lmCurrentBtn.disabled = false; lmCurrentBtn.innerText = prev;
            console.warn('현재 위치 실패:', err);
            showToast('위치 접근이 거부되었습니다. 지도를 움직여 설정해주십시오.');
        }, { enableHighAccuracy: true, timeout: 8000 });
    });

    document.getElementById('lm-cancel').addEventListener('click', () => {
        // [B] edit by smsong - '수정' 중 위치 재설정 취소 → 위치 변경 없이 편집 폼으로 복귀
        if (_editLocReturn) {
            exitPickMode();
            _editLocPicked = null;
            reopenEditWithSnapshot(false);
            showToast('위치 변경을 취소했습니다');
            return;
        }
        // [E] edit by smsong
        exitPickMode();
        if (pickReturnsToForm) {
            // 위치 재설정 취소 → 입력하던 폼 그대로 복귀
            pickReturnsToForm = false;
            if (pickTarget === 'checklist') openChecklistModal(); else openMemoryModal();
            showToast('위치 변경을 취소했습니다');
        } else if (pickTarget === 'checklist') {
            pickTarget = 'memory';
            showToast('체크리스트 추가를 취소함');
        } else {
            selectedFile = null;
            if (fileInput) fileInput.value = '';
            showToast('위치 선택을 취소함');
        }
    });

    // --- 주소/장소 검색 + 연관 검색어 ---
    const searchInput = document.getElementById('lm-search-input');
    const searchBtn = document.getElementById('lm-search-btn');
    const suggestBox = document.getElementById('lm-suggestions');
    let suggestTimer = null;
    let lastSuggestions = [];

    function hideSuggestions() {
        if (!suggestBox) return;
        suggestBox.classList.add('hidden');
        suggestBox.innerHTML = '';
        lastSuggestions = [];
    }

    function setLocationFromItem(item) {
        const addr = item.roadAddress || item.jibunAddress || '';
        const placeName = item.name || '';
        const finalize = (lat, lng) => {
            if (isNaN(lat) || isNaN(lng)) { showToast('좌표 조회 실패'); return; }
            // [B] edit by smsong - 검색 결과는 '즉시 확정'하지 않는다.
            //  지도를 그 위치로 부드럽게 이동시켜 사용자가 미세 조정한 뒤,
            //  '이 위치로 설정' 버튼으로 최종 확정하도록 위치 선택 모드를 유지한다.
            currentLatLng = { lat: lat, lng: lng };
            currentLocationMeta = splitKoreanAddress(addr);
            window._pendingPlaceTitle = placeName; // 제목 자동입력용 (추억/체크리스트 공용)
            hideSuggestions();
            const si = document.getElementById('lm-search-input');
            if (si) si.blur();
            const target = new naver.maps.LatLng(lat, lng);
            if (map) {
                if (typeof map.morph === 'function') map.morph(target, 17, { duration: 550, easing: 'easeOutCubic' });
                else { map.setCenter(target); map.setZoom(17); }
            }
            // 이동이 끝나면 중앙(레티클) 기준 주소 배너를 갱신
            setTimeout(updateCenterLabel, 620);
            showToast("검색 위치로 이동했어요. 지도를 조정한 뒤 '이 위치로 설정'을 눌러주세요.");
            // 위치 선택 모드는 그대로 유지 (exitPickMode / 폼 열기 안 함)
            // [E] edit by smsong
        };
        // 도로명 주소를 지오코딩해 정확한 좌표 확보, 실패 시 백엔드가 준 좌표 사용
        if (addr && window.naver && naver.maps.Service && naver.maps.Service.geocode) {
            naver.maps.Service.geocode({ query: addr }, (status, response) => {
                const a = (status === naver.maps.Service.Status.OK && response.v2 && response.v2.addresses && response.v2.addresses[0]) || null;
                if (a) finalize(parseFloat(a.y), parseFloat(a.x));
                else if (item.lat != null && item.lng != null) finalize(parseFloat(item.lat), parseFloat(item.lng));
                else showToast('좌표 조회 실패');
            });
        } else if (item.lat != null && item.lng != null) {
            finalize(parseFloat(item.lat), parseFloat(item.lng));
        } else { showToast('좌표 조회 실패'); }
    }

    // 장소(상호명) 검색 결과 렌더 — 이름 + 그 하위에 도로명 주소
    function renderSuggestions(items) {
        if (!suggestBox) return;
        lastSuggestions = items;
        suggestBox.innerHTML = '';
        items.forEach((item) => {
            const name = item.name || '(이름 없음)';
            const addr = item.roadAddress || item.jibunAddress || '주소 정보 없음';
            const cat = item.category ? '<span class="sg-cat">' + escapeHtml(item.category) + '</span>' : '';
            const li = document.createElement('li');
            li.innerHTML =
                '<span class="sg-main">' + escapeHtml(name) + cat + '</span>' +
                '<span class="sg-sub">' + escapeHtml(addr) + '</span>';
            li.addEventListener('click', () => setLocationFromItem(item));
            suggestBox.appendChild(li);
        });
        suggestBox.classList.remove('hidden');
    }

    function showEmptySuggestion() {
        if (!suggestBox) return;
        suggestBox.innerHTML = '<li class="sg-empty">검색 결과가 없음</li>';
        suggestBox.classList.remove('hidden');
        lastSuggestions = [];
    }

    // 현재 지도 중심의 지역명(시/도 + 시·군·구)을 접두어로 → '그 화면 주변' 검색 효과
    let _regionCache = { key: '', prefix: '' };
    function getMapRegionPrefix(cb) {
        if (!map || !map.getCenter) { cb('', null, null); return; }
        const c = map.getCenter();
        const lat = c.lat(), lng = c.lng();
        const key = lat.toFixed(3) + ',' + lng.toFixed(3); // ~100m 단위 캐시
        if (_regionCache.key === key) { cb(_regionCache.prefix, lat, lng); return; }
        reverseGeocode(lat, lng, (addr) => {
            const prefix = addr ? (splitKoreanAddress(addr).placeName || '') : '';
            _regionCache = { key: key, prefix: prefix };
            cb(prefix, lat, lng);
        });
    }

    // 백엔드 프록시(네이버 지역검색)로 상호명/장소 검색 — 현재 지도 위치 주변 우선
    function searchPlaces(query) {
        return new Promise((resolve) => {
            getMapRegionPrefix((prefix, lat, lng) => {
                const callApi = (q) => {
                    let url = `${API_BASE_URL}/api/search/place?query=${encodeURIComponent(q)}`;
                    if (lat != null && lng != null) url += `&lat=${lat}&lng=${lng}`;
                    return fetch(url, { headers: authHeaders(true) })
                        .then(handleResponse)
                        .then(items => Array.isArray(items) ? items : []);
                };
                if (prefix) {
                    // 1차: '지역명 + 키워드'로 주변 검색, 결과 없으면 키워드만으로 폴백
                    callApi(prefix + ' ' + query)
                        .then(items => items.length ? resolve(items) : callApi(query).then(resolve).catch(() => resolve([])))
                        .catch(() => callApi(query).then(resolve).catch(() => resolve([])));
                } else {
                    callApi(query).then(resolve).catch(() => resolve([]));
                }
            });
        });
    }

    // 입력 중 연관 검색어 조회 (디바운스)
    function fetchSuggestions(query) {
        searchPlaces(query)
            .then(items => {
                if ((searchInput.value || '').trim().length < 2) { hideSuggestions(); return; }
                if (!items.length) { showEmptySuggestion(); return; }
                renderSuggestions(items);
            })
            .catch(() => hideSuggestions());
    }

    // 검색 버튼/Enter: 떠 있는 후보 중 첫 번째 선택, 없으면 직접 조회
    function runSearch() {
        const query = (searchInput.value || '').trim();
        if (!query) { showToast('검색어를 입력해주십시오'); return; }
        if (lastSuggestions.length > 0) { setLocationFromItem(lastSuggestions[0]); return; }
        searchPlaces(query)
            .then(items => {
                if (!items.length) { showToast('검색 결과가 없음. 다른 키워드로 시도해보십시오.'); return; }
                setLocationFromItem(items[0]);
            })
            .catch(() => showToast('검색에 실패했습니다.'));
    }

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            const q = (searchInput.value || '').trim();
            clearTimeout(suggestTimer);
            if (q.length < 2) { hideSuggestions(); return; }
            suggestTimer = setTimeout(() => fetchSuggestions(q), 300);
        });
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); runSearch(); }
            else if (e.key === 'Escape') { hideSuggestions(); }
        });
    }
    if (searchBtn) searchBtn.addEventListener('click', runSearch);

    // --- 사진 업로드 & 위치 지정 ---
    async function handlePickedImage(file, fromCamera) {
        if (!file) return;
        pickTarget = 'memory';
        selectedFile = file;

        // 첫 사진을 그리드에 시드 (이후 ＋로 추가, 꾹 눌러 정렬 가능)
        if (window._memCreateMgr) window._memCreateMgr.reset([{ kind: 'file', file: file }]);

        // 다시 촬영 버튼: 카메라 경유면 노출, 갤러리면 숨김
        const retake = document.getElementById('btn-retake-photo');
        if (retake) retake.classList.toggle('hidden', !fromCamera);

        if (!map) {
            showToast('지도가 아직 준비되지 않음');
            return;
        }

        try {
            // 1) 날짜 메타데이터(촬영일) 자동 적용
            let metaAll = null;
            try { metaAll = await exifr.parse(file); } catch (_) { metaAll = null; }
            if (metaAll) {
                const shotDate = metaAll.DateTimeOriginal || metaAll.CreateDate || metaAll.ModifyDate;
                if (shotDate) {
                    const dObj = (shotDate instanceof Date) ? shotDate : new Date(shotDate);
                    if (!isNaN(dObj.getTime())) {
                        const yyyy = dObj.getFullYear();
                        const mm = String(dObj.getMonth() + 1).padStart(2, '0');
                        const dd = String(dObj.getDate()).padStart(2, '0');
                        const dateInput = document.getElementById('memory-date');
                        if (dateInput) dateInput.value = `${yyyy}-${mm}-${dd}`;
                    }
                }
            }

            // 2) 위치 메타데이터(GPS) 자동 적용
            const gps = await exifr.gps(file);
            if (gps && gps.latitude && gps.longitude) {
                currentLatLng = { lat: gps.latitude, lng: gps.longitude };
                currentLocationMeta = { placeName: '', address: '' };
                const badge = document.getElementById('location-status-badge');
                badge.innerHTML = pinText("사진 위치가 자동으로 설정되었습니다!");
                badge.className = "location-badge success";
                reverseGeocode(gps.latitude, gps.longitude, (addr) => {
                    currentLocationMeta = splitKoreanAddress(addr);
                    if (addr) badge.innerHTML = pinText(addr);
                });
                openMemoryModal();
            } else if (fromCamera && navigator.geolocation) {
                // 카메라 촬영 사진은 EXIF 위치가 없으므로 현재 GPS 사용
                const badge = document.getElementById('location-status-badge');
                if (badge) { badge.innerHTML = pinText('현재 위치를 가져오는 중…'); badge.className = 'location-badge'; }
                navigator.geolocation.getCurrentPosition((pos) => {
                    currentLatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                    currentLocationMeta = { placeName: '', address: '' };
                    if (badge) { badge.innerHTML = pinText('현재 위치로 설정되었습니다!'); badge.className = 'location-badge success'; }
                    reverseGeocode(currentLatLng.lat, currentLatLng.lng, (addr) => {
                        currentLocationMeta = splitKoreanAddress(addr);
                        if (addr && badge) badge.innerHTML = pinText(addr);
                    });
                    openMemoryModal();
                }, () => {
                    if (badge) { badge.innerHTML = pinText('위치를 가져올 수 없습니다 · 직접 설정'); badge.className = 'location-badge manual'; }
                    openMemoryModal();
                }, { enableHighAccuracy: true, timeout: 8000 });
            } else {
                // 메타데이터 없음 → 지도 클릭 모드
                enterPickMode();
            }
        } catch (error) {
            showToast('사진 분석 실패. 지도에서 위치를 골라주십시오.');
            enterPickMode();
        }
    }

    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            const files = Array.from(e.target.files || []);
            fileInput.value = '';
            if (!files.length) return;
            cameraMode = false;
            // 첫 장으로 위치/날짜(EXIF) 기준을 잡고 그리드 시드 → 나머지는 뒤에 추가
            handlePickedImage(files[0], false);
            if (files.length > 1 && window._memCreateMgr) window._memCreateMgr.addFiles(files.slice(1));
        });
    }

    // --- 폼 제출 ---
    const memoryForm = document.getElementById('memory-form');
    if (memoryForm) {
        memoryForm.addEventListener('submit', (e) => {
            e.preventDefault();
            if (!requireAuthOrRedirect()) return;
            if (!currentLatLng) { showToast('위치 정보가 없습니다'); return; }

            const submitBtn = memoryForm.querySelector('.submit-btn');
            submitBtn.disabled = true;
            submitBtn.innerText = '기록하는 중...';

            const _dateVal = document.getElementById('memory-date').value;
            const memoryDTO = {
                title: document.getElementById('memory-title').value,
                content: document.getElementById('memory-content').value,
                lat: currentLatLng.lat,
                lng: currentLatLng.lng,
                placeName: (currentLocationMeta && currentLocationMeta.placeName) || '',
                address: (currentLocationMeta && currentLocationMeta.address) || '',
                // 날짜 input(yyyy-MM-dd)을 'Z' 없는 로컬 날짜시각으로 전송 → 서버가 그대로 저장(현재 날짜로 덮어쓰지 않음)
                createdAt: _dateVal ? (_dateVal + 'T00:00:00') : null
            };

            const mgr = window._memCreateMgr;
            const files = mgr ? mgr.getNewFiles() : (selectedFile ? [selectedFile] : []);
            if (!files.length) { showToast('사진을 1장 이상 추가해주십시오'); submitBtn.disabled = false; submitBtn.innerText = '기록하기'; return; }
            if (files.length > 10) { showToast('이미지는 최대 10장까지 첨부할 수 있습니다'); submitBtn.disabled = false; submitBtn.innerText = '기록하기'; return; }
            memoryDTO.mediaOrder = mgr ? mgr.getMediaOrder() : files.map(() => '$NEW$');

            const formData = new FormData();
            formData.append("uid", currentUid);
            formData.append("memoryData", JSON.stringify(memoryDTO));
            files.forEach(f => formData.append("mediaData", f));

            withLoading(fetch(`${API_BASE_URL}/api/memories`, {
                method: 'POST',
                headers: authHeaders(false),
                body: formData
            }), '저장 중...')
                .then(handleResponse)
                .then(() => {
                    closeMemoryModal();
                    showToast('기록 성공');
                    // [B] edit by smsong - 생성 직후 최신 목록을 받아 지도에 바로 반영.
                    //  현재 지도가 가볼곳 모드였어도 추억 모드로 전환해 새 추억 마커가 보이도록 함.
                    loadMemoriesFromServer().then(function () {
                        if (mapMode !== 'memory') setMapMode('memory');
                        else refreshMapMarkers();
                    });
                    // [E] edit by smsong
                })
                .catch(err => {
                    console.error(err);
                    showToast('기록 실패. 다시 시도해주십시오.');
                })
                .finally(() => {
                    submitBtn.disabled = false;
                    submitBtn.innerText = '기록하기';
                });
        });
    }

    // ==========================================
    //  라이브 카메라 촬영 (카메라 메뉴 / 다시 촬영하기)
    // ==========================================
    const camModal = document.getElementById('camera-modal');
    const camVideo = document.getElementById('camera-video');
    const camLoading = document.getElementById('camera-loading');
    const camFallback = document.getElementById('camera-fallback-file');
    let camStream = null;
    let camFacing = 'environment';
    let cameraReturnToForm = false; // 다시 촬영 중 X 누르면 이전 사진 폼으로 복귀

    async function startCameraStream() {
        stopCameraStream();
        if (camLoading) camLoading.classList.remove('hidden');
        try {
            camStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: camFacing }, audio: false
            });
            if (camVideo) {
                camVideo.srcObject = camStream;
                // 전면(셀피) 카메라가 거울처럼 반전되어 보이는 것을 방지 → 일반 방향으로 표시
                camVideo.style.transform = (camFacing === 'user') ? 'scaleX(-1)' : 'none';
            }
            if (camLoading) camLoading.classList.add('hidden');
        } catch (err) {
            console.warn('카메라 접근 실패 → 파일 입력으로 대체:', err);
            if (camLoading) camLoading.classList.add('hidden');
            closeCameraModal();
            // getUserMedia 미지원/거부 → 모바일 기본 카메라 호출(대체)
            if (camFallback) camFallback.click();
        }
    }

    function stopCameraStream() {
        if (camStream) {
            camStream.getTracks().forEach(t => t.stop());
            camStream = null;
        }
        if (camVideo) camVideo.srcObject = null;
    }

    function openCameraCapture(returnToForm) {
        cameraReturnToForm = !!returnToForm;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            if (camFallback) camFallback.click();
            return;
        }
        // 촬영 중에는 작성 폼을 잠시 숨김(데이터는 유지 — reset 호출 안 함)
        document.getElementById('memory-modal').classList.add('hidden');
        if (camModal) camModal.classList.remove('hidden');
        startCameraStream();
    }

    function closeCameraModal() {
        stopCameraStream();
        if (camModal) camModal.classList.add('hidden');
        // 다시 촬영 중 촬영하지 않고 닫으면 → 이전 사진으로 작성 폼 복귀 (초기화 X)
        if (cameraReturnToForm) {
            cameraReturnToForm = false;
            if (selectedFile) openMemoryModal();
        }
    }

    // 촬영 → 위치(현재 GPS)·날짜(오늘) 자동 설정 → 작성 폼 오픈
    function capturePhoto() {
        if (!camVideo || !camVideo.videoWidth) { showToast('카메라가 준비되지 않았습니다'); return; }
        const canvas = document.getElementById('camera-canvas');
        canvas.width = camVideo.videoWidth;
        canvas.height = camVideo.videoHeight;
        const ctx = canvas.getContext('2d');
        // 전면 카메라는 미리보기를 반전 해제했으므로, 저장 사진도 동일하게 좌우 반전 적용
        if (camFacing === 'user') {
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
        }
        ctx.drawImage(camVideo, 0, 0, canvas.width, canvas.height);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        canvas.toBlob((blob) => {
            if (!blob) { showToast('사진 처리 실패'); return; }
            const file = new File([blob], 'camera_' + Date.now() + '.jpg', { type: 'image/jpeg' });
            selectedFile = file;
            cameraMode = true;
            cameraReturnToForm = false; // 촬영 성공 → 닫기 복귀 로직 비활성화
            closeCameraModal();

            // 첫 사진을 그리드에 시드
            if (window._memCreateMgr) window._memCreateMgr.reset([{ kind: 'file', file: file }]);
            // 다시 촬영 버튼 노출
            const retake = document.getElementById('btn-retake-photo');
            if (retake) retake.classList.remove('hidden');

            // 날짜: 오늘로 자동 설정
            const dateInput = document.getElementById('memory-date');
            if (dateInput) dateInput.value = new Date().toISOString().substring(0, 10);

            // 위치: 현재 GPS 자동 설정
            const badge = document.getElementById('location-status-badge');
            if (badge) { badge.innerHTML = pinText('현재 위치를 가져오는 중…'); badge.className = 'location-badge'; }
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition((pos) => {
                    currentLatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                    currentLocationMeta = { placeName: '', address: '' };
                    if (badge) { badge.innerHTML = pinText('현재 위치로 설정되었습니다!'); badge.className = 'location-badge success'; }
                    reverseGeocode(currentLatLng.lat, currentLatLng.lng, (addr) => {
                        currentLocationMeta = splitKoreanAddress(addr);
                        if (addr && badge) badge.innerHTML = pinText(addr);
                    });
                }, (err) => {
                    console.warn('위치 가져오기 실패:', err);
                    if (badge) { badge.innerHTML = pinText('위치를 가져올 수 없습니다 · 아래에서 직접 설정'); badge.className = 'location-badge manual'; }
                    showToast('위치 접근이 거부되었습니다. 위치를 직접 설정해주십시오.');
                }, { enableHighAccuracy: true, timeout: 8000 });
            } else if (badge) {
                badge.innerHTML = pinText('위치 기능을 사용할 수 없습니다 · 직접 설정');
                badge.className = 'location-badge manual';
            }

            openMemoryModal();
        }, 'image/jpeg', 0.92);
    }

    if (document.getElementById('camera-shutter'))
        document.getElementById('camera-shutter').addEventListener('click', capturePhoto);
    if (document.getElementById('camera-close'))
        document.getElementById('camera-close').addEventListener('click', closeCameraModal);
    if (document.getElementById('camera-switch'))
        document.getElementById('camera-switch').addEventListener('click', () => {
            camFacing = (camFacing === 'environment') ? 'user' : 'environment';
            startCameraStream();
        });

    // 대체 파일(모바일 카메라) 선택 시: 기존 사진 업로드 로직과 동일하게 처리
    if (camFallback) {
        camFallback.addEventListener('change', (e) => {
            const f = e.target.files[0];
            camFallback.value = '';
            if (!f) return;
            cameraMode = true;
            if (fileInput) {
                // 기존 change 핸들러를 재사용하기 위해 동일 처리 함수 호출
                handlePickedImage(f, true);
            }
        });
    }

    // 다시 촬영하기 → 카메라 재실행 (작성 중 데이터 유지)
    const retakeBtn = document.getElementById('btn-retake-photo');
    if (retakeBtn) retakeBtn.addEventListener('click', () => { openCameraCapture(true); });

    // ==========================================
    //  당겨서 새로고침 (Pull to refresh) — 당긴 만큼 원형 게이지가 채워짐
    // ==========================================
    const PTR_C = 2 * Math.PI * 15; // 진행 링 둘레 (r=15)
    const ptrIndicator = document.createElement('div');
    ptrIndicator.id = 'ptr-indicator';
    ptrIndicator.innerHTML =
        '<svg class="ptr-ring" viewBox="0 0 36 36">' +
        '<circle class="ptr-bg" cx="18" cy="18" r="15"></circle>' +
        '<circle class="ptr-fg" cx="18" cy="18" r="15"></circle>' +
        '</svg>';
    ptrIndicator.style.display = 'none';
    document.body.appendChild(ptrIndicator);
    const ptrFg = ptrIndicator.querySelector('.ptr-fg');
    ptrFg.style.strokeDasharray = PTR_C;
    ptrFg.style.strokeDashoffset = PTR_C;

    const PTR_THRESHOLD = 112; // 더 천천히 차도록 임계 거리 증가

    function ptrSetProgress(p) {
        // p: 0~1 → 링이 그만큼 채워짐
        ptrFg.style.strokeDashoffset = PTR_C * (1 - Math.max(0, Math.min(1, p)));
    }

    function attachPullToRefresh(scrollEl, isEnabled, onRefresh, iconInset, lockContent) {
        if (!scrollEl) return;
        const inset = (typeof iconInset === 'number') ? iconInset : 12;
        let startY = 0, pulling = false, dist = 0, busy = false, baseTop = 0;

        function setVisual(d, instant) {
            const t = instant ? 'none' : 'transform 0.32s var(--ease-soft)';
            ptrIndicator.style.transition = instant ? 'none' : 'transform 0.32s var(--ease-soft), opacity 0.3s ease';
            // 콘텐츠 고정 모드(lockContent)면 폼/내용은 전혀 움직이지 않고 링만 표시
            if (!lockContent) {
                scrollEl.style.transition = t;
                scrollEl.style.transform = d > 0 ? ('translateY(' + d + 'px)') : '';
            }
            // 아이콘(링)은 당긴 만큼 함께 따라 내려옴 (콘텐츠 고정 시에는 이동 폭 축소)
            const follow = Math.min(d, lockContent ? 56 : 120);
            ptrIndicator.style.transform = 'translateX(-50%) translateY(' + (baseTop + follow + inset) + 'px)';
            ptrIndicator.style.opacity = d > 4 ? Math.min(d / 30, 1) : 0;
            if (!ptrIndicator.classList.contains('spinning')) {
                ptrSetProgress(d / PTR_THRESHOLD);
            }
        }

        scrollEl.addEventListener('touchstart', (e) => {
            if (busy || !isEnabled() || scrollEl.scrollTop > 0) { pulling = false; return; }
            startY = e.touches[0].clientY; pulling = true; dist = 0;
            baseTop = scrollEl.getBoundingClientRect().top + 6;
            ptrIndicator.style.display = '';
            ptrIndicator.classList.remove('spinning');
            ptrFg.style.transition = 'stroke-dashoffset 0.05s linear';
            ptrFg.style.strokeDasharray = PTR_C;
        }, { passive: true });

        scrollEl.addEventListener('touchmove', (e) => {
            if (!pulling || busy) return;
            const dy = e.touches[0].clientY - startY;
            if (dy <= 0 || scrollEl.scrollTop > 0) { dist = 0; setVisual(0, true); pulling = (dy > 0); return; }
            // 제한 없이 당긴 만큼(저항감) 따라옴 — 천천히 차도록 계수 축소
            dist = dy * 0.5;
            setVisual(dist, true);
            if (dy > 5 && e.cancelable) e.preventDefault();
        }, { passive: false });

        const finish = () => {
            if (!pulling || busy) return;
            pulling = false;
            if (dist >= PTR_THRESHOLD) {
                // 게이지가 다 찼을 때 놓으면 → 새로고침 (스피너 회전)
                busy = true;
                ptrSetProgress(1);
                if (!lockContent) {
                    scrollEl.style.transition = 'transform 0.32s var(--ease-soft)';
                    scrollEl.style.transform = 'translateY(58px)';
                }
                ptrIndicator.style.transition = 'transform 0.32s var(--ease-soft)';
                ptrIndicator.style.transform = 'translateX(-50%) translateY(' + (baseTop + (lockContent ? 40 : 50) + inset) + 'px)';
                ptrIndicator.style.opacity = 1;
                ptrIndicator.classList.add('spinning');
                // 회전 인디케이터용 짧은 호(arc)로 전환
                ptrFg.style.transition = 'none';
                ptrFg.style.strokeDasharray = '24 ' + (PTR_C - 24);
                ptrFg.style.strokeDashoffset = '0';
                Promise.resolve().then(onRefresh).finally(() => {
                    setTimeout(() => {
                        ptrIndicator.classList.remove('spinning');
                        // 게이지 원복
                        ptrFg.style.transition = 'stroke-dashoffset 0.05s linear';
                        ptrFg.style.strokeDasharray = PTR_C;
                        setVisual(0, false);   // 화면이 다시 위로 올라가며 복귀
                        setTimeout(() => { ptrIndicator.style.display = 'none'; busy = false; }, 340);
                    }, 500);
                });
            } else {
                setVisual(0, false);
                setTimeout(() => { if (!busy) ptrIndicator.style.display = 'none'; }, 340);
            }
        };
        scrollEl.addEventListener('touchend', finish);
        scrollEl.addEventListener('touchcancel', finish);
    }

    const containerEl = document.querySelector('main.container');
    attachPullToRefresh(containerEl,
        () => {
            const tl = document.getElementById('tab-timeline');
            const cl = document.getElementById('tab-checklist');
            const pf = document.getElementById('tab-profile');
            return (tl && tl.style.display !== 'none')
                || (cl && cl.style.display !== 'none')
                || (pf && pf.style.display !== 'none');
        },
        () => {
            const cl = document.getElementById('tab-checklist');
            const pf = document.getElementById('tab-profile');
            if (pf && pf.style.display !== 'none') loadProfiles();
            if (cl && cl.style.display !== 'none') return Promise.resolve(loadChecklistsFromServer());
            return Promise.resolve(loadMemoriesFromServer());
        }, 26); // 타임라인/가볼곳/내정보 아이콘을 좀 더 아래로

    // 추억 상세 모달 당겨서 새로고침 — 스크롤 영역이 .sheet-body 로 변경됨
    const detailScroll = document.querySelector('#detail-modal .sheet-body');
    attachPullToRefresh(detailScroll,
        () => !document.getElementById('detail-modal').classList.contains('hidden') && _detailMemory != null,
        () => { if (_detailMemory) loadComments('memory', _detailMemory.id); return Promise.resolve(loadMemoriesFromServer()); },
        -10, true);

    // '우리의 추억' / '~의 추억' 리스트 모달 당겨서 새로고침 (가로 드래그는 CSS로 잠금)
    const listScroll = document.querySelector('#list-modal .list-modal-body');
    attachPullToRefresh(listScroll,
        () => {
            const m = document.getElementById('list-modal');
            return !m.classList.contains('hidden') && !m.classList.contains('dday-mode');
        },
        () => Promise.resolve(loadMemoriesFromServer()).then(() => {
            if (Daylog._openListKind) openStatList(Daylog._openListKind);
        }),
        14);

    // --- 데이터 불러오기 및 렌더링 ---
    function loadMemoriesFromServer() {
        if (!requireAuthOrRedirect()) return Promise.resolve();

        return withLoading(fetch(`${API_BASE_URL}/api/memories/${currentUid}`, { headers: authHeaders(true) })
            .then(handleResponse)
            .then(memories => {
                const list = memories || [];
                const sig = _listSig(list);
                if (sig === _memSig) return; // 변경 없음 → 재렌더 생략(깜빡임 방지)
                _memSig = sig;
                memoryList = list;
                Daylog.memories = memoryList;
                // [B] edit by smsong - 목록 전체 이미지 사전 로드 제거: <img loading="lazy"> 가 화면에 보이는 것만
                //  로드하도록 위임 → 목록 진입 프리즈/스크롤 버벅임 해소. (마커 <img> 는 자체 로드)
                updateProfileStats();
                if (Daylog._applyRoomProfileMode) Daylog._applyRoomProfileMode(); // [smsong] 친구/가족 멤버뷰 카운트 갱신

                const sorted = [...memoryList].sort(sortByDateDesc);
                if (mapMode === 'memory') renderActiveMapMarkers();
                buildTimelinePlaceOptions();
                applyTimelineFilter();
            })
            .catch(err => console.error("데이터 로드 실패:", err)), '추억을 불러오는 중...'); // [smsong] 로딩
    }

    // ==========================================
    //  가볼곳(체크리스트) — 로드 / 마커 / 목록 / 지도 전환
    // ==========================================
    function loadChecklistsFromServer() {
        if (!requireAuthOrRedirect()) return Promise.resolve();
        return withLoading(fetch(`${API_BASE_URL}/api/checklists/${currentUid}`, { headers: authHeaders(true) })
            .then(handleResponse)
            .then(list => {
                const arr = list || [];
                checklistLoaded = true;
                const sig = _listSig(arr);
                if (sig === _clSig) return; // 변경 없음 → 재렌더 생략(깜빡임 방지)
                _clSig = sig;
                checklistList = arr;
                Daylog.checklists = checklistList; // [B] edit by smsong - 멤버 모달 가볼곳 카운트용 (추억처럼 노출)
                // [B] edit by smsong - 목록 전체 이미지 사전 로드 제거 → lazy 로 위임 (스크롤/전환 성능)
                applyChecklistFilter();
                if (typeof updateChecklistStats === 'function') updateChecklistStats();
                if (Daylog._applyRoomProfileMode) Daylog._applyRoomProfileMode(); // [smsong] 멤버뷰 카운트 갱신
                if (mapMode === 'checklist') renderActiveMapMarkers();
            })
            .catch(err => console.error("체크리스트 로드 실패:", err)), '체크리스트를 불러오는 중...'); // [smsong] 로딩
    }

    // 가볼곳 마커 — 사진 대신 제목 말풍선, 타입별 색상, 방문 표시
    function renderChecklistMarkers(list) {
        if (!map) return;
        markers.forEach(m => m.setMap(null));
        markers = [];
        (list || []).forEach(item => {
            if (!(item.lat && item.lng)) return;
            const meta = checklistType(item.type);
            const visitedCls = item.visited ? ' visited' : '';
            const check = item.visited ? '<span class="cl-marker-check">' + icon('check',13) + '</span>' : '';
            const markerHtml =
                '<div class="cl-marker' + visitedCls + (_suppressDrop ? ' nodrop' : '') + '" style="--cl-color:' + meta.color + '">' +
                check +
                '<span class="cl-marker-emoji">' + meta.emoji + '</span>' +
                '<span class="cl-marker-title">' + escapeHtml(item.title || '체크리스트') + '</span>' +
                '<span class="cl-marker-tail"></span>' +
                '</div>';
            const marker = new naver.maps.Marker({
                position: new naver.maps.LatLng(item.lat, item.lng),
                map: map,
                icon: { content: markerHtml, anchor: new naver.maps.Point(14, 32) }
            });
            marker._checklistId = item.id;
            naver.maps.Event.addListener(marker, 'click', () => openChecklistDetail(item));
            markers.push(marker);
        });
    }

    // [B] edit by smsong - #1 마커 일괄 제거 (위치 선택 모드 진입 등)
    function clearAllMarkers() {
        markers.forEach(m => m.setMap(null));
        markers = [];
    }
    // [E] edit by smsong

    // 현재 모드 + 지도 필터를 적용해 마커 렌더
    function renderActiveMapMarkers() {
        // [B] edit by smsong - #1 위치 설정 중에는 추억/가볼곳 마커를 그리지 않는다(지도만 표시).
        //  마커 생성 함수가 아니라 이 진입점 한 곳만 막아, 위치 선택 중 백그라운드 새로고침
        //  (loadMemoriesFromServer 등)이 돌아도 마커가 다시 튀어나오지 않게 한다.
        if (isWaitingForMapClick) { clearAllMarkers(); return; }
        // [E] edit by smsong
        if (mapMode === 'checklist') {
            let list = [...checklistList];
            if (_mapClVisited === 'VISITED') list = list.filter(c => c.visited);
            else if (_mapClVisited === 'TODO') list = list.filter(c => !c.visited);
            if (_mapClCat !== 'ALL') list = list.filter(c => (c.type || 'ETC') === _mapClCat);
            renderChecklistMarkers(list);
        } else {
            let list = [...memoryList].sort(sortByDateDesc);
            if (_mapMemDate) list = list.filter(m => (m.createdAt || '').substring(0, 10) === _mapMemDate);
            renderMarkers(list);
        }
    }

    // 현재 모드에 맞춰 지도 마커 재렌더
    function refreshMapMarkers() {
        renderActiveMapMarkers();
    }

    // 지도 표시 데이터 전환 (추억 ↔ 가볼곳)
    function setMapMode(mode) {
        mapMode = mode;
        updateMapButtons();
        closeMapFilterPop(); // 모드 바뀌면 필터 폼 내용이 달라지므로 닫음
        if (mode === 'checklist' && !checklistLoaded) {
            loadChecklistsFromServer(); // 로드 완료 시 내부에서 마커 렌더
        } else {
            refreshMapMarkers();
        }
    }

    // 우측 원형 아이콘 버튼 갱신 (아이콘만 표시)
    function updateMapButtons() {
        const toggle = document.getElementById('btn-map-toggle');
        const action = document.getElementById('btn-map-action');
        const isCl = (mapMode === 'checklist');
        if (toggle) {
            toggle.innerHTML = isCl ? icon('camera',20) : icon('bookmark',20);
            toggle.title = isCl ? '추억 보기' : '체크리스트 보기';
            toggle.classList.toggle('to-memory', isCl);
            toggle.classList.toggle('to-checklist', !isCl);
        }
        if (action) {
            action.innerHTML = icon('plus',22);
            action.title = isCl ? '체크리스트 추가' : '기록 남기기';
            // 추가 버튼은 색이 바뀌지 않도록 모드별 색 클래스를 적용하지 않음
        }
    }

    // 가볼곳 목록(탭) 렌더 — 타임라인과 동일한 무한 스크롤 + 가상 스크롤
    // [B] edit by smsong - #2
    var _clPager = null;

    function _clCardEl(item) {
        const meta = checklistType(item.type);
        const card = document.createElement('div');
        card.className = 'cl-card' + (item.visited ? ' visited' : '');
        const badge = item.visited
            ? '<span class="cl-visited-badge">' + icon('check', 12) + ' 다녀옴' + (item.visitedDate ? ' · ' + fmtDate(item.visitedDate) : '') + '</span>'
            : '<span class="cl-todo-badge">가볼 예정</span>';
        const loc = [item.placeName, item.address].filter(Boolean).join(' ');
        card.innerHTML =
            '<div class="cl-card-main">' +
            '<div class="cl-card-tags">' +
            '<span class="cl-type-tag" style="--cl-color:' + meta.color + '">' + meta.emoji + ' ' + meta.label + '</span>' +
            badge +
            '</div>' +
            '<h4 class="cl-card-title">' + escapeHtml(item.title || '') + '</h4>' +
            (item.content ? '<p class="cl-card-text">' + escapeHtml(item.content) + '</p>' : '') +
            (loc ? '<div class="cl-card-loc">' + icon('pin', 13) + ' ' + escapeHtml(loc) + '</div>' : '') +
            commentBadgeHtml('checklist', item.id) +
            '</div>' +
            thumbHtml(coverUrlOf(item), 'cl-thumb');
        card.addEventListener('click', () => openChecklistDetail(item));
        return card;
    }

    function renderChecklistFeed(sorted) {
        const feedEl = document.getElementById('checklist-feed');
        if (!feedEl) return;
        const scrollEl = document.querySelector('main.container');

        if (!window.DaylogFeed || !scrollEl) {   // 안전 폴백 — 예전처럼 한 번에 그림
            feedEl.innerHTML = '';
            if (!sorted.length) {
                feedEl.innerHTML = '<div class="empty-state"><span class="es-icon">' + icon('bookmark', 40) + '</span><p>아직 등록된 체크리스트가 없습니다</p></div>';
                return;
            }
            sorted.forEach(item => feedEl.appendChild(_clCardEl(item)));
            applyCommentBadges('checklist');
            fetchCommentCounts('checklist');
            return;
        }

        if (!_clPager) {
            _clPager = window.DaylogFeed.create({
                feedEl: feedEl,
                scrollEl: scrollEl,
                pageSize: 5,
                windowRows: 10,
                emptyHtml: '<div class="empty-state"><span class="es-icon">' + icon('bookmark', 40) + '</span><p>아직 등록된 체크리스트가 없습니다</p></div>',
                rowsOf: function (list) {
                    return list.map(function (c) {
                        return { key: 'c:' + c.id, type: 'card', item: c, est: 132 };
                    });
                },
                renderRow: function (row) { return _clCardEl(row.item); },
                onWindow: function () { applyCommentBadges('checklist'); },
                onData: function () { fetchCommentCounts('checklist'); }
            });
            Daylog._clPager = _clPager; // 콘솔 디버그용
        }
        _clPager.setItems(sorted);
    }
    // [E] edit by smsong

    // 가볼곳 작성 폼 열기 (위치는 currentLatLng/currentLocationMeta 에서 가져옴)
    window._openChecklistForm = function () {
        const badge = document.getElementById('cl-location-badge');
        const place = (currentLocationMeta && currentLocationMeta.placeName) || '';
        const addr = (currentLocationMeta && currentLocationMeta.address) || '';
        const text = [place, addr].filter(Boolean).join(' ');
        if (badge) {
            badge.className = 'location-badge success';
            badge.innerHTML = text ? pinText(text) : pinText('선택한 위치');
            if (!text && currentLatLng) {
                reverseGeocode(currentLatLng.lat, currentLatLng.lng, (a) => {
                    if (a) { currentLocationMeta = splitKoreanAddress(a); badge.innerHTML = pinText(a); }
                });
            }
        }
        // 장소 검색으로 고른 경우 제목을 상호명으로 자동 입력 (사용자가 비워둔 경우에만)
        const titleEl = document.getElementById('cl-title');
        if (titleEl && window._pendingPlaceTitle && !titleEl.value.trim()) {
            titleEl.value = window._pendingPlaceTitle;
        }
        window._pendingPlaceTitle = '';
        if (window._clCreateMgr) window._clCreateMgr.reset([]);
    };
    function startChecklistCreate() {
        pickTarget = 'checklist';
        enterPickMode();
    }
    window._startChecklistCreate = startChecklistCreate;

    // 가볼곳 제출 데이터 묶기 (모듈 외부 폼 핸들러에서 호출)
    window._submitChecklist = function () {
        if (!requireAuthOrRedirect()) return;
        if (!currentLatLng) { showToast('위치 정보가 없습니다'); return; }
        const title = document.getElementById('cl-title').value.trim();
        if (!title) { showToast('제목을 입력해주십시오'); return; }
        const visited = document.getElementById('cl-visited').checked;
        const visitedDate = document.getElementById('cl-visited-date').value;
        // [B][E] edit by smsong - #13 갈 예정일 (체크리스트 달력 표시용)
        const plannedDate = (document.getElementById('cl-planned-date') || {}).value || null;
        const clMgr = window._clCreateMgr;
        const clFiles = clMgr ? clMgr.getNewFiles() : [];
        const hasImage = clFiles.length > 0;
        // '다녀왔습니다'가 체크된 경우 이미지는 필수
        if (visited && !hasImage) {
            showToast('다녀왔습니다로 표시하려면 사진을 첨부해주십시오');
            alert('다녀온 곳은 사진을 반드시 첨부해야 합니다.');
            return;
        }
        if (clFiles.length > 10) { showToast('이미지는 최대 10장까지 첨부할 수 있습니다'); return; }
        const dto = {
            title: title,
            content: document.getElementById('cl-content').value,
            lat: currentLatLng.lat,
            lng: currentLatLng.lng,
            placeName: (currentLocationMeta && currentLocationMeta.placeName) || '',
            address: (currentLocationMeta && currentLocationMeta.address) || '',
            type: window._clSelectedType || 'ETC',
            visited: visited,
            visitedDate: (visited && visitedDate) ? visitedDate : null,
            plannedDate: plannedDate,   // [B][E] edit by smsong - #13 갈 예정일
            mediaOrder: clMgr ? clMgr.getMediaOrder() : []
        };
        const fd = new FormData();
        fd.append('uid', currentUid);
        fd.append('checklistData', JSON.stringify(dto));
        clFiles.forEach(f => fd.append('mediaData', f));

        const submitBtn = document.querySelector('#checklist-form .submit-btn');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.innerText = '추가하는 중...'; }

        withLoading(fetch(`${API_BASE_URL}/api/checklists`, { method: 'POST', headers: authHeaders(false), body: fd }), '저장 중...')
            .then(handleResponse)
            .then((created) => {
                closeChecklistModal();
                pickTarget = 'memory';
                // [B] edit by smsong - '다녀왔습니다'로 추가하면 추억으로 기록하고, 가볼곳은 제거(추억으로 이동)
                if (created && created.visited) {
                    ensureMemoryForChecklist(created)
                        .then((made) => { showToast('다녀온 곳이라 추억으로 기록하고 보관함에 담았어요'); })
                        .then(() => archiveChecklistQuietly(created.id)) // 원본 가볼곳 제거
                        .catch(err => console.warn('추억 이동 실패', err))
                        .finally(() => {
                            // [B] edit by smsong - #3 추억/가볼곳 모두 새로고침 후 지도를 추억 모드로 → 새 추억 마커 즉시 표시
                            Promise.all([loadMemoriesFromServer(), loadChecklistsFromServer()]).then(function () {
                                if (mapMode !== 'memory') setMapMode('memory'); else refreshMapMarkers();
                            });
                        });
                } else {
                    showToast('체크리스트를 추가했습니다');
                    loadChecklistsFromServer().then(function () {
                        if (mapMode !== 'checklist') setMapMode('checklist');
                        else refreshMapMarkers();
                    });
                }
                // [E] edit by smsong
            })
            .catch(err => { console.error(err); showToast('추가 실패. 다시 시도해주십시오.'); })
            .finally(() => { if (submitBtn) { submitBtn.disabled = false; submitBtn.innerText = '추가하기'; } });
    };

    // 우측 하단 플로팅 버튼 동작
    const mapToggleBtn = document.getElementById('btn-map-toggle');
    if (mapToggleBtn) mapToggleBtn.addEventListener('click', () => {
        setMapMode(mapMode === 'checklist' ? 'memory' : 'checklist');
    });
    const mapActionBtn = document.getElementById('btn-map-action');
    if (mapActionBtn) mapActionBtn.addEventListener('click', () => {
        if (mapMode === 'checklist') startChecklistCreate();
        else { pickTarget = 'memory'; document.getElementById('memory-file').click(); }
    });

    // [B] edit by smsong - 지도 + 버튼 제거 대체: 각 메뉴(타임라인=추억 / 가볼곳=체크리스트)에서 직접 추가
    const tlAddBtn = document.getElementById('btn-timeline-add');
    if (tlAddBtn) tlAddBtn.addEventListener('click', () => {
        pickTarget = 'memory';
        document.getElementById('memory-file').click(); // 갤러리 → 사진 위치(EXIF)/현재위치 자동, 없으면 지도에서 선택
    });
    const clAddBtn = document.getElementById('btn-checklist-add');
    if (clAddBtn) clAddBtn.addEventListener('click', () => { startChecklistCreate(); });
    // [E] edit by smsong

    // ===== 지도 헤더 필터(➕) — 모드별 폼이 아이콘 아래로 살짝 뜨고, 누르면 즉시 적용 =====
    function closeMapFilterPop() {
        const pop = document.getElementById('map-filter-pop');
        if (pop) pop.classList.add('hidden');
    }
    function buildMapFilterPop() {
        const pop = document.getElementById('map-filter-pop');
        if (!pop) return;
        if (mapMode === 'checklist') {
            const vOpts = [['ALL', '전체'], ['VISITED', '가본 곳'], ['TODO', '안 가본 곳']];
            const cOpts = [['ALL', '전체'], ['CAFE', '카페'], ['FOOD', '식당'], ['SPOT', '장소'], ['ETC', '기타']];
            pop.innerHTML =
                '<div class="mfp-group">' +
                '<div class="mfp-title">방문 여부</div>' +
                '<div class="mfp-chips" id="mfp-visited">' +
                vOpts.map(o => '<button type="button" class="mfp-chip' + (_mapClVisited === o[0] ? ' active' : '') + '" data-v="' + o[0] + '">' + o[1] + '</button>').join('') +
                '</div></div>' +
                '<div class="mfp-group">' +
                '<div class="mfp-title">카테고리</div>' +
                '<div class="mfp-chips" id="mfp-cat">' +
                cOpts.map(o => '<button type="button" class="mfp-chip' + (_mapClCat === o[0] ? ' active' : '') + '" data-c="' + o[0] + '">' + o[1] + '</button>').join('') +
                '</div></div>';
            pop.querySelectorAll('#mfp-visited .mfp-chip').forEach(b => b.addEventListener('click', () => {
                _mapClVisited = b.dataset.v;
                pop.querySelectorAll('#mfp-visited .mfp-chip').forEach(x => x.classList.toggle('active', x === b));
                renderActiveMapMarkers();
            }));
            pop.querySelectorAll('#mfp-cat .mfp-chip').forEach(b => b.addEventListener('click', () => {
                _mapClCat = b.dataset.c;
                pop.querySelectorAll('#mfp-cat .mfp-chip').forEach(x => x.classList.toggle('active', x === b));
                renderActiveMapMarkers();
            }));
        } else {
            pop.innerHTML = '<div class="mfp-title">추억 날짜</div>' +
                '<input type="date" id="mfp-date" class="mfp-date" value="' + (_mapMemDate || '') + '">' +
                '<button type="button" id="mfp-date-all" class="mfp-chip mfp-allbtn' + (!_mapMemDate ? ' active' : '') + '">전체 보기</button>';
            const d = pop.querySelector('#mfp-date');
            const all = pop.querySelector('#mfp-date-all');
            if (d) d.addEventListener('change', () => {
                _mapMemDate = d.value || '';
                if (all) all.classList.toggle('active', !_mapMemDate);
                renderActiveMapMarkers();
            });
            if (all) all.addEventListener('click', () => {
                _mapMemDate = '';
                if (d) d.value = '';
                all.classList.add('active');
                renderActiveMapMarkers();
            });
        }
    }
    function toggleMapFilterPop() {
        const pop = document.getElementById('map-filter-pop');
        if (!pop) return;
        if (pop.classList.contains('hidden')) { buildMapFilterPop(); pop.classList.remove('hidden'); }
        else pop.classList.add('hidden');
    }
    const mapFilterBtn = document.getElementById('btn-map-filter');
    if (mapFilterBtn) mapFilterBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMapFilterPop(); });
    document.addEventListener('click', (e) => {
        const wrap = document.getElementById('header-map-filter');
        const pop = document.getElementById('map-filter-pop');
        if (pop && !pop.classList.contains('hidden') && wrap && !wrap.contains(e.target)) pop.classList.add('hidden');
    });
    // 가볼곳 위치 다시 설정
    const clResetLoc = document.getElementById('cl-reset-location');
    function _startChecklistLocationPick() {
        pickReturnsToForm = true;
        pickTarget = 'checklist';
        document.getElementById('checklist-modal').classList.add('hidden');
        enterPickMode();
    }
    if (clResetLoc) clResetLoc.addEventListener('click', _startChecklistLocationPick);
    // [B] edit by smsong - 위치 배지를 눌러도 바로 위치 변경
    const _clLocBadge = document.getElementById('cl-location-badge');
    if (_clLocBadge) {
        _clLocBadge.setAttribute('title', '눌러서 위치 변경');
        _clLocBadge.addEventListener('click', _startChecklistLocationPick);
    }
    // [E] edit by smsong
    updateMapButtons();

    // ---- 가볼곳 폼 상호작용 (타입 칩 / 방문 체크 / 제출) ----
    function bindTypeChips(containerId, setSel) {
        const box = document.getElementById(containerId);
        if (!box) return;
        box.querySelectorAll('.cl-type-chip').forEach(chip => {
            chip.style.setProperty('--cl-color', checklistType(chip.dataset.type).color);
            chip.addEventListener('click', () => {
                box.querySelectorAll('.cl-type-chip').forEach(c => c.classList.remove('selected'));
                chip.classList.add('selected');
                setSel(chip.dataset.type);
            });
        });
    }
    bindTypeChips('cl-type-options', (t) => { window._clSelectedType = t; });
    bindTypeChips('cl-edit-type-options', (t) => { window._clEditSelectedType = t; });

    // 방문 체크박스 → 날짜 입력 활성/비활성
    function bindVisitedToggle(checkId, dateId) {
        const chk = document.getElementById(checkId);
        const date = document.getElementById(dateId);
        if (!chk || !date) return;
        chk.addEventListener('change', () => {
            date.disabled = !chk.checked;
            const lbl = chk.closest('.cl-check-label');
            if (lbl) lbl.classList.toggle('checked', chk.checked);
            if (chk.checked && !date.value) date.value = new Date().toISOString().substring(0, 10);
        });
    }
    bindVisitedToggle('cl-visited', 'cl-visited-date');
    bindVisitedToggle('cl-edit-visited', 'cl-edit-visited-date');

    const checklistForm = document.getElementById('checklist-form');
    if (checklistForm) checklistForm.addEventListener('submit', (e) => {
        e.preventDefault();
        window._submitChecklist();
    });

    const clEditForm = document.getElementById('cl-edit-form');
    if (clEditForm) clEditForm.addEventListener('submit', (e) => { e.preventDefault(); saveChecklistEdit(); });
    const clEditCancel = document.getElementById('cl-edit-cancel');
    if (clEditCancel) clEditCancel.addEventListener('click', exitChecklistEdit);

    // 모달 바깥 클릭으로 닫기
    const clModal = document.getElementById('checklist-modal');
    if (clModal) clModal.addEventListener('click', (e) => { if (e.target.id === 'checklist-modal') closeChecklistModal(); });
    const clDetail = document.getElementById('checklist-detail-modal');
    if (clDetail) clDetail.addEventListener('click', (e) => { if (e.target.id === 'checklist-detail-modal') closeChecklistDetail(); });

    // ---- 타임라인 검색/필터 (장소 라디오 + 날짜) ----
    // 현재 추억들의 placeName 값으로 장소 콤보박스 옵션 구성
    function buildTimelinePlaceOptions() {
        const sel = document.getElementById('tl-filter-place');
        if (!sel) return;
        const places = Array.from(new Set(
            memoryList.map(m => (m.placeName || '').trim()).filter(Boolean)
        )).sort((a, b) => a.localeCompare(b, 'ko'));
        // 선택 중이던 값이 사라졌으면 전체로 복귀
        if (_tlPlaceFilter && !places.includes(_tlPlaceFilter)) _tlPlaceFilter = '';
        let html = '<option value="">전체</option>';
        places.forEach(p => {
            html += '<option value="' + escapeHtml(p) + '"' + (_tlPlaceFilter === p ? ' selected' : '') + '>' + escapeHtml(p) + '</option>';
        });
        sel.innerHTML = html;
        sel.value = _tlPlaceFilter;
        sel.onchange = () => { _tlPlaceFilter = sel.value; applyTimelineFilter(); };
    }

    function applyTimelineFilter() {
        const dateEl = document.getElementById('tl-filter-date');
        const day = (dateEl && dateEl.value) ? dateEl.value : '';
        const kw = _tlKeyword.trim().toLowerCase();
        let list = [...memoryList].sort(sortByDateDesc);
        if (kw) list = list.filter(m => {
            const hay = ((m.title || '') + ' ' + (m.content || '') + ' ' + (m.placeName || '') + ' ' + (m.address || '')).toLowerCase();
            return hay.includes(kw);
        });
        if (_tlPlaceFilter) list = list.filter(m => (m.placeName || '').trim() === _tlPlaceFilter);
        if (day) list = list.filter(m => (m.createdAt || '').substring(0, 10) === day);
        renderTimeline(list);
        // [B] edit by smsong - #15 그리드/달력도 같은 필터 결과로 동기화
        Daylog._tlFiltered = list;
        if (_tlView === 'grid') renderTimelineGrid(list);
        if (_tlView === 'calendar') renderCalendar();
        // [E] edit by smsong
    }

    // ===== [B] edit by smsong - #15 인스타그램식 사진 그리드 보기 =====
    //  · 3열 정사각 썸네일만. 글자 없이 사진으로만 훑는 화면이라 기본 보기로 쓴다.
    //  · 목록/달력과 같은 필터(_tlKeyword / _tlPlaceFilter / 날짜)를 그대로 따른다.
    //  · 무한 + 가상 스크롤은 DaylogFeed 를 그대로 쓴다. 3열이므로 한 번에 9개(3줄)씩.
    var _tlGridPager = null;

    function _tlGridTile(m) {
        var t = document.createElement('button');
        t.type = 'button';
        t.className = 'tg-tile';
        var cover = coverUrlOf(m);
        var many = (mediaUrlsOf(m) || []).length > 1;
        if (cover) {
            t.innerHTML =
                '<img class="tg-img" src="' + Daylog.thumbUrlOf(cover) + '" data-full="' + cover +
                '" loading="lazy" decoding="async" alt=""' +
                ' onload="this.classList.add(\'is-loaded\')" onerror="Daylog._thumbFallback(this)">' +
                (many ? '<span class="tg-multi" aria-label="사진 여러 장">' +
                    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
                    'stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="3" width="13" height="13" rx="2"/>' +
                    '<path d="M16 19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8"/></svg></span>' : '');
        } else {
            // 사진 없는 추억도 빠지지 않도록 제목만 얹은 타일로
            t.className += ' notext';
            t.innerHTML = '<span class="tg-noimg">' + icon('book', 20) + '</span>' +
                          '<span class="tg-title">' + escapeHtml(m.title || '') + '</span>';
        }
        t.addEventListener('click', function () { openDetailModal(m); });
        return t;
    }

    function renderTimelineGrid(sorted) {
        var gridEl = document.getElementById('timeline-grid');
        var scrollEl = document.querySelector('main.container');
        if (!gridEl) return;

        if (!window.DaylogFeed || !scrollEl) {   // 안전 폴백
            gridEl.innerHTML = '';
            (sorted || []).forEach(function (m) { gridEl.appendChild(_tlGridTile(m)); });
            return;
        }
        if (!_tlGridPager) {
            _tlGridPager = window.DaylogFeed.create({
                feedEl: gridEl,
                scrollEl: scrollEl,
                pageSize: 9,      // 3열 × 3줄
                windowRows: 8,
                estimate: 124,
                emptyHtml: '<div class="empty-state"><span class="es-icon">' + icon('image', 40) + '</span>' +
                           '<p>기록이 존재하지 않음</p></div>',
                rowsOf: function (list) {
                    var rows = [];
                    for (var i = 0; i < list.length; i += 3) {
                        var g = list.slice(i, i + 3);
                        rows.push({ key: 'g:' + g.map(function (x) { return x.id; }).join('-'), items: g });
                    }
                    return rows;
                },
                renderRow: function (row) {
                    var line = document.createElement('div');
                    line.className = 'tg-row';
                    row.items.forEach(function (m) { line.appendChild(_tlGridTile(m)); });
                    for (var k = row.items.length; k < 3; k++) line.appendChild(document.createElement('span'));
                    return line;
                }
            });
            Daylog._tlGridPager = _tlGridPager;
        }
        _tlGridPager.setItems(sorted);
    }
    // [E] edit by smsong

    // ===== [B] edit by smsong - 타임라인 보기 (그리드 / 목록 / 달력) =====
    var _tlView = 'grid';   // [B][E] edit by smsong - #15 기본은 사진 그리드
    var _calYear = null, _calMonth = null; // month: 0-11
    // 추억 날짜 테두리 색상 (기기 저장, 로그아웃/재시작 후에도 유지)
    var CAL_COLORS = ['#2e9e5b', '#3f7fb0', '#d05a4a', '#8a6fbf', '#e08a3c', '#d46a9a', '#b08968', '#333333'];
    var _calDateColor = (function () { try { return localStorage.getItem('daylog_cal_date_color') || '#2e9e5b'; } catch (e) { return '#2e9e5b'; } })();
    function _applyCalColor() {
        try { document.documentElement.style.setProperty('--cal-date-color', _calDateColor); } catch (e) {}
    }
    _applyCalColor(); // 초기 1회(버튼 아이콘 색 반영)
    function _setCalColor(c) {
        _calDateColor = c;
        try { localStorage.setItem('daylog_cal_date_color', c); } catch (e) {}
        _applyCalColor();
    }

    function _initCalMonthIfNeeded() {
        if (_calYear != null && _calMonth != null) return;
        var base;
        if (memoryList && memoryList.length) {
            var latest = [...memoryList].sort(sortByDateDesc)[0];
            base = (latest && latest.createdAt) ? new Date(latest.createdAt) : new Date();
            if (isNaN(base.getTime())) base = new Date();
        } else base = new Date();
        _calYear = base.getFullYear();
        _calMonth = base.getMonth();
    }

    function setTimelineView(view) {
        _tlView = view;
        var feed = document.getElementById('timeline-feed');
        var cal = document.getElementById('timeline-calendar');
        var grid = document.getElementById('timeline-grid');
        var bList = document.getElementById('tl-view-list');
        var bCal = document.getElementById('tl-view-cal');
        var bGrid = document.getElementById('tl-view-grid');
        var colorWrap = document.getElementById('tl-color-wrap');
        if (bGrid) bGrid.classList.toggle('active', view === 'grid');
        if (grid) grid.classList.toggle('hidden', view !== 'grid');
        // [B] edit by smsong - #15 사진 그리드
        if (view === 'grid') {
            if (feed) feed.classList.add('hidden');
            if (cal) cal.classList.add('hidden');
            if (bList) bList.classList.remove('active');
            if (bCal) bCal.classList.remove('active');
            if (colorWrap) colorWrap.style.display = 'none';
            var _pal0 = document.getElementById('cal-color-palette');
            if (_pal0) _pal0.classList.add('hidden');
            renderTimelineGrid(Daylog._tlFiltered || [...memoryList].sort(sortByDateDesc));
            requestAnimationFrame(function () { if (_tlGridPager) _tlGridPager.relayout(); });
            return;
        }
        // [E] edit by smsong
        if (view === 'calendar') {
            _initCalMonthIfNeeded();
            if (feed) feed.classList.add('hidden');
            if (cal) cal.classList.remove('hidden');
            if (bList) bList.classList.remove('active');
            if (bCal) bCal.classList.add('active');
            if (colorWrap) colorWrap.style.display = '';
            renderCalendar();
        } else {
            if (feed) feed.classList.remove('hidden');
            if (cal) cal.classList.add('hidden');
            if (bList) bList.classList.add('active');
            if (bCal) bCal.classList.remove('active');
            if (colorWrap) colorWrap.style.display = 'none';
            // [B] edit by smsong - #2 달력 → 목록으로 돌아오면 가상 스크롤 재계산
            requestAnimationFrame(function () { if (Daylog._relayoutFeeds) Daylog._relayoutFeeds(); });
            // [E] edit by smsong
            var pal = document.getElementById('cal-color-palette');
            if (pal) pal.classList.add('hidden');
        }
    }

    // [B] edit by smsong - 색상 팔레트 구성 + 선택
    function _buildColorPalette() {
        var pal = document.getElementById('cal-color-palette');
        if (!pal || pal.getAttribute('data-built') === '1') return;
        pal.setAttribute('data-built', '1');
        pal.innerHTML = CAL_COLORS.map(function (c) {
            return '<button type="button" class="cal-color-sw" data-color="' + c + '" style="background:' + c + ';" aria-label="색상"></button>';
        }).join('');
        pal.querySelectorAll('.cal-color-sw').forEach(function (sw) {
            sw.addEventListener('click', function (e) {
                e.stopPropagation();
                _setCalColor(sw.getAttribute('data-color'));
                pal.classList.add('hidden');
            });
        });
    }

    function renderCalendar() {
        var cont = document.getElementById('timeline-calendar');
        if (!cont) return;
        _initCalMonthIfNeeded();
        var y = _calYear, mo = _calMonth;

        // 날짜별 추억 그룹 (전체 추억 기준, YYYY-MM-DD)
        var byDate = {};
        (memoryList || []).forEach(function (m) {
            var key = (m.createdAt || '').substring(0, 10);
            if (key) (byDate[key] = byDate[key] || []).push(m);
        });

        var startDow = new Date(y, mo, 1).getDay();       // 0=일
        var daysInMonth = new Date(y, mo + 1, 0).getDate();
        var chevL = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
        var chevR = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';

        var html = '<div class="cal-head">' +
            '<button type="button" class="cal-nav" id="cal-prev" aria-label="이전 달">' + chevL + '</button>' +
            '<div class="cal-month">' + y + '년 ' + (mo + 1) + '월</div>' +
            '<button type="button" class="cal-nav" id="cal-next" aria-label="다음 달">' + chevR + '</button>' +
            '</div>';
        html += '<div class="cal-grid cal-dow">' +
            ['일', '월', '화', '수', '목', '금', '토'].map(function (d, i) {
                return '<div class="cal-dow-cell' + (i === 0 ? ' sun' : '') + (i === 6 ? ' sat' : '') + '">' + d + '</div>';
            }).join('') + '</div>';

        var cells = '';
        for (var i = 0; i < startDow; i++) cells += '<div class="cal-cell empty"></div>';
        for (var d = 1; d <= daysInMonth; d++) {
            var dateKey = y + '-' + String(mo + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
            var items = byDate[dateKey] || [];
            var dow = new Date(y, mo, d).getDay();
            var cls = 'cal-cell' + (items.length ? ' has' : '') + (dow === 0 ? ' sun' : '') + (dow === 6 ? ' sat' : '');
            var cell = '<div class="' + cls + '" data-date="' + dateKey + '">';
            cell += '<span class="cal-day">' + d + '</span>';
            if (items.length) {
                var cover = coverUrlOf(items[0]);
                var thumb = cover ? Daylog.thumbUrlOf(cover) : '';
                if (thumb) cell += '<img class="cal-thumb" src="' + thumb + '" data-full="' + cover + '" alt="" loading="lazy" decoding="async" onload="this.classList.add(\'is-loaded\')" onerror="Daylog._thumbFallback(this)">';
                else cell += '<span class="cal-nothumb">' + icon('book', 15, 'color:#b08968;') + '</span>';
                if (items.length > 1) cell += '<span class="cal-count">+' + (items.length - 1) + '</span>';
            }
            cell += '</div>';
            cells += cell;
        }
        html += '<div class="cal-grid cal-days">' + cells + '</div>';
        cont.innerHTML = html;
        _applyCalColor(); // [B] edit by smsong - 저장된 추억 날짜 색상 적용

        // [B][E] edit by smsong - #16 타임라인 달력도 "년월" 클릭으로 이동
        var _tmv = cont.querySelector('.cal-month');
        if (_tmv && Daylog._openMonthPicker) {
            _tmv.classList.add('cal-month-pick');
            _tmv.addEventListener('click', function () {
                Daylog._openMonthPicker(_calYear, _calMonth, function (y2, m2) {
                    _calYear = y2; _calMonth = m2; renderCalendar();
                });
            });
        }
        var prev = document.getElementById('cal-prev');
        var next = document.getElementById('cal-next');
        if (prev) prev.addEventListener('click', function () { _calMonth--; if (_calMonth < 0) { _calMonth = 11; _calYear--; } renderCalendar(); });
        if (next) next.addEventListener('click', function () { _calMonth++; if (_calMonth > 11) { _calMonth = 0; _calYear++; } renderCalendar(); });
        cont.querySelectorAll('.cal-cell.has').forEach(function (cell) {
            cell.addEventListener('click', function () {
                var key = cell.getAttribute('data-date');
                var items = byDate[key] || [];
                if (items.length === 1) openDetailModal(items[0]);
                else if (items.length > 1) openMemoryListModal(key.replace(/-/g, '.') + ' 추억', items);
            });
        });
    }
    Daylog._renderCalendar = renderCalendar; // 외부(로드 후)에서 갱신용
    Daylog._setTimelineView = setTimelineView;

    // [B] edit by smsong - #15 그리드 버튼/컨테이너 주입 + 기본 보기 적용 (main.html 무수정)
    (function injectGridView() {
        var tog = document.querySelector('#tab-timeline .tl-view-toggle');
        var feed = document.getElementById('timeline-feed');
        if (!tog || !feed || document.getElementById('tl-view-grid')) return;

        var b = document.createElement('button');
        b.type = 'button'; b.id = 'tl-view-grid'; b.className = 'tl-view-btn active';
        b.title = '사진으로 보기'; b.setAttribute('aria-label', '사진으로 보기');
        b.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<rect x="3" y="3" width="7" height="7" rx="1.2"/><rect x="14" y="3" width="7" height="7" rx="1.2"/>' +
            '<rect x="3" y="14" width="7" height="7" rx="1.2"/><rect x="14" y="14" width="7" height="7" rx="1.2"/></svg>';
        tog.insertBefore(b, tog.firstChild);   // 그리드 · 목록 · 달력 순
        b.addEventListener('click', function () { setTimelineView('grid'); });

        var g = document.createElement('div');
        g.id = 'timeline-grid';
        feed.parentNode.insertBefore(g, feed);

        // 기본 보기 = 그리드
        var bl = document.getElementById('tl-view-list');
        if (bl) bl.classList.remove('active');
        feed.classList.add('hidden');
    })();
    // [E] edit by smsong
    // 검색어(제목/내용/위치) 검색
    const tlKw = document.getElementById('tl-filter-keyword');
    const tlKwBtn = document.getElementById('tl-keyword-search');
    const runTlKeyword = () => { _tlKeyword = tlKw ? tlKw.value : ''; applyTimelineFilter(); };
    if (tlKwBtn) tlKwBtn.addEventListener('click', runTlKeyword);
    if (tlKw) tlKw.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runTlKeyword(); } });
    const tlFilterToggle = document.getElementById('tl-filter-toggle');
    // [B] edit by smsong - 타임라인/달력 보기 전환 버튼
    var _tlvList = document.getElementById('tl-view-list');
    var _tlvCal = document.getElementById('tl-view-cal');
    if (_tlvList) _tlvList.addEventListener('click', function () { setTimelineView('list'); });
    if (_tlvCal) _tlvCal.addEventListener('click', function () { setTimelineView('calendar'); });
    // [B] edit by smsong - 추억 날짜 색상 버튼 → 팔레트 토글
    var _calColorBtn = document.getElementById('cal-color-btn');
    if (_calColorBtn) _calColorBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        _buildColorPalette();
        var pal = document.getElementById('cal-color-palette');
        if (pal) pal.classList.toggle('hidden');
    });
    document.addEventListener('click', function (e) {
        var wrap = document.getElementById('tl-color-wrap');
        var pal = document.getElementById('cal-color-palette');
        if (pal && !pal.classList.contains('hidden') && wrap && !wrap.contains(e.target)) pal.classList.add('hidden');
    });
    const tlFilterPop = document.getElementById('tl-filter-pop');
    if (tlFilterToggle && tlFilterPop) {
        tlFilterToggle.addEventListener('click', (e) => { e.stopPropagation(); tlFilterPop.classList.toggle('hidden'); });
    }
    const clFilterToggle = document.getElementById('cl-filter-toggle');
    const clFilterPop = document.getElementById('cl-filter-pop');
    if (clFilterToggle && clFilterPop) {
        clFilterToggle.addEventListener('click', (e) => { e.stopPropagation(); clFilterPop.classList.toggle('hidden'); });
    }
    // [smsong] 바깥 클릭 시 필터 팝오버 닫기 (지도 필터와 동일한 동작)
    document.addEventListener('click', (e) => {
        const tw = document.getElementById('header-timeline-controls');
        if (tlFilterPop && !tlFilterPop.classList.contains('hidden') && tw && !tw.contains(e.target)) tlFilterPop.classList.add('hidden');
        const cw = document.getElementById('header-checklist-controls');
        if (clFilterPop && !clFilterPop.classList.contains('hidden') && cw && !cw.contains(e.target)) clFilterPop.classList.add('hidden');
    });
    const tlFilterSearch = document.getElementById('tl-filter-search');
    if (tlFilterSearch) tlFilterSearch.addEventListener('click', applyTimelineFilter);
    const tlFilterReset = document.getElementById('tl-filter-reset');
    if (tlFilterReset) tlFilterReset.addEventListener('click', () => {
        _tlPlaceFilter = '';
        _tlKeyword = '';
        const kwEl = document.getElementById('tl-filter-keyword'); if (kwEl) kwEl.value = '';
        const sel = document.getElementById('tl-filter-place'); if (sel) sel.value = '';
        const d = document.getElementById('tl-filter-date'); if (d) d.value = '';
        applyTimelineFilter();
    });

    // ---- 가볼곳 필터 (검색어 + 카테고리 + 방문여부) ----
    function applyChecklistFilter() {
        const kw = _clKeyword.trim().toLowerCase();
        let list = [...checklistList].sort(sortByDateDesc);
        if (kw) list = list.filter(c => {
            const hay = ((c.title || '') + ' ' + (c.content || '') + ' ' + (c.placeName || '') + ' ' + (c.address || '')).toLowerCase();
            return hay.includes(kw);
        });
        if (_clFilter && _clFilter !== 'ALL') list = list.filter(c => (c.type || 'ETC') === _clFilter);
        if (_clVisitedFilter === 'VISITED') list = list.filter(c => c.visited);
        else if (_clVisitedFilter === 'TODO') list = list.filter(c => !c.visited);
        renderChecklistFeed(list);
    }
    // 검색어(제목/내용/위치) 검색
    const clKw = document.getElementById('cl-filter-keyword');
    const clKwBtn = document.getElementById('cl-keyword-search');
    const runClKeyword = () => { _clKeyword = clKw ? clKw.value : ''; applyChecklistFilter(); };
    if (clKwBtn) clKwBtn.addEventListener('click', runClKeyword);
    if (clKw) clKw.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runClKeyword(); } });
    // 초기화 — 검색어/카테고리/방문여부 모두 리셋 후 즉시 전체 표시
    const clKwReset = document.getElementById('cl-keyword-reset');
    if (clKwReset) clKwReset.addEventListener('click', () => {
        _clKeyword = '';
        _clFilter = 'ALL';
        _clVisitedFilter = 'ALL';
        if (clKw) clKw.value = '';
        document.querySelectorAll('#cl-filter-bar .cl-filter-chip').forEach(c => c.classList.toggle('selected', c.dataset.filter === 'ALL'));
        document.querySelectorAll('#cl-visited-filter-bar .cl-vfilter-chip').forEach(c => c.classList.toggle('selected', c.dataset.vfilter === 'ALL'));
        applyChecklistFilter();
    });
    const clFilterBar = document.getElementById('cl-filter-bar');
    if (clFilterBar) {
        clFilterBar.querySelectorAll('.cl-filter-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                clFilterBar.querySelectorAll('.cl-filter-chip').forEach(c => c.classList.remove('selected'));
                chip.classList.add('selected');
                _clFilter = chip.dataset.filter || 'ALL';
                applyChecklistFilter();
            });
        });
    }
    const clVisitedBar = document.getElementById('cl-visited-filter-bar');
    if (clVisitedBar) {
        clVisitedBar.querySelectorAll('.cl-vfilter-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                clVisitedBar.querySelectorAll('.cl-vfilter-chip').forEach(c => c.classList.remove('selected'));
                chip.classList.add('selected');
                _clVisitedFilter = chip.dataset.vfilter || 'ALL';
                applyChecklistFilter();
            });
        });
    }

    // --- 지도 마커 (줌 시 깜빡임 방지: 기존 마커 제거 후 재생성, 사진은 배경이미지) ---
    function renderMarkers(list) {
        if (!map) return;
        markers.forEach(m => m.setMap(null));
        markers = [];
        list.forEach(memory => {
            if (!(memory.lat && memory.lng)) return;
            let markerHtml;
            const nd = _suppressDrop ? ' nodrop' : '';
            // [B] edit by smsong - 다중 이미지(mediaUrls) 기록도 대표(첫) 이미지로 마커 썸네일 표시.
            //  기존엔 단일 필드 memory.mediaURL 만 봐서 여러 장 기록의 마커가 비어 보였음.
            const _cover = coverUrlOf(memory);
            if (_cover) {
                // 지도 마커는 소형 썸네일(<img>)로 그림. 썸네일이 없으면(구버전/HEIC) onerror 로 원본 폴백.
                const _thumb = Daylog.thumbUrlOf(_cover);
                markerHtml = '<div class="custom-marker' + nd + '"><img class="cm-photo" src="' + _thumb + '" data-full="' + _cover + '" onload="this.classList.add(\'is-loaded\')" onerror="Daylog._thumbFallback(this)" alt="" decoding="async"></div>';
                // [E] edit by smsong
            } else {
                markerHtml = `<div class="marker-heart${nd}">${icon('book',26,'color:#b08968;')}</div>`;
            }
            // [B] edit by smsong - 마커 앵커를 '말풍선 아래 세모(꼬리) 끝'에 맞춰 실제 위치가 정확히 찍히도록 보정
            //  사진 마커: 56x56(사진46+패딩3*2+테두리2*2) 박스, 아래 세모 끝 ≈ (28, 62)
            //  하트 마커: 26px 아이콘, 하트 아래 끝 ≈ (13, 24)
            const _mkAnchor = _cover ? new naver.maps.Point(28, 62) : new naver.maps.Point(13, 24);
            const marker = new naver.maps.Marker({
                position: new naver.maps.LatLng(memory.lat, memory.lng),
                map: map,
                icon: { content: markerHtml, anchor: _mkAnchor }
            });
            // [E] edit by smsong
            marker._memoryId = memory.id; // 상세보기 → 지도 포커스/흔들기용
            naver.maps.Event.addListener(marker, 'click', () => openDetailModal(memory));
            markers.push(marker);
        });
    }

    // --- 타임라인 (날짜별 그룹 + 좌측정렬 제목/내용/위치 + 우측 썸네일) ---
    // [B] edit by smsong - #2 무한 스크롤 + 가상 스크롤로 전환.
    //  · 최초 5개 → 아래로 스크롤하면 로딩 폼과 함께 5개씩 추가
    //  · DOM 에 남는 카드는 화면에 보이는 5~10행뿐(위/아래로 다시 스크롤하면 다시 그림)
    var _tlPager = null;

    // 피드 두 개(타임라인/가볼곳)를 한 번에 다시 계산 — 탭 전환 직후 호출
    Daylog._relayoutFeeds = function () {
        try { if (_tlPager) _tlPager.relayout(); } catch (e) {}
        try { if (_clPager) _clPager.relayout(); } catch (e) {}
    };

    // 탭을 벗어났다가 다시 들어오면 항상 최신 5개부터 — 펼쳐 놓았던 페이지를 초기화한다.
    //  (초기화하지 않으면 이전에 스크롤로 불러 둔 수십 건이 그대로 다시 그려진다)
    Daylog._resetFeeds = function () {
        try { if (_tlPager) _tlPager.reset(); } catch (e) {}
        try { if (_clPager) _clPager.reset(); } catch (e) {}
    };

    function _tlDateHeadEl(dateKey) {
        const head = document.createElement('div');
        head.className = 'tl-date-head';
        head.innerHTML = '<span class="tl-date-dot"></span>' +
            '<span class="tl-date-label">' + escapeHtml(dateKey.replace(/-/g, '.')) + '</span>';
        return head;
    }

    function _tlCardEl(memory) {
        const card = document.createElement('div');
        card.className = 'tl-card';
        card.innerHTML =
            '<div class="tl-main">' +
            '<h4 class="tl-title">' + escapeHtml(memory.title || '') + '</h4>' +
            '<p class="tl-text">' + escapeHtml(memory.content || '') + '</p>' +
            '<div class="tl-loc">' +
            '<div class="tl-loc-row">' +
            '<span class="tl-loc-icon">' + icon('pin', 13) + '</span>' +
            '<span class="tl-place"></span>' +
            '</div>' +
            '<span class="tl-addr"></span>' +
            '</div>' +
            commentBadgeHtml('memory', memory.id) +
            '</div>' +
            thumbHtml(coverUrlOf(memory), 'tl-thumb');
        applyCardLocation(card, memory);
        card.addEventListener('click', () => openDetailModal(memory));
        return card;
    }

    function renderTimeline(sorted) {
        const feedEl = document.getElementById('timeline-feed');
        if (!feedEl) return;
        const scrollEl = document.querySelector('main.container');

        // 페이저를 쓸 수 없는 환경이면 예전처럼 한 번에 그린다(안전 폴백)
        if (!window.DaylogFeed || !scrollEl) {
            feedEl.innerHTML = '';
            if (!sorted.length) {
                feedEl.innerHTML = '<div class="empty-state"><span class="es-icon">' + icon('book', 40) + '</span>' +
                    '<p>기록이 존재하지 않음</p></div>';
                return;
            }
            let last = null;
            sorted.forEach(m => {
                const d = (m.createdAt || '').substring(0, 10) || '날짜미상';
                if (d !== last) { feedEl.appendChild(_tlDateHeadEl(d)); last = d; }
                feedEl.appendChild(_tlCardEl(m));
            });
            applyCommentBadges('memory');
            fetchCommentCounts('memory');
            return;
        }

        if (!_tlPager) {
            _tlPager = window.DaylogFeed.create({
                feedEl: feedEl,
                scrollEl: scrollEl,
                pageSize: 5,     // 한 번에 5개씩
                windowRows: 10,  // DOM 에 유지할 행 수(화면이 더 길면 필요한 만큼만 늘어남)
                emptyHtml: '<div class="empty-state"><span class="es-icon">' + icon('book', 40) + '</span>' +
                           '<p>기록이 존재하지 않음</p></div>',
                // 날짜 헤더 + 카드로 행 배열 구성 (목록이 날짜 내림차순이라 같은 날짜가 붙어 있다)
                rowsOf: function (list) {
                    var out = [], last = null;
                    list.forEach(function (m) {
                        var d = (m.createdAt || '').substring(0, 10) || '날짜미상';
                        if (d !== last) { out.push({ key: 'h:' + d, type: 'head', date: d, est: 46 }); last = d; }
                        out.push({ key: 'm:' + m.id, type: 'card', item: m, est: 118 });
                    });
                    return out;
                },
                renderRow: function (row) {
                    return (row.type === 'head') ? _tlDateHeadEl(row.date) : _tlCardEl(row.item);
                },
                onWindow: function () { applyCommentBadges('memory'); }, // 새로 그려진 카드에 배지 재적용
                onData: function () { fetchCommentCounts('memory'); }    // 목록이 바뀐 경우에만 1회 조회
            });
            Daylog._tlPager = _tlPager; // 콘솔 디버그용
        }
        _tlPager.setItems(sorted);
    }
    // [E] edit by smsong

    // ==========================================
    //  내 정보 (프로필) — 사람 구분 & 프로필 이미지
    // ==========================================
    // name 이 아래 값이면 '나', 아니면 상대방으로 인식 (유저 2명 전용)
    const ME_NAMES = ['송성민', 's s'];
    function isMe(u) {
        if (!u || !u.name) return false;
        const n = String(u.name).trim().toLowerCase();
        return ME_NAMES.map(s => s.toLowerCase()).includes(n);
    }

    let meUser = null;
    let partnerUser = null;
    let currentUser = null;
    let editingUser = null;
    const profileFileInput = document.getElementById('profile-file');

    // [B] edit by smsong - #2 내 프로필: 소셜 로그인 종류(카카오/네이버/구글) + 가입일 표시 (본인만)
    function renderMySocialInfo() {
        var wrap = document.getElementById('my-profile-info');
        var badge = document.getElementById('my-social-badge');
        var jd = document.getElementById('my-join-date');
        if (!wrap) return;
        if (!currentUser) { wrap.style.display = 'none'; return; }
        var kakao = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3C6.5 3 2 6.6 2 11c0 2.8 1.9 5.3 4.7 6.7-.2.7-.7 2.6-.8 3 0 .2 0 .4.2.5.2 0 .4 0 .5-.1.4-.3 3-2 4-2.7.5.1 1 .1 1.4.1 5.5 0 10-3.6 10-8S17.5 3 12 3z"/></svg>';
        var naver = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14.2 3v8.4L9.6 3H3v18h6.8v-8.4L14.4 21H21V3z"/></svg>';
        var google = '<svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"/><path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1C3.4 21.3 7.4 24 12 24z"/><path fill="#FBBC05" d="M5.4 14.4c-.2-.7-.4-1.5-.4-2.4s.1-1.7.4-2.4V6.6H1.4C.5 8.2 0 10 0 12s.5 3.8 1.4 5.4l4-3z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4C17.9 1.2 15.2 0 12 0 7.4 0 3.4 2.7 1.4 6.6l4 3C6.3 6.9 8.9 4.8 12 4.8z"/></svg>';
        var map = {
            kakao:  { label: '카카오', cls: 'kakao',  icon: kakao },
            naver:  { label: '네이버', cls: 'naver',  icon: naver },
            google: { label: '구글',   cls: 'google', icon: google }
        };
        var info = map[(currentUser.provider || '').toLowerCase()];
        var any = false;
        if (badge) {
            if (info) { badge.className = 'social-badge sb-' + info.cls; badge.innerHTML = info.icon + '<span>' + info.label + ' 로그인</span>'; badge.style.display = ''; any = true; }
            else { badge.style.display = 'none'; badge.innerHTML = ''; }
        }
        if (jd) {
            var c = currentUser.createdAt;
            if (c) {
                var d = new Date(c);
                var s = isNaN(d.getTime())
                    ? String(c).substring(0, 10).replace(/-/g, '.')
                    : (d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0'));
                jd.textContent = s + ' 가입'; jd.style.display = ''; any = true;
            } else { jd.style.display = 'none'; jd.textContent = ''; }
        }
        wrap.style.display = any ? 'flex' : 'none';
    }

    function loadProfiles(force) {
        if (force) _profSig = null; // 명시적 변경(사진/닉네임/프로필 수정) 후엔 강제 재렌더
        if (!requireAuthOrRedirect()) return;
        // [B] edit by smsong - #2 커플/멤버 판정 전에 서버 방정보(타입 권위)를 반드시 확보 → 커플 오판/깜빡임 제거
        ensureRoomInfoThen(function () {
        withLoading(fetch(`${API_BASE_URL}/user/all/${currentUid}`, { headers: authHeaders(true) })
            .then(handleResponse)
            .then(users => {
                const list = users || [];
                console.log('[Daylog] /user/all 응답:', list);
                // [smsong] 커플 '나/상대방'은 이 방에 설정된 커플 슬롯(방 멤버)만 사용
                const _findU = (uid) => list.find(u => u.uid === uid) || null;
                const _isCouple = isCoupleRoom(); // [smsong] 커플 방이면 '나/상대방' 카드 표시
                // [smsong] 커플 슬롯(coupleLeftUid=나, coupleRightUid=상대방)은 '이 방 멤버'만 사용.
                //  다른 방/비멤버 uid(예: 하드코딩된 A/B)는 절대 접근하지 않음.
                var _info = Daylog.roomInfo;
                var _members = (_info && _info.members) || [];
                var _memberUids = _members.map(function (m) { return m.uid; });
                var _lu = (_info && _info.coupleLeftUid && _memberUids.indexOf(_info.coupleLeftUid) >= 0) ? _info.coupleLeftUid : null;
                var _ru = (_info && _info.coupleRightUid && _memberUids.indexOf(_info.coupleRightUid) >= 0) ? _info.coupleRightUid : null;
                meUser = _lu ? _findU(_lu) : null;
                partnerUser = _ru ? _findU(_ru) : null;
                // 프로필 '수정' 대상(currentUser)은 항상 실제 로그인 유저
                currentUser = _findU(currentUid) || null;

                Daylog.meUid = meUser && meUser.uid;
                Daylog.partnerUid = partnerUser && partnerUser.uid;
                // [smsong] 작성자 표시용 맵도 '이 방 멤버'만 포함 (비멤버 노출 방지)
                Daylog.usersByUid = {};
                _members.forEach(function (m) { var u = _findU(m.uid); if (u) Daylog.usersByUid[u.uid] = u; });
                if (currentUser && currentUser.uid) Daylog.usersByUid[currentUser.uid] = currentUser;

                if (!meUser) {
                    console.warn('[Daylog] 로그인 uid(' + currentUid + ')와 일치하는 사용자가 목록에 없습니다.');
                }
                // 이름/아바타는 실제로 바뀌었을 때만 다시 그림(이미지 재로딩 깜빡임 방지)
                const sig = _listSig(list);
                if (sig !== _profSig) {
                    _profSig = sig;
                    renderProfileBox('me', meUser, icon('user',34), _isCouple ? '나' : '');
                    renderProfileBox('partner', partnerUser, icon('user',34), _isCouple ? '상대방' : '');
                }
                profilesLoaded = true;
                updateProfileStats(); // 숫자만 갱신(저비용, 깜빡임 없음)
                applyRoomProfileMode(); // [smsong] 방 타입별(커플/친구·가족) 화면 전환
                applyCoupleEditButtons(); // [smsong] 방장이면 '나/상대방' 변경 버튼 노출
                renderMySocialInfo(); // [B] edit by smsong - #2 내 소셜/가입일 표시
                // 체크리스트 개수/목록도 준비 (이미 로드돼 있으면 라벨만 갱신)
                if (checklistLoaded) updateChecklistStats(); else loadChecklistsFromServer();
                maybePromptNickname();
            })
            .catch(err => {
                console.error("프로필 로드 실패(/user/all):", err);
                showToast('프로필 조회 실패: ' + (err.message || '서버 오류'));
                loadSelfProfileFallback();
            }), '프로필을 불러오는 중...'); // [smsong] 로딩
        }); // [B] edit by smsong - ensureRoomInfoThen 콜백 닫기
    }

    // /user/all 이 막혔을 때 최소한 본인 정보만이라도 채우는 폴백
    function loadSelfProfileFallback() {
        fetch(`${API_BASE_URL}/user/uid/${currentUid}`, { headers: authHeaders(true) })
            .then(handleResponse)
            .then(me => {
                console.log('[Daylog] /user/uid 폴백 응답:', me);
                if (!me) return;
                currentUser = me;
                meUser = me;
                // [smsong] 접근 권한은 서버(권한 메뉴/DB) 기준 — loadMyPermission 이 게이트 처리
                Daylog.meUid = me.uid;
                Daylog.usersByUid = {}; if (me.uid) Daylog.usersByUid[me.uid] = me;
                renderProfileBox('me', me, icon('user',34), '나');
                updateProfileStats();
                maybePromptNickname();
            })
            .catch(err => console.error("본인 프로필 폴백 실패(/user/uid):", err));
    }

    // [B] edit by smsong - 닉네임 최초 설정은 방 목록(rooms.html)에서 진행하도록 이동.
    //  main.html 에서는 더 이상 닉네임 설정 모달을 띄우지 않는다.
    function maybePromptNickname() { /* no-op: rooms.html 에서 최초 닉네임 설정 */ }
    // [E] edit by smsong

    // 공통 사용자 저장 (PUT /user). mediaData 파트는 항상 포함해
    // 'Required part mediaData is not present' 오류를 방지 (빈 파일이면 백엔드가 기존 프로필 유지)
    function saveUser(userObj, file) {
        const fd = new FormData();
        fd.append('userData', JSON.stringify(userObj));
        if (file) {
            fd.append('mediaData', file);
        } else {
            fd.append('mediaData', new Blob([], { type: 'application/octet-stream' }), 'empty');
        }
        return withLoading(fetch(`${API_BASE_URL}/user`, {
            method: 'PUT',
            headers: authHeaders(false),
            body: fd
        }), '저장 중...').then(handleResponse);
    }

    function renderProfileBox(role, user, fallbackEmoji, relationLabel) {
        const avatar = document.getElementById('avatar-' + role);
        const nameEl = document.getElementById('name-' + role);
        const subEl = document.getElementById('sub-' + role);
        const editEl = document.getElementById('edit-' + role);
        const wrap = document.getElementById('wrap-' + role);
        if (!avatar || !wrap) return;

        // 아바타 이미지 / SNS 기본 이미지 (이미지 로드 실패 시 기본 이미지로 폴백)
        const showImg = (src) => {
            avatar.innerHTML = '';
            const img = document.createElement('img');
            img.src = src;
            img.alt = '프로필';
            img.onerror = () => { img.onerror = null; img.src = DEFAULT_AVATAR; };
            avatar.appendChild(img);
        };
        if (user && user.profileURL) {
            showImg(Daylog.bustImg(user.profileURL)); // [smsong] 변경 즉시 반영(캐시버스터)
        } else {
            showImg(DEFAULT_AVATAR);
        }

        // 닉네임 우선, 없으면 정규화된 실제 이름(송성민/강미르)으로 표시
        const hasNick = !!(user && user.nickname && String(user.nickname).trim());
        const realName = user ? normalizeDisplayName(user.name) : relationLabel;
        nameEl.innerText = hasNick ? user.nickname : realName;
        subEl.innerText = relationLabel;

        // ✋ 내 정보 탭에서는 이미지 수정 불가 — 실제 사진이 있을 때만 클릭 확대(라이트박스)
        wrap.classList.remove('editable', 'viewable');
        editEl.classList.add('hidden'); // 📷 편집 배지 항상 숨김
        wrap.onclick = null;

        if (user && user.profileURL) {
            wrap.classList.add('viewable');
            wrap.onclick = () => openLightbox(Daylog.bustImg(user.profileURL), avatar);
        }
    }

    if (profileFileInput) {
        profileFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            profileFileInput.value = ''; // 같은 파일 재선택 허용
            if (!file || !editingUser) return;
            const target = editingUser;
            _crop.sourceInput = profileFileInput; // [B] edit by smsong - 취소(X) 시 갤러리 재오픈용 / [E] edit by smsong
            openCropper(file, (cropped) => uploadProfileImage(target, cropped));
        });
    }

    function uploadProfileImage(user, file) {
        if (!requireAuthOrRedirect()) return;
        showToast('프로필 사진을 올리는 중...');
        saveUser({ uid: user.uid, id: user.id }, file)
            .then((updated) => {
                Daylog.bumpImgVer(); // [smsong] 같은 경로 덮어쓰기여도 새 사진 즉시 표시
                // [smsong] 새 프로필 이미지를 미리 받아 캐시에 올려둠 → 렌더 시 빈 화면 깜빡임 없이 즉시 표시
                if (updated && updated.profileURL) { var _pre = new Image(); _pre.src = Daylog.bustImg(updated.profileURL); }
                showToast('프로필 사진이 변경 완료');
                loadProfiles(true);
            })
            .catch(err => {
                console.error(err);
                showToast('변경 실패: ' + (err.message || '서버 오류'));
            });
    }

    // ----- 닉네임 최초 설정 -----
    const nicknameForm = document.getElementById('nickname-form');
    if (nicknameForm) {
        nicknameForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const val = document.getElementById('nickname-input').value.trim();
            if (!val) { showToast('닉네임을 입력해주십시오'); return; }
            if (!currentUser) { showToast('사용자 정보 조회 실패'); return; }
            const btn = nicknameForm.querySelector('.submit-btn');
            btn.disabled = true; btn.innerText = '저장 중...';
            const payload = { uid: currentUser.uid, id: currentUser.id, nickname: val };
            saveUser(payload, null)
                .then(updated => {
                    currentUser = updated || payload;
                    document.getElementById('nickname-modal').classList.add('hidden');
                    showToast('닉네임 설정 완료');
                    loadProfiles(true);
                })
                .catch(err => { console.error(err); showToast('설정 실패: ' + (err.message || '서버 오류')); })
                .finally(() => { btn.disabled = false; btn.innerText = '시작하기'; });
        });
    }

    // ----- 프로필 수정 페이지 -----
    let editPendingFile = null;
    let editRemovePhoto = false;
    const editFileInput = document.getElementById('edit-file');
    const editPage = document.getElementById('edit-page');

    // 수정 페이지 아바타 미리보기 + '사진 제거' 버튼 노출 제어
    function setEditAvatar(src, hasPhoto) {
        const av = document.getElementById('edit-avatar');
        if (av) av.innerHTML = '<img src="' + src + '" alt="프로필">';
        const rm = document.getElementById('edit-remove-photo');
        if (rm) rm.classList.toggle('hidden', !hasPhoto);
    }

    function openEditPage() {
        if (!currentUser) { showToast('사용자 정보를 불러오는 중입니다'); loadProfiles(); return; }
        editPendingFile = null;
        editRemovePhoto = false;
        document.getElementById('edit-nickname').value = currentUser.nickname || '';
        setEditAvatar(currentUser.profileURL || DEFAULT_AVATAR, !!currentUser.profileURL);
        editPage.classList.add('open');
    }
    function closeEditPage() { editPage.classList.remove('open'); }

    // [B] edit by smsong - #3 btn-edit-profile 제거됨 → null 가드
    var _bep = document.getElementById('btn-edit-profile');
    if (_bep) _bep.addEventListener('click', openEditPage);
    // [B] edit by smsong - #3 멤버 보기 버튼 → 멤버 모달
    var _bmv = document.getElementById('btn-member-view');
    if (_bmv) _bmv.addEventListener('click', openMemberModal);
    // [B] edit by smsong - #3 방 알림 켜기/끄기 토글 버튼
    var _brnt = document.getElementById('btn-room-notif-toggle');
    if (_brnt) _brnt.addEventListener('click', toggleRoomNotif);
    try { applyRoomNotifToggle(); } catch (e) {}
    var _mmClose = document.getElementById('member-modal-close');
    if (_mmClose) _mmClose.addEventListener('click', function () { var mm = document.getElementById('member-modal'); if (mm) mm.classList.add('hidden'); });
    var _mmModal = document.getElementById('member-modal');
    if (_mmModal) _mmModal.addEventListener('click', function (e) { if (e.target.id === 'member-modal') _mmModal.classList.add('hidden'); });
    const btnTrash = document.getElementById('btn-trash');
    if (btnTrash) btnTrash.addEventListener('click', openTrashModal);
    // [smsong] 방 목록으로 이동 (다른 방 선택 가능)
    // [B] edit by smsong - #4 설정 메뉴 [방 목록] 도 상단 좌측 로고와 똑같이 확인(confirm) 후 이동
    const btnRooms = document.getElementById('btn-rooms');
    if (btnRooms) btnRooms.addEventListener('click', () => {
        if (confirm('방 목록으로 이동합니다.')) location.href = 'rooms.html';
    });
    // [E] edit by smsong
    // [B] edit by smsong - #1 로고 클릭 핸들러는 아래 navLogo(confirm) 하나로 통일 (중복 무조건 이동 제거)
    const logoHome = document.getElementById('logo-home');
    if (logoHome) { logoHome.setAttribute('tabindex', '0'); }
    const btnProfileLogout = document.getElementById('btn-profile-logout');
    if (btnProfileLogout) btnProfileLogout.addEventListener('click', () => {
        if (confirm('로그아웃을 진행합니다.')) serverLogoutThenRedirect('로그아웃 되었습니다.');
    });
    // [smsong] 방장 전용 권한 관리(접근/CRUD/내보내기) 모달 열기/닫기
    const btnPermAdmin = document.getElementById('btn-perm-admin');
    if (btnPermAdmin) btnPermAdmin.addEventListener('click', openPermissionAdmin);
    const rmClose = document.getElementById('room-members-close');
    if (rmClose) rmClose.addEventListener('click', closeRoomMembers);
    const rmModal = document.getElementById('room-members-modal');
    if (rmModal) rmModal.addEventListener('click', (e) => { if (e.target.id === 'room-members-modal') closeRoomMembers(); });
    const permClose = document.getElementById('perm-close');
    if (permClose) permClose.addEventListener('click', closePermissionAdmin);
    const permModal = document.getElementById('perm-modal');
    if (permModal) permModal.addEventListener('click', (e) => { if (e.target.id === 'perm-modal') closePermissionAdmin(); });
    // 접근 요청 알림 모달 닫기 (X · 배경 클릭)
    const areqClose = document.getElementById('access-request-close');
    if (areqClose) areqClose.addEventListener('click', closeAccessRequestModal);
    const areqModal = document.getElementById('access-request-modal');
    if (areqModal) areqModal.addEventListener('click', (e) => { if (e.target.id === 'access-request-modal') closeAccessRequestModal(); });
    // [B] edit by smsong - 거절 사유 입력 모달 (취소=사유없이 닫기, X/배경=거절 취소)
    const rrClose = document.getElementById('reject-reason-close');
    if (rrClose) rrClose.addEventListener('click', () => _closeRejectReason(null));
    const rrCancel = document.getElementById('reject-reason-cancel');
    if (rrCancel) rrCancel.addEventListener('click', () => _closeRejectReason(null));
    const rrConfirm = document.getElementById('reject-reason-confirm');
    if (rrConfirm) rrConfirm.addEventListener('click', () => {
        const inp = document.getElementById('reject-reason-input');
        _closeRejectReason(inp ? inp.value : '');
    });
    const rrModal = document.getElementById('reject-reason-modal');
    if (rrModal) rrModal.addEventListener('click', (e) => { if (e.target.id === 'reject-reason-modal') _closeRejectReason(null); });
    // [B] edit by smsong - 환영 폼: 동의 체크 시 '방 이용하기' 버튼 활성화
    const wChk = document.getElementById('welcome-consent-check');
    const wBtn = document.getElementById('welcome-enter-btn');
    if (wChk && wBtn) wChk.addEventListener('change', function () { wBtn.disabled = !wChk.checked; });
    if (wBtn) wBtn.addEventListener('click', confirmWelcome);
    // [E] edit by smsong
    // 헤더의 디데이 클릭 → 디데이 폼 열기
    const headerDday = document.querySelector('.dday-counter');
    if (headerDday) {
        headerDday.style.cursor = 'pointer';
        headerDday.addEventListener('click', () => showDDayInfo());
    }
    document.getElementById('edit-back').addEventListener('click', closeEditPage);
    document.getElementById('edit-avatar-wrap').addEventListener('click', () => editFileInput.click());

    // 사진 제거 버튼 — 현재/선택 사진을 지우고 기본 이미지로
    const editRemoveBtn = document.getElementById('edit-remove-photo');
    if (editRemoveBtn) {
        editRemoveBtn.addEventListener('click', () => {
            editPendingFile = null;
            editRemovePhoto = true;
            setEditAvatar(DEFAULT_AVATAR, false);
            showToast('저장하면 사진이 제거됩니다');
        });
    }

    editFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        editFileInput.value = '';
        if (!file) return;
        _crop.sourceInput = editFileInput; // [B] edit by smsong - 취소(X) 시 갤러리 재오픈용 / [E] edit by smsong
        openCropper(file, (cropped) => {
            editPendingFile = cropped;
            editRemovePhoto = false;
            const reader = new FileReader();
            reader.onload = (ev) => { setEditAvatar(ev.target.result, true); };
            reader.readAsDataURL(cropped);
        });
    });

    const editForm = document.getElementById('edit-form');
    editForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!currentUser) return;
        const nick = document.getElementById('edit-nickname').value.trim();
        if (!nick) { showToast('닉네임을 입력해주십시오'); return; }
        const btn = editForm.querySelector('.submit-btn');
        btn.disabled = true; btn.innerText = '저장 중...';
        // 닉네임 + (선택) 프로필 이미지 변경/제거. uid/id 는 본인 식별용
        const payload = { uid: currentUser.uid, id: currentUser.id, nickname: nick };
        // 새 사진이 없고 '사진 제거'를 누른 경우 → profileURL 을 빈 값으로 보내 명시적 제거
        if (!editPendingFile && editRemovePhoto) {
            payload.profileURL = '';
        }
        saveUser(payload, editPendingFile)
            .then(updated => {
                currentUser = updated || payload;
                if (editRemovePhoto && currentUser) currentUser.profileURL = '';
                editPendingFile = null;
                editRemovePhoto = false;
                Daylog.bumpImgVer(); // [smsong] 사진 변경/제거 즉시 반영
                // [smsong] 새 프로필 이미지 미리 로드 → 즉시 표시(깜빡임 방지)
                if (currentUser && currentUser.profileURL) { var _pre2 = new Image(); _pre2.src = Daylog.bustImg(currentUser.profileURL); }
                showToast('프로필 저장 완료');
                closeEditPage();
                loadProfiles(true);
            })
            .catch(err => { console.error(err); showToast('저장 실패: ' + (err.message || '서버 오류')); })
            .finally(() => { btn.disabled = false; btn.innerText = '저장하기'; });
    });

    function displayNameOf(user, fallback) {
        if (!user) return fallback;
        if (user.nickname && String(user.nickname).trim()) return user.nickname;
        return normalizeDisplayName(user.name);
    }

    function updateProfileStats() {
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v; };
        var _dday = getDdayStart(); // [smsong] 방(coupleSince) 기준
        set('stat-days', _dday ? daysSince(_dday) : '-');
        set('stat-total', memoryList.length);
        const meUid = meUser && meUser.uid;
        const pUid = partnerUser && partnerUser.uid;
        set('stat-me-count', memoryList.filter(m => m.ownerUid === meUid).length);
        set('stat-partner-count', memoryList.filter(m => m.ownerUid === pUid).length);
        // 라벨에 정규화된 이름 반영
        const meLabel = document.getElementById('stat-me-label');
        const pLabel = document.getElementById('stat-partner-label');
        if (meLabel && meUser) meLabel.innerText = displayNameOf(meUser, '나') + '의 추억';
        if (pLabel && partnerUser) pLabel.innerText = displayNameOf(partnerUser, '상대방') + '의 추억';
    }

    // [smsong] ===== 방 타입별 내 정보 화면 =====
    //  커플: 기존 커플 카드(디데이/우리의 추억/나♥상대) 그대로
    //  친구·가족: 구성원 프로필 그리드 → 프로필의 추억/가볼곳 조회
    var _memberCache = null;
    var _roomInfoLoading = false;
    // [B] edit by smsong - #2 설정 뷰 판정 전에 서버 방정보(타입 권위) 를 반드시 확보 → 커플/멤버 오판 방지
    function ensureRoomInfoThen(cb) {
        if (Daylog.roomInfo) { cb(); return; }
        var roomId = getRoomId();
        if (!roomId) { cb(); return; }
        if (_roomInfoLoading) { setTimeout(function () { ensureRoomInfoThen(cb); }, 120); return; }
        _roomInfoLoading = true;
        withLoading(fetch(`${API_BASE_URL}/api/rooms/${encodeURIComponent(roomId)}/members`, { headers: authHeaders(true) })
            .then(handleResponse)
            .then(room => {
                Daylog.roomInfo = room;
                if (room && room.type) localStorage.setItem('selectedRoomType', String(room.type).toUpperCase());
                _memberCache = (room && room.members) || [];
                // [B] edit by smsong - #4 작성자/수정자 즉시 표시: 멤버 정보로 usersByUid 채움(설정 미방문에도 이름 표시)
                try {
                    Daylog.usersByUid = Daylog.usersByUid || {};
                    _memberCache.forEach(function (m) {
                        if (m && m.uid) Daylog.usersByUid[m.uid] = {
                            uid: m.uid, nickname: m.nickname, name: m.name, profileURL: m.profileURL
                        };
                    });
                } catch (e) {}
            })
            .catch(err => console.error('[Daylog] 방 정보 로드 실패:', err))
            .finally(() => { _roomInfoLoading = false; cb(); }), '방 정보를 불러오는 중...'); // [smsong] 로딩
    }

    function applyRoomProfileMode() {
        ensureRoomInfoThen(function () {
            var coupleView = document.getElementById('couple-view');
            var memberView = document.getElementById('member-view');
            if (typeof applyDdayVisibility === 'function') applyDdayVisibility(); // [smsong] 디데이 커플 전용 표시/숨김
            if (isCoupleRoom()) {
                if (coupleView) coupleView.style.display = '';
                if (memberView) memberView.style.display = 'none';
                return;
            }
            if (coupleView) coupleView.style.display = 'none';
            // [B] edit by smsong - #3 멤버 목록은 [멤버 보기] 모달로 이동 → 설정 탭에선 그리드 미표시
            if (memberView) memberView.style.display = 'none';
        });
    }
    function fetchMembersThenPaint() {
        var roomId = getRoomId();
        if (!roomId) return;
        withLoading(fetch(`${API_BASE_URL}/api/rooms/${encodeURIComponent(roomId)}/members`, { headers: authHeaders(true) })
            .then(handleResponse)
            .then(room => { _memberCache = (room && room.members) || []; paintMemberGrid(_memberCache); })
            .catch(err => console.error('[Daylog] 멤버 뷰 로드 실패:', err)), '멤버를 불러오는 중...'); // [smsong] 로딩
    }
    function paintMemberGrid(members) {
        var container = document.getElementById('member-view');
        if (!container) return;
        var _rt = getRoomType();
        var typeName = (_rt === 'FAMILY') ? '가족' : (_rt === 'ACQUAINTANCE') ? '지인' : (_rt === 'PERSONAL') ? '개인' : '친구'; // [B] edit by smsong - #5 개인(PERSONAL) 추가
        var head = document.createElement('div');
        head.className = 'member-view-head';
        head.textContent = typeName + ' 구성원 ' + members.length + '명';
        var grid = document.createElement('div');
        grid.className = 'member-grid-inner';
        members.forEach(m => {
            var name = m.nickname || normalizeDisplayName(m.name) || m.uid;
            var memCount = memoryList.filter(x => x.ownerUid === m.uid).length;
            var clCount = checklistList.filter(x => x.ownerUid === m.uid).length;
            var card = document.createElement('div');
            card.className = 'member-card';
            var avatar = m.profileURL
                ? `<img src="${Daylog.bustImg(m.profileURL)}" alt="" class="member-avatar-img">`
                : `<span class="member-avatar-fallback">${icon('user',30)}</span>`;
            var ownerBadge = m.owner ? '<span class="member-owner-badge">방장</span>' : '';
            // [B] edit by smsong - #3 역할(방장/멤버/일반) 뱃지를 닉네임 '바로 위'에 배치
            var _role = m.role || (m.owner ? 'OWNER' : 'MEMBER');
            var _roleLabel = (_role === 'OWNER') ? '방장' : (_role === 'MEMBER') ? '멤버' : '일반';
            var _roleCls = (_role === 'OWNER') ? 'owner' : (_role === 'MEMBER') ? 'member' : 'general';
            card.innerHTML =
                `<div class="member-avatar">${avatar}</div>` +
                `<div class="member-info">` +
                    `<div class="member-role-badge role-${_roleCls}">${_roleLabel}</div>` +
                    `<div class="member-name">${_escHtml(name)}</div>` +
                `</div>` +
                // [B] edit by smsong - 추억/가볼곳 타일을 멤버 카드 오른쪽 끝에 배치
                `<div class="member-counts">` +
                    `<button class="member-count-btn" data-kind="mem"><b>${memCount}</b><span>추억</span></button>` +
                    `<button class="member-count-btn" data-kind="cl"><b>${clCount}</b><span>체크리스트</span></button>` +
                `</div>`;
            card.querySelector('[data-kind="mem"]').addEventListener('click', () => {
                var items = memoryList.filter(x => x.ownerUid === m.uid).sort(sortByDateDesc);
                Daylog._openListKind = null;
                openMemoryListModal(name + '의 추억', items);
            });
            card.querySelector('[data-kind="cl"]').addEventListener('click', () => {
                var items = checklistList.filter(x => x.ownerUid === m.uid).sort(sortByDateDesc);
                openChecklistListModal(name + '의 체크리스트', items);
            });
            grid.appendChild(card);
        });
        container.innerHTML = '';
        container.appendChild(head);
        container.appendChild(grid);
    }
    // 외부(멤버 강퇴/탭 전환)에서 강제 새로고침
    Daylog.refreshMemberProfile = function () { _memberCache = null; applyRoomProfileMode(); };
    Daylog._applyRoomProfileMode = applyRoomProfileMode;

    // [smsong] ===== 커플 슬롯('나'/'상대방') 방장 지정 =====
    // 방 정보(RoomDTO: coupleLeftUid/coupleRightUid/members) 로드 → Daylog.roomInfo 캐시
    function loadRoomInfo(force) {
        var roomId = getRoomId();
        if (!roomId) return;
        if (!force && Daylog.roomInfo) { afterRoomInfo(); return; }
        withLoading(fetch(`${API_BASE_URL}/api/rooms/${encodeURIComponent(roomId)}/members`, { headers: authHeaders(true) })
            .then(handleResponse)
            .then(room => { Daylog.roomInfo = room; _memberCache = (room && room.members) || null; afterRoomInfo(); })
            .catch(err => console.error('[Daylog] 방 정보 로드 실패:', err)), '방 정보를 불러오는 중...'); // [smsong] 로딩
    }
    function afterRoomInfo() {
        if (isCoupleRoom()) { loadProfiles(true); applyCoupleEditButtons(); }
        else applyRoomProfileMode();
        // [B] edit by smsong - #11 오늘이 커플 기념일이면 축하 폼을 띄운다
        //  (멤버 닉네임이 들어있는 roomInfo 가 채워진 뒤라 이름을 바로 쓸 수 있다)
        try { maybeShowAnniversary(); } catch (e) {}
        // [E] edit by smsong
    }
    Daylog.loadRoomInfo = loadRoomInfo;

    // 방장 & 커플 방일 때만 '나/상대방' 변경 버튼 노출
    function applyCoupleEditButtons() {
        var show = isCoupleRoom() && isRoomOwner();
        var em = document.getElementById('couple-edit-me');
        var ep = document.getElementById('couple-edit-partner');
        if (em) em.classList.toggle('hidden', !show);
        if (ep) ep.classList.toggle('hidden', !show);
    }

    // 슬롯 선택 모달
    var _pickSlot = null; // 'me' | 'partner'
    function openCouplePicker(slot) {
        _pickSlot = slot;
        var modal = document.getElementById('couple-pick-modal');
        var title = document.getElementById('couple-pick-title');
        var body = document.getElementById('couple-pick-body');
        if (!modal || !body) return;
        if (title) title.textContent = (slot === 'me') ? "'나' 선택" : "'상대방' 선택";
        modal.classList.remove('hidden');
        body.innerHTML = '<div class="perm-loading">불러오는 중...</div>';
        // 최신 멤버 확보 후 렌더
        var roomId = getRoomId();
        withLoading(fetch(`${API_BASE_URL}/api/rooms/${encodeURIComponent(roomId)}/members`, { headers: authHeaders(true) })
            .then(handleResponse)
            .then(room => { Daylog.roomInfo = room; renderCouplePicker((room && room.members) || []); })
            .catch(err => { body.innerHTML = '<div class="perm-empty" style="padding:16px;color:#8a8178;">멤버를 불러오지 못했습니다.</div>'; console.error(err); }), '멤버를 불러오는 중...'); // [smsong] 로딩
    }
    function renderCouplePicker(members) {
        var body = document.getElementById('couple-pick-body');
        if (!body) return;
        var info = Daylog.roomInfo || {};
        var curUid = (_pickSlot === 'me') ? info.coupleLeftUid : info.coupleRightUid;
        var otherUid = (_pickSlot === 'me') ? info.coupleRightUid : info.coupleLeftUid;
        var html = '<div class="rm-list">';
        members.forEach(function (m) {
            var name = m.nickname || m.name || m.uid;
            var avatar = m.profileURL
                ? '<img src="' + _escHtml(m.profileURL) + '" alt="" class="rm-avatar-img">'
                : '<span class="rm-avatar-fallback">' + icon('user', 20) + '</span>';
            var isCur = (curUid && curUid === m.uid);
            var isOther = (otherUid && otherUid === m.uid); // 반대 슬롯에 이미 지정된 사람
            var right = isCur
                ? '<span class="cp-current">현재 지정</span>'
                : (isOther ? '<span class="cp-other">반대편 지정됨</span>' : '<span class="cp-pick">선택 ›</span>');
            html += '<button type="button" class="rm-item cp-item' + (isCur ? ' cp-sel' : '') + '" data-uid="' + _escHtml(m.uid) + '">' +
                        '<span class="rm-avatar">' + avatar + '</span>' +
                        '<span class="rm-name">' + _escHtml(name) + '</span>' +
                        right +
                    '</button>';
        });
        html += '</div>';
        body.innerHTML = html;
        body.querySelectorAll('.cp-item').forEach(function (btn) {
            btn.addEventListener('click', function () { setCoupleSlot(_pickSlot, btn.getAttribute('data-uid')); });
        });
    }
    function closeCouplePicker() {
        var modal = document.getElementById('couple-pick-modal');
        if (modal) modal.classList.add('hidden');
        _pickSlot = null;
    }
    function setCoupleSlot(slot, uid) {
        var info = Daylog.roomInfo || {};
        var left = info.coupleLeftUid || null;
        var right = info.coupleRightUid || null;
        if (slot === 'me') {
            left = uid;
            if (right === uid) right = null; // 같은 사람이 양쪽에 지정되지 않도록
        } else {
            right = uid;
            if (left === uid) left = null;
        }
        var roomId = getRoomId();
        withLoading(fetch(`${API_BASE_URL}/api/rooms/${encodeURIComponent(roomId)}/couple`, {
            method: 'PUT', headers: authHeaders(true),
            body: JSON.stringify({ uid: getUid(), leftUid: left || '', rightUid: right || '' })
        }), '저장 중...')
            .then(handleResponse)
            .then(room => {
                Daylog.roomInfo = room;
                closeCouplePicker();
                showToast('저장되었어요');
                loadProfiles(true); // 카드 즉시 반영
            })
            .catch(err => { showToast('저장 실패: ' + (err.message || '오류')); console.error(err); });
    }
    // 편집 버튼 / 모달 이벤트 바인딩
    (function wireCoupleEdit() {
        var em = document.getElementById('couple-edit-me');
        var ep = document.getElementById('couple-edit-partner');
        if (em) em.addEventListener('click', function (e) { e.stopPropagation(); openCouplePicker('me'); });
        if (ep) ep.addEventListener('click', function (e) { e.stopPropagation(); openCouplePicker('partner'); });
        var cc = document.getElementById('couple-pick-close');
        if (cc) cc.addEventListener('click', closeCouplePicker);
        var cm = document.getElementById('couple-pick-modal');
        if (cm) cm.addEventListener('click', function (e) { if (e.target.id === 'couple-pick-modal') closeCouplePicker(); });
    })();

    // --- 내 정보 통계 클릭 → 해당 추억 목록 / D-Day 날짜 표시 ---
    function buildStatList(kind) {
        if (kind === 'total') return { title: '우리의 추억', items: [...memoryList].sort(sortByDateDesc) };
        if (kind === 'me') {
            const u = meUser && meUser.uid;
            return { title: displayNameOf(meUser, '나') + '의 추억', items: memoryList.filter(m => m.ownerUid === u).sort(sortByDateDesc) };
        }
        if (kind === 'partner') {
            const u = partnerUser && partnerUser.uid;
            return { title: displayNameOf(partnerUser, '상대방') + '의 추억', items: memoryList.filter(m => m.ownerUid === u).sort(sortByDateDesc) };
        }
        return null;
    }
    function openStatList(kind) {
        const b = buildStatList(kind);
        if (!b) return;
        Daylog._openListKind = kind; // 새로고침 시 같은 목록 재구성용
        openMemoryListModal(b.title, b.items);
    }

    // 유저별 체크리스트 개수 표시 + 라벨
    function updateChecklistStats() {
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v; };
        const meUid = meUser && meUser.uid;
        const pUid = partnerUser && partnerUser.uid;
        set('stat-cl-me-count', checklistList.filter(c => c.ownerUid === meUid).length);
        set('stat-cl-partner-count', checklistList.filter(c => c.ownerUid === pUid).length);
        const meLabel = document.getElementById('stat-cl-me-label');
        const pLabel = document.getElementById('stat-cl-partner-label');
        if (meLabel && meUser) meLabel.innerText = displayNameOf(meUser, '나') + '의 체크리스트';
        if (pLabel && partnerUser) pLabel.innerText = displayNameOf(partnerUser, '상대방') + '의 체크리스트';
    }
    Daylog.updateChecklistStats = updateChecklistStats;

    function openChecklistStatList(kind) {
        const meUid = meUser && meUser.uid;
        const pUid = partnerUser && partnerUser.uid;
        let title, items;
        if (kind === 'me') {
            title = displayNameOf(meUser, '나') + '의 체크리스트';
            items = checklistList.filter(c => c.ownerUid === meUid);
        } else {
            title = displayNameOf(partnerUser, '상대방') + '의 체크리스트';
            items = checklistList.filter(c => c.ownerUid === pUid);
        }
        openChecklistListModal(title, [...items].sort(sortByDateDesc));
    }

    function bindStatClicks() {
        const bind = (id, fn) => {
            const el = document.getElementById(id);
            if (el) { el.style.cursor = 'pointer'; el.addEventListener('click', fn); }
        };
        bind('stat-card-dday', () => { Daylog._openListKind = null; showDDayInfo(); });
        bind('stat-card-total', () => openStatList('total'));
        bind('stat-card-me', () => openStatList('me'));
        bind('stat-card-partner', () => openStatList('partner'));
        bind('stat-card-cl-me', () => openChecklistStatList('me'));
        bind('stat-card-cl-partner', () => openChecklistStatList('partner'));
    }
    bindStatClicks();

    // 첫 진입 시 프로필 로드
    loadProfiles();
    loadRoomInfo(false); // [smsong] 방 커플 슬롯/멤버 정보 로드 → 카드 반영

    // 모달 바깥 클릭 시 닫기
    document.getElementById('memory-modal').addEventListener('click', (e) => {
        if (e.target.id === 'memory-modal') closeMemoryModal();
    });
    document.getElementById('detail-modal').addEventListener('click', (e) => {
        if (e.target.id === 'detail-modal') closeDetailModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { closeLightbox(); closeEditPage(); closeMemoryModal(); closeDetailModal(); closeChecklistModal(); closeChecklistDetail(); }
    });

    // ===== 이미지 라이트박스 (확대 + 드래그) =====
    const lbStage = document.getElementById('lightbox-stage');
    const lbImg = document.getElementById('lightbox-img');
    const lbHint = document.getElementById('lightbox-hint');

    document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
    const lbPrev = document.getElementById('lightbox-prev');
    const lbNext = document.getElementById('lightbox-next');
    if (lbPrev) lbPrev.addEventListener('click', (e) => { e.stopPropagation(); _lbShow(_lb.idx - 1); });
    if (lbNext) lbNext.addEventListener('click', (e) => { e.stopPropagation(); _lbShow(_lb.idx + 1); });

    // 이미지 탭 → 확대/축소 토글
    lbImg.addEventListener('click', (e) => {
        e.stopPropagation();
        if (_lb.moved) { _lb.moved = false; return; }
        if (_lb.scale === 1) { _lb.scale = 2.4; }
        else { _lb.scale = 1; _lb.x = 0; _lb.y = 0; }
        _lbApply();
        if (lbHint) lbHint.style.opacity = (_lb.scale === 1) ? '1' : '0';
    });

    // 확대 상태에서 드래그하여 이동 / 기본 상태에서 좌우 스와이프로 이미지 전환
    lbStage.addEventListener('pointerdown', (e) => {
        _lb.swStartX = e.clientX; _lb.swStartY = e.clientY; _lb.swiping = (_lb.scale === 1);
        if (_lb.scale === 1) return;
        _lb.dragging = true; _lb.moved = false;
        _lb.sx = e.clientX; _lb.sy = e.clientY; _lb.bx = _lb.x; _lb.by = _lb.y;
        lbImg.classList.add('dragging');
        try { lbStage.setPointerCapture(e.pointerId); } catch (_) {}
    });
    lbStage.addEventListener('pointermove', (e) => {
        if (!_lb.dragging) return;
        const dx = e.clientX - _lb.sx, dy = e.clientY - _lb.sy;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) _lb.moved = true;
        _lb.x = _lb.bx + dx; _lb.y = _lb.by + dy; _lbApply();
    });
    function _lbEndDrag(e) {
        _lb.dragging = false; lbImg.classList.remove('dragging');
        // 기본 상태 좌우 스와이프 → 이전/다음 이미지
        if (_lb.swiping && _lb.list && _lb.list.length > 1) {
            const dx = e.clientX - _lb.swStartX, dy = e.clientY - _lb.swStartY;
            if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy)) {
                _lb.moved = true; // 스와이프를 탭으로 오인하지 않도록
                if (dx < 0) _lbShow(_lb.idx + 1); else _lbShow(_lb.idx - 1);
            }
        }
        _lb.swiping = false;
    }
    lbStage.addEventListener('pointerup', _lbEndDrag);
    lbStage.addEventListener('pointercancel', _lbEndDrag);

    // 이미지 밖(배경) 탭 → 닫기
    lbStage.addEventListener('click', (e) => {
        if (e.target === lbImg) return;
        if (_lb.moved) { _lb.moved = false; return; }
        closeLightbox();
    });

    // 미리보기(작성 폼) 클릭 → 자르기/회전 편집기 / 상세 이미지 클릭 → 라이트박스
    const previewImg = document.getElementById('image-preview');
    if (previewImg) previewImg.addEventListener('click', function () {
        if (selectedFile) openPhotoEditor(selectedFile, applyEditedPhoto);
        else if (this.src) openLightbox(this.src, this);
    });
    const detailImg = document.getElementById('detail-image');
    if (detailImg) detailImg.addEventListener('click', function () { if (this.src) openLightbox(this.src, this); });

    // 편집기에서 적용된 사진을 작성 폼에 반영
    function applyEditedPhoto(file) {
        if (!file) return;
        selectedFile = file;
        const preview = document.getElementById('image-preview');
        if (preview) {
            const url = URL.createObjectURL(file);
            preview.src = url;
            preview.classList.remove('hidden');
        }
        showToast('편집한 사진을 적용했습니다');
    }

    // ===== 사진 편집기(자르기/회전) 이벤트 =====
    const peStage = document.getElementById('pe-stage');
    const peCrop = document.getElementById('pe-crop');
    if (document.getElementById('pe-cancel')) document.getElementById('pe-cancel').addEventListener('click', closePhotoEditor);
    if (document.getElementById('pe-apply')) document.getElementById('pe-apply').addEventListener('click', peApply);
    if (document.getElementById('pe-rotate')) document.getElementById('pe-rotate').addEventListener('click', peRotate);
    if (document.getElementById('pe-reset')) document.getElementById('pe-reset').addEventListener('click', () => peLayout(true));

    if (peStage && peCrop) {
        // 핸들(모서리) → 리사이즈 / 박스 본문 → 이동
        peCrop.querySelectorAll('.pe-handle').forEach(h => {
            h.addEventListener('pointerdown', (e) => {
                e.stopPropagation();
                _ped.drag = { mode: 'resize', corner: h.getAttribute('data-corner'), sx: e.clientX, sy: e.clientY, box0: { ..._ped.crop } };
                try { peStage.setPointerCapture(e.pointerId); } catch (_) {}
            });
        });
        peCrop.addEventListener('pointerdown', (e) => {
            if (e.target.classList.contains('pe-handle')) return;
            _ped.drag = { mode: 'move', sx: e.clientX, sy: e.clientY, box0: { ..._ped.crop } };
            try { peStage.setPointerCapture(e.pointerId); } catch (_) {}
        });
        peStage.addEventListener('pointermove', (e) => {
            if (!_ped.drag) return;
            const dx = e.clientX - _ped.drag.sx, dy = e.clientY - _ped.drag.sy;
            const b0 = _ped.drag.box0;
            if (_ped.drag.mode === 'move') {
                _ped.crop.x = b0.x + dx;
                _ped.crop.y = b0.y + dy;
            } else {
                const co = _ped.drag.corner;
                if (co === 'nw') { _ped.crop.x = b0.x + dx; _ped.crop.y = b0.y + dy; _ped.crop.w = b0.w - dx; _ped.crop.h = b0.h - dy; }
                else if (co === 'ne') { _ped.crop.y = b0.y + dy; _ped.crop.w = b0.w + dx; _ped.crop.h = b0.h - dy; }
                else if (co === 'sw') { _ped.crop.x = b0.x + dx; _ped.crop.w = b0.w - dx; _ped.crop.h = b0.h + dy; }
                else if (co === 'se') { _ped.crop.w = b0.w + dx; _ped.crop.h = b0.h + dy; }
            }
            peClampCrop();
            peApplyCropStyle();
        });
        const peEnd = (e) => { _ped.drag = null; try { peStage.releasePointerCapture(e.pointerId); } catch (_) {} };
        peStage.addEventListener('pointerup', peEnd);
        peStage.addEventListener('pointercancel', peEnd);
    }

    // ===== 사진 편집(크롭/줌) 이벤트 =====
    const cropStage = document.getElementById('crop-stage');
    // [B] edit by smsong - 프로필 사진 편집 취소(X) 시 갤러리를 다시 열어 바로 재선택 가능하게
    document.getElementById('crop-cancel').addEventListener('click', () => {
        const _src = _crop.sourceInput;
        closeCropper();
        if (_src) { try { _src.value = ''; _src.click(); } catch (_) {} }
    });
    // [E] edit by smsong
    document.getElementById('crop-apply').addEventListener('click', cropApply);
    document.getElementById('crop-zoom').addEventListener('input', (e) => setCropZoom(parseFloat(e.target.value)));

    cropStage.addEventListener('pointerdown', (e) => {
        _crop.dragging = true; _crop.sx = e.clientX; _crop.sy = e.clientY;
        _crop.bx = _crop.x; _crop.by = _crop.y;
        try { cropStage.setPointerCapture(e.pointerId); } catch (_) {}
    });
    cropStage.addEventListener('pointermove', (e) => {
        if (!_crop.dragging) return;
        _crop.x = _crop.bx + (e.clientX - _crop.sx);
        _crop.y = _crop.by + (e.clientY - _crop.sy);
        applyCropTransform();
    });
    const endCropDrag = () => { _crop.dragging = false; };
    cropStage.addEventListener('pointerup', endCropDrag);
    cropStage.addEventListener('pointercancel', endCropDrag);
    cropStage.addEventListener('wheel', (e) => {
        e.preventDefault();
        setCropZoom(Math.min(3, Math.max(1, _crop.zoom + (e.deltaY < 0 ? 0.1 : -0.1))));
    }, { passive: false });
});

// ==========================================
// 3. UI 제어 유틸
// ==========================================
function openMemoryModal() {
    const modal = document.getElementById('memory-modal');
    modal.classList.remove('hidden');
    const d = document.getElementById('memory-date');
    if (!d.value) d.value = new Date().toISOString().substring(0, 10);
    // 장소 검색으로 고른 경우 제목을 상호명으로 자동 입력 (비어 있을 때만)
    const titleEl = document.getElementById('memory-title');
    if (titleEl && window._pendingPlaceTitle && !titleEl.value.trim()) {
        titleEl.value = window._pendingPlaceTitle;
    }
    window._pendingPlaceTitle = '';
}

function closeMemoryModal() {
    document.getElementById('memory-modal').classList.add('hidden');
    document.getElementById('memory-form').reset();
    document.getElementById('image-preview').classList.add('hidden');
    if (window._memCreateMgr) window._memCreateMgr.reset([]);
    const rt = document.getElementById('btn-retake-photo');
    if (rt) rt.classList.add('hidden');
    const lm = document.getElementById('location-mode');
    if (lm) lm.classList.add('hidden');
}

// ====== 가볼곳(체크리스트) 모달 ======
function openChecklistModal() {
    const modal = document.getElementById('checklist-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    if (typeof window._openChecklistForm === 'function') window._openChecklistForm();
}

function closeChecklistModal() {
    const modal = document.getElementById('checklist-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    const form = document.getElementById('checklist-form');
    if (form) form.reset();
    window._clSelectedType = null;
    document.querySelectorAll('#cl-type-options .cl-type-chip').forEach(c => c.classList.remove('selected'));
    const vd = document.getElementById('cl-visited-date');
    if (vd) vd.disabled = true;
    const clChk = document.getElementById('cl-visited');
    if (clChk) { clChk.checked = false; const lbl = clChk.closest('.cl-check-label'); if (lbl) lbl.classList.remove('checked'); }
    const lm = document.getElementById('location-mode');
    if (lm) lm.classList.add('hidden');
}

let _detailChecklist = null;

function openChecklistDetail(item, overModal) {
    _detailChecklist = item;
    document.getElementById('checklist-detail-modal').classList.toggle('over-modal', !!overModal); // [smsong] 목록 모달 위로 올릴지
    const view = document.getElementById('cl-detail-view');
    const editForm = document.getElementById('cl-edit-form');
    if (editForm) editForm.classList.add('hidden');
    if (view) view.classList.remove('hidden');

    const meta = checklistType(item.type);
    const isOwner = !!(item.ownerUid && Daylog.currentUid && item.ownerUid === Daylog.currentUid);
    const canManage = canManageObject(item); // [smsong] 소유자 또는 커플(송성민/강미르)
    const loc = [item.placeName, item.address].filter(Boolean).join(' ');
    const contentHtml = escapeHtml(item.content || '').replace(/\n/g, '<br>');

    // 작성자(= 만든 사람) 정보
    const author = (Daylog.usersByUid && Daylog.usersByUid[item.ownerUid]) || null;
    let authorName = '';
    if (author) {
        authorName = (author.nickname && String(author.nickname).trim())
            ? author.nickname
            : (typeof normalizeDisplayName === 'function' ? normalizeDisplayName(author.name) : (author.name || ''));
    }
    const authorPhoto = (author && author.profileURL) ? author.profileURL : DEFAULT_AVATAR;

    const visitedHtml = item.visited
        ? '<span class="meta-item cl-meta-visited">' + icon('check',13) + ' 다녀옴' + (item.visitedDate ? ' · ' + fmtDate(item.visitedDate) : '') + '</span>'
        : '<span class="meta-item cl-meta-todo">아직 안 가봤습니다</span>';
    const _clUrls = mediaUrlsOf(item);
    // [B] edit by smsong - 상세 이미지 전체 사전 로드 제거: 캐러셀이 첫 장만 즉시, 나머지는 lazy → 개수 무관 즉시 표시
    const imageHtml = carouselHtml(_clUrls);

    // [B] edit by smsong - #7 몰입형 상세 (가볼곳). 구조는 추억과 동일, 배지만 추가.
    //  · id 는 전부 기존 그대로 유지 (cl-detail-loc / cl-author-avatar / cl-comments-* / cl-new-comment-*)
    view.innerHTML =
        '<div class="dtl">' +
        '<div class="dtl-stage' + (_clUrls.length ? '' : ' empty') + '">' +
        (_clUrls.length ? imageHtml : '<span class="dtl-stage-ic">' + icon('bookmark', 42) + '</span>') +
        '</div>' +
        '<div class="dtl-page">' +
        '<div class="dtl-eyebrow">' +
        '<span class="dtl-loc meta-loc-clickable" id="cl-detail-loc" title="지도에서 보기">' +
        (loc ? icon('pin', 13) + ' ' + escapeHtml(loc) : icon('pin', 13) + ' 위치 정보 없음') + '</span>' +
        '</div>' +
        '<div class="dtl-badges">' +
        '<span class="cl-type-tag cl-type-tag-lg" style="--cl-color:' + meta.color + '">' + meta.emoji + ' ' + meta.label + '</span>' +
        visitedHtml +
        '</div>' +
        '<h2 class="dtl-title">' + escapeHtml(item.title || '') + '</h2>' +
        '<div class="detail-author dtl-author">' +
        '<div class="da-avatar" id="cl-author-avatar" style="background-image:url(\'' + authorPhoto + '\')"></div>' +
        '<span class="da-name">' + escapeHtml(authorName || '작성자') + '</span>' +
        '</div>' +
        (item.content ? '<div class="dtl-text"><p>' + contentHtml + '</p></div>' : '') +
        // [smsong] 가볼곳 댓글 영역 (추억과 동일, id는 cl- 접두어로 분리)
        '<div class="comments-section dtl-comments">' +
        '<div class="comments-head">' + icon('comment',15) + ' 댓글 <span class="comments-count" id="cl-comments-count">0</span></div>' +
        '<div class="comments-list" id="cl-comments-list"><div class="comments-loading">댓글을 불러오는 중…</div></div>' +
        '<div class="comment-compose">' +
        '<input type="text" class="comment-input" id="cl-new-comment-input" placeholder="댓글을 남겨보십시오" maxlength="1000">' +
        '<button type="button" class="comment-send-btn" id="cl-new-comment-send">등록</button>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '</div>';
    // [E] edit by smsong

    const headerActions = document.getElementById('cl-detail-header-actions');
    if (headerActions) {
        // [smsong] 수정은 소유자/커플, 휴지통 이동은 작성자(소유자)만
        headerActions.innerHTML =
            (canManage ? '<button type="button" class="detail-edit-btn" id="cl-detail-edit-open" title="수정">' + icon('edit',16) + '</button>' : '') +
            (canTrashObject(item) ? '<button type="button" class="detail-trash-btn" id="cl-detail-del-open" title="휴지통">' + icon('trash',16) + '</button>' : '');
    }

    bindCarousel(document.getElementById('cl-detail-view'), _clUrls);
    Daylog._fitDetailStage(document.getElementById('cl-detail-view')); // [B] edit by smsong - #7 사진 비율에 맞춰 무대 높이
    const av = document.getElementById('cl-author-avatar');
    if (av) av.addEventListener('click', () => openLightbox(authorPhoto, av));
    const locEl = document.getElementById('cl-detail-loc');
    if (locEl && item.lat != null && item.lng != null) {
        locEl.addEventListener('click', () => Daylog.focusChecklistOnMap && Daylog.focusChecklistOnMap(item));
    }
    const eo = document.getElementById('cl-detail-edit-open');
    if (eo) eo.addEventListener('click', () => enterChecklistEdit(item));
    const dl = document.getElementById('cl-detail-del-open');
    if (dl) dl.addEventListener('click', () => trashChecklist(item.id));

    // [smsong] 가볼곳 댓글 작성 바인딩 + 로드
    const clSend = document.getElementById('cl-new-comment-send');
    const clInput = document.getElementById('cl-new-comment-input');
    if (clSend) clSend.addEventListener('click', () => submitComment('checklist', item.id, null, 'cl-new-comment-input'));
    if (clInput) clInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submitComment('checklist', item.id, null, 'cl-new-comment-input'); }
    });
    loadComments('checklist', item.id);

    const cdm = document.getElementById('checklist-detail-modal');
    const cdmScroll = cdm.querySelector('.sheet-body');
    if (cdmScroll) cdmScroll.scrollTop = 0;
    _getChecklistSheet().open('full');       // [smsong] 바텀시트로 열기(완전히 위)
}

function enterChecklistEdit(item) {
    if (_clSheet) _clSheet.snap('full', true); // [smsong] 편집 시 시트를 완전히 위로
    const view = document.getElementById('cl-detail-view');
    const editForm = document.getElementById('cl-edit-form');
    if (!editForm) return;

    // 위치(수정 불가) 표시
    const loc = [item.placeName, item.address].filter(Boolean).join(' ');
    const locEl = document.getElementById('cl-edit-loc');
    if (locEl) locEl.innerHTML = loc ? pinText(loc) : pinText('위치');

    // 타입 칩 선택 반영
    window._clEditSelectedType = item.type || 'ETC';
    document.querySelectorAll('#cl-edit-type-options .cl-type-chip').forEach(c => {
        c.classList.toggle('selected', c.dataset.type === window._clEditSelectedType);
    });

    // 사진 편집 그리드 시드 (기존 이미지 → url 항목)
    if (window._clEditMgr) {
        const urls = mediaUrlsOf(item);
        window._clEditMgr.reset(urls.map(u => ({ kind: 'url', url: u })));
    }

    document.getElementById('cl-edit-title').value = item.title || '';
    document.getElementById('cl-edit-content').value = item.content || '';
    const chk = document.getElementById('cl-edit-visited');
    const date = document.getElementById('cl-edit-visited-date');
    chk.checked = !!item.visited;
    date.disabled = !item.visited;
    date.value = item.visitedDate ? String(item.visitedDate).substring(0, 10) : '';
    // [B] edit by smsong - #13 갈 예정일 채우기 (입력칸이 없으면 먼저 주입)
    if (Daylog._injectPlannedInputs) Daylog._injectPlannedInputs();
    var _pd = document.getElementById('cl-edit-planned-date');
    if (_pd) _pd.value = item.plannedDate ? String(item.plannedDate).substring(0, 10) : '';
    // [E] edit by smsong
    const editLbl = chk.closest('.cl-check-label');
    if (editLbl) editLbl.classList.toggle('checked', !!item.visited);

    if (view) view.classList.add('hidden');
    editForm.classList.remove('hidden');
}

function exitChecklistEdit() {
    // [smsong] 위치 재설정 복귀 중에는 초기화하지 않음(복귀 시 새 위치 유지)
    if (!window._editLocRestoring) _editLocPicked = null;
    const view = document.getElementById('cl-detail-view');
    const editForm = document.getElementById('cl-edit-form');
    if (editForm) editForm.classList.add('hidden');
    if (view) view.classList.remove('hidden');
}

// 가볼곳을 '다녀옴'으로 표시하면 동일 위치/제목/내용/이미지로 추억을 자동 생성
// (이미지는 이미 업로드된 URL을 mediaOrder로 그대로 재사용 → 재업로드 없음)
function createMemoryFromChecklist(cl) {
    if (!cl || cl.lat == null || cl.lng == null) return Promise.resolve();
    const urls = mediaUrlsOf(cl);
    const dateStr = cl.visitedDate ? String(cl.visitedDate).substring(0, 10) : new Date().toISOString().substring(0, 10);
    const memoryData = {
        title: cl.title || '',
        content: cl.content || '',
        lat: cl.lat,
        lng: cl.lng,
        placeName: cl.placeName || '',
        address: cl.address || '',
        createdAt: dateStr + 'T00:00:00',
        mediaOrder: urls
    };
    const fd = new FormData();
    fd.append('uid', Daylog.currentUid);
    fd.append('memoryData', JSON.stringify(memoryData));
    // mediaData(새 파일) 없음 → 백엔드가 mediaOrder의 기존 URL을 그대로 보존
    return fetch(`${Daylog.api}/api/memories`, { method: 'POST', headers: Daylog.authHeaders(false), body: fd })
        .then(Daylog.handleResponse)
        .then(function (created) {
            // [B] edit by smsong - #5 가볼곳 댓글(+답글)을 새 추억으로 이동
            if (created && created.id && cl.id) {
                return fetch(`${Daylog.api}/comment/move?fromChecklist=${cl.id}&toMemory=${created.id}`,
                    { method: 'POST', headers: Daylog.authHeaders(true) })
                    .then(Daylog.handleResponse).catch(function () {})
                    .then(function () { return created; });
            }
            return created;
        });
}

// [B] edit by smsong - 가볼곳 '다녀옴' 추억 자동 생성 시 중복 방지
//  가볼곳의 위치(lat/lng)는 수정할 수 없으므로, '동일 위치 + 동일 제목'의 추억을 같은 오브젝트로 간주한다.
//  이미 존재하면 새로 만들지 않아, 안가봄<->갔다왔습니다 토글을 반복해도 추억이 중복 생성되지 않는다.
function ensureMemoryForChecklist(cl) {
    if (!cl || cl.lat == null || cl.lng == null) return Promise.resolve(false);
    const sameObject = (m) =>
        m && m.lat != null && m.lng != null &&
        Math.abs(Number(m.lat) - Number(cl.lat)) < 1e-6 &&
        Math.abs(Number(m.lng) - Number(cl.lng)) < 1e-6 &&
        String(m.title || '').trim() === String(cl.title || '').trim();
    return fetch(`${Daylog.api}/api/memories/${Daylog.currentUid}`, { headers: Daylog.authHeaders(true) })
        .then(Daylog.handleResponse)
        .then((list) => {
            if ((list || []).some(sameObject)) return false; // 동일 추억이 이미 있음 -> 생성 안 함
            return createMemoryFromChecklist(cl).then(() => true);
        })
        .catch(() => createMemoryFromChecklist(cl).then(() => true)); // 목록 조회 실패 시 기존 동작 유지
}
// [E] edit by smsong

function saveChecklistEdit() {
    const item = _detailChecklist;
    if (!item) return;
    const wasVisited = !!item.visited; // 수정 전 방문여부 (새로 체크된 경우에만 추억 생성)
    const title = document.getElementById('cl-edit-title').value.trim();
    if (!title) { showToast('제목을 입력해주십시오'); return; }
    const visited = document.getElementById('cl-edit-visited').checked;
    const visitedDate = document.getElementById('cl-edit-visited-date').value;
    const mgr = window._clEditMgr;
    const order = mgr ? mgr.getMediaOrder() : null;
    const newFiles = mgr ? mgr.getNewFiles() : [];
    if (visited && (!order || order.length === 0)) { showToast('다녀온 곳은 사진을 1장 이상 첨부해주십시오'); return; }
    if (order && order.length > 10) { showToast('이미지는 최대 10장까지 첨부할 수 있습니다'); return; }
    const dto = {
        title: title,
        content: document.getElementById('cl-edit-content').value,
        type: window._clEditSelectedType || item.type || 'ETC',
        visited: visited,
        visitedDate: (visited && visitedDate) ? visitedDate : null,
        // [B][E] edit by smsong - #13 갈 예정일 (빈 값이면 null → 달력에서 해제)
        plannedDate: (document.getElementById('cl-edit-planned-date') || {}).value || null,
        mediaOrder: order
    };
    // [B] edit by smsong - 위치를 '실제로 변경'했을 때만 위치 필드를 함께 전송(미변경 시 기존과 동일 페이로드 → 회귀 없음)
    if (_editLocPicked) {
        dto.lat = _editLocPicked.lat;
        dto.lng = _editLocPicked.lng;
        dto.placeName = _editLocPicked.placeName || '';
        dto.address = _editLocPicked.address || '';
    }
    // [E] edit by smsong
    const fd = new FormData();
    fd.append('checklistData', JSON.stringify(dto));
    newFiles.forEach(f => fd.append('mediaData', f));

    const btn = document.querySelector('#cl-edit-form .submit-btn');
    if (btn) { btn.disabled = true; btn.innerText = '저장 중...'; }

    withLoading(fetch(`${Daylog.api}/api/checklists/${item.id}`, {
        method: 'PUT',
        headers: Daylog.authHeaders(false), // FormData → Content-Type 자동 설정
        body: fd
    }), '수정 중...')
        .then(Daylog.handleResponse)
        .then((updated) => {
            _editLocPicked = null; // [smsong] 수정 위치 소비
            closeChecklistDetail();
            // [B] edit by smsong - 처음으로 '다녀옴'이 되면 추억으로 기록하고 가볼곳은 제거(추억으로 이동)
            if (updated && updated.visited && !wasVisited) {
                ensureMemoryForChecklist(updated)
                    .then((made) => { showToast('다녀온 곳이라 추억으로 기록하고 보관함에 담았어요'); })
                    .then(() => archiveChecklistQuietly(updated.id)) // 원본 가볼곳 제거
                    .catch(err => console.warn('추억 이동 실패', err))
                    .finally(() => {
                        // [B] edit by smsong - #3 추억/가볼곳 새로고침 후 지도를 추억 모드로 → 새 추억 마커 즉시 표시
                        Promise.all([loadMemoriesFromServer(), loadChecklistsFromServer()]).then(function () {
                            if (mapMode !== 'memory') setMapMode('memory'); else refreshMapMarkers();
                        });
                    });
            } else {
                showToast('수정 완료');
                Daylog.reloadChecklists();
            }
            // [E] edit by smsong
        })
        .catch(err => { console.error(err); showToast('수정 실패. 다시 시도해주십시오.'); })
        .finally(() => { if (btn) { btn.disabled = false; btn.innerText = '저장하기'; } });
}

// [B] edit by smsong - #12 '다녀옴' 추억 자동생성 후 원본 체크리스트를 조용히 '보관함'으로 이동.
//  · 예전에는 휴지통으로 보냈으나, 30일 뒤 자동 삭제되면 달력 기록까지 사라져 버렸다.
//  · 보관함은 지도/목록에는 안 뜨고 달력과 [설정 > 보관함]에서만 보인다. 자동 삭제도 없다.
//  · 달력에서 완전히 사라지는 시점은 '영구 삭제' 뿐이다.
function archiveChecklistQuietly(id) {
    if (id == null) return Promise.resolve();
    return fetch(`${Daylog.api}/api/checklists/${id}/archive`, { method: 'PUT', headers: Daylog.authHeaders(true) })
        .then(Daylog.handleResponse).catch(() => {});
}
// 이전 이름 호환 (혹시 남은 호출부가 있어도 보관함으로 동작)
function trashChecklistQuietly(id) { return archiveChecklistQuietly(id); }
// [E] edit by smsong

function trashChecklist(id) {
    if (!confirm('이 체크리스트를 휴지통으로 옮기시겠습니까?')) return;
    withLoading(fetch(`${Daylog.api}/api/checklists/${id}/trash`, { method: 'PUT', headers: Daylog.authHeaders(true) }), '휴지통으로 이동 중...')
        .then(Daylog.handleResponse)
        .then(() => { showToast('휴지통으로 이동했습니다'); closeChecklistDetail(); Daylog.reloadChecklists(); })
        .catch(err => { console.error(err); showToast('이동 실패. 다시 시도해주십시오.'); });
}

function closeChecklistDetail() {
    _getChecklistSheet().close();  // [smsong] 정리는 onClosed 콜백에서
}

let _detailMemory = null;
// [B] edit by smsong - 추억/가볼곳 '수정' 중 새로 고른 위치(없으면 원본 유지). 저장 함수(최상위)와 위치선택(클로저)이 공유하므로 최상위에 선언
let _editLocPicked = null; // { lat, lng, placeName, address } | null
// [E] edit by smsong

// =====================================================
// [smsong] 상세보기 바텀시트 (REMS 방식 이식)
//  스냅: full(완전히 위) → one(1/3) → closed(완전히 아래=닫힘)
//  드래그 영역: 핸들 + 헤더 / 본문(.sheet-body)은 자유 스크롤
// =====================================================
function createDetailSheet(modalId, onClosed) {
    const modal = document.getElementById(modalId);
    const content = modal.querySelector('.detail-content');
    const handle = modal.querySelector('.sheet-handle');
    const header = modal.querySelector('.detail-modal-header');
    let current = 'closed';
    let dragging = false, startY = 0, startPx = 0, lastY = 0, lastT = 0, vel = 0;
    let closeTimer = null;

    function A() { return window.innerHeight || document.documentElement.clientHeight; }
    function H() { return content.offsetHeight || A() * 0.88; }
    function metrics() {
        const a = A(), h = H();
        return {
            full: 0,                                    // 완전히 위
            one:  Math.max(0, Math.round(h - a * 0.34)),// 1/3 노출
            closed: Math.round(h + 40)                  // 완전히 아래(숨김)
        };
    }
    function curPx() {
        const m = /translateY\(([-0-9.]+)px\)/.exec(content.style.transform || '');
        return m ? parseFloat(m[1]) : metrics()[current];
    }
    function apply(px, animate) {
        content.style.transition = animate ? 'transform 0.42s cubic-bezier(0.32,0.72,0,1)' : 'none';
        content.style.transform = 'translateY(' + px + 'px)';
    }
    function snap(name, animate) {
        current = name;
        // [B] edit by smsong - #8 시트가 완전히 위(full)일 때만 .at-full 표시 → CSS 가 상·하단 네비를 감춘다.
        //  1/3 로 내려 뒤 화면(지도/타임라인)을 보는 상태에서는 네비가 다시 필요하므로 여기서 토글한다.
        modal.classList.toggle('at-full', name === 'full');
        // [E] edit by smsong
        apply(metrics()[name], animate !== false);
        if (name === 'closed') {
            clearTimeout(closeTimer);
            closeTimer = setTimeout(() => {
                if (current !== 'closed') return;
                modal.classList.add('hidden');
                if (typeof onClosed === 'function') onClosed();
            }, animate !== false ? 380 : 0);
        }
    }
    function open(target) {
        clearTimeout(closeTimer);
        target = target || 'full';
        dragging = false;                 // [smsong] 이전 드래그 상태 강제 해제
        modal.classList.remove('hidden');
        const sb = content.querySelector('.sheet-body');
        if (sb) sb.scrollTop = 0;         // [smsong] 본문 스크롤도 항상 맨 위로
        // [smsong] 오브젝트 간 이동/화면 이동 시 항상 완전히 아래에서 시작 → 완전히 위(첫 페이지)로 초기화
        current = 'closed';
        content.style.transition = 'none';
        content.style.transform = 'translateY(' + metrics().closed + 'px)';
        void content.offsetHeight;        // reflow → 닫힘 위치 확정
        requestAnimationFrame(() => {
            requestAnimationFrame(() => snap(target, true));  // 이중 rAF로 확실히 애니메이션 재생
        });
        // [smsong] 드래그 가능 힌트: 핸들을 잠깐 튕김(유한)
        if (handle) {
            handle.classList.remove('hinting');
            void handle.offsetWidth;
            handle.classList.add('hinting');
            setTimeout(() => handle.classList.remove('hinting'), 2000);
        }
    }
    function close() { snap('closed', true); }

    function down(e) {
        dragging = true;
        startY = lastY = (e.touches ? e.touches[0].clientY : e.clientY);
        lastT = Date.now(); vel = 0; startPx = curPx();
        content.style.transition = 'none';
        document.body.style.userSelect = 'none';
    }
    function move(e) {
        if (!dragging) return;
        const y = (e.touches ? e.touches[0].clientY : e.clientY);
        const m = metrics();
        const px = Math.max(0, Math.min(startPx + (y - startY), m.closed));
        content.style.transform = 'translateY(' + px + 'px)';
        const now = Date.now(), dt = now - lastT;
        if (dt > 0) vel = (y - lastY) / dt;
        lastY = y; lastT = now;
        if (e.cancelable) e.preventDefault();
    }
    function up() {
        if (!dragging) return;
        dragging = false; document.body.style.userSelect = '';
        const m = metrics(), pos = curPx(), TH = 0.55;
        let target;
        if (vel > TH) {          // 아래로 플릭 → 한 단계 내림 (완전히 위→1/3, 그 아래는 닫힘)
            target = current === 'full' ? 'one' : 'closed';
        } else if (vel < -TH) {  // 위로 플릭 → 완전히 위로
            target = 'full';
        } else {                 // 천천히 놓으면 가장 가까운 스냅 (2/3 지점 제거)
            const cand = ['full', 'one', 'closed'];
            target = cand.reduce((a, b) => Math.abs(m[b] - pos) < Math.abs(m[a] - pos) ? b : a, cand[0]);
        }
        snap(target, true);
    }

    [handle, header].forEach(t => {
        if (!t) return;
        t.addEventListener('touchstart', down, { passive: true });
        t.addEventListener('mousedown', down);
    });
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('mousemove', move);
    window.addEventListener('touchend', up);
    window.addEventListener('mouseup', up);
    window.addEventListener('resize', () => { if (current !== 'closed') snap(current, false); });

    return { open, close, snap, isOpen: () => current !== 'closed' };
}
let _memorySheet = null, _clSheet = null;
function _getMemorySheet() {
    if (!_memorySheet) _memorySheet = createDetailSheet('detail-modal', () => {
        const ha = document.getElementById('detail-header-actions'); if (ha) ha.innerHTML = '';
        exitDetailEdit();
        _detailMemory = null;
    });
    return _memorySheet;
}
function _getChecklistSheet() {
    if (!_clSheet) _clSheet = createDetailSheet('checklist-detail-modal', () => {
        const ha = document.getElementById('cl-detail-header-actions'); if (ha) ha.innerHTML = '';
        exitChecklistEdit();
        _detailChecklist = null;
    });
    return _clSheet;
}

function openDetailModal(memory, overModal) {
    _detailMemory = memory;
    document.getElementById('detail-modal').classList.toggle('over-modal', !!overModal); // [smsong] 목록 모달 위로 올릴지
    const view = document.getElementById('detail-view');
    const editForm = document.getElementById('detail-edit-form');
    if (editForm) editForm.classList.add('hidden');
    if (view) view.classList.remove('hidden');

    const dateStr = memory.createdAt ? memory.createdAt.substring(0, 10).replace(/-/g, '.') : '';
    const _memUrls = mediaUrlsOf(memory);
    // [B] edit by smsong - 상세 이미지 전체 사전 로드 제거 → 캐러셀 lazy 로 위임 (이미지 많아도 즉시 열림)
    const imageHtml = carouselHtml(_memUrls);
    const isOwner = !!(memory.ownerUid && Daylog.currentUid && memory.ownerUid === Daylog.currentUid);
    const canManage = canManageObject(memory); // [smsong] 소유자 또는 커플(송성민/강미르)
    const contentHtml = escapeHtml(memory.content || '').replace(/\n/g, '<br>');

    // 작성자 정보 (2인 전용 — usersByUid 에서 조회)
    const author = (Daylog.usersByUid && Daylog.usersByUid[memory.ownerUid]) || null;
    let authorName = '';
    if (author) {
        authorName = (author.nickname && String(author.nickname).trim())
            ? author.nickname
            : (typeof normalizeDisplayName === 'function' ? normalizeDisplayName(author.name) : (author.name || ''));
    }
    const authorPhoto = (author && author.profileURL) ? author.profileURL : DEFAULT_AVATAR;
    const authorHtml =
        '<div class="detail-author">' +
        '<div class="da-avatar" id="detail-author-avatar" style="background-image:url(\'' + authorPhoto + '\')"></div>' +
        '<span class="da-name">' + escapeHtml(authorName || '작성자') + '</span>' +
        '</div>';

    // [B] edit by smsong - #7 몰입형 상세: 무대(사진) → 종이(글·댓글)
    //  · id 는 전부 기존 그대로 유지 (detail-loc / detail-author-avatar / comments-* / new-comment-*)
    //    → applyDetailLocation, loadComments, submitComment 등 기존 로직이 그대로 동작한다.
    view.innerHTML =
        '<div class="dtl">' +
        '<div class="dtl-stage' + (_memUrls.length ? '' : ' empty') + '">' +
        (_memUrls.length ? imageHtml : '<span class="dtl-stage-ic">' + icon('book', 42) + '</span>') +
        '</div>' +
        '<div class="dtl-page">' +
        '<div class="dtl-eyebrow">' +
        '<span>' + escapeHtml(dateStr) + '</span>' +
        '<span class="dtl-sep">·</span>' +
        '<span class="dtl-loc meta-loc-clickable" id="detail-loc" title="지도에서 보기">' + icon('pin', 13) + ' 위치 확인 중…</span>' +
        '</div>' +
        '<h2 class="dtl-title">' + escapeHtml(memory.title || '') + '</h2>' +
        authorHtml +
        (memory.content ? '<div class="dtl-text"><p>' + contentHtml + '</p></div>' : '') +
        // 댓글 영역
        '<div class="comments-section dtl-comments">' +
        '<div class="comments-head">' + icon('comment',15) + ' 댓글 <span class="comments-count" id="comments-count">0</span></div>' +
        '<div class="comments-list" id="comments-list"><div class="comments-loading">댓글을 불러오는 중…</div></div>' +
        '<div class="comment-compose">' +
        '<input type="text" class="comment-input" id="new-comment-input" placeholder="댓글을 남겨보십시오" maxlength="1000">' +
        '<button type="button" class="comment-send-btn" id="new-comment-send">등록</button>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '</div>';
    // [E] edit by smsong

    // 헤더 영역: (소유자만) 수정/휴지통 버튼을 '추억 상세' 위치에 작게 배치
    const headerActions = document.getElementById('detail-header-actions');
    if (headerActions) {
        // [smsong] 수정은 소유자/커플, 휴지통 이동은 작성자(소유자)만
        headerActions.innerHTML =
            (canManage ? '<button type="button" class="detail-edit-btn" id="detail-edit-open" title="수정">' + icon('edit',16) + '</button>' : '') +
            (canTrashObject(memory) ? '<button type="button" class="detail-trash-btn" id="detail-trash-open" title="휴지통">' + icon('trash',16) + '</button>' : '');
    }

    applyDetailLocation(memory);

    // 위치 클릭 → 지도 탭으로 이동 + 해당 마커 흔들기
    const locEl = document.getElementById('detail-loc');
    if (locEl && memory.lat != null && memory.lng != null) {
        locEl.addEventListener('click', () => {
            if (Daylog && typeof Daylog.focusOnMap === 'function') Daylog.focusOnMap(memory);
        });
    }

    // 이미지 캐러셀 바인딩 (좌우 스와이프 + 탭 확대)
    bindCarousel(document.getElementById('detail-view'), _memUrls);
    Daylog._fitDetailStage(document.getElementById('detail-view')); // [B] edit by smsong - #7 사진 비율에 맞춰 무대 높이

    // 작성자 프로필 클릭 → 확대 (실제 사진/기본 이미지 모두)
    const da = document.getElementById('detail-author-avatar');
    if (da) da.addEventListener('click', () => openLightbox(authorPhoto, da));

    const eo = document.getElementById('detail-edit-open');
    if (eo) eo.addEventListener('click', () => enterDetailEdit(memory));

    const to = document.getElementById('detail-trash-open');
    if (to) to.addEventListener('click', () => trashMemory(memory.id));

    // 댓글 작성 바인딩
    const sendBtn = document.getElementById('new-comment-send');
    const newInput = document.getElementById('new-comment-input');
    if (sendBtn) sendBtn.addEventListener('click', () => submitComment('memory', memory.id, null, 'new-comment-input'));
    if (newInput) newInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submitComment('memory', memory.id, null, 'new-comment-input'); }
    });

    loadComments('memory', memory.id);

    const dm = document.getElementById('detail-modal');
    const dmScroll = dm.querySelector('.sheet-body');
    if (dmScroll) dmScroll.scrollTop = 0;   // 항상 맨 위에서 시작
    _getMemorySheet().open('full');         // [smsong] 바텀시트로 열기(완전히 위)
}

// 상세/수정 모달의 위치 표기 (장소명 + 상세주소) — 없으면 좌표로 역지오코딩
//  elId: 채워 넣을 요소 id ('detail-loc' 또는 'edit-loc')
function fillLocationInto(elId, memory) {
    const el = document.getElementById(elId);
    if (!el) return;
    const place = (memory.placeName || '').trim();
    const addr = (memory.address || '').trim();
    // 기존과 동일하게 한 줄 주소처럼 보이도록 공백으로 합침
    const compose = (p, a) => pinText([p, a].filter(Boolean).join(' '));
    if (place || addr) el.innerHTML = compose(place, addr);
    if (!place && !addr) {
        if (memory.lat != null && memory.lng != null) {
            reverseGeocode(memory.lat, memory.lng, (a) => { el.innerHTML = a ? pinText(a) : pinText('위치 정보 없음'); });
        } else { el.innerHTML = pinText('위치 정보 없음'); }
    } else if (place && !addr && memory.lat != null && memory.lng != null) {
        reverseGeocode(memory.lat, memory.lng, (a) => { if (a) el.innerHTML = compose(place, a); });
    }
}

function applyDetailLocation(memory) { fillLocationInto('detail-loc', memory); }

function enterDetailEdit(memory) {
    if (_memorySheet) _memorySheet.snap('full', true); // [smsong] 편집 시 시트를 완전히 위로
    const view = document.getElementById('detail-view');
    const editForm = document.getElementById('detail-edit-form');
    if (!editForm) return;

    // 사진 편집 그리드 시드 (기존 이미지 → url 항목, 추가/삭제/정렬 가능)
    if (window._memEditMgr) {
        const urls = mediaUrlsOf(memory);
        window._memEditMgr.reset(urls.map(u => ({ kind: 'url', url: u })));
    }
    // 위치 표시 (수정 불가)
    fillLocationInto('edit-loc', memory);

    document.getElementById('edit-memory-date').value = memory.createdAt ? memory.createdAt.substring(0, 10) : '';
    document.getElementById('edit-memory-title').value = memory.title || '';
    document.getElementById('edit-memory-content').value = memory.content || '';
    if (view) view.classList.add('hidden');
    editForm.classList.remove('hidden');
}

function exitDetailEdit() {
    // [smsong] 위치 재설정 복귀 중에는 초기화하지 않음(복귀 시 새 위치 유지)
    if (!window._editLocRestoring) _editLocPicked = null;
    const view = document.getElementById('detail-view');
    const editForm = document.getElementById('detail-edit-form');
    if (editForm) editForm.classList.add('hidden');
    if (view) view.classList.remove('hidden');
}

// 본인 추억 수정 저장 (이미지 제외 · 제목/내용/날짜)
function saveDetailEdit() {
    const memory = _detailMemory;
    if (!memory) return;
    const date = document.getElementById('edit-memory-date').value;
    const title = document.getElementById('edit-memory-title').value.trim();
    const content = document.getElementById('edit-memory-content').value.trim();
    if (!title) { showToast('제목을 입력해주십시오'); return; }

    const mgr = window._memEditMgr;
    const order = mgr ? mgr.getMediaOrder() : null;
    const newFiles = mgr ? mgr.getNewFiles() : [];
    if (order && order.length > 10) { showToast('이미지는 최대 10장까지 첨부할 수 있습니다'); return; }

    // createdAt: LocalDateTime("yyyy-MM-ddT00:00:00") 형식으로 전송
    let createdAt = null;
    if (date) createdAt = date + 'T00:00:00';
    else if (memory.createdAt) createdAt = (String(memory.createdAt).length === 10) ? (memory.createdAt + 'T00:00:00') : memory.createdAt;

    const memoryData = { title: title, content: content, createdAt: createdAt, mediaOrder: order };
    // [B] edit by smsong - 위치를 '실제로 변경'했을 때만 위치 필드를 함께 전송(미변경 시 기존과 동일 페이로드 → 회귀 없음)
    if (_editLocPicked) {
        memoryData.lat = _editLocPicked.lat;
        memoryData.lng = _editLocPicked.lng;
        memoryData.placeName = _editLocPicked.placeName || '';
        memoryData.address = _editLocPicked.address || '';
    }
    // [E] edit by smsong
    const fd = new FormData();
    fd.append('memoryData', JSON.stringify(memoryData));
    newFiles.forEach(f => fd.append('mediaData', f));

    const btn = document.querySelector('#detail-edit-form .submit-btn');
    if (btn) { btn.disabled = true; btn.innerText = '저장 중...'; }

    withLoading(fetch(`${Daylog.api}/api/memories/${memory.id}`, {
        method: 'PUT',
        headers: Daylog.authHeaders(false), // FormData → Content-Type 자동
        body: fd
    }), '수정 중...')
        .then(Daylog.handleResponse)
        .then(() => {
            _editLocPicked = null; // [smsong] 수정 위치 소비
            showToast('수정 완료');
            closeDetailModal();
            Daylog.reload();
        })
        .catch(err => { console.error(err); showToast('수정 실패. 다시 시도해주십시오.'); })
        .finally(() => { if (btn) { btn.disabled = false; btn.innerText = '저장하기'; } });
}

function closeDetailModal() {
    _getMemorySheet().close();  // [smsong] 아래로 슬라이드 후 숨김/정리는 onClosed 콜백에서
}

// ==========================================
//  댓글 / 대댓글
// ==========================================
const _commentCache = {};

// [smsong] 오브젝트별 댓글 수 (썸네일 배지) — { memory:{id:n}, checklist:{id:n} }
function _ensureCommentCounts() {
    if (!Daylog.commentCounts) Daylog.commentCounts = { memory: {}, checklist: {} };
    return Daylog.commentCounts;
}
function applyCommentBadges(kind) {
    const map = _ensureCommentCounts()[kind] || {};
    const prefix = (kind === 'checklist') ? 'clcbadge-' : 'mcbadge-';
    document.querySelectorAll('[id^="' + prefix + '"]').forEach(el => {
        const key = el.id.substring(prefix.length);
        const n = map[key] || 0;
        if (n > 0) { el.innerHTML = icon('comment', 12) + ' ' + n; el.style.display = ''; }
        else { el.style.display = 'none'; }
    });
}
function fetchCommentCounts(kind) {
    const path = (kind === 'checklist') ? '/comment/counts/checklist' : '/comment/counts/memory';
    return fetch(`${Daylog.api}${path}`, { headers: Daylog.authHeaders(true) })
        .then(Daylog.handleResponse)
        .then(map => { _ensureCommentCounts()[kind] = map || {}; applyCommentBadges(kind); })
        .catch(err => console.warn('[Daylog] 댓글 수 조회 실패:', err));
}
// 썸네일에 붙는 댓글 수 배지 요소 (초기 숨김 → 카운트 로드 후 표시)
function commentBadgeHtml(kind, id) {
    const prefix = (kind === 'checklist') ? 'clcbadge-' : 'mcbadge-';
    return '<span class="obj-comment-badge" id="' + prefix + id + '" style="display:none"></span>';
}

function commentAuthorName(c) {
    if (c.ownerNickname && c.ownerNickname.trim()) return c.ownerNickname.trim();
    if (typeof normalizeDisplayName === 'function' && c.ownerName) return normalizeDisplayName(c.ownerName);
    return c.ownerName || '익명';
}

function commentTimeLabel(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const diff = (now - d) / 1000; // 초
    if (diff < 60) return '방금 전';
    if (diff < 3600) return Math.floor(diff / 60) + '분 전';
    if (diff < 86400) return Math.floor(diff / 3600) + '시간 전';
    const yyyy = d.getFullYear(), mm = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}.${mm}.${dd}`;
}

function commentAvatarHtml(c) {
    const src = (c.ownerProfileURL && c.ownerProfileURL.trim()) ? c.ownerProfileURL : DEFAULT_AVATAR;
    return '<div class="c-avatar" style="background-image:url(\'' + src + '\')" data-photo="' + src + '" onclick="openLightbox(this.dataset.photo, this)"></div>';
}

function commentItemHtml(c, kind, targetId, isReply) {
    _commentCache[c.id] = c;
    const isOwner = !!(c.ownerUid && Daylog.currentUid && c.ownerUid === Daylog.currentUid);
    const contentHtml = escapeHtml(c.content || '').replace(/\n/g, '<br>');
    const K = "'" + kind + "'";

    let actions =
        '<div class="c-actions">' +
        (isReply ? '' : '<button type="button" class="c-act-btn" onclick="toggleReplyForm(' + c.id + ')">답글</button>') +
        (isOwner ? '<button type="button" class="c-act-btn" onclick="enterCommentEdit(' + c.id + ',' + K + ',' + targetId + ')">수정</button>' : '') +
        (isOwner ? '<button type="button" class="c-act-btn c-act-trash" onclick="trashComment(' + K + ',' + c.id + ',' + targetId + ')">' + icon('trash',15) + '</button>' : '') +
        '</div>';

    let replyForm = isReply ? '' :
        '<div class="c-reply-form hidden" id="reply-form-' + c.id + '">' +
        '<input type="text" class="comment-input" id="reply-input-' + c.id + '" placeholder="답글을 입력하십시오" maxlength="1000">' +
        '<button type="button" class="comment-send-btn" onclick="submitComment(' + K + ',' + targetId + ',' + c.id + ',\'reply-input-' + c.id + '\')">등록</button>' +
        '</div>';

    let repliesHtml = '';
    if (!isReply && c.replies && c.replies.length) {
        repliesHtml = '<div class="c-replies">' +
            c.replies.map(r => commentItemHtml(r, kind, targetId, true)).join('') +
            '</div>';
    }

    return '' +
        '<div class="comment-item' + (isReply ? ' is-reply' : '') + '" data-id="' + c.id + '">' +
        commentAvatarHtml(c) +
        '<div class="c-body">' +
        '<div class="c-meta">' +
        '<span class="c-name">' + escapeHtml(commentAuthorName(c)) + '</span>' +
        '<span class="c-time">' + commentTimeLabel(c.createdAt) + '</span>' +
        '</div>' +
        '<div class="c-content" id="c-content-' + c.id + '">' + contentHtml + '</div>' +
        actions +
        replyForm +
        repliesHtml +
        '</div>' +
        '</div>';
}

function loadComments(kind, targetId) {
    const listId = (kind === 'checklist') ? 'cl-comments-list' : 'comments-list';
    const countId = (kind === 'checklist') ? 'cl-comments-count' : 'comments-count';
    const list = document.getElementById(listId);
    if (!list) return;
    const path = (kind === 'checklist') ? `/comment/checklist/${targetId}` : `/comment/memory/${targetId}`;
    withLoading(fetch(`${Daylog.api}${path}`, { headers: Daylog.authHeaders(true) })
        .then(Daylog.handleResponse)
        .then(comments => {
            comments = comments || [];
            const countEl = document.getElementById(countId);
            let total = comments.length;
            comments.forEach(c => { total += (c.replies ? c.replies.length : 0); });
            if (countEl) countEl.textContent = total;

            if (!comments.length) {
                list.innerHTML = '<div class="comments-empty">댓글이 존재하지 않습니다.</div>';
                return;
            }
            list.innerHTML = comments.map(c => commentItemHtml(c, kind, targetId, false)).join('');
        })
        .catch(err => {
            console.error(err);
            list.innerHTML = '<div class="comments-empty">댓글을 조회 실패</div>';
        }), '댓글을 불러오는 중...'); // [smsong] 로딩
}

function submitComment(kind, targetId, parentId, inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const content = input.value.trim();
    if (!content) { showToast('댓글을 입력해주십시오'); return; }

    const body = (kind === 'checklist')
        ? { checklistId: targetId, parentId: parentId, content: content }
        : { memoryId: targetId, parentId: parentId, content: content };

    withLoading(fetch(`${Daylog.api}/comment`, {
        method: 'POST',
        headers: Daylog.authHeaders(true),
        body: JSON.stringify(body)
    }), '등록 중...')
        .then(Daylog.handleResponse)
        .then(() => {
            input.value = '';
            loadComments(kind, targetId);
        })
        .catch(err => { console.error(err); showToast('댓글 등록 실패'); });
}

function toggleReplyForm(commentId) {
    const form = document.getElementById('reply-form-' + commentId);
    if (!form) return;
    form.classList.toggle('hidden');
    if (!form.classList.contains('hidden')) {
        const inp = document.getElementById('reply-input-' + commentId);
        if (inp) inp.focus();
    }
}

function enterCommentEdit(commentId, kind, targetId) {
    const c = _commentCache[commentId];
    const box = document.getElementById('c-content-' + commentId);
    if (!c || !box) return;
    const K = "'" + kind + "'";
    box.innerHTML =
        '<textarea class="c-edit-area" id="c-edit-' + commentId + '" maxlength="1000">' + escapeHtml(c.content || '') + '</textarea>' +
        '<div class="c-edit-actions">' +
        '<button type="button" class="c-edit-cancel" onclick="loadComments(' + K + ',' + targetId + ')">취소</button>' +
        '<button type="button" class="c-edit-save" onclick="saveCommentEdit(' + commentId + ',' + K + ',' + targetId + ')">저장</button>' +
        '</div>';
    const ta = document.getElementById('c-edit-' + commentId);
    if (ta) { ta.focus(); ta.value = c.content || ''; }
}

function saveCommentEdit(commentId, kind, targetId) {
    const ta = document.getElementById('c-edit-' + commentId);
    if (!ta) return;
    const content = ta.value.trim();
    if (!content) { showToast('내용을 입력해주십시오'); return; }
    withLoading(fetch(`${Daylog.api}/comment/${commentId}`, {
        method: 'PUT',
        headers: Daylog.authHeaders(true),
        body: JSON.stringify({ content: content })
    }), '수정 중...')
        .then(Daylog.handleResponse)
        .then(() => { showToast('댓글 수정 완료'); loadComments(kind, targetId); })
        .catch(err => { console.error(err); showToast('수정 실패'); });
}

function trashComment(kind, commentId, targetId) {
    if (!confirm('이 댓글을 휴지통으로 옮기시겠습니까?')) return;
    withLoading(fetch(`${Daylog.api}/comment/${commentId}/trash`, {
        method: 'PUT',
        headers: Daylog.authHeaders(true)
    }), '휴지통으로 이동 중...')
        .then(Daylog.handleResponse)
        .then(() => { showToast('휴지통으로 이동했습니다'); loadComments(kind, targetId); })
        .catch(err => { console.error(err); showToast('이동 실패'); });
}

// ==========================================
//  추억 휴지통 이동
// ==========================================
function trashMemory(memoryId) {
    if (!confirm('이 추억을 휴지통으로 옮기시겠습니까?')) return;
    withLoading(fetch(`${Daylog.api}/api/memories/${memoryId}/trash`, {
        method: 'PUT',
        headers: Daylog.authHeaders(true)
    }), '휴지통으로 이동 중...')
        .then(Daylog.handleResponse)
        .then(() => { showToast('휴지통으로 이동했습니다'); closeDetailModal(); Daylog.reload(); })
        .catch(err => { console.error(err); showToast('이동 실패'); });
}

// ==========================================
//  휴지통 모달
// ==========================================
function openTrashModal() {
    const modal = document.getElementById('trash-modal');
    const body = document.getElementById('trash-modal-body');
    if (!modal || !body) return;
    body.innerHTML = '<div class="comments-loading">휴지통을 불러오는 중…</div>';
    modal.classList.remove('hidden');

    const uid = Daylog.currentUid;
    withLoading(Promise.all([
        fetch(`${Daylog.api}/api/memories/trash/${uid}`, { headers: Daylog.authHeaders(true) }).then(Daylog.handleResponse).catch(() => []),
        fetch(`${Daylog.api}/comment/trash`, { headers: Daylog.authHeaders(true) }).then(Daylog.handleResponse).catch(() => []),
        fetch(`${Daylog.api}/api/checklists/trash/${uid}`, { headers: Daylog.authHeaders(true) }).then(Daylog.handleResponse).catch(() => [])
    ]).then(([memories, comments, checklists]) => {
        renderTrash(memories || [], comments || [], checklists || []);
    }), '휴지통을 불러오는 중...'); // [smsong] 로딩
}

function closeTrashModal() {
    const modal = document.getElementById('trash-modal');
    if (modal) modal.classList.add('hidden');
}

function renderTrash(memories, comments, checklists) {
    const body = document.getElementById('trash-modal-body');
    if (!body) return;
    // [B][E] edit by smsong - #13 렌더 후 선택 모드 툴바 부착
    setTimeout(function () { if (Daylog._setupTrashSelect) Daylog._setupTrashSelect(); }, 0);
    checklists = checklists || [];

    if (!memories.length && !comments.length && !checklists.length) {
        body.innerHTML = '<div class="empty-state"><span class="es-icon">' + icon('trash',40) + '</span><p>휴지통이 비어 있습니다</p></div>';
        return;
    }

    let html = '';
    // [B] edit by smsong - 휴지통 30일 자동 삭제 안내
    html += '<div class="trash-notice">' + icon('trash',13) + ' 휴지통의 항목은 30일 뒤 자동으로 삭제됩니다.</div>';
    // [E] edit by smsong

    if (memories.length) {
        html += '<div class="trash-group-title">추억 ' + memories.length + '</div>';
        memories.forEach(m => {
            const dateStr = m.createdAt ? m.createdAt.substring(0, 10).replace(/-/g, '.') : '';
            const thumb = Daylog.lmThumbHtml(coverUrlOf(m), icon('book',22,'color:#b08968;')); // [smsong] lazy 썸네일
            html +=
                '<div class="trash-row" data-kind="memory" data-id="' + m.id + '">' +
                thumb +
                '<div class="lm-row-main">' +
                '<div class="lm-row-date">' + escapeHtml(dateStr) + '</div>' +
                '<div class="lm-row-title">' + escapeHtml(m.title || '') + '</div>' +
                '<div class="lm-row-text">' + escapeHtml(m.content || '') + '</div>' +
                autoDeleteText(m) + // [smsong]
                '</div>' +
                '<div class="trash-actions">' +
                (canTrashObject(m) ? '<button type="button" class="trash-restore" onclick="restoreMemory(' + m.id + ')">복원</button>' : '') +
                (canDeleteObject(m) ? '<button type="button" class="trash-delete" onclick="deleteMemoryForever(' + m.id + ')">영구삭제</button>' : '') +
                '</div>' +
                '</div>';
        });
    }

    if (comments.length) {
        html += '<div class="trash-group-title">댓글 ' + comments.length + '</div>';
        comments.forEach(c => {
            const onTitle = c.memoryTitle ? ('"' + escapeHtml(c.memoryTitle) + '" 에 남긴 댓글') : '댓글';
            html +=
                '<div class="trash-row" data-kind="comment" data-id="' + c.id + '">' +
                '<div class="lm-thumb lm-thumb-empty">' + icon('comment',22,'color:#b08968;') + '</div>' +
                '<div class="lm-row-main">' +
                '<div class="lm-row-date">' + onTitle + '</div>' +
                '<div class="lm-row-text trash-comment-text">' + escapeHtml(c.content || '') + '</div>' +
                '</div>' +
                '<div class="trash-actions">' +
                '<button type="button" class="trash-restore" onclick="restoreComment(' + c.id + ')">복원</button>' +
                '<button type="button" class="trash-delete" onclick="deleteCommentForever(' + c.id + ')">영구삭제</button>' +
                '</div>' +
                '</div>';
        });
    }

    if (checklists.length) {
        html += '<div class="trash-group-title">체크리스트 ' + checklists.length + '</div>';
        checklists.forEach(c => {
            const meta = (typeof checklistType === 'function') ? checklistType(c.type) : { emoji: icon('bookmark',15), label: '' };
            const loc = [c.placeName, c.address].filter(Boolean).join(' ');
            html +=
                '<div class="trash-row" data-kind="checklist" data-id="' + c.id + '">' +
                '<div class="lm-thumb lm-thumb-empty">' + meta.emoji + '</div>' +
                '<div class="lm-row-main">' +
                '<div class="lm-row-date">' + escapeHtml(meta.label || '체크리스트') + '</div>' +
                '<div class="lm-row-title">' + escapeHtml(c.title || '') + '</div>' +
                '<div class="lm-row-text">' + escapeHtml(loc) + '</div>' +
                autoDeleteText(c) + // [smsong]
                '</div>' +
                '<div class="trash-actions">' +
                (canTrashObject(c) ? '<button type="button" class="trash-restore" onclick="restoreChecklist(' + c.id + ')">복원</button>' : '') +
                (canDeleteObject(c) ? '<button type="button" class="trash-delete" onclick="deleteChecklistForever(' + c.id + ')">영구삭제</button>' : '') +
                '</div>' +
                '</div>';
        });
    }

    body.innerHTML = html;
}

function restoreMemory(id) {
    withLoading(fetch(`${Daylog.api}/api/memories/${id}/restore`, { method: 'PUT', headers: Daylog.authHeaders(true) }), '복원 중...')
        .then(Daylog.handleResponse)
        .then(() => { showToast('복원했습니다'); openTrashModal(); Daylog.reload(); })
        .catch(err => { console.error(err); showToast('복원 실패'); });
}

function deleteMemoryForever(id) {
    if (!confirm('이 추억을 영구적으로 삭제하시겠습니까?\n삭제하면 되돌릴 수 없습니다.')) return;
    withLoading(fetch(`${Daylog.api}/api/memories/${id}`, { method: 'DELETE', headers: Daylog.authHeaders(true) }), '삭제 중...')
        .then(Daylog.handleResponse)
        .then(() => { showToast('영구 삭제했습니다'); openTrashModal(); })
        .catch(err => { console.error(err); showToast('삭제 실패'); });
}

function restoreComment(id) {
    withLoading(fetch(`${Daylog.api}/comment/${id}/restore`, { method: 'PUT', headers: Daylog.authHeaders(true) }), '복원 중...')
        .then(Daylog.handleResponse)
        .then(() => { showToast('복원했습니다'); openTrashModal(); })
        .catch(err => { console.error(err); showToast('복원 실패'); });
}

function deleteCommentForever(id) {
    if (!confirm('이 댓글을 영구적으로 삭제하시겠습니까?\n삭제하면 되돌릴 수 없습니다.')) return;
    withLoading(fetch(`${Daylog.api}/comment/${id}`, { method: 'DELETE', headers: Daylog.authHeaders(true) }), '삭제 중...')
        .then(Daylog.handleResponse)
        .then(() => { showToast('영구 삭제했습니다'); openTrashModal(); })
        .catch(err => { console.error(err); showToast('삭제 실패'); });
}

function restoreChecklist(id) {
    withLoading(fetch(`${Daylog.api}/api/checklists/${id}/restore`, { method: 'PUT', headers: Daylog.authHeaders(true) }), '복원 중...')
        .then(Daylog.handleResponse)
        .then(() => { showToast('복원했습니다'); openTrashModal(); Daylog.reloadChecklists(); })
        .catch(err => { console.error(err); showToast('복원 실패'); });
}

function deleteChecklistForever(id) {
    if (!confirm('이 체크리스트를 영구적으로 삭제하시겠습니까?\n삭제하면 되돌릴 수 없습니다.')) return;
    withLoading(fetch(`${Daylog.api}/api/checklists/${id}`, { method: 'DELETE', headers: Daylog.authHeaders(true) }), '삭제 중...')
        .then(Daylog.handleResponse)
        .then(() => { showToast('영구 삭제했습니다'); openTrashModal(); })
        .catch(err => { console.error(err); showToast('삭제 실패'); });
}

// ===== 통계 클릭용 리스트 모달 / D-Day 정보 =====
// [B] edit by smsong - #3 멤버 보기 모달
function openMemberModal() {
    const modal = document.getElementById('member-modal');
    const body = document.getElementById('member-modal-body');
    if (!modal || !body) return;
    body.innerHTML = '<div class="perm-loading">불러오는 중...</div>';
    modal.classList.remove('hidden');
    const roomId = getRoomId();
    // [B] edit by smsong - 추억/가볼곳 목록을 먼저 로드해야 카운트가 정확(특히 가볼곳 탭 미방문 시 0 방지)
    withLoading(Promise.all([
        (Daylog.reload ? Promise.resolve(Daylog.reload()) : Promise.resolve()),
        (Daylog.reloadChecklists ? Promise.resolve(Daylog.reloadChecklists()) : Promise.resolve()),
        fetch(`${Daylog.api}/api/rooms/${encodeURIComponent(roomId)}/members`, { headers: Daylog.authHeaders(true) }).then(Daylog.handleResponse)
    ]).then(function (results) {
        const room = results[2];
        Daylog.roomInfo = room;
        renderMemberModal((room && room.members) || [], isCoupleRoom());
    }).catch(function () {
        body.innerHTML = '<div style="padding:22px;text-align:center;color:#8a8178;">멤버를 불러오지 못했습니다.</div>';
    }), '멤버를 불러오는 중...');
}

function renderMemberModal(members, isCouple) {
    const body = document.getElementById('member-modal-body');
    if (!body) return;
    if (!members.length) { body.innerHTML = '<div style="padding:22px;text-align:center;color:#8a8178;">멤버가 없습니다.</div>'; return; }
    const mems = Daylog.memories || [];
    const cls = Daylog.checklists || [];
    body.innerHTML = '';
    members.forEach(m => {
        const name = m.nickname || m.name || m.uid;
        const memCount = mems.filter(x => x.ownerUid === m.uid).length;
        const clCount = cls.filter(x => x.ownerUid === m.uid).length;
        const role = m.role || (m.owner ? 'OWNER' : 'MEMBER');
        const roleLabel = role === 'OWNER' ? '방장' : (role === 'MEMBER' ? '멤버' : '일반');
        const roleCls = role === 'OWNER' ? 'owner' : (role === 'MEMBER' ? 'member' : 'general');
        const avatar = m.profileURL
            ? `<img class="member-avatar-img" src="${m.profileURL}" alt="" onerror="this.style.display='none'">`
            : icon('user', 26, 'color:#b08968;');
        // [B] edit by smsong - 추억/가볼곳 개수만 표시 (댓글 제거)
        let counts = '';
        counts += `<button class="mm-count" data-act="mem" data-uid="${m.uid}"><b>${memCount}</b><span>추억</span></button>`;
        counts += `<button class="mm-count" data-act="cl" data-uid="${m.uid}"><b>${clCount}</b><span>체크리스트</span></button>`;
        const card = document.createElement('div');
        card.className = 'mm-card';
        card.innerHTML =
            `<div class="member-avatar">${avatar}</div>` +
            `<div class="mm-info"><div class="member-role-badge role-${roleCls}">${roleLabel}</div><div class="mm-name">${escapeHtml(name)}</div></div>` +
            `<div class="mm-counts">${counts}</div>`;
        body.appendChild(card);
    });
    body.querySelectorAll('.mm-count').forEach(btn => {
        btn.addEventListener('click', () => {
            const uid = btn.getAttribute('data-uid');
            const act = btn.getAttribute('data-act');
            const mem = members.find(x => x.uid === uid);
            const nm = mem ? (mem.nickname || mem.name || uid) : uid;
            if (act === 'mem') openMemoryListModal(nm + '님의 추억', (Daylog.memories || []).filter(x => x.ownerUid === uid));
            else if (act === 'cl') openChecklistListModal(nm + '님의 체크리스트', (Daylog.checklists || []).filter(x => x.ownerUid === uid));
        });
    });
}

function openCommentedItems(uid, name) {
    const roomId = getRoomId();
    withLoading(fetch(`${Daylog.api}/api/rooms/${encodeURIComponent(roomId)}/member/${encodeURIComponent(uid)}/commented`, { headers: Daylog.authHeaders(true) })
        .then(Daylog.handleResponse)
        .then(entries => { openCommentedListModal(name + '님이 남긴 댓글', entries || []); })
        .catch(() => showToast('댓글 목록을 불러오지 못했습니다')), '댓글을 불러오는 중...');
}

function openCommentedListModal(title, entries) {
    const modal = document.getElementById('list-modal');
    const titleEl = document.getElementById('list-modal-title');
    const body = document.getElementById('list-modal-body');
    if (!modal || !body) return;
    modal.classList.remove('dday-mode');
    modal.classList.add('list-fullscreen');
    Daylog._openListKind = null;
    titleEl.textContent = title;
    body.innerHTML = '';
    if (!entries.length) {
        body.innerHTML = '<div class="empty-state"><span class="es-icon">' + icon('book', 40, 'color:#b08968;') + '</span><p>작성한 댓글이 없습니다</p></div>';
    } else {
        entries.forEach(function (e) {
            const kindLabel = (e.type === 'memory') ? '추억' : '체크리스트';
            const dateStr = e.createdAt ? String(e.createdAt).substring(0, 10).replace(/-/g, '.') : '';
            const row = document.createElement('div');
            row.className = 'lm-row cmt-row';
            row.innerHTML =
                '<div class="lm-row-main">' +
                    '<div class="cmt-row-on">' + icon(e.type === 'memory' ? 'book' : 'bookmark', 13, 'color:#b08968;') +
                        " <b>" + kindLabel + "</b> · '" + escapeHtml(e.itemTitle || '') + "'</div>" +
                    '<div class="cmt-row-text">' + escapeHtml(e.content || '') + '</div>' +
                    (dateStr ? '<div class="lm-row-date">' + escapeHtml(dateStr) + '</div>' : '') +
                '</div>';
            row.addEventListener('click', function () {
                if (e.type === 'memory') {
                    const m = (Daylog.memories || []).find(x => String(x.id) === String(e.itemId));
                    if (m) openDetailModal(m, true); else showToast('원본 추억을 찾을 수 없습니다');
                } else {
                    const c = (Daylog.checklists || []).find(x => String(x.id) === String(e.itemId));
                    if (c) openChecklistDetail(c, true); else showToast('원본 체크리스트를 찾을 수 없습니다');
                }
            });
            body.appendChild(row);
        });
    }
    if (body) body.scrollTop = 0;
    modal.classList.remove('hidden');
}

// [B] edit by smsong - #9 목록 모달(우리의 추억 / ~의 추억 / ~의 체크리스트) 개편
//
//  바뀐 점
//   1) 썸네일 왼쪽 + 텍스트 오른쪽의 줄 목록 → 2열 사진 그리드. 사진이 주인공이 된다.
//   2) 타임라인/가볼곳과 같은 방식으로 이미지 표시 (서버 소형 썸네일 + lazy + 실패 시 원본 폴백).
//   3) 최초 5개 → 아래로 스크롤하면 로딩 폼과 함께 5개씩. DOM 에는 보이는 만큼만 유지(가상 스크롤).
//   4) 목록을 닫으면 페이지를 초기화해, 다시 열 때 항상 최신 5개부터 시작한다.
//
//  추억/가볼곳 두 목록이 같은 #list-modal-body 를 쓰므로 페이저는 하나만 만들고
//  _lmMode 로 렌더러를 갈아끼운다. (스크롤 리스너가 중복 등록되지 않는다)
var _lmMode = 'memory';
var _lmPager = null;
var _lmGrid = null;

function _lmEnsureGrid() {
    if (!_lmGrid) {
        _lmGrid = document.createElement('div');
        _lmGrid.className = 'lm-grid';
    }
    return _lmGrid;
}

// 타일 1개 — 사진 + 제목 + 메타
function _lmTileEl(item, kind) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'lm-tile';

    const cover = coverUrlOf(item);
    let art;
    if (cover) {
        // 타임라인/가볼곳 카드와 동일한 방식: 소형 썸네일 + lazy + onerror 원본 폴백
        art = '<img class="lm-tile-img" src="' + Daylog.thumbUrlOf(cover) + '" data-full="' + cover +
              '" loading="lazy" decoding="async" alt=""' +
              ' onload="this.classList.add(\'is-loaded\')" onerror="Daylog._thumbFallback(this)">';
    } else {
        art = '<span class="lm-tile-ic">' + icon(kind === 'checklist' ? 'bookmark' : 'book', 26) + '</span>';
    }

    let chip = '', meta = '';
    if (kind === 'checklist') {
        const m = (typeof checklistType === 'function') ? checklistType(item.type) : { emoji: '', label: '체크리스트', color: '#b08968' };
        chip = '<span class="lm-tile-chip' + (item.visited ? ' done' : '') + '">' +
               (item.visited ? icon('check', 11) + ' 다녀옴' : '예정') + '</span>';
        meta = escapeHtml([m.label, item.placeName || item.address || ''].filter(Boolean).join(' · '));
    } else {
        meta = escapeHtml(item.createdAt ? String(item.createdAt).substring(0, 10).replace(/-/g, '.') : '');
    }

    tile.innerHTML =
        '<span class="lm-tile-art' + (cover ? '' : ' empty') + '">' + art + chip + '</span>' +
        '<span class="lm-tile-title">' + escapeHtml(item.title || '') + '</span>' +
        '<span class="lm-tile-meta">' + meta + '</span>';

    tile.addEventListener('click', function () {
        // 목록은 그대로 두고 상세를 그 위로 (over-modal)
        if (kind === 'checklist') openChecklistDetail(item, true);
        else openDetailModal(item, true);
    });
    return tile;
}

function _lmEnsurePager() {
    if (_lmPager) return _lmPager;
    const body = document.getElementById('list-modal-body');
    if (!body || !window.DaylogFeed) return null;
    _lmPager = window.DaylogFeed.create({
        feedEl: _lmEnsureGrid(),
        scrollEl: body,
        pageSize: 5,      // 5개씩
        windowRows: 6,    // 한 줄에 2개 → 6줄이면 화면을 충분히 덮는다
        estimate: 196,    // 타일 1줄 추정 높이(px)
        emptyHtml: '',    // 비어 있을 때는 각 open 함수가 직접 채운다
        // 2개씩 묶어 한 줄로
        rowsOf: function (list) {
            var rows = [];
            for (var i = 0; i < list.length; i += 2) {
                var a = list[i], b = list[i + 1];
                rows.push({ key: 'g:' + (a && a.id) + '-' + (b ? b.id : ''), items: b ? [a, b] : [a] });
            }
            return rows;
        },
        renderRow: function (row) {
            var line = document.createElement('div');
            line.className = 'lm-grid-row';
            row.items.forEach(function (it) { line.appendChild(_lmTileEl(it, _lmMode)); });
            if (row.items.length === 1) line.appendChild(document.createElement('span')); // 빈 칸 채움
            return line;
        }
    });
    return _lmPager;
}

// 목록 모달 공통 열기 — 제목/개수 세팅 후 페이저에 넘긴다
function _lmOpen(title, items, kind, emptyHtml) {
    const modal = document.getElementById('list-modal');
    const titleEl = document.getElementById('list-modal-title');
    const body = document.getElementById('list-modal-body');
    if (!modal || !body) return;

    _lmMode = kind;
    modal.classList.remove('dday-mode');
    modal.classList.add('list-fullscreen');
    modal.classList.add('lm-grid-mode');
    titleEl.innerHTML = escapeHtml(title) +
        ((items && items.length) ? '<span class="lm-count">' + items.length + '</span>' : '');

    body.innerHTML = '';
    body.scrollTop = 0;

    if (!items || !items.length) {
        modal.classList.remove('lm-grid-mode');
        body.innerHTML = emptyHtml;
        modal.classList.remove('hidden');
        return;
    }

    body.appendChild(_lmEnsureGrid());
    modal.classList.remove('hidden');   // 먼저 보이게 해야 높이를 잴 수 있다

    const pager = _lmEnsurePager();
    if (pager) {
        pager.reset();                  // 항상 최신 5개부터
        pager.setItems(items);
    } else {
        // DaylogFeed 가 없을 때 폴백 — 전부 그린다
        const g = _lmEnsureGrid();
        g.innerHTML = '';
        for (var i = 0; i < items.length; i += 2) {
            var line = document.createElement('div');
            line.className = 'lm-grid-row';
            line.appendChild(_lmTileEl(items[i], kind));
            if (items[i + 1]) line.appendChild(_lmTileEl(items[i + 1], kind));
            g.appendChild(line);
        }
    }
}

function openMemoryListModal(title, items) {
    _lmOpen(title, items, 'memory',
        '<div class="empty-state"><span class="es-icon">' + icon('book', 40, 'color:#b08968;') + '</span><p>표시할 추억이 없습니다</p></div>');
}

// 유저별 체크리스트 목록 모달 (추억 목록과 동일한 그리드, 클릭 시 가볼곳 상세)
function openChecklistListModal(title, items) {
    Daylog._openListKind = null; // 새로고침 시 추억 목록 재구성 로직과 분리
    _lmOpen(title, items, 'checklist',
        '<div class="empty-state"><span class="es-icon">' + icon('bookmark', 40) + '</span><p>표시할 체크리스트가 없습니다</p></div>');
}

function closeListModal() {
    const modal = document.getElementById('list-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('dday-mode');
        modal.classList.remove('list-fullscreen');
        modal.classList.remove('lm-grid-mode');
    }
    // 목록을 벗어나면 펼쳐 둔 페이지를 초기화 → 다시 열면 최신 5개부터
    try { if (_lmPager) _lmPager.reset(); } catch (e) {}
    Daylog._openListKind = null;
}
// [E] edit by smsong


function showDDayInfo() {
    const modal = document.getElementById('list-modal');
    const titleEl = document.getElementById('list-modal-title');
    const body = document.getElementById('list-modal-body');
    if (!modal || !body) return;
    var since = getDdayStart();
    var canEdit = false; // [B] edit by smsong - 디데이 수정 불가(요청): 편집 입력/저장 UI 비활성화
    titleEl.innerHTML = 'D-Day';
    var html = '<div class="dday-info">';
    if (since) {
        const start = new Date(since);
        const y = start.getFullYear(), m = start.getMonth() + 1, d = start.getDate();
        const n = daysSince(since);
        // [B] edit by smsong - #4 '우리가 만난 날' 탭할 때마다 축포
        html += '<div class="dday-celebrate" id="dday-celebrate" title="탭하면 축포가 터져요">' +
                '<div class="dday-info-emoji">' + icon('calendar', 28) + '</div>' +
                '<div class="dday-info-label">우리가 만난 날 🎉</div>' +
                '<div class="dday-info-date">' + y + '년 ' + m + '월 ' + d + '일</div>' +
                '<div class="dday-info-count">오늘로 <b>D+' + n + '</b> 일째</div>' +
                '</div>';
    } else {
        html += '<div class="dday-info-emoji">' + icon('calendar', 28) + '</div>' +
                '<div class="dday-info-label">만난 날짜가 설정되지 않았어요</div>';
    }
    if (canEdit) {
        html += '<div class="dday-edit-row">' +
                    '<input id="dday-edit-input" type="date" class="dday-edit-input" value="' + (since || '') + '">' +
                    '<button type="button" id="dday-edit-save" class="dday-edit-save">저장</button>' +
                '</div>';
    }
    html += '</div>';
    body.innerHTML = html;
    // [B] edit by smsong - #4 '우리가 만난 날' 탭마다 축포 + 열릴 때 1회
    // [B] edit by smsong - #3 탭할 때마다 축포를 '겹쳐서' 추가.
    //  click 대신 pointerdown → 손가락이 닿는 즉시 터짐(모바일 click 지연/스크롤 취소 영향 없음).
    var _cel = document.getElementById('dday-celebrate');
    if (_cel) {
        var _fireEv = ('onpointerdown' in window) ? 'pointerdown' : 'click';
        _cel.addEventListener(_fireEv, function () {
            if (typeof fireWelcomeBurst === 'function') fireWelcomeBurst();
        });
        if (since) setTimeout(function () { if (typeof fireWelcomeBurst === 'function') fireWelcomeBurst(); }, 180);
    }
    // [E] edit by smsong
    if (canEdit) {
        var saveBtn = document.getElementById('dday-edit-save');
        if (saveBtn) saveBtn.addEventListener('click', saveDday);
    }
    Daylog._openListKind = null;
    modal.classList.remove('list-fullscreen'); // [smsong] 디데이는 기존 카드 스타일 유지
    modal.classList.add('dday-mode'); // 디데이 폼 내부는 드래그(당겨서 새로고침) 비활성
    if (body) body.scrollTop = 0;
    modal.classList.remove('hidden');
}

// [smsong] 방장: 디데이(만난 날짜) 저장 → 방(coupleSince) 갱신
function saveDday() {
    var input = document.getElementById('dday-edit-input');
    if (!input) return;
    var roomId = getRoomId();
    withLoading(fetch(Daylog.api + '/api/rooms/' + encodeURIComponent(roomId) + '/dday', {
        method: 'PUT', headers: Daylog.authHeaders(true),
        body: JSON.stringify({ uid: getUid(), since: input.value || '' })
    }), '저장 중...')
        .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
        .then(function (room) {
            Daylog.roomInfo = room;
            showToast('저장되었어요');
            applyDdayVisibility();
            closeListModal();
        })
        .catch(function (err) { showToast('저장 실패: ' + (err.message || '오류')); console.error(err); });
}

// 타임라인/리스트 카드의 위치 표기 채우기
function applyCardLocation(scope, memory) {
    const placeEl = scope.querySelector('.tl-place');
    const addrEl = scope.querySelector('.tl-addr');
    if (!placeEl) return;
    const place = (memory.placeName || '').trim();
    const addr = (memory.address || '').trim();
    if (place) placeEl.textContent = place;
    if (addr) addrEl.textContent = addr;

    if (!place && !addr) {
        if (memory.lat != null && memory.lng != null) {
            placeEl.textContent = '위치 확인 중…';
            reverseGeocode(memory.lat, memory.lng, (a) => {
                if (a) {
                    const sp = splitKoreanAddress(a);
                    placeEl.textContent = sp.placeName;
                    addrEl.textContent = sp.address;
                } else placeEl.textContent = '위치 정보 없음';
            });
        } else { placeEl.textContent = '위치 정보 없음'; }
    } else if (place && !addr && memory.lat != null && memory.lng != null) {
        reverseGeocode(memory.lat, memory.lng, (a) => {
            if (a) { const sp = splitKoreanAddress(a); if (sp.address) addrEl.textContent = sp.address; }
        });
    }
}
function areaOf(addr) { return String(addr || '').split(' ').slice(0, 2).join(' '); }

// [smsong] 디데이 기준일은 방(coupleSince)에서 가져옴 — 방마다 개별, 커플 방에만 적용
function getDdayStart() {
    return (typeof Daylog !== 'undefined' && Daylog.roomInfo && Daylog.roomInfo.coupleSince) ? Daylog.roomInfo.coupleSince : null;
}
// 커플 방 + 기준일 있을 때만 헤더/프로필 디데이 표시, 그 외(친구·가족·미설정)엔 숨김
function applyDdayVisibility() {
    var counter = document.querySelector('.dday-counter');
    var card = document.getElementById('stat-card-dday');
    var since = getDdayStart();
    var show = isCoupleRoom() && !!since;
    if (counter) counter.style.display = show ? '' : 'none';
    if (card) card.style.display = show ? '' : 'none';
    if (show) { var el = document.getElementById('dday-count'); if (el) el.innerText = daysSince(since); }
}
function daysSince(start) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const s = new Date(start);
    s.setHours(0, 0, 0, 0);
    return Math.floor((today.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}
function calculateDDay(start) {
    const el = document.getElementById('dday-count');
    if (el) el.innerText = daysSince(start);
}

// ==========================================================================
// [B] edit by smsong - #11 커플 기념일 축하 폼 (100일 단위 / N주년)
//
//  · 커플 방(coupleSince 설정됨)에 들어올 때 오늘이 기념일이면 축하 폼을 먼저 띄운다.
//  · 방의 모든 멤버에게 뜬다. 문구는 방에 지정된 두 사람(coupleLeftUid / coupleRightUid)의
//    닉네임으로 만들고, 보는 사람이 그 둘 중 하나면 '나 → 상대' 순으로 바꿔 부른다.
//  · 축포는 디데이 폼과 같은 WFX 엔진(fireWelcomeBurst). 폼을 탭할 때마다 더 터진다.
//  · 하단 '이 축하 다시 보지 않기'를 누르면 그 계정 + 그 방 + 그 기념일에 대해 다시 뜨지 않는다.
//
//  ※ 서버 판정과 같은 규칙: 시작일이 D+1 (daysSince). 100의 배수 = N일, 같은 월/일 = N주년.
// ==========================================================================

// 오늘이 기념일이면 { key, label, big, unit } 반환, 아니면 null
function coupleMilestoneToday(sinceStr) {
    if (!sinceStr) return null;
    var s = new Date(sinceStr);
    if (isNaN(s.getTime())) return null;
    var t = new Date();

    // 주년이 100일 단위보다 우선 (같은 날 겹치면 주년으로 축하)
    if (s.getMonth() === t.getMonth() && s.getDate() === t.getDate()) {
        var yr = t.getFullYear() - s.getFullYear();
        if (yr >= 1) return { key: 'y' + yr, label: yr + '주년', big: String(yr), unit: '주년' };
    }
    var n = daysSince(sinceStr);
    if (n > 0 && n % 100 === 0) return { key: 'd' + n, label: n + '일', big: String(n), unit: '일' };
    return null;
}

function _annivSeenKey(ms) {
    return 'daylog_anniv_seen:' + (Daylog.currentUid || '') + ':' + getRoomId() + ':' + ms.key;
}

// 커플 슬롯 두 사람의 표시 이름 (닉네임 우선)
function _coupleNames() {
    var r = Daylog.roomInfo || {};
    var members = r.members || [];
    function nameOf(uid) {
        if (!uid) return '';
        var m = members.find(function (x) { return x && x.uid === uid; });
        if (!m) return '';
        var nk = (m.nickname && String(m.nickname).trim()) ? m.nickname : '';
        if (nk) return nk;
        return (typeof normalizeDisplayName === 'function') ? normalizeDisplayName(m.name) : (m.name || '');
    }
    return { left: nameOf(r.coupleLeftUid), right: nameOf(r.coupleRightUid),
             leftUid: r.coupleLeftUid, rightUid: r.coupleRightUid };
}

function closeAnnivModal() {
    var el = document.getElementById('anniv-modal');
    if (el && el.parentNode) el.parentNode.removeChild(el);
}

function showAnnivModal(ms) {
    closeAnnivModal();
    var c = _coupleNames();
    var me = Daylog.currentUid;

    // 보는 사람이 커플 중 하나면 '나 → 상대' 순으로
    var a = c.left, b = c.right;
    if (me && me === c.rightUid) { a = c.right; b = c.left; }
    var headline;
    if (a && b) {
        headline = (me === c.leftUid || me === c.rightUid)
            ? escapeHtml(a) + '님, ' + escapeHtml(b) + '님과 ' + ms.label + '이에요 🎉'
            : escapeHtml(a) + '님과 ' + escapeHtml(b) + '님, ' + ms.label + '이에요 🎉';
    } else {
        headline = '오늘은 ' + ms.label + '이에요 🎉';
    }

    var since = getDdayStart();
    var sub = '';
    if (since) {
        var s = new Date(since);
        sub = s.getFullYear() + '년 ' + (s.getMonth() + 1) + '월 ' + s.getDate() + '일부터 오늘까지';
    }

    var ov = document.createElement('div');
    ov.id = 'anniv-modal';
    ov.innerHTML =
        '<div class="anniv-card" role="dialog" aria-modal="true" aria-label="' + escapeHtml(ms.label) + ' 축하">' +
            '<button type="button" class="anniv-x" id="anniv-x" aria-label="닫기">&times;</button>' +
            '<div class="anniv-medal"><span class="anniv-big">' + escapeHtml(ms.big) + '</span>' +
                '<span class="anniv-unit">' + escapeHtml(ms.unit) + '</span></div>' +
            '<h3 class="anniv-title">' + headline + '</h3>' +
            (sub ? '<p class="anniv-sub">' + escapeHtml(sub) + '</p>' : '') +
            '<button type="button" class="anniv-nomore" id="anniv-nomore">이 축하 다시 보지 않기</button>' +
        '</div>';
    document.body.appendChild(ov);

    // 탭할 때마다 축포가 겹쳐 터지도록 (디데이 폼과 동일한 방식).
    //  닫기(×)와 '다시 보지 않기'는 제외 — 누르면 축포 대신 그 동작만 한다.
    var fireEv = ('onpointerdown' in window) ? 'pointerdown' : 'click';
    ov.querySelector('.anniv-card').addEventListener(fireEv, function (e) {
        if (e.target && e.target.closest && e.target.closest('.anniv-x, .anniv-nomore')) return;
        if (typeof fireWelcomeBurst === 'function') fireWelcomeBurst();
    });
    setTimeout(function () { if (typeof fireWelcomeBurst === 'function') fireWelcomeBurst(); }, 200);

    // '이 축하 다시 보지 않기' → 저장하고 바로 닫는다
    document.getElementById('anniv-nomore').addEventListener('click', function () {
        try { localStorage.setItem(_annivSeenKey(ms), '1'); } catch (e) {}
        closeAnnivModal();
    });
    // 닫기(×) / 바깥 탭 → 저장 없이 닫기 (다음에 이 방에 들어오면 다시 뜬다)
    document.getElementById('anniv-x').addEventListener('click', closeAnnivModal);
    ov.addEventListener('click', function (e) { if (e.target === ov) closeAnnivModal(); });
}

// 방에 들어올 때 호출 — 오늘이 기념일이고 아직 '그만 보기'를 누르지 않았다면 띄운다
function maybeShowAnniversary() {
    try {
        if (!isCoupleRoom()) return;
        var since = getDdayStart();
        if (!since) return;
        var ms = coupleMilestoneToday(since);
        if (!ms) return;
        if (localStorage.getItem(_annivSeenKey(ms))) return;
    } catch (e) { return; }

    // 다른 모달(환영/닉네임/알림 동의 등)이 떠 있으면 양보했다가 다시 시도
    var tries = 0;
    (function wait() {
        var busy = document.querySelector('#pc-overlay, .modal:not(.hidden), .room-modal:not(.hidden)');
        if (!busy) { showAnnivModal(ms); return; }
        if (tries++ > 12) return;   // 약 6초 대기 후 포기 (다음 진입 때 다시 시도)
        setTimeout(wait, 500);
    })();
}
Daylog.maybeShowAnniversary = maybeShowAnniversary;
// [E] edit by smsong


// ===== 사진 편집(크롭/줌) 상태 & 제어 =====
const _crop = { natW: 0, natH: 0, base: 1, zoom: 1, x: 0, y: 0, size: 0, onDone: null, url: null, dragging: false, sx: 0, sy: 0, bx: 0, by: 0, sourceInput: null /* [smsong] 취소 시 갤러리 재오픈 소스 */ };

function openCropper(file, onDone) {
    const modal = document.getElementById('crop-modal');
    const img = document.getElementById('crop-img');
    if (!modal || !img) { if (onDone) onDone(file); return; } // 크롭 UI 없으면 원본 사용
    _crop.onDone = onDone;
    if (_crop.url) URL.revokeObjectURL(_crop.url);
    _crop.url = URL.createObjectURL(file);

    img.onload = () => {
        modal.classList.remove('hidden');
        // 모달이 보인 뒤 실제 크기 측정
        requestAnimationFrame(() => {
            const stage = document.getElementById('crop-stage');
            const size = stage.getBoundingClientRect().width || 260;
            _crop.size = size;
            _crop.natW = img.naturalWidth;
            _crop.natH = img.naturalHeight;
            _crop.base = size / Math.min(img.naturalWidth, img.naturalHeight); // cover
            _crop.zoom = 1;
            const zoomEl = document.getElementById('crop-zoom');
            if (zoomEl) zoomEl.value = 1;
            const rw = _crop.natW * _crop.base, rh = _crop.natH * _crop.base;
            _crop.x = (size - rw) / 2;
            _crop.y = (size - rh) / 2;
            applyCropTransform();
        });
    };
    img.src = _crop.url;
}

function applyCropTransform() {
    const img = document.getElementById('crop-img');
    if (!img) return;
    const s = _crop.base * _crop.zoom;
    const rw = _crop.natW * s, rh = _crop.natH * s;
    // 크롭 영역(정사각형)을 항상 가득 채우도록 위치 제한
    _crop.x = Math.min(0, Math.max(_crop.size - rw, _crop.x));
    _crop.y = Math.min(0, Math.max(_crop.size - rh, _crop.y));
    img.style.width = rw + 'px';
    img.style.height = rh + 'px';
    img.style.left = _crop.x + 'px';
    img.style.top = _crop.y + 'px';
}

function setCropZoom(newZoom) {
    const oldS = _crop.base * _crop.zoom;
    const newS = _crop.base * newZoom;
    const cx = _crop.size / 2, cy = _crop.size / 2;
    const imgX = (cx - _crop.x) / oldS, imgY = (cy - _crop.y) / oldS;
    _crop.zoom = newZoom;
    _crop.x = cx - imgX * newS;
    _crop.y = cy - imgY * newS;
    const zoomEl = document.getElementById('crop-zoom');
    if (zoomEl) zoomEl.value = newZoom;
    applyCropTransform();
}

function cropApply() {
    const img = document.getElementById('crop-img');
    const s = _crop.base * _crop.zoom;
    const sx = (0 - _crop.x) / s;
    const sy = (0 - _crop.y) / s;
    const sSize = _crop.size / s;
    // 잘라낼 영역의 실제(원본) 해상도를 유지 → 확대(라이트박스) 시 원본 크기로 표시
    const out = Math.max(512, Math.min(Math.round(sSize), 1600));
    const canvas = document.createElement('canvas');
    canvas.width = out; canvas.height = out;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, out, out);
    canvas.toBlob((blob) => {
        const cb = _crop.onDone;
        closeCropper();
        if (blob && cb) cb(new File([blob], 'profile.jpg', { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.92);
}

function closeCropper() {
    const modal = document.getElementById('crop-modal');
    if (modal) modal.classList.add('hidden');
    if (_crop.url) { URL.revokeObjectURL(_crop.url); _crop.url = null; }
    _crop.onDone = null;
    _crop.sourceInput = null; // [B] edit by smsong - 갤러리 재오픈 소스 정리 / [E] edit by smsong
}

// ===== 추억 사진 편집기 (자르기 + 회전) =====
const _ped = { url: null, img: null, natW: 0, natH: 0, stageW: 0, stageH: 0, dispScale: 1, dispX: 0, dispY: 0, crop: { x: 0, y: 0, w: 0, h: 0 }, onDone: null, drag: null };

function openPhotoEditor(file, onDone) {
    const modal = document.getElementById('photo-editor-modal');
    const imEl = document.getElementById('pe-img');
    if (!modal || !imEl || !file) { if (onDone) onDone(file); return; }
    _ped.onDone = onDone;
    if (_ped.url) URL.revokeObjectURL(_ped.url);
    _ped.url = URL.createObjectURL(file);

    const im = new Image();
    im.onload = () => {
        _ped.img = im;
        _ped.natW = im.naturalWidth;
        _ped.natH = im.naturalHeight;
        imEl.src = _ped.url;
        modal.classList.remove('hidden');
        requestAnimationFrame(() => peLayout(true));
    };
    im.src = _ped.url;
}

function peLayout(resetCrop) {
    const stage = document.getElementById('pe-stage');
    const imEl = document.getElementById('pe-img');
    if (!stage || !imEl) return;
    _ped.stageW = stage.clientWidth;
    _ped.stageH = stage.clientHeight;
    _ped.dispScale = Math.min(_ped.stageW / _ped.natW, _ped.stageH / _ped.natH) || 1;
    const dw = _ped.natW * _ped.dispScale, dh = _ped.natH * _ped.dispScale;
    _ped.dispX = (_ped.stageW - dw) / 2;
    _ped.dispY = (_ped.stageH - dh) / 2;
    imEl.style.left = _ped.dispX + 'px';
    imEl.style.top = _ped.dispY + 'px';
    imEl.style.width = dw + 'px';
    imEl.style.height = dh + 'px';
    if (resetCrop) _ped.crop = { x: _ped.dispX, y: _ped.dispY, w: dw, h: dh };
    peApplyCropStyle();
}

function peApplyCropStyle() {
    const box = document.getElementById('pe-crop');
    if (!box) return;
    box.style.left = _ped.crop.x + 'px';
    box.style.top = _ped.crop.y + 'px';
    box.style.width = _ped.crop.w + 'px';
    box.style.height = _ped.crop.h + 'px';
}

function peClampCrop() {
    const minX = _ped.dispX, minY = _ped.dispY;
    const maxX = _ped.dispX + _ped.natW * _ped.dispScale;
    const maxY = _ped.dispY + _ped.natH * _ped.dispScale;
    const c = _ped.crop;
    const MIN = 40;
    c.w = Math.max(MIN, Math.min(c.w, maxX - minX));
    c.h = Math.max(MIN, Math.min(c.h, maxY - minY));
    c.x = Math.max(minX, Math.min(c.x, maxX - c.w));
    c.y = Math.max(minY, Math.min(c.y, maxY - c.h));
}

function peRotate() {
    if (!_ped.img) return;
    const c = document.createElement('canvas');
    c.width = _ped.natH; c.height = _ped.natW;
    const cx = c.getContext('2d');
    cx.translate(c.width / 2, c.height / 2);
    cx.rotate(Math.PI / 2);
    cx.drawImage(_ped.img, -_ped.natW / 2, -_ped.natH / 2);
    const data = c.toDataURL('image/jpeg', 0.95);
    const im = new Image();
    im.onload = () => {
        _ped.img = im; _ped.natW = im.naturalWidth; _ped.natH = im.naturalHeight;
        const imEl = document.getElementById('pe-img');
        if (imEl) imEl.src = data;
        peLayout(true);
    };
    im.src = data;
}

function peApply() {
    if (!_ped.img) return;
    const sx = (_ped.crop.x - _ped.dispX) / _ped.dispScale;
    const sy = (_ped.crop.y - _ped.dispY) / _ped.dispScale;
    const sw = _ped.crop.w / _ped.dispScale;
    const sh = _ped.crop.h / _ped.dispScale;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw));
    c.height = Math.max(1, Math.round(sh));
    const cx = c.getContext('2d');
    cx.drawImage(_ped.img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    c.toBlob((blob) => {
        const cb = _ped.onDone;
        closePhotoEditor();
        if (blob && cb) cb(new File([blob], 'memory_' + Date.now() + '.jpg', { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.92);
}

function closePhotoEditor() {
    const modal = document.getElementById('photo-editor-modal');
    if (modal) modal.classList.add('hidden');
    if (_ped.url) { URL.revokeObjectURL(_ped.url); _ped.url = null; }
    _ped.onDone = null; _ped.drag = null;
}

// ============================================================
//  다중 이미지 공용 모듈 — 미리보기 그리드(✕삭제·꾹눌러 드래그 정렬) + 캐러셀
// ============================================================
const MEDIA_MAX = 10;

// obj: 추억/가볼곳 객체 → 이미지 URL 배열(첫 장이 대표)
function mediaUrlsOf(obj) {
    if (!obj) return [];
    if (Array.isArray(obj.mediaUrls) && obj.mediaUrls.length) return obj.mediaUrls.filter(Boolean);
    if (obj.mediaURL) return [obj.mediaURL];
    return [];
}

// [B] edit by smsong - 목록/마커 썸네일용 대표(첫) 이미지 URL.
//  다중 이미지(mediaUrls) 기록이면 첫 장, 단일이면 mediaURL. → 여러 장 기록의 썸네일 누락 해결.
function coverUrlOf(obj) {
    var arr = mediaUrlsOf(obj);
    return arr.length ? arr[0] : null;
}

function createMediaManager(opts) {
    const grid = opts.grid, input = opts.input, onTileTap = opts.onTileTap;
    let items = []; // { kind:'url'|'file', url?, file?, _obj? }

    function objURL(it) {
        if (it.kind === 'url') return it.url;
        if (!it._obj) it._obj = URL.createObjectURL(it.file);
        return it._obj;
    }
    function revokeAll() { items.forEach(it => { if (it._obj) { try { URL.revokeObjectURL(it._obj); } catch (_) {} it._obj = null; } }); }
    function reset(initial) { revokeAll(); items = (initial || []).slice(); render(); }
    function count() { return items.length; }
    function addFiles(fileList) {
        const files = Array.from(fileList || []);
        for (const f of files) {
            if (!f || !f.type || f.type.indexOf('image/') !== 0) continue;
            if (items.length >= MEDIA_MAX) { showToast('이미지는 최대 ' + MEDIA_MAX + '장까지 첨부할 수 있습니다'); break; }
            items.push({ kind: 'file', file: f });
        }
        render();
    }
    function replaceAt(i, f) {
        if (!items[i]) return;
        if (items[i]._obj) { try { URL.revokeObjectURL(items[i]._obj); } catch (_) {} }
        items[i] = { kind: 'file', file: f };
        render();
    }
    function removeAt(i) {
        const it = items[i];
        if (it && it._obj) { try { URL.revokeObjectURL(it._obj); } catch (_) {} }
        items.splice(i, 1);
        render();
    }
    function getNewFiles() { return items.filter(it => it.kind === 'file').map(it => it.file); }
    function getMediaOrder() { return items.map(it => it.kind === 'url' ? it.url : '$NEW$'); }

    function render() {
        if (!grid) return;
        grid.innerHTML = '';
        items.forEach((it, i) => {
            const tile = document.createElement('div');
            tile.className = 'media-tile';
            tile.dataset.idx = i;
            tile._item = it;
            tile.style.backgroundImage = "url('" + objURL(it) + "')";
            if (i === 0) { const b = document.createElement('span'); b.className = 'media-cover'; b.textContent = '대표'; tile.appendChild(b); }
            const rm = document.createElement('button');
            rm.type = 'button'; rm.className = 'media-remove'; rm.innerHTML = '&times;';
            rm.addEventListener('click', (e) => { e.stopPropagation(); removeAt(i); });
            tile.appendChild(rm);
            if (onTileTap) tile.addEventListener('click', (e) => { if (e.target.closest('.media-remove')) return; if (!grid._didDrag) onTileTap(it, i, replaceAt); });
            grid.appendChild(tile);
        });
        if (items.length < MEDIA_MAX) {
            const add = document.createElement('button');
            add.type = 'button'; add.className = 'media-add'; add.innerHTML = '<span>＋</span>';
            add.addEventListener('click', () => { if (input) input.click(); });
            grid.appendChild(add);
        }
    }

    // 꾹 눌러(롱프레스) 드래그 → 순서 변경 (마우스/터치 공통). DOM 노드를 직접 이동해 포인터 캡처 유지.
    if (grid && !grid._reorderBound) {
        grid._reorderBound = true;
        let pressTimer = null, dragNode = null, isDragging = false, sx = 0, sy = 0;
        grid.addEventListener('pointerdown', (e) => {
            const tile = e.target.closest('.media-tile');
            if (!tile || e.target.closest('.media-remove')) return;
            sx = e.clientX; sy = e.clientY; grid._didDrag = false;
            clearTimeout(pressTimer);
            pressTimer = setTimeout(() => {
                isDragging = true; dragNode = tile; grid._didDrag = true;
                tile.classList.add('dragging');
                try { tile.setPointerCapture(e.pointerId); } catch (_) {}
            }, 200);
        });
        grid.addEventListener('pointermove', (e) => {
            if (!isDragging) {
                if (pressTimer && (Math.abs(e.clientX - sx) > 12 || Math.abs(e.clientY - sy) > 12)) { clearTimeout(pressTimer); pressTimer = null; }
                return;
            }
            e.preventDefault();
            const el = document.elementFromPoint(e.clientX, e.clientY);
            const over = el && el.closest ? el.closest('.media-tile') : null;
            if (over && over !== dragNode && over.parentElement === grid) {
                const r = over.getBoundingClientRect();
                const after = (e.clientX - r.left) > r.width / 2;
                grid.insertBefore(dragNode, after ? over.nextSibling : over);
            }
        }, { passive: false });
        const endDrag = () => {
            clearTimeout(pressTimer); pressTimer = null;
            if (isDragging) {
                isDragging = false;
                if (dragNode) dragNode.classList.remove('dragging');
                // DOM 순서 → items 재구성
                const tiles = Array.from(grid.querySelectorAll('.media-tile'));
                items = tiles.map(t => t._item).filter(Boolean);
                dragNode = null;
                render();
                setTimeout(() => { grid._didDrag = false; }, 50);
            }
        };
        grid.addEventListener('pointerup', endDrag);
        grid.addEventListener('pointercancel', endDrag);
    }

    return { reset, addFiles, replaceAt, removeAt, count, getNewFiles, getMediaOrder, render };
}

// 상세 화면 캐러셀 HTML
// [B] edit by smsong - 상세 이미지 캐러셀: JS transform → REMS식 네이티브 CSS scroll-snap.
//  트랙 자체가 가로 스크롤(scroll-snap)로 넘어가므로 세로 페이지 스크롤은 브라우저가 자연 처리 →
//  버벅임/포인터 캡처 이슈 없이 부드럽고, 손가락 세로 스크롤도 정상. 이미지는 decoding=async + onerror.
function carouselHtml(urls) {
    if (!urls || !urls.length) return '';
    if (urls.length === 1) {
        return '<div class="detail-image-wrap"><img src="' + urls[0] + '" alt="사진" class="detail-single-img" decoding="async"></div>';
    }
    const cid = 'car-' + Math.random().toString(36).slice(2);
    let slides = '';
    urls.forEach((u, i) => {
        // [B] edit by smsong - 첫 장만 즉시 로드, 나머지는 loading="lazy" → 이미지 개수와 무관하게 상세가 즉시 열림.
        //  (네이티브 scroll-snap 이라 넘길 때 해당 슬라이드만 로드됨)
        slides += '<div class="carousel-slide"><img src="' + u + '" alt="사진" decoding="async"' +
            (i === 0 ? ' onload="Daylog._fitCarousel(\'' + cid + '\', this)"' : ' loading="lazy"') +
            ' onerror="this.parentElement.style.display=\'none\'"></div>';
    });
    let dots = '';
    urls.forEach((u, i) => { dots += '<span class="carousel-dot' + (i === 0 ? ' active' : '') + '" data-i="' + i + '"></span>'; });
    return '<div class="detail-carousel">' +
        '<div class="carousel-count"><span class="cc-cur">1</span>/' + urls.length + '</div>' +
        '<div class="carousel-track" id="' + cid + '">' + slides + '</div>' +
        '<button type="button" class="carousel-arrow prev" disabled>&#8249;</button>' +
        '<button type="button" class="carousel-arrow next">&#8250;</button>' +
        '<div class="carousel-dots">' + dots + '</div>' +
        '</div>';
}

// [B] edit by smsong - #7 사진 무대 높이를 '첫 장의 실제 비율'에 맞춘다.
//
//  고정 높이(46dvh)로 두면 세로 사진이 위아래로 잘려 답답했다.
//  이제 첫 사진의 naturalWidth/Height 로 필요한 높이를 계산해 인라인으로 넣는다.
//   · 하한 MIN_VH — 파노라마처럼 납작한 사진도 이보다 얇아지지 않게(제목만 덩그러니 뜨는 것 방지)
//   · 상한 MAX_VH — 세로 사진 상한. 그 아래 제목/본문 첫 줄이 최소한 보이도록 남겨 둔다.
//  비율이 이 범위 안이면 object-fit:cover 여도 잘리는 부분이 전혀 없다.
//  범위를 벗어나는 극단적인 사진만 가운데 기준으로 잘리고, 탭하면 라이트박스에서 원본 전체를 본다.
//
//  ★ 답답하면 MAX_VH 만 올리십시오 (0.82 ≈ 화면의 82%).
(function () {
    'use strict';
    var MIN_VH = 0.38;
    var MAX_VH = 0.78;

    function vh() { return window.innerHeight || document.documentElement.clientHeight || 700; }

    function sizeStage(stage, ratio) {
        var w = stage.clientWidth || stage.offsetWidth;
        if (!w || !ratio) return;
        var v = vh();
        var h = Math.round(Math.max(v * MIN_VH, Math.min(v * MAX_VH, w * ratio)));
        stage.style.height = h + 'px';
        stage.style.minHeight = h + 'px';
    }

    Daylog._fitDetailStage = function (root) {
        if (!root) return;
        var stage = root.querySelector('.dtl-stage');
        if (!stage || stage.classList.contains('empty')) return;
        var img = stage.querySelector('img');
        if (!img) return;

        function apply() {
            if (!img.naturalWidth || !img.naturalHeight) return;
            var ratio = img.naturalHeight / img.naturalWidth;
            stage.setAttribute('data-ratio', ratio);
            sizeStage(stage, ratio);
        }
        if (img.complete && img.naturalWidth) apply();
        else img.addEventListener('load', apply, { once: true });
    };

    // 화면 회전/리사이즈 시 다시 계산 (리스너는 1개만)
    window.addEventListener('resize', function () {
        var list = document.querySelectorAll('.dtl-stage[data-ratio]');
        for (var i = 0; i < list.length; i++) {
            sizeStage(list[i], parseFloat(list[i].getAttribute('data-ratio')));
        }
    });
})();
// [E] edit by smsong

// 첫 이미지 비율로 트랙 높이 설정 → 레이아웃 시프트(깜빡임) 방지 (REMS fitGalleryHeight 방식)
Daylog._fitCarousel = function (cid, img) {
    const track = document.getElementById(cid);
    if (!track || !img || !img.naturalWidth) return;
    const w = track.clientWidth || track.offsetWidth;
    if (!w) return;
    let h = w * img.naturalHeight / img.naturalWidth;
    const maxH = Math.round(window.innerHeight * 0.7);
    if (h > maxH) h = maxH;
    track.style.height = Math.round(h) + 'px';
};

// 캐러셀 동작 바인딩 (네이티브 스크롤 + 화살표/점 + 탭→라이트박스)
function bindCarousel(rootEl, urls) {
    if (!rootEl) return;
    const single = rootEl.querySelector('.detail-single-img');
    if (single) { single.addEventListener('click', () => openLightbox(urls, single, 0)); return; }
    const car = rootEl.querySelector('.detail-carousel');
    if (!car) return;
    const track = car.querySelector('.carousel-track');
    const slides = car.querySelectorAll('.carousel-slide');
    const dots = car.querySelectorAll('.carousel-dot');
    const prev = car.querySelector('.carousel-arrow.prev');
    const next = car.querySelector('.carousel-arrow.next');
    const cur = car.querySelector('.cc-cur');
    const total = urls.length;
    if (!track) return;

    function curIdx() {
        const w = track.clientWidth || 1;
        return Math.max(0, Math.min(total - 1, Math.round(track.scrollLeft / w)));
    }
    function update() {
        const idx = curIdx();
        dots.forEach((d, di) => d.classList.toggle('active', di === idx));
        if (prev) prev.disabled = idx === 0;
        if (next) next.disabled = idx === total - 1;
        if (cur) cur.textContent = (idx + 1);
    }
    function goTo(i) {
        const idx = Math.max(0, Math.min(total - 1, i));
        const w = track.clientWidth || 1;
        track.scrollTo({ left: idx * w, behavior: 'smooth' });
    }
    // 스크롤 위치 → 카운터/점 갱신 (rAF 스로틀로 부드럽게)
    let ticking = false;
    track.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => { update(); ticking = false; });
    }, { passive: true });

    if (prev) prev.addEventListener('click', () => goTo(curIdx() - 1));
    if (next) next.addEventListener('click', () => goTo(curIdx() + 1));
    dots.forEach(d => d.addEventListener('click', () => goTo(+d.dataset.i)));
    // 탭 → 라이트박스 (네이티브 스크롤은 드래그 시 click 을 발생시키지 않으므로 moved 추적 불필요)
    slides.forEach((s, si) => {
        const img = s.querySelector('img');
        if (img) img.addEventListener('click', () => openLightbox(urls, img, si));
    });
    update();
}

// ===== 라이트박스 상태 & 제어 =====
const _lb = { scale: 1, x: 0, y: 0, dragging: false, sx: 0, sy: 0, bx: 0, by: 0, moved: false, originRect: null, targetRect: null, animating: false, list: [], idx: 0, swiping: false, swStartX: 0, swStartY: 0 };
function _lbApply() {
    const img = document.getElementById('lightbox-img');
    if (img) img.style.transform = 'translate(' + _lb.x + 'px, ' + _lb.y + 'px) scale(' + _lb.scale + ')';
}
// 라이트박스 좌우 이동 UI 갱신
function _lbUpdateNav() {
    const prev = document.getElementById('lightbox-prev');
    const next = document.getElementById('lightbox-next');
    const counter = document.getElementById('lightbox-counter');
    const many = _lb.list && _lb.list.length > 1;
    if (prev) prev.classList.toggle('hidden', !many || _lb.idx <= 0);
    if (next) next.classList.toggle('hidden', !many || _lb.idx >= _lb.list.length - 1);
    if (counter) {
        counter.classList.toggle('hidden', !many);
        if (many) counter.textContent = (_lb.idx + 1) + ' / ' + _lb.list.length;
    }
}
// 라이트박스에서 다른 이미지로 전환 (확대 상태 초기화)
function _lbShow(idx) {
    if (!_lb.list || !_lb.list.length) return;
    _lb.idx = Math.max(0, Math.min(_lb.list.length - 1, idx));
    const img = document.getElementById('lightbox-img');
    if (!img) return;
    _lb.scale = 1; _lb.x = 0; _lb.y = 0;
    _lb.originRect = null; // 전환 후에는 제자리 축소 애니메이션 생략
    img.style.transition = 'opacity 0.15s ease';
    img.style.opacity = '0';
    setTimeout(() => {
        img.src = _lb.list[_lb.idx];
        img.style.transform = 'none';
        img.style.borderRadius = '0';
        img.onload = () => { img.onload = null; img.style.opacity = '1'; };
        if (img.complete && img.naturalWidth) img.style.opacity = '1';
    }, 150);
    _lbUpdateNav();
}
function _rectOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
}
// 메타(스레드/인스타)식: 원본 위치에서 확대되어 나타나고, 닫을 때 제자리로 축소
function openLightbox(srcOrList, originEl, index) {
    const list = Array.isArray(srcOrList) ? srcOrList.filter(Boolean) : (srcOrList ? [srcOrList] : []);
    if (!list.length) return;
    _lb.list = list;
    _lb.idx = Math.max(0, Math.min(list.length - 1, index || 0));
    const src = list[_lb.idx];
    const lb = document.getElementById('lightbox');
    const img = document.getElementById('lightbox-img');
    const hint = document.getElementById('lightbox-hint');
    if (!lb || !img) return;

    _lbUpdateNav();

    if (img) img.style.opacity = '1';
    _lb.scale = 1; _lb.x = 0; _lb.y = 0;
    _lb.originRect = (originEl && originEl.getBoundingClientRect) ? _rectOf(originEl) : null;
    if (hint) hint.style.opacity = '1';

    const runAnim = () => {
        // 확대된 최종(target) 위치 측정
        img.style.transition = 'none';
        img.style.transform = 'none';
        img.style.borderRadius = '0';
        const target = _rectOf(img);
        _lb.targetRect = target;
        const o = _lb.originRect;
        if (o && target.w && target.h) {
            const scale = Math.max(o.w / target.w, o.h / target.h);
            const tx = o.cx - target.cx, ty = o.cy - target.cy;
            img.style.transformOrigin = 'center center';
            img.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
            img.style.borderRadius = '50%';
            void img.offsetWidth; // reflow
            img.style.transition = 'transform 0.34s cubic-bezier(.22,.61,.36,1), border-radius 0.34s ease';
            requestAnimationFrame(() => {
                img.style.transform = 'translate(0px,0px) scale(1)';
                img.style.borderRadius = '0';
            });
        } else {
            img.style.transition = 'transform 0.2s var(--ease-soft)';
        }
    };

    lb.classList.remove('hidden');
    lb.style.opacity = '';
    if (img.src !== src) {
        img.onload = () => { img.onload = null; runAnim(); };
        img.src = src;
        if (img.complete && img.naturalWidth) { img.onload = null; runAnim(); }
    } else {
        runAnim();
    }
}
function closeLightbox() {
    const lb = document.getElementById('lightbox');
    if (!lb || lb.classList.contains('hidden')) return;
    const img = document.getElementById('lightbox-img');

    // 확대(줌) 상태였다면 먼저 원위치
    _lb.scale = 1; _lb.x = 0; _lb.y = 0;

    const o = _lb.originRect, target = _lb.targetRect;
    if (img && o && target && target.w && target.h) {
        const scale = Math.max(o.w / target.w, o.h / target.h);
        const tx = o.cx - target.cx, ty = o.cy - target.cy;
        img.style.transition = 'transform 0.3s cubic-bezier(.4,0,.2,1), border-radius 0.3s ease';
        img.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
        img.style.borderRadius = '50%';
        lb.style.transition = 'opacity 0.3s ease';
        lb.style.opacity = '0';
        setTimeout(() => {
            lb.classList.add('hidden');
            lb.style.opacity = '';
            lb.style.transition = '';
            if (img) { img.src = ''; img.style.transition = ''; img.style.transform = ''; img.style.borderRadius = ''; img.style.opacity = ''; }
            _lb.originRect = null; _lb.targetRect = null;
        }, 300);
    } else {
        lb.classList.add('hidden');
        if (img) { img.src = ''; img.style.transform = ''; img.style.borderRadius = ''; img.style.opacity = ''; }
        _lb.originRect = null; _lb.targetRect = null;
    }
}

let _toastTimer = null;
function showToast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.innerText = msg;
    t.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// ==========================================
// 4. 신규 모달(상세 수정 / 리스트) 이벤트 바인딩
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // ===== 다중 이미지 매니저 초기화 (생성/수정 4종) =====
    const _mkMgr = (gridId, inputId, onTileTap) => {
        const grid = document.getElementById(gridId);
        const input = document.getElementById(inputId);
        if (!grid) return null;
        const mgr = createMediaManager({ grid, input, onTileTap });
        if (input) input.addEventListener('change', (e) => { mgr.addFiles(e.target.files); e.target.value = ''; });
        return mgr;
    };
    window._memCreateMgr = _mkMgr('memory-media-grid', 'memory-media-input',
        (it, i, replaceAt) => { if (it.kind === 'file' && typeof openPhotoEditor === 'function') openPhotoEditor(it.file, (nf) => replaceAt(i, nf)); });
    window._clCreateMgr = _mkMgr('cl-media-grid', 'cl-image');
    window._memEditMgr = _mkMgr('edit-media-grid', 'edit-media-input');
    window._clEditMgr = _mkMgr('cl-edit-media-grid', 'cl-edit-image-file');

    // 상세 수정 폼
    const detailEditForm = document.getElementById('detail-edit-form');
    if (detailEditForm) {
        detailEditForm.addEventListener('submit', (e) => { e.preventDefault(); saveDetailEdit(); });
    }
    const detailEditCancel = document.getElementById('detail-edit-cancel');
    if (detailEditCancel) detailEditCancel.addEventListener('click', exitDetailEdit);

    // 리스트 모달 닫기 (배경 클릭 / X 버튼)
    const listModal = document.getElementById('list-modal');
    if (listModal) {
        listModal.addEventListener('click', (e) => { if (e.target.id === 'list-modal') closeListModal(); });
    }
    const listClose = document.getElementById('list-modal-close');
    if (listClose) listClose.addEventListener('click', closeListModal);

    // 휴지통 모달 닫기 (배경 클릭 / X 버튼)
    const trashModal = document.getElementById('trash-modal');
    if (trashModal) {
        trashModal.addEventListener('click', (e) => { if (e.target.id === 'trash-modal') closeTrashModal(); });
    }
    const trashClose = document.getElementById('trash-modal-close');
    if (trashClose) trashClose.addEventListener('click', closeTrashModal);

    // ESC 로 리스트 모달도 닫기
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeListModal(); closeTrashModal(); } });
});

// ==========================================================================
// [B] edit by smsong - #13 체크리스트 달력 / 일정 / 보관함 / 선택 모드
//
//  · 체크리스트 탭에 타임라인과 같은 [목록 | 달력] 전환을 붙인다.
//  · 달력에는 두 종류가 올라간다.
//      - 일정(schedule)      : /api/schedules        — 무엇을 할지 기록
//      - 체크리스트(plannedDate): /api/checklists/calendar/{uid} — 갈 예정일
//    체크리스트는 '보관함 포함' 엔드포인트를 쓴다. 다녀와서 보관된 곳도 달력엔 남아야 하므로.
//  · 빈 날짜를 누르면 일정 추가 폼, 뭔가 있는 날짜를 누르면 그날의 목록 폼이 뜬다.
//  · 보관함은 [설정 > 휴지통] 바로 위 버튼으로 연다. 보관함/휴지통 모두 선택 모드로
//    여러 건을 한 번에 처리할 수 있고, 영구 삭제 시에만 달력 경고를 띄운다.
//
//  DOM 은 전부 여기서 주입한다(main.html 무수정). CSS 도 <style id="cw-style"> 로 주입.
// ==========================================================================
(function () {
    'use strict';

    var PERM_WARN = '영구 삭제하면 체크리스트 달력에서도 사라집니다.\n계속하시겠습니까?';

    var _schedules = [];   // 방의 일정
    var _calCls = [];      // 달력용 체크리스트 (보관함 포함)
    var _clView = 'calendar';  // list | calendar — [B][E] edit by smsong - #15 기본은 달력
    var _cy = null, _cm = null;
    var _sel = null;              // 선택된 날짜 (YYYY-MM-DD)
    var _pendingPlanned = null;   // 달력에서 체크리스트를 추가할 때 넘길 갈 예정일
    var _loaded = false;

    function api() { return Daylog.api; }
    function hdr(json) { return Daylog.authHeaders(json); }
    function esc(s) { return escapeHtml(s == null ? '' : String(s)); }
    function ymd(d) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    function dkey(v) { return v ? String(v).substring(0, 10) : ''; }

    // ===================== 데이터 =====================
    function loadCalendarData(force) {
        if (_loaded && !force) return Promise.resolve();
        var uid = Daylog.currentUid;
        if (!uid) return Promise.resolve();
        return Promise.all([
            fetch(api() + '/api/schedules/' + encodeURIComponent(uid), { headers: hdr(true) })
                .then(Daylog.handleResponse).catch(function () { return []; }),
            fetch(api() + '/api/checklists/calendar/' + encodeURIComponent(uid), { headers: hdr(true) })
                .then(Daylog.handleResponse).catch(function () { return []; })
        ]).then(function (r) {
            _schedules = r[0] || [];
            _calCls = (r[1] || []).filter(function (c) { return !!c.plannedDate; });
            _loaded = true;
        });
    }

    // 날짜별로 묶기 → { 'YYYY-MM-DD': { s:[일정], c:[체크리스트] } }
    function groupByDate() {
        var g = {};
        function slot(k) { return (g[k] = g[k] || { s: [], c: [] }); }
        _schedules.forEach(function (x) { var k = dkey(x.scheduleDate); if (k) slot(k).s.push(x); });
        _calCls.forEach(function (x) { var k = dkey(x.plannedDate); if (k) slot(k).c.push(x); });
        return g;
    }

    // ===================== 뷰 전환 =====================
    function injectHeader() {
        var sec = document.querySelector('#tab-checklist .timeline-section');
        var feed = document.getElementById('checklist-feed');
        if (!sec || !feed || document.getElementById('cl-view-list')) return;

        var title = sec.querySelector('.section-title');
        var wrap = document.createElement('div');
        wrap.className = 'tl-view-header cw-head';
        if (title) wrap.appendChild(title);
        var tog = document.createElement('div');
        tog.className = 'tl-view-toggle';
        tog.innerHTML =
            '<button type="button" id="cl-view-list" class="tl-view-btn active" title="목록으로 보기" aria-label="목록으로 보기">' +
            icon('bookmark', 18) + '</button>' +
            '<button type="button" id="cl-view-cal" class="tl-view-btn" title="달력으로 보기" aria-label="달력으로 보기">' +
            icon('calendar', 18) + '</button>';
        wrap.appendChild(tog);
        sec.insertBefore(wrap, feed);

        var cal = document.createElement('div');
        cal.id = 'checklist-calendar';
        cal.className = 'hidden';
        sec.insertBefore(cal, feed.nextSibling);

        document.getElementById('cl-view-list').addEventListener('click', function () { setView('list'); });
        document.getElementById('cl-view-cal').addEventListener('click', function () { setView('calendar'); });

        // [B] edit by smsong - #15 기본 보기 = 달력. 여기서는 화면 상태만 맞추고
        //  데이터는 체크리스트 탭에 실제로 들어올 때 불러온다(초기 로딩 낭비 방지).
        if (_clView === 'calendar') {
            feed.classList.add('hidden');
            cal.classList.remove('hidden');
            document.getElementById('cl-view-list').classList.remove('active');
            document.getElementById('cl-view-cal').classList.add('active');
        }
        // [E] edit by smsong
    }

    function setView(v) {
        _clView = v;
        var feed = document.getElementById('checklist-feed');
        var cal = document.getElementById('checklist-calendar');
        var bl = document.getElementById('cl-view-list'), bc = document.getElementById('cl-view-cal');
        var isCal = (v === 'calendar');
        if (feed) feed.classList.toggle('hidden', isCal);
        if (cal) cal.classList.toggle('hidden', !isCal);
        if (bl) bl.classList.toggle('active', !isCal);
        if (bc) bc.classList.toggle('active', isCal);
        if (isCal) {
            withLoading(loadCalendarData(true).then(render), '달력을 불러오는 중...');
        } else {
            requestAnimationFrame(function () { if (Daylog._relayoutFeeds) Daylog._relayoutFeeds(); });
        }
    }
    Daylog._setChecklistView = setView;

    // ===================== 달력 =====================
    function initMonth() {
        if (_cy == null) {
            var t = new Date();
            _cy = t.getFullYear(); _cm = t.getMonth();
        }
        // 선택 날짜가 보고 있는 달 밖이면 보정 — 이번 달이면 오늘, 아니면 1일
        var pre = String(_cy) + '-' + String(_cm + 1).padStart(2, '0');
        if (!_sel || _sel.substring(0, 7) !== pre) {
            var now = new Date();
            _sel = (now.getFullYear() === _cy && now.getMonth() === _cm) ? ymd(now) : (pre + '-01');
        }
    }

    function render() {
        var cont = document.getElementById('checklist-calendar');
        if (!cont) return;
        initMonth();
        var g = groupByDate();
        var todayKey = ymd(new Date());

        var chevL = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
        var chevR = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';

        var html = '<div class="cal-head">' +
            '<button type="button" class="cal-nav" id="cw-prev" aria-label="이전 달">' + chevL + '</button>' +
            '<div class="cal-month">' + _cy + '년 ' + (_cm + 1) + '월</div>' +
            '<button type="button" class="cal-nav" id="cw-next" aria-label="다음 달">' + chevR + '</button>' +
            '</div>';
        html += '<div class="cw-legend">' +
            '<span><i class="cw-dot sch"></i>일정</span><span><i class="cw-dot cl"></i>갈 곳</span>' +
            '<span class="cw-legend-hint">날짜를 누르면 추가·확인</span></div>';
        html += '<div class="cal-grid cal-dow">' +
            ['일', '월', '화', '수', '목', '금', '토'].map(function (d, i) {
                return '<div class="cal-dow-cell' + (i === 0 ? ' sun' : '') + (i === 6 ? ' sat' : '') + '">' + d + '</div>';
            }).join('') + '</div>';

        var startDow = new Date(_cy, _cm, 1).getDay();
        var dim = new Date(_cy, _cm + 1, 0).getDate();
        var cells = '';
        for (var i = 0; i < startDow; i++) cells += '<div class="cal-cell cw-cell empty"></div>';
        for (var d = 1; d <= dim; d++) {
            var key = _cy + '-' + String(_cm + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
            var it = g[key] || { s: [], c: [] };
            var total = it.s.length + it.c.length;
            var dow = new Date(_cy, _cm, d).getDay();
            var cls = 'cal-cell cw-cell' + (total ? ' has' : '') + (dow === 0 ? ' sun' : '') + (dow === 6 ? ' sat' : '') +
                      (key === todayKey ? ' today' : '') + (key === _sel ? ' picked-day' : '');
            var cell = '<div class="' + cls + '" data-date="' + key + '">';
            cell += '<span class="cal-day">' + d + '</span>';
            if (total) {
                var label = (it.s[0] && it.s[0].title) || (it.c[0] && it.c[0].title) || '';
                cell += '<span class="cw-label">' + esc(label) + '</span>';
                cell += '<span class="cw-dots">';
                if (it.s.length) cell += '<i class="cw-dot sch"></i>';
                if (it.c.length) cell += '<i class="cw-dot cl"></i>';
                if (total > 1) cell += '<span class="cw-more">' + total + '</span>';
                cell += '</span>';
            }
            cell += '</div>';
            cells += cell;
        }
        html += '<div class="cal-grid cal-days">' + cells + '</div>';
        // [B][E] edit by smsong - #14 달력 아래 인라인 패널 자리
        html += '<div id="cw-daypanel" class="cw-daypanel"></div>';
        cont.innerHTML = html;

        // [B][E] edit by smsong - #16 "2026년 8월" 클릭 → 년월 선택
        var _mv = cont.querySelector('.cal-month');
        if (_mv) {
            _mv.classList.add('cal-month-pick');
            _mv.addEventListener('click', function () {
                openMonthPicker(_cy, _cm, function (y2, m2) { _cy = y2; _cm = m2; render(); });
            });
        }
        document.getElementById('cw-prev').addEventListener('click', function () {
            _cm--; if (_cm < 0) { _cm = 11; _cy--; } render();
        });
        document.getElementById('cw-next').addEventListener('click', function () {
            _cm++; if (_cm > 11) { _cm = 0; _cy++; } render();
        });
        cont.querySelectorAll('.cw-cell:not(.empty)').forEach(function (c) {
            c.addEventListener('click', function () {
                _sel = c.getAttribute('data-date');
                cont.querySelectorAll('.cw-cell.picked-day').forEach(function (x) { x.classList.remove('picked-day'); });
                c.classList.add('picked-day');
                renderDay(_sel);
                var box = document.getElementById('cw-daypanel');
                if (box && box.scrollIntoView) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            });
        });
        renderDay(_sel);
    }
    Daylog._renderChecklistCalendar = render;

    // ===================== 년·월 선택기 =====================
    //  달력 헤더의 "2026년 8월" 을 누르면 뜬다. 체크리스트 달력과 타임라인 달력이 함께 쓴다.
    function openMonthPicker(y, m, onPick) {
        var old = document.getElementById('cw-mp');
        if (old && old.parentNode) old.parentNode.removeChild(old);

        var cy = y, now = new Date();
        var ov = document.createElement('div');
        ov.id = 'cw-mp';
        function paint() {
            var months = '';
            for (var i = 0; i < 12; i++) {
                var on = (cy === y && i === m);
                var isNow = (cy === now.getFullYear() && i === now.getMonth());
                months += '<button type="button" class="cw-mp-m' + (on ? ' on' : '') + (isNow ? ' now' : '') +
                          '" data-m="' + i + '">' + (i + 1) + '월</button>';
            }
            ov.innerHTML =
                '<div class="cw-mp-card" role="dialog" aria-modal="true" aria-label="년월 선택">' +
                    '<div class="cw-mp-y">' +
                        '<button type="button" class="cw-mp-nav" data-d="-1" aria-label="이전 해">‹</button>' +
                        '<span class="cw-mp-yv">' + cy + '년</span>' +
                        '<button type="button" class="cw-mp-nav" data-d="1" aria-label="다음 해">›</button>' +
                    '</div>' +
                    '<div class="cw-mp-grid">' + months + '</div>' +
                    '<button type="button" class="cw-mp-today" id="cw-mp-today">오늘로</button>' +
                '</div>';
            ov.querySelectorAll('.cw-mp-nav').forEach(function (b) {
                b.addEventListener('click', function () { cy += Number(b.getAttribute('data-d')); paint(); });
            });
            ov.querySelectorAll('.cw-mp-m').forEach(function (b) {
                b.addEventListener('click', function () {
                    close(); onPick(cy, Number(b.getAttribute('data-m')));
                });
            });
            document.getElementById('cw-mp-today').addEventListener('click', function () {
                close(); onPick(now.getFullYear(), now.getMonth());
            });
        }
        function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); }
        document.body.appendChild(ov);
        paint();
        ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    }
    Daylog._openMonthPicker = openMonthPicker;

    // ===================== 그날의 목록 (달력 아래 인라인 패널) =====================
    //  시트로 덮지 않고 달력 밑 여백에 그대로 펼친다. 날짜를 누를 때마다 이 영역만 다시 그린다.
    function renderDay(key) {
        var box = document.getElementById('cw-daypanel');
        if (!box) return;
        if (!key) { box.innerHTML = ''; return; }

        var g = groupByDate();
        var it = g[key] || { s: [], c: [] };
        var dt = new Date(key);
        var full = dt.getFullYear() + '년 ' + (dt.getMonth() + 1) + '월 ' + dt.getDate() + '일';
        var dow = ['일', '월', '화', '수', '목', '금', '토'][dt.getDay()];
        var total = it.s.length + it.c.length;

        // [B] edit by smsong - #16 추가 버튼을 날짜 오른쪽에 작게 가로 배치
        var addBtns =
            '<div class="cw-addrow">' +
                '<button type="button" class="cw-addbtn" id="cw-add-s">' + icon('plus', 12) + ' 일정</button>' +
                '<button type="button" class="cw-addbtn" id="cw-add-c">' + icon('plus', 12) + ' 체크리스트</button>' +
            '</div>';

        var html =
            '<div class="cw-dp-head">' +
                '<div class="cw-dp-date">' + esc(full) + ' <span class="cw-dp-dow">' + dow + '</span></div>' +
                (total ? '<span class="cw-dp-cnt">' + total + '</span>' : '') +
                addBtns +
            '</div>';
        // [E] edit by smsong

        if (!total) {
            html += '<div class="cw-dp-empty">' +
                '<span class="cw-dp-ic">' + icon('calendar', 30) + '</span>' +
                '<p>등록된 일정과 체크리스트가 없어요</p></div>';
            box.innerHTML = html;
            bindAdd(key);
            return;
        }

        var rows = '';
        it.s.forEach(function (s) {
            var time = s.allDay ? '종일' : (s.startTime ? String(s.startTime).substring(0, 5) : '종일');
            rows += '<div class="cw-row sch' + (s.done ? ' done' : '') + '">' +
                '<button type="button" class="cw-check" data-id="' + s.id + '" data-done="' + (s.done ? '1' : '0') + '" aria-label="완료">' +
                (s.done ? icon('check', 14) : '') + '</button>' +
                '<div class="cw-row-main"><div class="cw-row-title">' + esc(s.title) +
                '<span class="cw-tag sch">일정</span></div>' +
                '<div class="cw-row-sub">' + esc(time) + (s.content ? ' · ' + esc(s.content) : '') + '</div></div>' +
                '<button type="button" class="cw-row-edit" data-id="' + s.id + '" aria-label="수정">' + icon('edit', 15) + '</button>' +
                '</div>';
        });
        it.c.forEach(function (c) {
            var meta = (typeof checklistType === 'function') ? checklistType(c.type) : { label: '', emoji: '' };
            var badge = c.archived ? '<span class="cw-tag arch">보관됨</span>'
                      : (c.visited ? '<span class="cw-tag done">다녀옴</span>' : '<span class="cw-tag cl">갈 곳</span>');
            rows += '<div class="cw-row cl" data-id="' + c.id + '">' +
                '<span class="cw-ic">' + (meta.emoji || icon('bookmark', 15)) + '</span>' +
                '<div class="cw-row-main"><div class="cw-row-title">' + esc(c.title) + badge + '</div>' +
                '<div class="cw-row-sub">' + esc([c.placeName, c.address].filter(Boolean).join(' ')) + '</div></div>' +
                '</div>';
        });

        box.innerHTML = html + '<div class="cw-dp-list">' + rows + '</div>';

        // 일정 완료 토글
        box.querySelectorAll('.cw-check').forEach(function (b) {
            b.addEventListener('click', function (e) {
                e.stopPropagation();
                var id = b.getAttribute('data-id'), next = b.getAttribute('data-done') !== '1';
                withLoading(fetch(api() + '/api/schedules/' + id + '/done?done=' + next, { method: 'PUT', headers: hdr(true) })
                    .then(Daylog.handleResponse), '저장 중...')
                    .then(function () { return loadCalendarData(true); })
                    .then(function () { render(); })
                    .catch(function () { showToast('변경 실패'); });
            });
        });
        // 일정 수정
        box.querySelectorAll('.cw-row-edit').forEach(function (b) {
            b.addEventListener('click', function (e) {
                e.stopPropagation();
                var id = b.getAttribute('data-id');
                openScheduleForm(key, _schedules.find(function (x) { return String(x.id) === String(id); }));
            });
        });
        // 체크리스트 → 상세
        box.querySelectorAll('.cw-row.cl').forEach(function (r) {
            r.addEventListener('click', function () {
                var id = r.getAttribute('data-id');
                var c = _calCls.find(function (x) { return String(x.id) === String(id); });
                if (c) openChecklistDetail(c, true); else showToast('원본을 찾을 수 없습니다');
            });
        });
        bindAdd(key);
    }

    function bindAdd(key) {
        var a = document.getElementById('cw-add-s');
        var b = document.getElementById('cw-add-c');
        if (a) a.addEventListener('click', function () { openScheduleForm(key, null); });
        if (b) b.addEventListener('click', function () { addChecklistOn(key); });
    }

    // 체크리스트는 위치를 골라야 하므로 기존 생성 흐름(지도 위치 선택)을 그대로 태운다.
    //  선택한 날짜는 _pendingPlanned 에 담아 두었다가 작성 폼이 열릴 때 '갈 예정일'에 채운다.
    function addChecklistOn(key) {
        _pendingPlanned = key;
        if (typeof window._startChecklistCreate === 'function') {
            showToast('지도에서 갈 곳의 위치를 선택해주세요');
            window._startChecklistCreate();
        } else {
            _pendingPlanned = null;
            showToast('체크리스트 추가를 열 수 없습니다');
        }
    }

    // ===================== 일정 작성/수정 폼 =====================
    function closeScheduleForm() {
        var e = document.getElementById('cw-form');
        if (e && e.parentNode) e.parentNode.removeChild(e);
    }

    function openScheduleForm(dateKey, s) {
        closeScheduleForm();
        var editing = !!s;
        var ov = document.createElement('div');
        ov.id = 'cw-form';
        ov.innerHTML =
            '<div class="cw-card" role="dialog" aria-modal="true">' +
                '<div class="cw-card-head">' +
                    '<h3>' + (editing ? '일정 수정' : '일정 추가') + '</h3>' +
                    '<button type="button" class="cw-x" aria-label="닫기">&times;</button>' +
                '</div>' +
                '<label class="cw-lb">날짜</label>' +
                '<input type="date" id="cw-date" class="cw-in" value="' + esc(editing ? dkey(s.scheduleDate) : dateKey) + '">' +
                '<label class="cw-lb">무엇을 할까요</label>' +
                '<input type="text" id="cw-title" class="cw-in" maxlength="60" placeholder="예) 전시 보러 가기" value="' + esc(editing ? s.title : '') + '">' +
                '<label class="cw-lb">메모 <span class="cw-opt">선택</span></label>' +
                '<textarea id="cw-content" class="cw-in cw-ta" maxlength="500" placeholder="같이 챙길 것, 만날 장소 등">' + esc(editing ? (s.content || '') : '') + '</textarea>' +
                '<div class="cw-time-row">' +
                    '<label class="cw-switch"><input type="checkbox" id="cw-allday"' + ((!editing || s.allDay) ? ' checked' : '') + '> 종일</label>' +
                    '<input type="time" id="cw-time" class="cw-in cw-time"' + ((!editing || s.allDay) ? ' disabled' : '') +
                    ' value="' + esc(editing && s.startTime ? String(s.startTime).substring(0, 5) : '') + '">' +
                '</div>' +
                '<button type="button" class="cw-save" id="cw-save">' + (editing ? '저장하기' : '추가하기') + '</button>' +
                (editing ? '<button type="button" class="cw-del" id="cw-del">' + icon('trash', 14) + ' 휴지통으로</button>' : '') +
            '</div>';
        document.body.appendChild(ov);

        ov.addEventListener('click', function (e) { if (e.target === ov) closeScheduleForm(); });
        ov.querySelector('.cw-x').addEventListener('click', closeScheduleForm);

        var allday = document.getElementById('cw-allday'), timeEl = document.getElementById('cw-time');
        allday.addEventListener('change', function () { timeEl.disabled = allday.checked; if (allday.checked) timeEl.value = ''; });

        document.getElementById('cw-save').addEventListener('click', function () {
            var title = document.getElementById('cw-title').value.trim();
            var date = document.getElementById('cw-date').value;
            if (!title) { showToast('무엇을 할지 입력해주십시오'); return; }
            if (!date) { showToast('날짜를 선택해주십시오'); return; }
            var body = {
                title: title,
                content: document.getElementById('cw-content').value.trim(),
                scheduleDate: date,
                allDay: allday.checked,
                startTime: allday.checked ? null : (timeEl.value ? timeEl.value + ':00' : null),
                done: editing ? !!s.done : false
            };
            var url = editing ? (api() + '/api/schedules/' + s.id)
                              : (api() + '/api/schedules?uid=' + encodeURIComponent(Daylog.currentUid));
            withLoading(fetch(url, { method: editing ? 'PUT' : 'POST', headers: hdr(true), body: JSON.stringify(body) })
                .then(Daylog.handleResponse), '저장 중...')
                .then(function () { return loadCalendarData(true); })
                .then(function () {
                    closeScheduleForm(); render();
                    showToast(editing ? '일정을 수정했어요' : '일정을 추가했어요');
                })
                .catch(function (e) { console.error(e); showToast('저장 실패. 다시 시도해주십시오.'); });
        });

        var del = document.getElementById('cw-del');
        if (del) del.addEventListener('click', function () {
            if (!confirm('이 일정을 휴지통으로 옮기시겠습니까?')) return;
            withLoading(fetch(api() + '/api/schedules/' + s.id + '/trash', { method: 'PUT', headers: hdr(true) })
                .then(Daylog.handleResponse), '이동 중...')
                .then(function () { return loadCalendarData(true); })
                .then(function () { closeScheduleForm(); render(); showToast('휴지통으로 옮겼어요'); })
                .catch(function () { showToast('이동 실패'); });
        });
    }

    // ===================== 갈 예정일 입력 주입 =====================
    function injectPlannedInputs() {
        [['cl-visited-date', 'cl-planned-date'], ['cl-edit-visited-date', 'cl-edit-planned-date']].forEach(function (p) {
            var anchor = document.getElementById(p[0]);
            if (!anchor || document.getElementById(p[1])) return;
            var group = anchor.closest('.form-group') || anchor.parentElement;
            var wrap = document.createElement('div');
            wrap.className = 'form-group cw-planned-group';
            wrap.innerHTML = '<label>갈 예정일 <span class="cw-opt">선택 · 체크리스트 달력에 표시됩니다</span></label>' +
                             '<input type="date" id="' + p[1] + '">';
            group.parentNode.insertBefore(wrap, group.nextSibling);
        });
    }
    Daylog._injectPlannedInputs = injectPlannedInputs;

    // ===================== 보관함 =====================
    function injectArchiveButton() {
        var trash = document.getElementById('btn-trash');
        if (!trash || document.getElementById('btn-archive')) return;
        var b = document.createElement('button');
        b.type = 'button';
        b.id = 'btn-archive';
        b.className = trash.className;   // 휴지통 버튼과 같은 스타일
        b.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;" aria-hidden="true">' +
            '<rect x="2" y="4" width="20" height="5" rx="1.5"/><path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9"/>' +
            '<line x1="10" y1="13" x2="14" y2="13"/></svg> 보관함';
        trash.parentNode.insertBefore(b, trash);   // 휴지통 바로 위
        b.addEventListener('click', openArchive);
    }

    function openArchive() {
        var uid = Daylog.currentUid;
        withLoading(fetch(api() + '/api/checklists/archive/' + encodeURIComponent(uid), { headers: hdr(true) })
            .then(Daylog.handleResponse), '보관함을 불러오는 중...')
            .then(renderArchive)
            .catch(function () { showToast('보관함을 불러오지 못했습니다'); });
    }

    function closeArchive() {
        var e = document.getElementById('cw-archive');
        if (e && e.parentNode) e.parentNode.removeChild(e);
    }

    function renderArchive(items) {
        closeArchive();
        items = items || [];
        var rows = items.map(function (c) {
            var meta = (typeof checklistType === 'function') ? checklistType(c.type) : { label: '', emoji: '' };
            var when = c.visitedDate ? String(c.visitedDate).substring(0, 10).replace(/-/g, '.') : '';
            var cover = coverUrlOf(c);
            var thumb = cover
                ? '<img class="cw-th" src="' + Daylog.thumbUrlOf(cover) + '" data-full="' + cover + '" loading="lazy" decoding="async" alt="" onerror="Daylog._thumbFallback(this)">'
                : '<span class="cw-th empty">' + icon('bookmark', 18) + '</span>';
            return '<div class="cw-arow" data-id="' + c.id + '">' +
                '<span class="cw-sel" aria-hidden="true"></span>' + thumb +
                '<div class="cw-row-main"><div class="cw-row-title">' + esc(c.title) + '</div>' +
                '<div class="cw-row-sub">' + esc(meta.label || '') + (when ? ' · ' + when + ' 다녀옴' : '') + '</div></div>' +
                '</div>';
        }).join('');

        var ov = document.createElement('div');
        ov.id = 'cw-archive';
        ov.className = 'cw-full';
        ov.innerHTML =
            '<div class="cw-full-head">' +
                '<h3>보관함<span class="cw-cnt">' + items.length + '</span></h3>' +
                '<div class="cw-head-act">' +
                    (items.length ? '<button type="button" class="cw-selbtn" id="cw-a-sel">선택</button>' : '') +
                    '<button type="button" class="cw-x" id="cw-a-close" aria-label="닫기">&times;</button>' +
                '</div>' +
            '</div>' +
            '<p class="cw-note">다녀온 곳이 여기에 담깁니다. 지도·목록에는 안 보이지만 체크리스트 달력에는 남아 있어요.</p>' +
            '<div class="cw-abody">' + (items.length ? rows :
                '<div class="empty-state"><span class="es-icon">' + icon('bookmark', 40) + '</span><p>보관된 항목이 없습니다</p></div>') + '</div>' +
            '<div class="cw-bar" id="cw-a-bar">' +
                '<button type="button" class="cw-bar-all" id="cw-a-all">전체 선택</button>' +
                '<span class="cw-bar-cnt" id="cw-a-cnt">0개 선택</span>' +
                '<button type="button" class="cw-bar-go" id="cw-a-trash">휴지통으로</button>' +
            '</div>';
        document.body.appendChild(ov);

        document.getElementById('cw-a-close').addEventListener('click', closeArchive);
        bindSelect(ov, '.cw-arow', {
            selBtn: 'cw-a-sel', bar: 'cw-a-bar', all: 'cw-a-all', cnt: 'cw-a-cnt',
            actions: [{ id: 'cw-a-trash', run: bulkArchiveToTrash }]
        });
    }

    function bulkArchiveToTrash(ids, ov) {
        if (!ids.length) { showToast('선택된 항목이 없습니다'); return; }
        if (!confirm(ids.length + '개를 휴지통으로 옮기시겠습니까?\n휴지통에서 영구 삭제하면 달력에서도 사라집니다.')) return;
        withLoading(fetch(api() + '/api/checklists/bulk/trash', { method: 'POST', headers: hdr(true), body: JSON.stringify({ ids: ids }) })
            .then(Daylog.handleResponse), '이동 중...')
            .then(function (r) {
                showToast((r && r.success ? r.success : ids.length) + '개를 휴지통으로 옮겼어요');
                _loaded = false;
                return loadCalendarData(true);
            })
            .then(function () { render(); closeArchive(); openArchive(); })
            .catch(function () { showToast('이동 실패'); });
    }

    // ===================== 선택 모드 (보관함/휴지통 공용) =====================
    //  opts = { selBtn, bar, all, cnt, actions:[{id, run(ids, root)}] }
    function bindSelect(root, rowSel, opts) {
        var on = false;
        var selBtn = document.getElementById(opts.selBtn);
        var bar = document.getElementById(opts.bar);
        var allBtn = document.getElementById(opts.all);
        var cntEl = document.getElementById(opts.cnt);
        if (!bar) return;

        function ids() {
            return Array.prototype.map.call(root.querySelectorAll(rowSel + '.picked'),
                function (r) { return Number(r.getAttribute('data-id')); });
        }
        function paint() {
            var n = ids().length;
            if (cntEl) cntEl.textContent = n + '개 선택';
            bar.classList.toggle('show', on);
            root.classList.toggle('selecting', on);
            if (selBtn) selBtn.textContent = on ? '취소' : '선택';
        }
        if (selBtn) selBtn.addEventListener('click', function () {
            on = !on;
            if (!on) root.querySelectorAll(rowSel + '.picked').forEach(function (r) { r.classList.remove('picked'); });
            paint();
        });
        if (allBtn) allBtn.addEventListener('click', function () {
            var rows = root.querySelectorAll(rowSel);
            var every = ids().length === rows.length && rows.length > 0;
            rows.forEach(function (r) { r.classList.toggle('picked', !every); });
            paint();
        });
        root.querySelectorAll(rowSel).forEach(function (r) {
            r.addEventListener('click', function (e) {
                if (!on) return;
                e.stopPropagation(); e.preventDefault();
                r.classList.toggle('picked');
                paint();
            }, true);
        });
        (opts.actions || []).forEach(function (a) {
            var b = document.getElementById(a.id);
            if (b) b.addEventListener('click', function () { a.run(ids(), root); });
        });
        paint();
    }
    Daylog._bindSelect = bindSelect;

    // ===================== 휴지통 선택 모드 =====================
    //  renderTrash() 가 다시 그릴 때마다 툴바를 붙인다.
    function setupTrashSelect() {
        var body = document.getElementById('trash-modal-body');
        var modal = document.getElementById('trash-modal');
        if (!body || !modal || !body.querySelector('.trash-row')) return;
        if (document.getElementById('cw-t-bar')) return;

        var head = modal.querySelector('.modal-header');
        if (head && !document.getElementById('cw-t-sel')) {
            var b = document.createElement('button');
            b.type = 'button'; b.id = 'cw-t-sel'; b.className = 'cw-selbtn';
            b.textContent = '선택';
            head.insertBefore(b, head.querySelector('.close-modal'));
        }
        var bar = document.createElement('div');
        bar.className = 'cw-bar'; bar.id = 'cw-t-bar';
        bar.innerHTML =
            '<button type="button" class="cw-bar-all" id="cw-t-all">전체 선택</button>' +
            '<span class="cw-bar-cnt" id="cw-t-cnt">0개 선택</span>' +
            '<button type="button" class="cw-bar-go danger" id="cw-t-del">영구 삭제</button>';
        modal.querySelector('.list-content').appendChild(bar);

        bindSelect(modal, '.trash-row', {
            selBtn: 'cw-t-sel', bar: 'cw-t-bar', all: 'cw-t-all', cnt: 'cw-t-cnt',
            actions: [{ id: 'cw-t-del', run: bulkTrashDelete }]
        });
    }
    Daylog._setupTrashSelect = setupTrashSelect;

    function bulkTrashDelete(ids, root) {
        var rows = Array.prototype.filter.call(root.querySelectorAll('.trash-row.picked'), function () { return true; });
        if (!rows.length) { showToast('선택된 항목이 없습니다'); return; }
        if (!confirm(rows.length + '개를 영구 삭제합니다.\n' + PERM_WARN)) return;

        var by = { memory: [], checklist: [], comment: [] };
        rows.forEach(function (r) {
            var k = r.getAttribute('data-kind'), id = Number(r.getAttribute('data-id'));
            if (by[k]) by[k].push(id);
        });
        var jobs = [];
        if (by.memory.length) jobs.push(fetch(api() + '/api/memories/bulk/delete', { method: 'POST', headers: hdr(true), body: JSON.stringify({ ids: by.memory }) }));
        if (by.checklist.length) jobs.push(fetch(api() + '/api/checklists/bulk/delete', { method: 'POST', headers: hdr(true), body: JSON.stringify({ ids: by.checklist }) }));
        // 댓글은 일괄 API 가 없어 개별 호출
        by.comment.forEach(function (id) {
            jobs.push(fetch(api() + '/comment/' + id + '?hard=true', { method: 'DELETE', headers: hdr(true) }));
        });

        withLoading(Promise.all(jobs), '삭제 중...')
            .then(function () {
                showToast(rows.length + '개를 영구 삭제했어요');
                _loaded = false;
                if (typeof openTrashModal === 'function') openTrashModal();
                return loadCalendarData(true).then(render);
            })
            .catch(function (e) { console.error(e); showToast('삭제 실패'); });
    }

    // ===================== CSS =====================
    function injectCss() {
        if (document.getElementById('cw-style')) return;
        var css = [
            '.cw-head{margin-bottom:12px;}',
            '.cw-legend{display:flex;align-items:center;gap:14px;margin:0 2px 10px;font-size:0.72rem;color:var(--gray-500);}',
            '.cw-legend-hint{margin-left:auto;color:var(--gray-400);}',
            '.cw-dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px;vertical-align:middle;}',
            '.cw-dot.sch{background:#2e9e5b;}.cw-dot.cl{background:var(--primary);}',
            '.cw-cell{position:relative;cursor:pointer;}',
            '.cw-cell.today .cal-day{background:var(--primary);color:#fff;border-radius:50%;}',
            '.cw-cell .cal-day{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;}',
            '.cw-label{display:block;margin-top:2px;font-size:0.6rem;line-height:1.2;color:var(--gray-600);' +
            'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 2px;}',
            '.cw-dots{position:absolute;left:0;right:0;bottom:5px;display:flex;align-items:center;justify-content:center;gap:3px;}',
            '.cw-more{font-size:0.56rem;font-weight:700;color:var(--gray-400);}',
            // 달력 아래 인라인 패널
            '.cw-daypanel{margin-top:16px;padding-top:14px;border-top:1px solid var(--gray-200);}',
            '.cw-dp-head{display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;}',
            '.cw-dp-date{font-family:var(--font-logo),var(--font-main);font-size:1.02rem;font-weight:600;' +
            'color:var(--gray-800);white-space:nowrap;}',
            '.cw-dp-dow{font-family:var(--font-main);font-size:0.78rem;font-weight:600;color:var(--gray-400);}',
            '.cw-dp-cnt{font-size:0.7rem;font-weight:700;color:var(--primary-dark);background:var(--primary-light);' +
            'border-radius:999px;padding:2px 8px;}',
            '.cw-dp-empty{text-align:center;padding:22px 10px 18px;color:var(--gray-400);}',
            '.cw-dp-ic{display:inline-flex;color:var(--primary-light);margin-bottom:8px;}',
            '.cw-dp-empty p{margin:0;font-size:0.86rem;line-height:1.6;}',
            '.cw-dp-list{margin-bottom:4px;}',
            // #16 날짜 오른쪽에 붙는 작은 추가 버튼
            '.cw-addrow{display:flex;gap:6px;margin-left:auto;flex:none;}',
            '.cw-addbtn{display:inline-flex;align-items:center;gap:3px;white-space:nowrap;' +
            'border:1px solid var(--primary-light);border-radius:999px;padding:6px 10px;background:transparent;' +
            'color:var(--primary-dark);font-family:inherit;font-size:0.72rem;font-weight:600;cursor:pointer;line-height:1;}',
            '.cw-addbtn:active{background:var(--primary-light);}',
            // #16 년월 선택기
            '.cal-month-pick{cursor:pointer;position:relative;padding-right:14px;}',
            '.cal-month-pick::after{content:"";position:absolute;right:0;top:50%;width:6px;height:6px;' +
            'margin-top:-4px;border-right:2px solid var(--gray-400);border-bottom:2px solid var(--gray-400);' +
            'transform:rotate(45deg);}',
            '#cw-mp{position:fixed;inset:0;z-index:2750;background:rgba(45,38,32,.52);' +
            'display:flex;align-items:center;justify-content:center;padding:24px;animation:cwFade .18s ease;}',
            '#cw-mp .cw-mp-card{width:100%;max-width:320px;background:var(--white);border-radius:22px;padding:18px;' +
            'animation:cwPop .28s cubic-bezier(.2,.8,.3,1);}',
            '.cw-mp-y{display:flex;align-items:center;justify-content:center;gap:18px;margin-bottom:14px;}',
            '.cw-mp-yv{font-family:var(--font-logo),var(--font-main);font-size:1.18rem;font-weight:600;color:var(--gray-800);min-width:74px;text-align:center;}',
            '.cw-mp-nav{border:none;background:transparent;font-size:1.5rem;line-height:1;color:var(--gray-500);' +
            'cursor:pointer;padding:2px 10px;border-radius:8px;}',
            '.cw-mp-nav:active{background:var(--gray-100);}',
            '.cw-mp-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;}',
            '.cw-mp-m{border:1px solid transparent;background:var(--gray-100);border-radius:12px;padding:11px 0;' +
            'font-family:inherit;font-size:0.86rem;font-weight:600;color:var(--gray-600);cursor:pointer;}',
            '.cw-mp-m.now{border-color:var(--primary-light);}',
            '.cw-mp-m.on{background:var(--primary);color:#fff;}',
            '.cw-mp-today{margin-top:14px;width:100%;border:none;border-radius:12px;padding:11px;' +
            'background:transparent;color:var(--gray-500);font-family:inherit;font-size:0.82rem;font-weight:600;cursor:pointer;}',
            '.cw-mp-today:active{background:var(--gray-100);}',
            '.cw-row{display:flex;align-items:center;gap:11px;padding:12px 2px;border-bottom:1px solid var(--gray-100);}',
            '.cw-row.cl{cursor:pointer;}',
            '.cw-row.done .cw-row-title{text-decoration:line-through;color:var(--gray-400);}',
            '.cw-row-main{flex:1;min-width:0;}',
            '.cw-row-title{font-size:0.9rem;font-weight:600;color:var(--gray-800);display:flex;align-items:center;gap:6px;}',
            '.cw-row-sub{font-size:0.75rem;color:var(--gray-400);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
            '.cw-check{width:22px;height:22px;flex:none;border:2px solid var(--gray-200);border-radius:7px;background:transparent;' +
            'display:flex;align-items:center;justify-content:center;color:#fff;cursor:pointer;padding:0;}',
            '.cw-row.done .cw-check{background:#2e9e5b;border-color:#2e9e5b;}',
            '.cw-row-edit{border:none;background:transparent;color:var(--gray-400);cursor:pointer;padding:4px;flex:none;}',
            '.cw-ic{flex:none;display:inline-flex;}',
            '.cw-tag{font-size:0.6rem;font-weight:700;padding:2px 7px;border-radius:999px;flex:none;}',
            '.cw-tag.sch{background:#e3f1e8;color:#2e6e56;}',
            '.cw-tag.cl{background:var(--primary-light);color:var(--primary-dark);}',
            '.cw-tag.arch{background:var(--gray-100);color:var(--gray-500);}',
            '.cw-tag.done{background:#e3f1e8;color:#2e6e56;}',
            '.cw-cell.picked-day{background:var(--primary-light);border-radius:10px;}',
            // ===== #15 타임라인 사진 그리드 (인스타그램식) =====
            '#timeline-grid{margin:0 -20px;}',   // 콘텐츠 여백을 무시하고 화면 끝까지
            '.tg-row{display:grid;grid-template-columns:repeat(3,1fr);gap:2px;margin-bottom:2px;}',
            '.tg-tile{position:relative;aspect-ratio:1/1;width:100%;padding:0;border:none;overflow:hidden;' +
            'background:var(--gray-100);cursor:pointer;display:block;}',
            '.tg-tile:active{opacity:.82;}',
            '.tg-img{width:100%;height:100%;object-fit:cover;display:block;opacity:0;transition:opacity .25s ease;}',
            '.tg-img.is-loaded{opacity:1;}',
            '.tg-multi{position:absolute;top:6px;right:6px;color:#fff;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5));' +
            'display:inline-flex;pointer-events:none;}',
            '.tg-tile.notext{background:var(--primary-light);display:flex;flex-direction:column;' +
            'align-items:center;justify-content:center;gap:6px;padding:10px;color:var(--primary-dark);}',
            '.tg-title{font-size:0.7rem;font-weight:600;line-height:1.35;text-align:center;' +
            'overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;}',
            // 일정 작성 카드
            '#cw-form{position:fixed;inset:0;z-index:2700;background:rgba(45,38,32,.52);display:flex;align-items:center;justify-content:center;padding:22px;}',
            '#cw-form .cw-card{width:100%;max-width:360px;max-height:88dvh;overflow-y:auto;background:var(--white);' +
            'border-radius:22px;padding:20px;animation:cwPop .3s cubic-bezier(.2,.8,.3,1);}',
            '.cw-card-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;}',
            '.cw-card-head h3{margin:0;font-size:1.06rem;font-weight:700;color:var(--gray-800);}',
            '.cw-lb{display:block;margin:12px 0 6px;font-size:0.78rem;font-weight:600;color:var(--gray-500);}',
            '.cw-opt{font-weight:400;color:var(--gray-400);}',
            '.cw-in{width:100%;box-sizing:border-box;border:1px solid var(--gray-200);border-radius:12px;padding:12px;' +
            'font-family:inherit;font-size:0.92rem;color:var(--gray-800);background:var(--white);}',
            '.cw-in:focus{outline:none;border-color:var(--primary);}',
            '.cw-ta{min-height:74px;resize:vertical;}',
            '.cw-time-row{display:flex;align-items:center;gap:12px;margin-top:14px;}',
            '.cw-switch{display:flex;align-items:center;gap:6px;font-size:0.86rem;color:var(--gray-600);cursor:pointer;white-space:nowrap;}',
            '.cw-switch input{width:17px;height:17px;accent-color:var(--primary);}',
            '.cw-time{flex:1;}',
            '.cw-save{margin-top:18px;width:100%;border:none;border-radius:14px;padding:14px;background:var(--primary);' +
            'color:#fff;font-family:inherit;font-size:1rem;font-weight:700;cursor:pointer;}',
            '.cw-save:active{transform:scale(.99);}',
            '.cw-del{margin-top:9px;width:100%;border:none;border-radius:12px;padding:11px;background:transparent;' +
            'color:#b5462f;font-family:inherit;font-size:0.86rem;font-weight:600;cursor:pointer;' +
            'display:flex;align-items:center;justify-content:center;gap:5px;}',
            // 보관함 (풀스크린)
            '.cw-full{position:fixed;inset:0;z-index:2500;background:var(--bg-color);display:flex;flex-direction:column;' +
            'padding:max(14px,calc(env(safe-area-inset-top) + 10px)) 18px 0;animation:cwFade .2s ease;}',
            '.cw-full-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;}',
            '.cw-full-head h3{margin:0;font-family:var(--font-logo),var(--font-main);font-size:1.28rem;font-weight:600;' +
            'color:var(--gray-800);display:flex;align-items:center;gap:9px;}',
            '.cw-cnt{font-family:var(--font-main);font-size:0.72rem;font-weight:600;color:var(--primary-dark);' +
            'background:var(--primary-light);border-radius:999px;padding:2px 9px;}',
            '.cw-head-act{display:flex;align-items:center;gap:6px;}',
            '.cw-selbtn{border:1px solid var(--gray-200);background:transparent;border-radius:10px;padding:6px 12px;' +
            'font-family:inherit;font-size:0.8rem;font-weight:600;color:var(--gray-600);cursor:pointer;}',
            '.cw-note{margin:0 0 12px;font-size:0.76rem;line-height:1.5;color:var(--gray-400);}',
            '.cw-abody{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding-bottom:90px;}',
            '.cw-arow{display:flex;align-items:center;gap:12px;padding:11px 2px;border-bottom:1px solid var(--gray-100);cursor:pointer;}',
            '.cw-th{width:52px;height:52px;border-radius:12px;object-fit:cover;flex:none;background:var(--gray-100);}',
            '.cw-th.empty{display:flex;align-items:center;justify-content:center;color:var(--primary);}',
            // 선택 모드
            '.cw-sel{width:20px;height:20px;border-radius:50%;border:2px solid var(--gray-200);flex:none;display:none;}',
            '.selecting .cw-sel{display:block;}',
            '.selecting .cw-arow.picked .cw-sel,.selecting .trash-row.picked .cw-sel{background:var(--primary);border-color:var(--primary);}',
            '.selecting .cw-arow.picked,.selecting .trash-row.picked{background:var(--primary-light);border-radius:12px;}',
            '.selecting .trash-row{cursor:pointer;}',
            '.selecting .trash-actions{opacity:.35;pointer-events:none;}',
            '.selecting .trash-row::before{content:"";width:20px;height:20px;border-radius:50%;border:2px solid var(--gray-200);' +
            'flex:none;align-self:center;margin-right:10px;}',
            '.selecting .trash-row.picked::before{background:var(--primary);border-color:var(--primary);}',
            '.cw-bar{position:fixed;left:0;right:0;bottom:0;z-index:2650;display:none;align-items:center;gap:10px;' +
            'padding:12px 18px calc(env(safe-area-inset-bottom) + 12px);background:var(--white);' +
            'box-shadow:0 -6px 22px rgba(139,115,85,.14);}',
            '.cw-bar.show{display:flex;}',
            '.cw-bar-all{border:1px solid var(--gray-200);background:transparent;border-radius:10px;padding:9px 12px;' +
            'font-family:inherit;font-size:0.82rem;font-weight:600;color:var(--gray-600);cursor:pointer;white-space:nowrap;}',
            '.cw-bar-cnt{flex:1;font-size:0.82rem;color:var(--gray-500);}',
            '.cw-bar-go{border:none;border-radius:11px;padding:11px 16px;background:var(--primary);color:#fff;' +
            'font-family:inherit;font-size:0.88rem;font-weight:700;cursor:pointer;white-space:nowrap;}',
            '.cw-bar-go.danger{background:#b5462f;}',
            '@keyframes cwUp{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}',
            '@keyframes cwPop{from{transform:translateY(14px) scale(.96);opacity:0}to{transform:none;opacity:1}}',
            '@keyframes cwFade{from{opacity:0}to{opacity:1}}'
        ].join('');
        var st = document.createElement('style');
        st.id = 'cw-style';
        st.textContent = css;
        (document.head || document.documentElement).appendChild(st);
    }

    // ===================== 시작 =====================
    function boot() {
        injectCss();
        injectHeader();
        injectPlannedInputs();
        injectArchiveButton();

        // [B] edit by smsong - #14 달력에서 '체크리스트 추가'로 들어온 경우,
        //  위치 선택을 마치고 작성 폼이 열릴 때 그 날짜를 '갈 예정일'에 자동으로 채운다.
        var _origOpen = window._openChecklistForm;
        window._openChecklistForm = function () {
            if (typeof _origOpen === 'function') _origOpen.apply(this, arguments);
            injectPlannedInputs();
            var el = document.getElementById('cl-planned-date');
            if (el && _pendingPlanned) {
                el.value = _pendingPlanned;
                _pendingPlanned = null;
                showToast('갈 예정일이 선택한 날짜로 채워졌어요');
            }
        };
        // [E] edit by smsong
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();

    Daylog._reloadCalendar = function () { return withLoading(loadCalendarData(true).then(render), '달력을 불러오는 중...'); };
    Daylog._calendarView = function () { return _clView; };
})();
// [E] edit by smsong
