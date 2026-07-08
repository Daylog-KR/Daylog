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
    return true;
}

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
function getRoomType() { return (localStorage.getItem('selectedRoomType') || 'COUPLE').toUpperCase(); }
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
function isPrivilegedUser() { var p = _myPerm(); return !!(p && (p.admin || p.canEdit)); }   // 수정 권한
function canManageObject(item) { return isPrivilegedUser(); }                                  // 수정 버튼 표시
function canTrashObject(item) { var p = _myPerm(); return !!(p && (p.admin || p.canTrash)); }  // 휴지통 버튼
function canDeleteObject() { var p = _myPerm(); return !!(p && (p.admin || p.canDelete)); }    // 영구삭제 버튼
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
    return fetch(Daylog.api + '/api/permissions/register', { method: 'POST', headers: Daylog.authHeaders(true) })
        .then(function (res) {
            if (!res.ok) { console.error('[Daylog] 권한 등록(register) 실패 - HTTP ' + res.status); throw new Error('HTTP ' + res.status); }
            return res.json();
        })
        .then(function (p) {
            Daylog.myPerm = p || null;
            applyMyPermUI();
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
        });
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
// [B] edit by smsong - 폭죽(축포) 연출: 화면 곳곳에서 여러 번 '파바박' 터지는 스파크 + 위에서 떨어지는 색종이.
//  커다란 원(링)은 제거. 스파크 수를 크게 늘리고, 전체 지속을 약 2.6초로 길게.
function fireWelcomeBurst() {
    var fx = document.getElementById('welcome-fx');
    if (!fx) return;
    fx.innerHTML = '';
    var colors = ['#b08968', '#e6ccb2', '#9c6644', '#cf8b8b', '#d1cbc1', '#e8b4b4', '#c9a27e', '#f0d9b5', '#f2c14e', '#e07a5f', '#81b29a'];

    var vw = window.innerWidth || 360;
    var vh = window.innerHeight || 640;
    var frag = document.createDocumentFragment();

    // ===== 1) 폭죽 터짐: 여러 지점에서 스태거드로 파바박 =====
    var BURSTS = 9;                       // 터지는 지점 수(여러 번 터짐)
    var SPARKS_PER_BURST = 34;            // 지점마다 사방으로 튀는 스파크 수
    for (var b = 0; b < BURSTS; b++) {
        // 터지는 위치: 화면 상단~중앙(가로 전체, 세로 10~65%)
        var cx = vw * (0.1 + Math.random() * 0.8);
        var cy = vh * (0.1 + Math.random() * 0.55);
        var burstDelay = Math.random() * 1.1;                 // 0~1.1s 사이 스태거 → 연속으로 터짐
        var reach = Math.min(vw, vh) * (0.22 + Math.random() * 0.18); // 터짐 반경
        var hue = colors[b % colors.length];
        for (var s = 0; s < SPARKS_PER_BURST; s++) {
            var p = document.createElement('span');
            p.className = 'wfx-spark';
            var ang = (Math.PI * 2) * (s / SPARKS_PER_BURST) + (Math.random() * 0.4 - 0.2);
            var dist = reach * (0.55 + Math.random() * 0.6);
            var size = 5 + Math.random() * 8;
            var tx = Math.cos(ang) * dist;
            var ty = Math.sin(ang) * dist + dist * 0.35;      // 중력 느낌(아래로 살짝 처짐)
            p.style.left = cx + 'px';
            p.style.top = cy + 'px';
            p.style.width = size + 'px';
            p.style.height = size + 'px';
            // 같은 폭죽은 비슷한 색 계열 + 가끔 다른 색 섞기
            p.style.background = (s % 5 === 0) ? colors[(b + s) % colors.length] : hue;
            p.style.setProperty('--tx', tx.toFixed(0) + 'px');
            p.style.setProperty('--ty', ty.toFixed(0) + 'px');
            p.style.setProperty('--sc', (0.5 + Math.random() * 0.8).toFixed(2));
            p.style.setProperty('--rot', ((Math.random() * 360 - 180) | 0) + 'deg');
            p.style.setProperty('--dur', (1.5 + Math.random() * 0.7).toFixed(2) + 's');
            p.style.setProperty('--delay', burstDelay.toFixed(2) + 's');
            if (s % 6 === 0) p.style.borderRadius = '1px'; // 일부는 각진 불꽃
            frag.appendChild(p);
        }
    }

    // ===== 2) 위에서 떨어지는 색종이(축포 리본 느낌) =====
    var CONFETTI = 70;
    for (var i = 0; i < CONFETTI; i++) {
        var c = document.createElement('span');
        c.className = 'wfx-confetti';
        var startX = vw * Math.random();
        var startY = -20 - Math.random() * 60;
        var w = 6 + Math.random() * 7;
        var h = 9 + Math.random() * 12;
        var driftX = (Math.random() * 120 - 60);
        var fallY = vh * (0.85 + Math.random() * 0.4);
        c.style.left = startX + 'px';
        c.style.top = startY + 'px';
        c.style.width = w + 'px';
        c.style.height = h + 'px';
        c.style.background = colors[i % colors.length];
        c.style.setProperty('--tx', driftX.toFixed(0) + 'px');
        c.style.setProperty('--ty', fallY.toFixed(0) + 'px');
        c.style.setProperty('--rot', ((Math.random() * 900 - 450) | 0) + 'deg');
        c.style.setProperty('--dur', (2.0 + Math.random() * 0.7).toFixed(2) + 's');
        c.style.setProperty('--delay', (Math.random() * 0.9).toFixed(2) + 's');
        frag.appendChild(c);
    }

    fx.appendChild(frag);

    // 애니메이션 종료 후 정리 (스태거 최대 ~1.1s + 지속 ~2.7s 여유)
    setTimeout(function () { if (fx) fx.innerHTML = ''; }, 3200);
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
            '<div class="perm-flags">' +
              permToggle(p, 'canCreate', '생성', lockToggles) +
              permToggle(p, 'canEdit', '수정', lockToggles) +
              permToggle(p, 'canTrash', '휴지통', lockToggles) +
              permToggle(p, 'canDelete', '삭제', lockToggles) +
            '</div>' +
        '</div>';
    });
    body.innerHTML = html;
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
function thumbHtml(mediaURL, cls) {
    const c = cls || 'tl-thumb';
    if (mediaURL) {
        return '<div class="' + c + '" style="background-image:url(\'' + mediaURL + '\')"></div>';
    }
    return '<div class="' + c + ' thumb-empty"><span class="thumb-empty-icon">' + icon('image',22) + '</span><span class="thumb-empty-text">이미지 없음</span></div>';
}

