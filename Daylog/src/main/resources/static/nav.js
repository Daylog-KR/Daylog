// ==========================================================================
// [B] edit by smsong - #36 안드로이드 하드웨어 '뒤로가기' 대응 (main.html / rooms.html 공용)
//
//  문제
//   PWA(standalone)에서 안드로이드 뒤로가기를 누르면 히스토리에 쌓인 게 없어
//   폼/상세가 열려 있든 말든 앱이 그냥 종료됐다.
//
//  해결 방식
//   화면 위에 레이어(모달·시트·폼·오버레이)가 하나 열릴 때마다 히스토리에
//   '표식(sentinel)' 엔트리를 하나 밀어 넣는다. 뒤로가기를 누르면 그 표식이 소비되면서
//   popstate 가 뜨고, 우리는 '가장 위 레이어 하나'만 닫는다. 앱은 그대로 남는다.
//     추억 수정 폼 → (뒤로) → 추억 상세 → (뒤로) → 타임라인
//
//  레이어 목록은 페이지마다 다르므로 registerProvider() 로 주입한다.
//  아무도 등록하지 않으면 아래 기본 제공자(DOM 휴리스틱)가 동작한다.
//
//  ⚠ 열림/닫힘 호출부를 전부 고치지 않아도 되도록, 현재 열린 레이어 수를 주기적으로
//     확인해 표식 개수를 맞춘다(sync). 코드 어디서 닫든 히스토리가 어긋나지 않는다.
// ==========================================================================
(function (global) {
    'use strict';

    var providers = [];   // 각각 () => [{ name, close }] (위 → 아래 순서)
    var pushedLayers = 0; // 레이어용으로 밀어 넣은 표식 수
    var spare = 0;        // 여분 표식 1개 (뒤로 한 번에 바로 종료되지 않도록)
    var ignore = 0;       // 우리가 스스로 go(-n) 한 것에 대한 popstate 무시 횟수
    var exitArmed = false;
    var started = false;

    function push() {
        try { history.pushState({ dlNav: Date.now() }, ''); return true; } catch (e) { return false; }
    }

    function stack() {
        var out = [];
        for (var i = 0; i < providers.length; i++) {
            var got;
            try { got = providers[i]() || []; } catch (e) { got = []; }
            for (var j = 0; j < got.length; j++) {
                if (got[j] && typeof got[j].close === 'function') out.push(got[j]);
            }
        }
        return out;
    }

    // 현재 열린 레이어 수에 맞춰 표식 개수를 조정한다.
    function sync() {
        if (!started) return;
        var n = stack().length;
        if (n > pushedLayers) {
            while (pushedLayers < n) { if (!push()) break; pushedLayers++; }
        } else if (n < pushedLayers) {
            // 표식이 남아돈다(코드에서 직접 닫은 경우) → 그만큼 되감는다.
            //  혹시라도 카운트가 어긋났을 때 페이지 밖으로 튕겨 나가지 않도록 상한을 둔다.
            var d = Math.min(pushedLayers - n, 20);
            pushedLayers = n;
            if (d > 0) {
                ignore++;                   // go(-d) 는 popstate 를 1회만 발생시킨다
                try { history.go(-d); } catch (e) {}
            }
        }
    }

    function toast(msg) {
        if (typeof global.showToast === 'function') { global.showToast(msg); return; }
        var t = document.getElementById('toast');
        if (t) {
            t.textContent = msg; t.classList.add('show');
            setTimeout(function () { t.classList.remove('show'); }, 1800);
        }
    }

    function onPop() {
        if (ignore > 0) { ignore--; return; }

        var s = stack();
        if (s.length) {
            // 소비된 표식 = 레이어용. 가장 위 레이어 하나만 닫는다.
            pushedLayers = Math.max(0, pushedLayers - 1);
            try { s[0].close(); } catch (e) {}
            setTimeout(sync, 0);   // 닫힌 뒤 실제 레이어 수와 다시 맞춘다
            return;
        }

        // 열린 레이어가 없다 → 페이지 차원의 뒤로가기
        spare = 0;
        var handled = false;
        if (typeof global.DaylogNav.onEmpty === 'function') {
            try { handled = !!global.DaylogNav.onEmpty(); } catch (e) {}
        }
        if (handled) { if (push()) spare = 1; return; }

        if (exitArmed) return;   // 두 번째 → 표식을 다시 넣지 않는다 = 다음 뒤로가기에 앱 종료

        exitArmed = true;
        toast('뒤로가기를 한 번 더 누르면 종료됩니다');
        setTimeout(function () { exitArmed = false; }, 2000);
        if (push()) spare = 1;
    }

    function start() {
        if (started) return;
        started = true;
        window.addEventListener('popstate', onPop);
        if (push()) spare = 1;    // 여분 표식 1개 확보

        // 열림/닫힘 호출부를 일일이 고치지 않아도 되도록 상태를 따라간다.
        //  · 클릭/키 입력 직후(핸들러가 끝난 뒤)에 즉시 한 번
        //  · 그리고 주기적으로 한 번 더 (드래그로 시트를 닫는 등 이벤트 밖의 변화 대비)
        var defer = function () { setTimeout(sync, 0); };
        document.addEventListener('click', defer, true);
        document.addEventListener('keyup', defer, true);
        document.addEventListener('touchend', defer, true);
        document.addEventListener('pointerup', defer, true);
        setInterval(sync, 250);
    }

    global.DaylogNav = {
        /** 레이어 목록 제공자 등록. () => [{name, close}] (위 → 아래)
         *  페이지가 자기 레이어를 정확히 알려주면 기본 휴리스틱은 물러난다. */
        registerProvider: function (fn) {
            if (typeof fn !== 'function') return;
            if (defaultProvider) {
                var i = providers.indexOf(defaultProvider);
                if (i >= 0) providers.splice(i, 1);
                defaultProvider = null;
            }
            providers.push(fn);
            sync();
        },
        /** 레이어가 없을 때의 뒤로가기 처리. true 를 돌려주면 '처리됨'으로 본다. */
        onEmpty: null,
        /** 강제로 상태 재동기화 */
        sync: sync,
        /** 디버그용 */
        debug: function () {
            return { layers: stack().map(function (x) { return x.name; }), pushed: pushedLayers, spare: spare };
        }
    };

    // 기본 제공자 — 페이지가 별도 등록을 하지 않아도 흔한 오버레이는 잡아 준다.
    //  (rooms.html 처럼 자체 모달만 쓰는 페이지용. main.js 가 등록하면 자동으로 빠진다)
    var defaultProvider = function () {
        var out = [];
        // 위에 뜨는 것부터
        var pc = document.getElementById('pc-overlay');
        if (pc) out.push({ name: 'pc-overlay', close: function () { if (pc.parentNode) pc.parentNode.removeChild(pc); } });
        var ni = document.getElementById('ni-panel');
        if (ni) out.push({ name: 'ni-panel', close: function () {
            var ov = document.getElementById('ni-overlay');
            if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
            if (ni.parentNode) ni.parentNode.removeChild(ni);
        } });
        var nick = document.getElementById('nickname-modal');
        if (nick && !nick.classList.contains('hidden')) {
            out.push({ name: 'nickname-modal', close: function () { nick.classList.add('hidden'); } });
        }
        // 일반 모달 (.modal / .room-modal 중 열려 있는 것) — 나중에 선언된 것을 위로 본다
        var mods = document.querySelectorAll('.room-modal:not(.hidden), .modal:not(.hidden)');
        for (var i = mods.length - 1; i >= 0; i--) {
            (function (m) {
                if (m.id === 'nickname-modal') return;
                out.push({ name: m.id || 'modal', close: function () { m.classList.add('hidden'); } });
            })(mods[i]);
        }
        return out;
    };
    providers.push(defaultProvider);

    if (document.readyState === 'complete' || document.readyState === 'interactive') start();
    else document.addEventListener('DOMContentLoaded', start);
})(window);
// [E] edit by smsong
