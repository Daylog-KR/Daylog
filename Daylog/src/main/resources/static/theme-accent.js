// [B] edit by smsong - 기기별 테마 색상 커스터마이징 (프리셋 + 커스텀 색상 피커 + hex 입력).
//  · localStorage('daylog_accent') 에 기기 로컬로만 저장(백엔드 미연동). 값이 '#'로 시작하면 커스텀 색.
//  · 프리셋: :root[data-accent="id"] 가 --primary 계열을 CSS 로 오버라이드.
//  · 커스텀: data-accent="custom" + documentElement 인라인 스타일로 --primary/-dark/-light 를 계산해 주입.
//    라이트/다크에서 색이 자연스럽도록 HSL 로 파생(다크 전환 시 자동 재계산).
//  · 뒤로가기/취소로 닫으면 열기 전 색으로 되돌림(미확정), '완료'만 저장.
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

    // ---------- color utils ----------
    function clamp(x, a, b) { return Math.min(b, Math.max(a, x)); }
    function hexToRgb(h) { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join(''); var n = parseInt(h, 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; }
    function rgbToHex(r, g, b) { return '#' + [r, g, b].map(function (x) { return clamp(Math.round(x), 0, 255).toString(16).padStart(2, '0'); }).join(''); }
    function rgbToHsl(r, g, b) { r /= 255; g /= 255; b /= 255; var mx = Math.max(r, g, b), mn = Math.min(r, g, b), h, s, l = (mx + mn) / 2; if (mx === mn) { h = s = 0; } else { var d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); switch (mx) { case r: h = (g - b) / d + (g < b ? 6 : 0); break; case g: h = (b - r) / d + 2; break; default: h = (r - g) / d + 4; } h /= 6; } return { h: h * 360, s: s, l: l }; }
    function hslToRgb(h, s, l) { h /= 360; var r, g, b; if (s === 0) { r = g = b = l; } else { var q = l < 0.5 ? l * (1 + s) : l + s - l * s; var p = 2 * l - q; var f = function (t) { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; }; r = f(h + 1 / 3); g = f(h); b = f(h - 1 / 3); } return { r: r * 255, g: g * 255, b: b * 255 }; }
    function hslToHex(h, s, l) { var c = hslToRgb(h, s, l); return rgbToHex(c.r, c.g, c.b); }
    function rgbToHsv(r, g, b) { r /= 255; g /= 255; b /= 255; var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, h, s = mx === 0 ? 0 : d / mx, v = mx; if (mx === mn) h = 0; else { switch (mx) { case r: h = (g - b) / d + (g < b ? 6 : 0); break; case g: h = (b - r) / d + 2; break; default: h = (r - g) / d + 4; } h /= 6; } return { h: h * 360, s: s, v: v }; }
    function hsvToRgb(h, s, v) { h /= 360; var i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s), r, g, b; switch (i % 6) { case 0: r = v; g = t; b = p; break; case 1: r = q; g = v; b = p; break; case 2: r = p; g = v; b = t; break; case 3: r = p; g = q; b = v; break; case 4: r = t; g = p; b = v; break; default: r = v; g = p; b = q; } return { r: r * 255, g: g * 255, b: b * 255 }; }
    function normalizeHex(str) { if (!str) return null; str = String(str).trim(); if (str[0] !== '#') { if (/^[0-9a-fA-F]{3}$/.test(str) || /^[0-9a-fA-F]{6}$/.test(str)) str = '#' + str; } if (/^#[0-9a-fA-F]{3}$/.test(str)) { str = '#' + str.slice(1).split('').map(function (c) { return c + c; }).join(''); } if (/^#[0-9a-fA-F]{6}$/.test(str)) return str.toLowerCase(); var m = str.match(/rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/i); if (m) return rgbToHex(+m[1], +m[2], +m[3]); return null; }

    function deriveVars(hex, dark) {
        var c = hexToRgb(hex), hsl = rgbToHsl(c.r, c.g, c.b), h = hsl.h, s = hsl.s, l = hsl.l;
        if (!dark) {
            return { p: hex, d: hslToHex(h, clamp(s * 1.02, 0, 1), clamp(l * 0.80, 0.12, 0.92)), l: hslToHex(h, clamp(s * 0.72, 0, 1), 0.93) };
        }
        var pL = clamp(l < 0.5 ? 0.68 : l, 0.60, 0.82);
        return { p: hslToHex(h, clamp(s * 0.90, 0, 1), pL), d: hslToHex(h, clamp(s * 0.70, 0, 1), clamp(pL + 0.12, 0, 0.9)), l: hslToHex(h, clamp(s * 0.50, 0, 1), 0.22) };
    }

    var ROOT = document.documentElement;
    function saved() { try { return localStorage.getItem(KEY) || DEFAULT; } catch (e) { return DEFAULT; } }
    function isCustom(v) { return typeof v === 'string' && v.charAt(0) === '#'; }

    // 미리보기(저장 안 함)
    var currentValue = DEFAULT, openingValue = DEFAULT, committed = false;
    function preview(value) {
        currentValue = value;
        if (isCustom(value)) {
            var v = deriveVars(value, ROOT.getAttribute('data-theme') === 'dark');
            ROOT.style.setProperty('--primary', v.p);
            ROOT.style.setProperty('--primary-dark', v.d);
            ROOT.style.setProperty('--primary-light', v.l);
            ROOT.setAttribute('data-accent', 'custom');
        } else {
            ROOT.style.removeProperty('--primary');
            ROOT.style.removeProperty('--primary-dark');
            ROOT.style.removeProperty('--primary-light');
            ROOT.setAttribute('data-accent', value);
        }
        markTiles(isCustom(value) ? null : value);
    }
    function commit() { try { localStorage.setItem(KEY, currentValue); } catch (e) {} }

    function markTiles(id) {
        var grid = document.getElementById('ac-grid'); if (!grid) return;
        Array.prototype.forEach.call(grid.querySelectorAll('.ac-tile'), function (el) {
            var on = el.getAttribute('data-accent') === id;
            el.classList.toggle('on', on);
        });
    }

    function getCurrentHex() {
        if (isCustom(currentValue)) return currentValue;
        var c = getComputedStyle(ROOT).getPropertyValue('--primary');
        return normalizeHex(c) || '#647394';
    }

    // ---------- modal ----------
    var modal = null, hsv = { h: 0, s: 1, v: 1 };
    var el = {};
    function modalClass() { var b = document.getElementById('btn-accent'); return (b && b.getAttribute('data-modal-class')) || 'modal'; }

    function buildModal() {
        if (modal) return;
        modal = document.createElement('div');
        modal.id = 'accent-modal';
        modal.className = modalClass() + ' hidden';
        var ck = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        var tiles = '';
        ACCENTS.forEach(function (a) {
            tiles += '<button type="button" class="ac-tile" data-accent="' + a.id + '" style="--c:' + a.color + '" aria-label="' + a.name + '">' +
                '<span class="ac-dot"></span><span class="ac-nm">' + a.name + '</span><span class="ac-ck">' + ck + '</span></button>';
        });
        modal.innerHTML =
            '<div id="ac-card" role="dialog" aria-modal="true" aria-label="테마 색상 선택">' +
                '<div class="ac-head"><h3>테마 색상</h3><button type="button" class="ac-x" aria-label="닫기">&times;</button></div>' +
                '<p class="ac-desc">이 기기에만 적용되는 포인트 색상이에요.</p>' +
                '<div class="ac-tabs"><button type="button" data-tab="std" class="on">표준</button><button type="button" data-tab="custom">사용자 지정</button></div>' +
                '<div class="ac-pane on" data-pane="std"><div id="ac-grid" class="ac-grid">' + tiles + '</div></div>' +
                '<div class="ac-pane" data-pane="custom">' +
                    '<div class="ac-sv" id="ac-sv"><span class="ac-sv-thumb" id="ac-sv-thumb"></span></div>' +
                    '<div class="ac-hue" id="ac-hue"><span class="ac-hue-thumb" id="ac-hue-thumb"></span></div>' +
                    '<div class="ac-fields"><div class="ac-prev" id="ac-prev"></div>' +
                        '<div class="ac-hexwrap"><label>색상 코드 (HEX)</label>' +
                        '<input id="ac-hex" type="text" maxlength="7" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="#RRGGBB"></div></div>' +
                    '<div class="ac-rgb"><div>빨간색<b id="ac-r">0</b></div><div>녹색<b id="ac-g">0</b></div><div>파란색<b id="ac-b">0</b></div></div>' +
                '</div>' +
                '<div class="ac-foot"><button type="button" class="ac-cancel">취소</button><button type="button" class="ac-done">완료</button></div>' +
            '</div>';
        document.body.appendChild(modal);

        el.sv = modal.querySelector('#ac-sv'); el.svT = modal.querySelector('#ac-sv-thumb');
        el.hue = modal.querySelector('#ac-hue'); el.hueT = modal.querySelector('#ac-hue-thumb');
        el.prev = modal.querySelector('#ac-prev'); el.hex = modal.querySelector('#ac-hex');
        el.r = modal.querySelector('#ac-r'); el.g = modal.querySelector('#ac-g'); el.b = modal.querySelector('#ac-b');

        // 닫기(취소) 경로
        modal.addEventListener('click', function (e) { if (e.target === modal) close(false); });
        modal.querySelector('.ac-x').addEventListener('click', function () { close(false); });
        modal.querySelector('.ac-cancel').addEventListener('click', function () { close(false); });
        modal.querySelector('.ac-done').addEventListener('click', function () { close(true); });

        // 탭 전환
        modal.querySelector('.ac-tabs').addEventListener('click', function (e) {
            var b = e.target.closest('button[data-tab]'); if (!b) return;
            switchTab(b.getAttribute('data-tab'));
        });

        // 표준 그리드
        modal.querySelector('#ac-grid').addEventListener('click', function (e) {
            var t = e.target.closest('.ac-tile'); if (!t) return;
            preview(t.getAttribute('data-accent'));
        });

        // SV 영역 드래그
        function svAt(e) {
            var r = el.sv.getBoundingClientRect();
            hsv.s = clamp((e.clientX - r.left) / r.width, 0, 1);
            hsv.v = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
            renderCustom(false);
        }
        el.sv.addEventListener('pointerdown', function (e) { el.sv.setPointerCapture(e.pointerId); svAt(e); });
        el.sv.addEventListener('pointermove', function (e) { if (e.buttons) svAt(e); });

        // 색조 슬라이더 드래그
        function hueAt(e) {
            var r = el.hue.getBoundingClientRect();
            hsv.h = clamp((e.clientX - r.left) / r.width, 0, 1) * 360;
            renderCustom(false);
        }
        el.hue.addEventListener('pointerdown', function (e) { el.hue.setPointerCapture(e.pointerId); hueAt(e); });
        el.hue.addEventListener('pointermove', function (e) { if (e.buttons) hueAt(e); });

        // hex 입력 → 자동 적용
        el.hex.addEventListener('input', function () {
            var hx = normalizeHex(el.hex.value);
            if (hx) { var c = hexToRgb(hx); hsv = rgbToHsv(c.r, c.g, c.b); renderCustom(true); }
        });

        // 뒤로가기 등 외부에서 hidden 이 붙으면 취소로 간주해 되돌림
        new MutationObserver(function () {
            if (modal.classList.contains('hidden')) {
                if (!committed) preview(openingValue);
                committed = false;
            }
        }).observe(modal, { attributes: true, attributeFilter: ['class'] });
    }

    // fromHex=true 이면 hex 입력칸은 덮어쓰지 않음(커서 튐 방지)
    function renderCustom(fromHex) {
        var rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
        var hex = rgbToHex(rgb.r, rgb.g, rgb.b);
        var pure = hslToHex(hsv.h, 1, 0.5);
        el.svT.style.left = (hsv.s * 100) + '%';
        el.svT.style.top = ((1 - hsv.v) * 100) + '%';
        el.sv.style.setProperty('--hue', pure);
        el.hueT.style.left = (hsv.h / 360 * 100) + '%';
        el.hueT.style.setProperty('--hue', pure);
        el.prev.style.setProperty('--prev', hex);
        el.r.textContent = Math.round(rgb.r); el.g.textContent = Math.round(rgb.g); el.b.textContent = Math.round(rgb.b);
        if (!fromHex) el.hex.value = hex.toUpperCase();
        preview(hex);
    }

    function initCustomFrom(hex) {
        var c = hexToRgb(hex); hsv = rgbToHsv(c.r, c.g, c.b); renderCustom(false);
    }

    function switchTab(tab) {
        Array.prototype.forEach.call(modal.querySelectorAll('.ac-tabs button'), function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === tab); });
        Array.prototype.forEach.call(modal.querySelectorAll('.ac-pane'), function (p) { p.classList.toggle('on', p.getAttribute('data-pane') === tab); });
        if (tab === 'custom') initCustomFrom(getCurrentHex());
    }

    function open() {
        buildModal();
        openingValue = saved(); currentValue = openingValue; committed = false;
        switchTab('std');
        markTiles(isCustom(openingValue) ? null : openingValue);
        modal.classList.remove('hidden');
        try { if (window.DaylogNav && window.DaylogNav.sync) window.DaylogNav.sync(); } catch (e) {}
    }
    function close(save) {
        committed = !!save;
        if (save) commit();
        if (modal) modal.classList.add('hidden');
        try { if (window.DaylogNav && window.DaylogNav.sync) window.DaylogNav.sync(); } catch (e) {}
    }
    function onKey(e) { if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) close(false); }

    function init() {
        var s = saved();
        preview(s);                 // 저장값을 화면에 반영(저장은 안 함)
        var btn = document.getElementById('btn-accent');
        if (btn) btn.addEventListener('click', function (e) { e.preventDefault(); open(); });
        document.addEventListener('keydown', onKey);
        // 다크/라이트 전환 시 커스텀 색을 그 테마에 맞게 재계산
        new MutationObserver(function () {
            if (isCustom(currentValue)) {
                var v = deriveVars(currentValue, ROOT.getAttribute('data-theme') === 'dark');
                ROOT.style.setProperty('--primary', v.p);
                ROOT.style.setProperty('--primary-dark', v.d);
                ROOT.style.setProperty('--primary-light', v.l);
            }
        }).observe(ROOT, { attributes: true, attributeFilter: ['data-theme'] });
    }

    window.Daylog = window.Daylog || {};
    window.Daylog.applyAccent = function (v) { preview(v); commit(); };
    window.Daylog.openAccentPicker = open;

    if (document.readyState === 'complete' || document.readyState === 'interactive') init();
    else document.addEventListener('DOMContentLoaded', init);
})();