// [B] edit by smsong - 원본 이미지 URL → 서버가 만든 소형 썸네일(thumb_ 접두) URL 파생.
//  지도 마커/목록에서 원본(수 MB) 대신 썸네일을 써서 줌 인/아웃 시 재합성 부담 제거.
Daylog.thumbUrlOf = function (url) {
    if (!url) return url;
    var i = url.lastIndexOf('/');
    if (i < 0) return 'thumb_' + url;
    return url.substring(0, i + 1) + 'thumb_' + url.substring(i + 1);
};
// 썸네일이 아직 없거나(구버전 기록/HEIC 등) 로드 실패하면 원본으로 폴백
Daylog._thumbFallback = function (img) {
    img.onerror = null;
    var full = img.getAttribute('data-full');
    if (full && img.src !== full) img.src = full;
};
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
    // [E] edit by smsong
    Daylog.openChecklistDetailById = (id) => {
        const c = checklistList.find(x => x.id === id);
        if (c) openChecklistDetail(c);
    };

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

    // --- 로그아웃 ---
    document.getElementById('btn-logout').addEventListener('click', (e) => {
        e.preventDefault();
        if (confirm('로그아웃을 진행합니다.')) redirectToLogin('로그아웃 되었습니다.');
    });

    // [B] edit by smsong - main 상단 좌측 Daylog 로고 → 확인 후 방 목록으로 이동 (main 페이지 전용)
    const navLogo = document.querySelector('.navbar .logo');
    if (navLogo) {
        navLogo.style.cursor = 'pointer';
        navLogo.setAttribute('title', '방 목록으로 이동');
        navLogo.addEventListener('click', () => {
            if (confirm('방 목록으로 이동합니다.')) location.href = 'rooms.html';
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
            if (targetTab === 'tab-map' && map) {
                naver.maps.Event.trigger(map, 'resize');
            }
            // 즉시 캐시 화면을 보여주고(이미 그려져 있음), 백그라운드에서 조용히 최신화.
            // 데이터가 실제로 바뀐 경우에만 다시 그리므로 전환 속도 유지 + 깜빡임 없음.
            if (targetTab === 'tab-profile') loadProfiles();
            if (targetTab === 'tab-checklist') loadChecklistsFromServer();
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
            showToast('가볼곳 추가를 취소함');
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

        return fetch(`${API_BASE_URL}/api/memories/${currentUid}`, { headers: authHeaders(true) })
            .then(handleResponse)
            .then(memories => {
                const list = memories || [];
                const sig = _listSig(list);
                if (sig === _memSig) return; // 변경 없음 → 재렌더 생략(깜빡임 방지)
                _memSig = sig;
                memoryList = list;
                Daylog.memories = memoryList;
                preloadImages(list.map(m => m.mediaURL)); // [smsong] 썸네일/마커/상세 즉시 표시
                updateProfileStats();
                if (Daylog._applyRoomProfileMode) Daylog._applyRoomProfileMode(); // [smsong] 친구/가족 멤버뷰 카운트 갱신

                const sorted = [...memoryList].sort(sortByDateDesc);
                if (mapMode === 'memory') renderActiveMapMarkers();
                buildTimelinePlaceOptions();
                applyTimelineFilter();
            })
            .catch(err => console.error("데이터 로드 실패:", err));
    }

    // ==========================================
    //  가볼곳(체크리스트) — 로드 / 마커 / 목록 / 지도 전환
    // ==========================================
    function loadChecklistsFromServer() {
        if (!requireAuthOrRedirect()) return Promise.resolve();
        return fetch(`${API_BASE_URL}/api/checklists/${currentUid}`, { headers: authHeaders(true) })
            .then(handleResponse)
            .then(list => {
                const arr = list || [];
                checklistLoaded = true;
                const sig = _listSig(arr);
                if (sig === _clSig) return; // 변경 없음 → 재렌더 생략(깜빡임 방지)
                _clSig = sig;
                checklistList = arr;
                preloadImages(arr.map(c => c.mediaURL)); // [smsong] 썸네일/마커/상세 즉시 표시
                applyChecklistFilter();
                if (typeof updateChecklistStats === 'function') updateChecklistStats();
                if (Daylog._applyRoomProfileMode) Daylog._applyRoomProfileMode(); // [smsong] 멤버뷰 카운트 갱신
                if (mapMode === 'checklist') renderActiveMapMarkers();
            })
            .catch(err => console.error("가볼곳 로드 실패:", err));
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
                '<span class="cl-marker-title">' + escapeHtml(item.title || '가볼곳') + '</span>' +
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

    // 현재 모드 + 지도 필터를 적용해 마커 렌더
    function renderActiveMapMarkers() {
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
            action.title = isCl ? '가볼곳 추가' : '기록 남기기';
            // 추가 버튼은 색이 바뀌지 않도록 모드별 색 클래스를 적용하지 않음
        }
    }

    // 가볼곳 목록(탭) 렌더 — 타임라인과 유사한 카드 리스트
    function renderChecklistFeed(sorted) {
        const feed = document.getElementById('checklist-feed');
        if (!feed) return;
        feed.innerHTML = '';
        if (!sorted.length) {
            feed.innerHTML = '<div class="empty-state"><span class="es-icon">' + icon('bookmark',40) + '</span><p>아직 등록된 가볼곳이 없습니다</p></div>';
            return;
        }
        sorted.forEach(item => {
            const meta = checklistType(item.type);
            const card = document.createElement('div');
            card.className = 'cl-card' + (item.visited ? ' visited' : '');
            const badge = item.visited
                ? '<span class="cl-visited-badge">' + icon('check',12) + ' 다녀옴' + (item.visitedDate ? ' · ' + fmtDate(item.visitedDate) : '') + '</span>'
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
                (loc ? '<div class="cl-card-loc">' + icon('pin',13) + ' ' + escapeHtml(loc) + '</div>' : '') +
                commentBadgeHtml('checklist', item.id) +
                '</div>' +
                thumbHtml(item.mediaURL, 'cl-thumb');
            card.addEventListener('click', () => openChecklistDetail(item));
            feed.appendChild(card);
        });
        applyCommentBadges('checklist');
        fetchCommentCounts('checklist');
    }

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
                showToast('가볼곳을 추가했습니다');
                pickTarget = 'memory';
                // 다녀온 곳으로 추가하면 동일 위치에 추억도 자동 생성
                if (created && created.visited) {
                    // [B] edit by smsong - 동일 위치+제목 추억이 있으면 중복 생성 방지
                    ensureMemoryForChecklist(created)
                        .then((made) => { if (made) showToast('다녀온 곳이라 추억에도 기록했습니다'); })
                        .catch(err => console.warn('추억 자동 생성 실패', err));
                    // [E] edit by smsong
                }
                // [B] edit by smsong - 생성 직후 서버에서 최신 목록을 받아 지도에 바로 반영
                //  (기존: setMapMode 만 호출해 이미 로드된 '옛 목록'으로 마커를 그려 새 가볼곳이 안 보이던 문제)
                loadChecklistsFromServer().then(function () {
                    if (mapMode !== 'checklist') setMapMode('checklist');
                    else refreshMapMarkers();
                });
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
    }
    // 검색어(제목/내용/위치) 검색
    const tlKw = document.getElementById('tl-filter-keyword');
    const tlKwBtn = document.getElementById('tl-keyword-search');
    const runTlKeyword = () => { _tlKeyword = tlKw ? tlKw.value : ''; applyTimelineFilter(); };
    if (tlKwBtn) tlKwBtn.addEventListener('click', runTlKeyword);
    if (tlKw) tlKw.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runTlKeyword(); } });
    const tlFilterToggle = document.getElementById('tl-filter-toggle');
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
            if (memory.mediaURL) {
                // [B] edit by smsong - 지도 마커는 소형 썸네일(<img>)로 그림 → 줌 시 대용량 원본 재합성 제거(성능).
                //  썸네일이 없으면(구버전 기록/HEIC) onerror 로 원본 폴백.
                const _full = memory.mediaURL;
                const _thumb = Daylog.thumbUrlOf(_full);
                new Image().src = _thumb; // 썸네일 사전 캐싱
                markerHtml = '<div class="custom-marker' + nd + '"><img class="cm-photo" src="' + _thumb + '" data-full="' + _full + '" onerror="Daylog._thumbFallback(this)" alt="" decoding="async"></div>';
                // [E] edit by smsong
            } else {
                markerHtml = `<div class="marker-heart${nd}">${icon('book',26,'color:#b08968;')}</div>`;
            }
            // [B] edit by smsong - 마커 앵커를 '말풍선 아래 세모(꼬리) 끝'에 맞춰 실제 위치가 정확히 찍히도록 보정
            //  사진 마커: 56x56(사진46+패딩3*2+테두리2*2) 박스, 아래 세모 끝 ≈ (28, 62)
            //  하트 마커: 26px 아이콘, 하트 아래 끝 ≈ (13, 24)
            const _mkAnchor = memory.mediaURL ? new naver.maps.Point(28, 62) : new naver.maps.Point(13, 24);
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
    function renderTimeline(sorted) {
        const timelineFeed = document.getElementById('timeline-feed');
        timelineFeed.innerHTML = '';

        if (!sorted.length) {
            timelineFeed.innerHTML =
                '<div class="empty-state"><span class="es-icon">' + icon('book',40) + '</span>' +
                '<p>기록이 존재하지 않음</p></div>';
            return;
        }

        const groups = {};
        sorted.forEach(m => {
            const key = (m.createdAt || '').substring(0, 10) || '날짜미상';
            (groups[key] = groups[key] || []).push(m);
        });

        let idx = 0;
        Object.keys(groups).sort((a, b) => b.localeCompare(a)).forEach(dateKey => {
            const head = document.createElement('div');
            head.className = 'tl-date-head';
            head.innerHTML = '<span class="tl-date-dot"></span>' +
                '<span class="tl-date-label">' + escapeHtml(dateKey.replace(/-/g, '.')) + '</span>';
            timelineFeed.appendChild(head);

            groups[dateKey].forEach(memory => {
                const card = document.createElement('div');
                card.className = 'tl-card';

                const thumb = thumbHtml(memory.mediaURL, 'tl-thumb');

                card.innerHTML =
                    '<div class="tl-main">' +
                    '<h4 class="tl-title">' + escapeHtml(memory.title || '') + '</h4>' +
                    '<p class="tl-text">' + escapeHtml(memory.content || '') + '</p>' +
                    '<div class="tl-loc">' +
                    '<div class="tl-loc-row">' +
                    '<span class="tl-loc-icon">' + icon('pin',13) + '</span>' +
                    '<span class="tl-place"></span>' +
                    '</div>' +
                    '<span class="tl-addr"></span>' +
                    '</div>' +
                    commentBadgeHtml('memory', memory.id) +
                    '</div>' +
                    thumb;

                applyCardLocation(card, memory);
                card.addEventListener('click', () => openDetailModal(memory));
                timelineFeed.appendChild(card);
            });
        });
        applyCommentBadges('memory');   // 캐시 즉시 반영
        fetchCommentCounts('memory');   // 최신 수 갱신
    }

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

    function loadProfiles(force) {
        if (force) _profSig = null; // 명시적 변경(사진/닉네임/프로필 수정) 후엔 강제 재렌더
        if (!requireAuthOrRedirect()) return;
        fetch(`${API_BASE_URL}/user/all/${currentUid}`, { headers: authHeaders(true) })
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
                // 체크리스트 개수/목록도 준비 (이미 로드돼 있으면 라벨만 갱신)
                if (checklistLoaded) updateChecklistStats(); else loadChecklistsFromServer();
                maybePromptNickname();
            })
            .catch(err => {
                console.error("프로필 로드 실패(/user/all):", err);
                showToast('프로필 조회 실패: ' + (err.message || '서버 오류'));
                loadSelfProfileFallback();
            });
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

    document.getElementById('btn-edit-profile').addEventListener('click', openEditPage);
    const btnTrash = document.getElementById('btn-trash');
    if (btnTrash) btnTrash.addEventListener('click', openTrashModal);
    // [smsong] 방 목록으로 이동 (다른 방 선택 가능)
    const btnRooms = document.getElementById('btn-rooms');
    if (btnRooms) btnRooms.addEventListener('click', () => { location.href = 'rooms.html'; });
    const btnProfileLogout = document.getElementById('btn-profile-logout');
    if (btnProfileLogout) btnProfileLogout.addEventListener('click', () => {
        if (confirm('로그아웃을 진행합니다.')) redirectToLogin('로그아웃 되었습니다.');
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
    function applyRoomProfileMode() {
        var coupleView = document.getElementById('couple-view');
        var memberView = document.getElementById('member-view');
        if (typeof applyDdayVisibility === 'function') applyDdayVisibility(); // [smsong] 디데이 커플 전용 표시/숨김
        if (isCoupleRoom()) {
            if (coupleView) coupleView.style.display = '';
            if (memberView) memberView.style.display = 'none';
            return;
        }
        if (coupleView) coupleView.style.display = 'none';
        if (memberView) memberView.style.display = 'block';
        if (_memberCache) paintMemberGrid(_memberCache);
        else fetchMembersThenPaint();
    }
    function fetchMembersThenPaint() {
        var roomId = getRoomId();
        if (!roomId) return;
        fetch(`${API_BASE_URL}/api/rooms/${encodeURIComponent(roomId)}/members`, { headers: authHeaders(true) })
            .then(handleResponse)
            .then(room => { _memberCache = (room && room.members) || []; paintMemberGrid(_memberCache); })
            .catch(err => console.error('[Daylog] 멤버 뷰 로드 실패:', err));
    }
    function paintMemberGrid(members) {
        var container = document.getElementById('member-view');
        if (!container) return;
        var typeName = (getRoomType() === 'FAMILY') ? '가족' : '친구';
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
            card.innerHTML =
                `<div class="member-avatar">${avatar}</div>` +
                `<div class="member-info">` +
                    `<div class="member-name">${_escHtml(name)} ${ownerBadge}</div>` +
                `</div>` +
                // [B] edit by smsong - 추억/가볼곳 타일을 멤버 카드 오른쪽 끝에 배치
                `<div class="member-counts">` +
                    `<button class="member-count-btn" data-kind="mem"><b>${memCount}</b><span>추억</span></button>` +
                    `<button class="member-count-btn" data-kind="cl"><b>${clCount}</b><span>가볼곳</span></button>` +
                `</div>`;
            card.querySelector('[data-kind="mem"]').addEventListener('click', () => {
                var items = memoryList.filter(x => x.ownerUid === m.uid).sort(sortByDateDesc);
                Daylog._openListKind = null;
                openMemoryListModal(name + '의 추억', items);
            });
            card.querySelector('[data-kind="cl"]').addEventListener('click', () => {
                var items = checklistList.filter(x => x.ownerUid === m.uid).sort(sortByDateDesc);
                openChecklistListModal(name + '의 가볼곳', items);
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
        fetch(`${API_BASE_URL}/api/rooms/${encodeURIComponent(roomId)}/members`, { headers: authHeaders(true) })
            .then(handleResponse)
            .then(room => { Daylog.roomInfo = room; _memberCache = (room && room.members) || null; afterRoomInfo(); })
            .catch(err => console.error('[Daylog] 방 정보 로드 실패:', err));
    }
    function afterRoomInfo() {
        if (isCoupleRoom()) { loadProfiles(true); applyCoupleEditButtons(); }
        else applyRoomProfileMode();
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
        fetch(`${API_BASE_URL}/api/rooms/${encodeURIComponent(roomId)}/members`, { headers: authHeaders(true) })
            .then(handleResponse)
            .then(room => { Daylog.roomInfo = room; renderCouplePicker((room && room.members) || []); })
            .catch(err => { body.innerHTML = '<div class="perm-empty" style="padding:16px;color:#8a8178;">멤버를 불러오지 못했습니다.</div>'; console.error(err); });
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
    preloadImages(_clUrls); // [smsong] 상세 이미지 즉시 표시/스와이프
    const imageHtml = carouselHtml(_clUrls);

    view.innerHTML =
        '<div class="detail-container">' +
        '<div class="detail-header">' +
        '<span class="cl-type-tag cl-type-tag-lg" style="--cl-color:' + meta.color + '">' + meta.emoji + ' ' + meta.label + '</span>' +
        '<h2 class="detail-title">' + escapeHtml(item.title || '') + '</h2>' +
        '<div class="detail-author">' +
        '<div class="da-avatar" id="cl-author-avatar" style="background-image:url(\'' + authorPhoto + '\')"></div>' +
        '<span class="da-name">' + escapeHtml(authorName || '작성자') + '</span>' +
        '</div>' +
        '<div class="detail-meta">' +
        visitedHtml +
        (loc ? '<span class="meta-item meta-loc-clickable" id="cl-detail-loc" title="지도에서 보기">' + icon('pin',13) + ' ' + escapeHtml(loc) + '</span>' : '') +
        '</div>' +
        '</div>' +
        editedByHtml(item) + // [smsong] 마지막 수정 일시/수정자
        imageHtml +
        (item.content ? '<div class="detail-body"><p>' + contentHtml + '</p></div>' : '') +
        // [smsong] 가볼곳 댓글 영역 (추억과 동일, id는 cl- 접두어로 분리)
        '<div class="comments-section">' +
        '<div class="comments-head">' + icon('comment',15) + ' 댓글 <span class="comments-count" id="cl-comments-count">0</span></div>' +
        '<div class="comments-list" id="cl-comments-list"><div class="comments-loading">댓글을 불러오는 중…</div></div>' +
        '<div class="comment-compose">' +
        '<input type="text" class="comment-input" id="cl-new-comment-input" placeholder="댓글을 남겨보십시오" maxlength="1000">' +
        '<button type="button" class="comment-send-btn" id="cl-new-comment-send">등록</button>' +
        '</div>' +
        '</div>' +
        '</div>';

    const headerActions = document.getElementById('cl-detail-header-actions');
    if (headerActions) {
        // [smsong] 수정은 소유자/커플, 휴지통 이동은 작성자(소유자)만
        headerActions.innerHTML =
            (canManage ? '<button type="button" class="detail-edit-btn" id="cl-detail-edit-open" title="수정">' + icon('edit',16) + '</button>' : '') +
            (canTrashObject(item) ? '<button type="button" class="detail-trash-btn" id="cl-detail-del-open" title="휴지통">' + icon('trash',16) + '</button>' : '');
    }

    bindCarousel(document.getElementById('cl-detail-view'), _clUrls);
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
        .then(Daylog.handleResponse);
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
            showToast('수정 완료');
            closeChecklistDetail();
            Daylog.reloadChecklists();
            // 이번 수정에서 처음으로 '다녀옴'이 된 경우에만 추억 자동 생성
            // [B] edit by smsong - 재방문 토글(안가봄->갔다왔습니다)로 동일 추억이 중복 생성되지 않도록 dedup 처리
            if (updated && updated.visited && !wasVisited) {
                ensureMemoryForChecklist(updated)
                    .then((made) => { if (made) showToast('다녀온 곳이라 추억에도 기록했습니다'); })
                    .catch(err => console.warn('추억 자동 생성 실패', err));
            }
            // [E] edit by smsong
        })
        .catch(err => { console.error(err); showToast('수정 실패. 다시 시도해주십시오.'); })
        .finally(() => { if (btn) { btn.disabled = false; btn.innerText = '저장하기'; } });
}

function trashChecklist(id) {
    if (!confirm('이 가볼곳을 휴지통으로 옮기시겠습니까?')) return;
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
    preloadImages(_memUrls); // [smsong] 상세 이미지 즉시 표시/스와이프
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

    view.innerHTML =
        '<div class="detail-container">' +
        '<div class="detail-header">' +
        '<h2 class="detail-title">' + escapeHtml(memory.title || '') + '</h2>' +
        authorHtml +
        '<div class="detail-meta">' +
        '<span class="meta-item">' + icon('calendar',13) + ' ' + escapeHtml(dateStr) + '</span>' +
        '<span class="meta-item meta-loc-clickable" id="detail-loc" title="지도에서 보기">' + icon('pin',13) + ' 위치 확인 중…</span>' +
        '</div>' +
        '</div>' +
        editedByHtml(memory) + // [smsong] 마지막 수정 일시/수정자
        imageHtml +
        '<div class="detail-body"><p>' + contentHtml + '</p></div>' +
        // 댓글 영역
        '<div class="comments-section">' +
        '<div class="comments-head">' + icon('comment',15) + ' 댓글 <span class="comments-count" id="comments-count">0</span></div>' +
        '<div class="comments-list" id="comments-list"><div class="comments-loading">댓글을 불러오는 중…</div></div>' +
        '<div class="comment-compose">' +
        '<input type="text" class="comment-input" id="new-comment-input" placeholder="댓글을 남겨보십시오" maxlength="1000">' +
        '<button type="button" class="comment-send-btn" id="new-comment-send">등록</button>' +
        '</div>' +
        '</div>' +
        '</div>';

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
    fetch(`${Daylog.api}${path}`, { headers: Daylog.authHeaders(true) })
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
        });
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
    Promise.all([
        fetch(`${Daylog.api}/api/memories/trash/${uid}`, { headers: Daylog.authHeaders(true) }).then(Daylog.handleResponse).catch(() => []),
        fetch(`${Daylog.api}/comment/trash`, { headers: Daylog.authHeaders(true) }).then(Daylog.handleResponse).catch(() => []),
        fetch(`${Daylog.api}/api/checklists/trash/${uid}`, { headers: Daylog.authHeaders(true) }).then(Daylog.handleResponse).catch(() => [])
    ]).then(([memories, comments, checklists]) => {
        renderTrash(memories || [], comments || [], checklists || []);
    });
}

