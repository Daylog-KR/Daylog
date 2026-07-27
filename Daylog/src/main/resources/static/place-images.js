// ==========================================================================
// [B] edit by smsong - #44 장소 사진 자동 첨부 (추억 / 가볼곳 공용)
//
//  하는 일
//   사진 그리드 아래에 '장소 사진 가져오기' 버튼을 붙인다.
//   누르면 현재 폼의 장소명(+지역)으로 백엔드 이미지 검색을 돌려 후보를 띄우고,
//   고른 사진을 서버 프록시로 내려받아 File 로 만들어 기존 미디어 매니저에 그대로 넣는다.
//
//  왜 File 로 넣는가
//   URL 을 DB 에 저장하면 원본이 사라질 때 이미지가 깨지고(링크 로트),
//   기존 업로드 파이프라인(GCS 업로드 · thumb_ 썸네일 생성 · mediaOrder 정렬)을
//   전부 다시 만들어야 한다. File 로 밀어 넣으면 백엔드는 손댈 게 없다.
//
//  ⚠ 저작권
//   후보 이미지는 블로그/뉴스 등 제3자가 올린 사진이다. 방 안에서만 보이는
//   사적 기록용으로만 쓰고, 외부 공개로 확장할 거면 별도 검토가 필요하다.
//   그래서 시트 하단에 출처 도메인과 안내 문구를 항상 노출한다.
// ==========================================================================
(function (global) {
    'use strict';

    var Daylog = global.Daylog = global.Daylog || {};
    var MAX_PICK = 10;   // 한 번에 고를 수 있는 최대 장수 (미디어 매니저 상한과 별개의 안전선)

    // ---------- 스타일 ----------
    function injectStyle() {
        if (document.getElementById('pi-style')) return;
        var css =
            // 가볼곳 사진 그리드의 '＋' 옆에 같은 크기(정사각형)로 놓이는 타일 버튼.
            //  .media-add 와 동일한 aspect-ratio / 모양을 맞춰 나란히 보이게 한다.
            '.pi-fetch{aspect-ratio:1/1;border-radius:12px;border:2px dashed var(--primary-light,#e6ccb2);' +
            'background:var(--gray-50,#faf9f8);color:var(--primary,#b08968);cursor:pointer;' +
            'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;' +
            'font-family:inherit;font-size:0.66rem;font-weight:700;line-height:1.15;text-align:center;padding:4px;}' +
            '.pi-fetch:hover{background:var(--primary-light,#e6ccb2);}' +
            '.pi-fetch:active{transform:scale(.97);}' +
            '.pi-fetch svg{width:20px;height:20px;}' +

            '#pi-overlay{position:fixed;inset:0;z-index:2900;background:rgba(45,38,32,.52);' +
            'display:flex;align-items:flex-end;justify-content:center;animation:piFade .18s ease;}' +
            '@media (min-width:600px){#pi-overlay{align-items:center;}}' +
            '#pi-card{width:100%;max-width:560px;max-height:88dvh;display:flex;flex-direction:column;' +
            'background:var(--white,#fffdf9);border-radius:22px 22px 0 0;overflow:hidden;' +
            'animation:piUp .26s cubic-bezier(.2,.8,.3,1);}' +
            '@media (min-width:600px){#pi-card{border-radius:22px;}}' +

            '.pi-head{display:flex;align-items:center;gap:10px;padding:16px 18px 13px;' +
            'border-bottom:1px solid var(--gray-100,#f3f0ec);}' +
            '.pi-head h3{margin:0;font-size:1.02rem;font-weight:700;color:var(--gray-800,#2e2b28);}' +
            '.pi-head .pi-q{font-size:0.8rem;color:var(--gray-500,#7a756e);font-weight:600;' +
            'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:46%;}' +
            '.pi-x{margin-left:auto;border:none;background:transparent;font-size:1.5rem;line-height:1;' +
            'color:var(--gray-400,#a8a29a);cursor:pointer;padding:0 4px;}' +

            '#pi-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:12px 14px 4px;}' +
            '.pi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;}' +
            '@media (min-width:480px){.pi-grid{grid-template-columns:repeat(4,1fr);}}' +
            '.pi-cell{position:relative;padding-top:100%;border-radius:12px;overflow:hidden;cursor:pointer;' +
            'background:var(--gray-100,#f3f0ec);border:2px solid transparent;}' +
            '.pi-cell img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;}' +
            '.pi-cell.sel{border-color:var(--primary,#b08968);}' +
            '.pi-cell.sel::after{content:"";position:absolute;inset:0;background:rgba(176,137,104,.22);}' +
            '.pi-no{position:absolute;top:6px;right:6px;z-index:2;width:22px;height:22px;border-radius:50%;' +
            'display:flex;align-items:center;justify-content:center;font-size:0.72rem;font-weight:800;' +
            'background:rgba(255,255,255,.86);color:var(--gray-400,#a8a29a);' +
            'box-shadow:0 1px 4px rgba(0,0,0,.18);}' +
            '.pi-cell.sel .pi-no{background:var(--primary,#b08968);color:#fff;}' +
            '.pi-src{position:absolute;left:0;right:0;bottom:0;z-index:2;padding:3px 6px;font-size:0.62rem;' +
            'color:#fff;background:linear-gradient(transparent,rgba(0,0,0,.55));' +
            'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +

            '.pi-msg{padding:34px 18px;text-align:center;color:var(--gray-500,#7a756e);font-size:0.87rem;line-height:1.6;}' +
            '.pi-note{padding:12px 18px 2px;font-size:0.72rem;color:var(--gray-400,#a8a29a);line-height:1.55;}' +

            '.pi-foot{display:flex;gap:10px;padding:12px 16px calc(14px + env(safe-area-inset-bottom));' +
            'border-top:1px solid var(--gray-100,#f3f0ec);}' +
            '.pi-btn{flex:1;border:none;border-radius:13px;padding:13px;font-family:inherit;' +
            'font-size:0.94rem;font-weight:700;cursor:pointer;}' +
            '.pi-btn.ghost{background:var(--gray-100,#f3f0ec);color:var(--gray-600,#5c5751);}' +
            '.pi-btn.primary{background:var(--primary,#b08968);color:#fff;}' +
            '.pi-btn:disabled{opacity:.5;cursor:default;}' +

            '@keyframes piFade{from{opacity:0}to{opacity:1}}' +
            '@keyframes piUp{from{transform:translateY(18px);opacity:.6}to{transform:none;opacity:1}}' +
            '@media (prefers-reduced-motion:reduce){#pi-overlay,#pi-card{animation:none;}}';
        var st = document.createElement('style');
        st.id = 'pi-style';
        st.textContent = css;
        document.head.appendChild(st);
    }

    function esc(s) {
        return (s == null ? '' : String(s))
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function toast(m) { if (typeof global.showToast === 'function') global.showToast(m); }

    // main.js 의 API_BASE_URL 은 const 라 window 에 없다.
    //  → main.js 가 공개해 둔 Daylog.api 를 최우선으로, APP_CONFIG 를 폴백으로 쓴다.
    //  (이걸 못 찾으면 상대경로가 되어 Vercel(프론트) 로 요청이 새어 404 가 난다)
    function apiBase() {
        if (Daylog && typeof Daylog.api === 'string' && Daylog.api) return Daylog.api;
        if (global.APP_CONFIG && global.APP_CONFIG.BACKEND_BASE) return global.APP_CONFIG.BACKEND_BASE;
        if (typeof global.API_BASE_URL === 'string' && global.API_BASE_URL) return global.API_BASE_URL;
        return '';
    }

    function headers() {
        return (typeof global.authHeaders === 'function') ? global.authHeaders(false) : {};
    }

    // 주소 문자열에서 '시/도 + 시·군·구' 만 뽑아 검색 힌트로 쓴다.
    function regionHint(text) {
        if (!text) return '';
        var m = String(text).match(/([가-힣]+(?:특별시|광역시|특별자치시|특별자치도|시|도))\s*([가-힣]+(?:시|군|구))?/);
        if (!m) return '';
        var big = m[1].replace(/(특별시|광역시|특별자치시|특별자치도)$/, '');
        return (big + ' ' + (m[2] || '')).trim();
    }

    // ---------- 시트 ----------
    function close() {
        var ov = document.getElementById('pi-overlay');
        if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    }

    /**
     * @param cfg.query   검색할 장소명 (필수 · 초기값)
     * @param cfg.region  지역 힌트 (선택)
     * @param cfg.mgr     createMediaManager 인스턴스
     */
    function open(cfg) {
        injectStyle();
        close();

        var mgr = cfg.mgr;
        var maxTotal = (typeof global.MEDIA_MAX === 'number') ? global.MEDIA_MAX : 10;
        var room = mgr ? Math.max(0, maxTotal - mgr.count()) : maxTotal;
        if (room <= 0) { toast('이미지는 최대 ' + maxTotal + '장까지 첨부할 수 있습니다'); return; }
        var limit = Math.min(room, MAX_PICK);

        var ov = document.createElement('div');
        ov.id = 'pi-overlay';
        ov.innerHTML =
            '<div id="pi-card" role="dialog" aria-modal="true" aria-label="장소 사진 가져오기">' +
            '<div class="pi-head">' +
            '<h3>장소 사진</h3>' +
            '<span class="pi-q">' + esc(cfg.query || '') + '</span>' +
            '<button type="button" class="pi-x" aria-label="닫기">&times;</button>' +
            '</div>' +
            '<div id="pi-body"><div class="pi-msg">사진을 찾는 중…</div></div>' +
            '<div class="pi-foot">' +
            '<button type="button" class="pi-btn ghost" id="pi-cancel">취소</button>' +
            '<button type="button" class="pi-btn primary" id="pi-add" disabled>추가</button>' +
            '</div>' +
            '</div>';
        document.body.appendChild(ov);

        var body = ov.querySelector('#pi-body');
        var addBtn = ov.querySelector('#pi-add');
        var picked = [];   // 선택 순서 유지

        ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
        ov.querySelector('.pi-x').addEventListener('click', close);
        ov.querySelector('#pi-cancel').addEventListener('click', close);

        function refreshBtn() {
            addBtn.disabled = picked.length === 0;
            addBtn.textContent = picked.length ? (picked.length + '장 추가') : '추가';
        }

        // --- 검색 (버튼을 누른 시점의 장소명으로 자동 검색) ---
        (function runSearch() {
            var q = (cfg.query || '').trim();
            if (!q) {
                body.innerHTML = '<div class="pi-msg">먼저 장소를 검색하거나<br>제목을 입력해주세요.</div>';
                return;
            }
            var url = apiBase() + '/api/search/place-images?query=' + encodeURIComponent(q);
            if (cfg.region) url += '&region=' + encodeURIComponent(cfg.region);

            fetch(url, { headers: headers() })
                .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
                .then(function (items) {
                    if (!Array.isArray(items) || !items.length) {
                        body.innerHTML = '<div class="pi-msg">이 장소의 사진을 찾지 못했습니다.<br>' +
                            '제목을 조금 더 정확한 가게 이름으로 바꿔보세요.</div>';
                        return;
                    }
                    render(items);
                })
                .catch(function () {
                    body.innerHTML = '<div class="pi-msg">사진을 불러오지 못했습니다.<br>잠시 후 다시 시도해주세요.</div>';
                });
        })();

        function render(items) {
            var grid = document.createElement('div');
            grid.className = 'pi-grid';
            items.forEach(function (it) {
                var cell = document.createElement('div');
                cell.className = 'pi-cell';
                cell.innerHTML =
                    '<span class="pi-no"></span>' +
                    '<span class="pi-src">' + esc(it.source || '') + '</span>';
                var img = document.createElement('img');
                img.alt = it.title || '';
                img.loading = 'lazy';
                img.referrerPolicy = 'no-referrer';   // 썸네일 핫링크 차단 회피
                img.src = it.thumbnail || it.url;
                img.onerror = function () { cell.remove(); };
                cell.insertBefore(img, cell.firstChild);

                cell.addEventListener('click', function () {
                    var i = picked.indexOf(it);
                    if (i >= 0) picked.splice(i, 1);
                    else {
                        if (picked.length >= limit) { toast('한 번에 ' + limit + '장까지 고를 수 있습니다'); return; }
                        picked.push(it);
                    }
                    renumber();
                    refreshBtn();
                });
                cell._item = it;
                grid.appendChild(cell);
            });

            function renumber() {
                Array.prototype.forEach.call(grid.children, function (c) {
                    var i = picked.indexOf(c._item);
                    c.classList.toggle('sel', i >= 0);
                    c.querySelector('.pi-no').textContent = i >= 0 ? String(i + 1) : '';
                });
            }

            body.innerHTML = '';
            body.appendChild(grid);
            var note = document.createElement('p');
            note.className = 'pi-note';
            note.textContent = '웹에서 검색된 사진입니다. 저작권은 각 출처에 있으니 우리 방 기록용으로만 사용해주세요.';
            body.appendChild(note);
        }

        // --- 추가 ---
        addBtn.addEventListener('click', function () {
            if (!picked.length) return;
            addBtn.disabled = true;
            addBtn.textContent = '가져오는 중…';

            var files = [];
            var seq = Promise.resolve();
            picked.forEach(function (it, idx) {
                seq = seq.then(function () {
                    return fetch(apiBase() + '/api/search/image-proxy?url=' + encodeURIComponent(it.url),
                        { headers: headers() })
                        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.blob(); })
                        .then(function (blob) {
                            files.push(new File([blob], 'place_' + Date.now() + '_' + idx + '.jpg',
                                { type: 'image/jpeg' }));
                        })
                        .catch(function () { /* 개별 실패는 건너뛴다 */ });
                });
            });

            seq.then(function () {
                if (!files.length) {
                    toast('사진을 가져오지 못했습니다');
                    addBtn.disabled = false;
                    refreshBtn();
                    return;
                }
                if (mgr) mgr.addFiles(files);
                close();
                toast(files.length + '장을 추가했어요' +
                    (files.length < picked.length ? ' (일부는 가져오지 못했어요)' : ''));
            });
        });
    }

    // ---------- 버튼 부착 ----------
    //  가볼곳 그리드의 '＋' 타일 바로 뒤에 같은 크기 타일 버튼을 넣는다.
    //  mgr.render() 가 그리드를 매번 새로 그리므로(innerHTML=''), render 를 래핑해
    //  매 렌더 직후 버튼을 다시 붙인다.
    function makeBtn(cfg) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pi-fetch';
        btn.innerHTML =
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/>' +
            '<path d="M21 16l-5-5-6 6"/></svg><span>장소 사진</span>';
        btn.addEventListener('click', function () {
            var q = (typeof cfg.query === 'function' ? cfg.query() : cfg.query) || '';
            q = String(q).trim();
            var r = (typeof cfg.region === 'function' ? cfg.region() : cfg.region) || '';
            open({ query: q, region: r, mgr: (typeof cfg.mgr === 'function' ? cfg.mgr() : cfg.mgr) });
        });
        return btn;
    }

    function attach(cfg) {
        var grid = document.getElementById(cfg.gridId);
        if (!grid || grid._piBound) return;
        grid._piBound = true;
        injectStyle();

        // 그리드 끝(＋ 다음)에 버튼을 붙인다. 이미 있으면 맨 끝으로만 옮긴다.
        function place() {
            var existing = grid.querySelector('.pi-fetch');
            if (existing) {
                if (existing !== grid.lastElementChild) grid.appendChild(existing); // 항상 맨 뒤 유지
                return;
            }
            grid.appendChild(makeBtn(cfg));
        }

        // 미디어 매니저의 render 는 클로저 내부 함수라 바깥에서 덮어도 reset/addFiles 가 부르는
        //  원본까지는 못 바꾼다. 그래서 render 래핑 대신 그리드 변화를 감시해 버튼을 다시 붙인다.
        //  (reset/추가/삭제/정렬로 그리드가 다시 그려질 때마다 재삽입 → 절대 사라지지 않는다)
        var scheduled = false;
        var mo = new MutationObserver(function () {
            if (scheduled) return;
            scheduled = true;
            // childList 변경 도중 재삽입하면 옵저버가 또 도니, 다음 틱으로 미뤄 무한루프를 막는다.
            requestAnimationFrame(function () { scheduled = false; place(); });
        });
        mo.observe(grid, { childList: true });

        place(); // 최초 1회
    }

    function val(id) {
        var el = document.getElementById(id);
        return el ? (el.value || '').trim() : '';
    }
    function text(id) {
        var el = document.getElementById(id);
        return el ? (el.textContent || '').trim() : '';
    }

    // ---------- 현재 확정된 장소 추적 ----------
    //  main.js 의 _pendingPlaceTitle 은 폼을 열면 곧바로 비워지므로, setPlace() 로 잠깐 붙들어 둔다.
    //  다만 '_place 를 최우선'으로 삼으면 모달이 열린 채 B 로 장소만 바꿨을 때
    //  openMemoryModal 이 다시 안 불려 A 가 굳는 문제가 생긴다.
    //  → 그래서 '지금 화면에 실제로 보이는 값'(제목 입력칸)을 최우선으로 읽는다.
    //    장소 검색으로 잡으면 제목칸이 그 상호명으로 채워지므로 사용자 기대와 일치하고,
    //    사용자가 제목을 직접 고쳤다면 그 제목으로 검색하는 게 오히려 자연스럽다.
    var _place = { name: '', region: '' };

    function setPlace(name, region) {
        // 조건 없이 항상 최신값으로 덮어쓴다(이전엔 '같으면 무시'였는데, 그 탓에 갱신이 씹혔다).
        _place = { name: (name || '').trim(), region: (region || '').trim() };
        close(); // 이전 장소로 열려 있던 후보 시트가 있으면 닫는다
    }

    function currentPlace(titleId) {
        // 우선순위: 화면에 보이는 제목칸 > 방금 확정한 장소(_place) > _pendingPlaceTitle
        //  제목칸을 최우선으로 두면 '모달 열린 채 장소만 바꾼' 경우에도 항상 현재 값을 따라간다.
        var t = titleId ? val(titleId) : '';
        if (t) return t;
        if (_place.name) return _place.name;
        if (global._pendingPlaceTitle) return String(global._pendingPlaceTitle).trim();
        return '';
    }

    // 가볼곳(체크리스트) 작성 폼에서만 사용한다. (추억 폼에서는 제거)
    function mount() {
        attach({
            gridId: 'cl-media-grid',
            mgr: function () { return global._clCreateMgr; },
            query: function () { return currentPlace('cl-title'); },
            region: function () { return regionHint(text('location-status-badge')) || _place.region; }
        });
    }

    Daylog.placeImages = {
        open: open,
        attach: attach,
        mount: mount,
        close: close,
        /** 장소가 확정/변경될 때 main.js 가 호출 → 다음 '사진 가져오기'가 새 장소로 검색된다.
         *  @param name   상호명 (예: "스타벅스 서울역점")
         *  @param region 지역 힌트 (예: "서울 중구") — 선택 */
        setPlace: setPlace,
        /** 장소 추적값을 비운다(폼을 닫거나 새로 열 때). 열린 시트도 닫는다. */
        reset: function () { _place = { name: '', region: '' }; close(); },
        /** openLayerStack() 에서 호출 — 뒤로가기/ESC 로 이 시트만 닫히게 한다 */
        layers: function () {
            var ov = document.getElementById('pi-overlay');
            return ov ? [{ name: 'pi-overlay', close: close }] : [];
        }
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
    else mount();
})(window);
// [E] edit by smsong