function closeTrashModal() {
    const modal = document.getElementById('trash-modal');
    if (modal) modal.classList.add('hidden');
}

function renderTrash(memories, comments, checklists) {
    const body = document.getElementById('trash-modal-body');
    if (!body) return;
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
            const thumb = m.mediaURL
                ? '<div class="lm-thumb" style="background-image:url(\'' + m.mediaURL + '\')"></div>'
                : '<div class="lm-thumb lm-thumb-empty">' + icon('book',22,'color:#b08968;') + '</div>';
            html +=
                '<div class="trash-row">' +
                thumb +
                '<div class="lm-row-main">' +
                '<div class="lm-row-date">' + escapeHtml(dateStr) + '</div>' +
                '<div class="lm-row-title">' + escapeHtml(m.title || '') + '</div>' +
                '<div class="lm-row-text">' + escapeHtml(m.content || '') + '</div>' +
                autoDeleteText(m) + // [smsong]
                '</div>' +
                '<div class="trash-actions">' +
                (canTrashObject() ? '<button type="button" class="trash-restore" onclick="restoreMemory(' + m.id + ')">복원</button>' : '') +
                (canDeleteObject() ? '<button type="button" class="trash-delete" onclick="deleteMemoryForever(' + m.id + ')">영구삭제</button>' : '') +
                '</div>' +
                '</div>';
        });
    }

    if (comments.length) {
        html += '<div class="trash-group-title">댓글 ' + comments.length + '</div>';
        comments.forEach(c => {
            const onTitle = c.memoryTitle ? ('"' + escapeHtml(c.memoryTitle) + '" 에 남긴 댓글') : '댓글';
            html +=
                '<div class="trash-row">' +
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
        html += '<div class="trash-group-title">가볼곳 ' + checklists.length + '</div>';
        checklists.forEach(c => {
            const meta = (typeof checklistType === 'function') ? checklistType(c.type) : { emoji: icon('bookmark',15), label: '' };
            const loc = [c.placeName, c.address].filter(Boolean).join(' ');
            html +=
                '<div class="trash-row">' +
                '<div class="lm-thumb lm-thumb-empty">' + meta.emoji + '</div>' +
                '<div class="lm-row-main">' +
                '<div class="lm-row-date">' + escapeHtml(meta.label || '가볼곳') + '</div>' +
                '<div class="lm-row-title">' + escapeHtml(c.title || '') + '</div>' +
                '<div class="lm-row-text">' + escapeHtml(loc) + '</div>' +
                autoDeleteText(c) + // [smsong]
                '</div>' +
                '<div class="trash-actions">' +
                (canTrashObject() ? '<button type="button" class="trash-restore" onclick="restoreChecklist(' + c.id + ')">복원</button>' : '') +
                (canDeleteObject() ? '<button type="button" class="trash-delete" onclick="deleteChecklistForever(' + c.id + ')">영구삭제</button>' : '') +
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
    if (!confirm('이 가볼곳을 영구적으로 삭제하시겠습니까?\n삭제하면 되돌릴 수 없습니다.')) return;
    withLoading(fetch(`${Daylog.api}/api/checklists/${id}`, { method: 'DELETE', headers: Daylog.authHeaders(true) }), '삭제 중...')
        .then(Daylog.handleResponse)
        .then(() => { showToast('영구 삭제했습니다'); openTrashModal(); })
        .catch(err => { console.error(err); showToast('삭제 실패'); });
}

// ===== 통계 클릭용 리스트 모달 / D-Day 정보 =====
function openMemoryListModal(title, items) {
    const modal = document.getElementById('list-modal');
    const titleEl = document.getElementById('list-modal-title');
    const body = document.getElementById('list-modal-body');
    if (!modal || !body) return;
    modal.classList.remove('dday-mode');
    modal.classList.add('list-fullscreen'); // [smsong] 풀스크린 스타일
    titleEl.textContent = title;
    body.innerHTML = '';

    if (!items || !items.length) {
        body.innerHTML = '<div class="empty-state"><span class="es-icon">' + icon('book',40,'color:#b08968;') + '</span><p>표시할 추억이 없습니다</p></div>';
    } else {
        items.forEach(memory => {
            const dateStr = memory.createdAt ? memory.createdAt.substring(0, 10).replace(/-/g, '.') : '';
            const thumb = memory.mediaURL
                ? `<div class="lm-thumb" style="background-image:url('${memory.mediaURL}')"></div>`
                : '<div class="lm-thumb lm-thumb-empty">' + icon('book',22,'color:#b08968;') + '</div>';
            const row = document.createElement('div');
            row.className = 'lm-row';
            row.innerHTML =
                thumb +
                '<div class="lm-row-main">' +
                '<div class="lm-row-date">' + escapeHtml(dateStr) + '</div>' +
                '<div class="lm-row-title">' + escapeHtml(memory.title || '') + '</div>' +
                '<div class="lm-row-text">' + escapeHtml(memory.content || '') + '</div>' +
                '</div>';
            row.addEventListener('click', () => openDetailModal(memory, true)); // [smsong] 목록 유지 + 상세를 그 위로
            body.appendChild(row);
        });
    }
    if (body) body.scrollTop = 0;
    modal.classList.remove('hidden');
}

function closeListModal() {
    const modal = document.getElementById('list-modal');
    if (modal) { modal.classList.add('hidden'); modal.classList.remove('dday-mode'); modal.classList.remove('list-fullscreen'); }
    Daylog._openListKind = null;
}

// 유저별 체크리스트 목록 모달 (추억 목록과 동일한 UI, 클릭 시 가볼곳 상세)
function openChecklistListModal(title, items) {
    const modal = document.getElementById('list-modal');
    const titleEl = document.getElementById('list-modal-title');
    const body = document.getElementById('list-modal-body');
    if (!modal || !body) return;
    modal.classList.remove('dday-mode');
    modal.classList.add('list-fullscreen'); // [smsong] 풀스크린 스타일
    Daylog._openListKind = null; // 새로고침 시 추억 목록 재구성 로직과 분리
    titleEl.textContent = title;
    body.innerHTML = '';

    if (!items || !items.length) {
        body.innerHTML = '<div class="empty-state"><span class="es-icon">' + icon('bookmark',40) + '</span><p>표시할 가볼곳이 없습니다</p></div>';
    } else {
        items.forEach(item => {
            const meta = (typeof checklistType === 'function') ? checklistType(item.type) : { emoji: icon('bookmark',15), label: '' };
            const loc = [item.placeName, item.address].filter(Boolean).join(' ');
            const thumb = item.mediaURL
                ? `<div class="lm-thumb" style="background-image:url('${item.mediaURL}')"></div>`
                : '<div class="lm-thumb lm-thumb-empty">' + meta.emoji + '</div>';
            const badge = item.visited
                ? '<span class="cl-visited-badge">' + icon('check',12) + ' 다녀옴</span>'
                : '<span class="cl-todo-badge">가볼 예정</span>';
            const row = document.createElement('div');
            row.className = 'lm-row';
            row.innerHTML =
                thumb +
                '<div class="lm-row-main">' +
                '<div class="lm-row-date">' + escapeHtml(meta.label || '가볼곳') + ' · ' + badge + '</div>' +
                '<div class="lm-row-title">' + escapeHtml(item.title || '') + '</div>' +
                '<div class="lm-row-text">' + escapeHtml(loc || (item.content || '')) + '</div>' +
                '</div>';
            row.addEventListener('click', () => openChecklistDetail(item, true)); // [smsong] 목록 유지 + 상세를 그 위로
            body.appendChild(row);
        });
    }
    if (body) body.scrollTop = 0;
    modal.classList.remove('hidden');
}

function showDDayInfo() {
    const modal = document.getElementById('list-modal');
    const titleEl = document.getElementById('list-modal-title');
    const body = document.getElementById('list-modal-body');
    if (!modal || !body) return;
    var since = getDdayStart();
    var canEdit = isCoupleRoom() && isRoomOwner();
    titleEl.innerHTML = 'D-Day';
    var html = '<div class="dday-info">';
    if (since) {
        const start = new Date(since);
        const y = start.getFullYear(), m = start.getMonth() + 1, d = start.getDate();
        const n = daysSince(since);
        html += '<div class="dday-info-emoji">' + icon('calendar', 28) + '</div>' +
                '<div class="dday-info-label">우리가 만난 날</div>' +
                '<div class="dday-info-date">' + y + '년 ' + m + '월 ' + d + '일</div>' +
                '<div class="dday-info-count">오늘로 <b>D+' + n + '</b> 일째</div>';
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
function carouselHtml(urls) {
    if (!urls || !urls.length) return '';
    if (urls.length === 1) {
        return '<div class="detail-image-wrap"><img src="' + urls[0] + '" alt="사진" class="detail-single-img"></div>';
    }
    let slides = '';
    urls.forEach(u => { slides += '<div class="carousel-slide"><img src="' + u + '" alt="사진"></div>'; });
    let dots = '';
    urls.forEach((u, i) => { dots += '<span class="carousel-dot' + (i === 0 ? ' active' : '') + '" data-i="' + i + '"></span>'; });
    return '<div class="detail-carousel">' +
        '<div class="carousel-count"><span class="cc-cur">1</span>/' + urls.length + '</div>' +
        '<div class="carousel-viewport"><div class="carousel-track">' + slides + '</div></div>' +
        '<button type="button" class="carousel-arrow prev" disabled>&#8249;</button>' +
        '<button type="button" class="carousel-arrow next">&#8250;</button>' +
        '<div class="carousel-dots">' + dots + '</div>' +
        '</div>';
}

// 캐러셀 동작 바인딩 (스와이프 + 화살표 + 점 + 탭→라이트박스)
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
    let idx = 0, startX = 0, startY = 0, dx = 0, dy = 0, dragging = false, moved = false, axis = null;

    function go(i) {
        idx = Math.max(0, Math.min(urls.length - 1, i));
        track.style.transition = 'transform 0.32s cubic-bezier(.22,.61,.36,1)';
        track.style.transform = 'translateX(' + (-idx * 100) + '%)';
        dots.forEach((d, di) => d.classList.toggle('active', di === idx));
        if (prev) prev.disabled = idx === 0;
        if (next) next.disabled = idx === urls.length - 1;
        if (cur) cur.textContent = (idx + 1);
    }
    if (prev) prev.addEventListener('click', () => go(idx - 1));
    if (next) next.addEventListener('click', () => go(idx + 1));
    dots.forEach(d => d.addEventListener('click', () => go(+d.dataset.i)));
    slides.forEach((s, si) => s.querySelector('img').addEventListener('click', () => { if (!moved) openLightbox(urls, s.querySelector('img'), si); }));

    const vp = car.querySelector('.carousel-viewport');
    // 뷰포트 높이를 '첫 번째 사진' 비율로 맞춤 (나머지는 잘리지 않고 contain)
    if (vp && urls[0]) {
        const im0 = new Image();
        im0.onload = () => { if (im0.naturalWidth && im0.naturalHeight) vp.style.aspectRatio = im0.naturalWidth + ' / ' + im0.naturalHeight; };
        im0.src = urls[0];
    }
    // [B] edit by smsong - 방향 잠금(directional lock): 가로 제스처면 사진만 넘기고,
    //  세로 제스처면 손을 떼 브라우저가 페이지를 스크롤하게 둔다(뷰포트 CSS: touch-action:pan-y).
    //  포인터 캡처는 '가로'로 확정된 뒤에만 → 세로 스크롤을 가로채지 않음.
    let captured = false;
    vp.addEventListener('pointerdown', (e) => {
        dragging = true; moved = false; axis = null; captured = false;
        startX = e.clientX; startY = e.clientY; dx = 0; dy = 0;
        track.style.transition = 'none';
    });
    vp.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        dx = e.clientX - startX;
        dy = e.clientY - startY;
        // 첫 유의미한 이동에서 축 결정 (가로 우세 → 사진 넘김 / 세로 우세 → 페이지 스크롤에 양보)
        if (!axis && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
            axis = (Math.abs(dx) > Math.abs(dy)) ? 'x' : 'y';
            if (axis === 'x') {
                try { vp.setPointerCapture(e.pointerId); captured = true; } catch (_) {}
            } else {
                // 세로: 드래그 종료하고 브라우저 스크롤에 맡김
                dragging = false;
                return;
            }
        }
        if (axis !== 'x') return;
        if (Math.abs(dx) > 6) moved = true;
        track.style.transform = 'translateX(calc(' + (-idx * 100) + '% + ' + dx + 'px))';
    });
    const endSwipe = (e) => {
        if (captured && e && e.pointerId != null) { try { vp.releasePointerCapture(e.pointerId); } catch (_) {} }
        captured = false;
        if (!dragging) { axis = null; return; }
        dragging = false;
        if (axis === 'x') { // 가로 제스처일 때만 넘김 판정
            if (dx < -50 && idx < urls.length - 1) go(idx + 1);
            else if (dx > 50 && idx > 0) go(idx - 1);
            else go(idx);
        }
        axis = null;
        setTimeout(() => { moved = false; }, 30);
    };
    // [E] edit by smsong
    vp.addEventListener('pointerup', endSwipe);
    vp.addEventListener('pointercancel', endSwipe);
    go(0);
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