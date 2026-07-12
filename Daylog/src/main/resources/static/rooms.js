// =====================================================
// Daylog — 방 목록 (셋로그 스타일)
// 로그인 후 진입: 방 목록 → 방 입장 → main.html
// 방은 초대 코드로 멤버가 모여, 그 방 멤버끼리만 추억/가볼곳 공유
// =====================================================

const CFG = window.APP_CONFIG || {};
const API_BASE = (CFG && CFG.BACKEND_BASE) || 'http://localhost:8086';
const TOKEN_KEY = 'accessToken';

// 로그인 관련 로컬스토리지 키 (일괄 정리용)
const AUTH_KEYS = ['accessToken', 'currentUser', 'auth', 'selectedRoomId', 'selectedRoomName', 'selectedRoomType', 'selectedRoomOwnerUid'];

function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }

function decodeJwt(token) {
    try {
        const part = token.split('.')[1];
        const json = decodeURIComponent(
            atob(part.replace(/-/g, '+').replace(/_/g, '/'))
                .split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
        );
        return JSON.parse(json);
    } catch (e) { return null; }
}

function authHeaders(withJson) {
    const h = {};
    if (withJson) h['Content-Type'] = 'application/json';
    const t = getToken();
    if (t) h['Authorization'] = 'Bearer ' + t;
    return h;
}

// [B] edit by smsong - 권한 API(reject-seen/dismiss)는 방을 X-Room-Id 헤더로 구분
function roomHeaders(roomId) {
    const h = authHeaders(false);
    if (roomId != null) h['X-Room-Id'] = String(roomId);
    return h;
}

// =====================================================
// ⭐ 무한 리다이렉트 차단의 핵심:
//   로그인 화면으로 돌려보낼 때는 "항상" 토큰을 먼저 지운다.
//   그래야 login.js 가 남아있는 토큰을 보고 다시 rooms 로 튕기지 않는다.
//   (login → rooms → login → rooms ... 루프의 종료 조건 확보)
// =====================================================
// main.js 와 동일한 문구: 토큰 없음/만료 시 안내 후 로그인 화면으로.
const AUTH_EXPIRED_MSG = '토큰이 만료되었거나 존재하지 않습니다. 다시 로그인해주십시오.';
let __redirecting = false;
function gotoLoginCleared(msg) {
    if (__redirecting) return;      // 중복 호출/중복 alert 방지
    __redirecting = true;
    if (msg) alert(msg);            // 안내 메시지 (main.js 와 동일 패턴)
    AUTH_KEYS.forEach(k => localStorage.removeItem(k)); // 토큰 제거 → login.js 되튕김 방지
    location.replace('login.html');
}

// ===== 인증 가드 =====
const token = getToken();
const payload = decodeJwt(token);
const expired = !!(payload && payload.exp && Date.now() >= payload.exp * 1000);
const uid = payload && (payload.sub || payload.uid || payload.username || payload.userId);

// 토큰 없음 / 디코드 실패 / 만료 / uid 추출 불가 → 토큰 정리 후 로그인으로
const validSession = !!token && !!payload && !expired && !!uid;
if (!validSession) {
    gotoLoginCleared(AUTH_EXPIRED_MSG);
}

// ===== 엘리먼트 =====
const listEl = document.getElementById('rooms-list');
const emptyEl = document.getElementById('rooms-empty');
const modalEl = document.getElementById('room-modal');
const modalTitle = document.getElementById('room-modal-title');
const modalDesc = document.getElementById('room-modal-desc');
const modalInput = document.getElementById('room-modal-input');
const modalOk = document.getElementById('room-modal-ok');
const modalCancel = document.getElementById('room-modal-cancel');
const pasteRow = document.getElementById('room-paste-row');   // [B] edit by smsong
const pasteBtn = document.getElementById('room-modal-paste'); // [B] edit by smsong
const typeRow = document.getElementById('room-type-row');
const ddayRow = document.getElementById('room-dday-row');
const ddayInput = document.getElementById('room-dday-input');
// [smsong] 상단 탭
const tabMemberEl = document.getElementById('tab-member'); // 내가 속한 방
const tabOwnerEl = document.getElementById('tab-owner');   // 내가 방장인 방
const tabPendingEl = document.getElementById('tab-pending'); // [smsong] 요청 대기중인 방
const mainEl = document.querySelector('.rooms-main');

// [B] edit by smsong - 코드 입장 미리보기 모달
const previewModalEl = document.getElementById('preview-modal');
const previewThumbEl = document.getElementById('preview-thumb');
const previewNameEl = document.getElementById('preview-name');
const previewTypeEl = document.getElementById('preview-type');
const previewCountEl = document.getElementById('preview-count');
const previewNoteEl = document.getElementById('preview-note');
const previewOkBtn = document.getElementById('preview-ok');
const previewCancelBtn = document.getElementById('preview-cancel');
// 거절 안내 모달
const rejectModalEl = document.getElementById('reject-modal');
const rejectReasonEl = document.getElementById('reject-reason');
const rejectOkBtn = document.getElementById('reject-ok');
let previewRoom = null; // 미리보기 중인 방
let previewCode = null; // 미리보기 중 입력한 초대 코드(요청 전송 시 사용)
// [E] edit by smsong

let modalMode = null; // 'create' | 'join' | 'rename'
let selectedType = null; // [smsong] 방 생성 시 기본 미선택
let currentView = 'member'; // [smsong] 'member'(내가 속한 방) | 'owner'(내가 방장인 방) | 'pending'(요청 대기중인 방)
let myRooms = []; // [smsong] 내가 속한 방 원본(한 번 받아 탭별로 필터링)
let myPendingRooms = []; // [B] edit by smsong - 요청 대기중/거절된 방 목록
let renameTarget = null; // [smsong] 이름 수정 대상 방
let selectedImageFile = null; // [smsong] 방 생성/수정 시 첨부한 대표 이미지

function typeLabel(type) {
    if (type === 'FRIEND') return { label: '친구', cls: 'friend' };
    if (type === 'FAMILY') return { label: '가족', cls: 'family' };
    if (type === 'ACQUAINTANCE') return { label: '지인', cls: 'acquaintance' }; // [B] edit by smsong
    return { label: '커플', cls: 'couple' };
}
function updateTypeChips() {
    document.querySelectorAll('.type-chip').forEach(ch => {
        ch.classList.toggle('active', !!selectedType && ch.dataset.type === selectedType);
    });
    if (ddayRow) ddayRow.style.display = (selectedType === 'COUPLE') ? 'flex' : 'none';
}

// ===== 유틸 =====
function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function showToast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2200);
}

// ===== 전역 로딩 오버레이 (main 과 동일: 처리/이동 중 클릭 차단 · 중복 표시 방지) =====
let _loadingCount = 0;
function showLoading(msg) {
    _loadingCount++;
    const ov = document.getElementById('loading-overlay');
    if (ov) {
        const t = ov.querySelector('.lo-text');
        if (t) t.textContent = msg || '처리 중입니다...';
        ov.classList.add('show');
        ov.setAttribute('aria-hidden', 'false');
    }
}
function hideLoading() {
    _loadingCount = Math.max(0, _loadingCount - 1);
    if (_loadingCount === 0) {
        const ov = document.getElementById('loading-overlay');
        if (ov) { ov.classList.remove('show'); ov.setAttribute('aria-hidden', 'true'); }
    }
}

// [B] edit by smsong - 뒤로가기(bfcache 복원) 시 로딩 오버레이가 켜진 채 되살아나 '영원히 로딩'되는 문제 해결.
//  방 입장 시 showLoading()을 켠 채로 main.html 로 떠났다가, 브라우저 뒤로가기로 이 페이지가
//  bfcache 에서 복원되면 오버레이가 그대로 남아 멈춰 보인다. → 복원 시점에 무조건 오버레이를 끈다.
function _forceHideOverlay() {
    _loadingCount = 0;
    const ov = document.getElementById('loading-overlay');
    if (ov) { ov.classList.remove('show'); ov.setAttribute('aria-hidden', 'true'); }
    __redirecting = false; // 재진입 시 정상 동작하도록 리다이렉트 가드도 해제
}
window.addEventListener('pageshow', function () {
    // e.persisted === true → bfcache 복원. (일반 로드 때도 안전하게 오버레이 정리)
    _forceHideOverlay();
});
// [E] edit by smsong

// [B] edit by smsong - 방 대표 이미지 픽커/미리보기/업로드
const imgPickerRow = document.getElementById('room-img-row');
const imgInput = document.getElementById('room-img-input');
const imgPreview = document.getElementById('room-img-preview');
const imgClearBtn = document.getElementById('room-img-clear');

function resetRoomImagePicker(previewUrl) {
    selectedImageFile = null;
    if (imgInput) imgInput.value = '';
    if (imgPreview) {
        if (previewUrl) {
            imgPreview.style.backgroundImage = `url('${previewUrl}')`;
            imgPreview.classList.add('has-img');
        } else {
            imgPreview.style.backgroundImage = '';
            imgPreview.classList.remove('has-img');
        }
    }
    if (imgClearBtn) imgClearBtn.style.display = previewUrl ? 'inline-flex' : 'none';
}
if (imgInput) {
    imgInput.addEventListener('change', () => {
        const f = imgInput.files && imgInput.files[0];
        if (!f) return;
        selectedImageFile = f;
        const url = URL.createObjectURL(f);
        if (imgPreview) { imgPreview.style.backgroundImage = `url('${url}')`; imgPreview.classList.add('has-img'); }
        if (imgClearBtn) imgClearBtn.style.display = 'inline-flex';
    });
}
if (imgPreview) imgPreview.addEventListener('click', () => { if (imgInput) imgInput.click(); });
if (imgClearBtn) imgClearBtn.addEventListener('click', () => resetRoomImagePicker(''));

// 방 대표 이미지 업로드 (생성/이름수정 성공 후 호출) — 백엔드: POST /api/rooms/{id}/image (multipart, part명 'mediaData')
async function uploadRoomImage(roomId, file) {
    if (!roomId || !file) return;
    try {
        const fd = new FormData();
        fd.append('mediaData', file);
        const res = await fetch(`${API_BASE}/api/rooms/${roomId}/image`, {
            method: 'POST', headers: authHeaders(false), body: fd // FormData → Content-Type 자동
        });
        if (!res.ok) { showToast('방은 저장됐지만 이미지 업로드는 실패했어요'); }
    } catch (e) { showToast('이미지 업로드 중 오류가 발생했어요'); }
}
// [E] edit by smsong

// ===== 방 목록 로드 =====
// 두 탭 모두 '내가 속한 방'(기존 엔드포인트) 하나만 호출하고,
//  받은 목록을 탭에 따라 프론트에서 필터링한다. (전체 방 조회 안 함 → 데이터 정합성 유지)
//   - 내가 속한 방  : 전부
//   - 내가 방장인 방: owner === true 만
async function loadRooms() {
    if (!uid) { gotoLoginCleared(AUTH_EXPIRED_MSG); return; }
    showLoading('방 목록을 불러오는 중...'); // [smsong] 로딩
    try {
        const res = await fetch(`${API_BASE}/api/rooms/${encodeURIComponent(uid)}`, { headers: authHeaders(true) });
        // 서버가 토큰을 거부(401/403)하면 → 토큰 정리 후 로그인으로 (여기서 안 지우면 login 이 되튕김)
        if (res.status === 401 || res.status === 403) { gotoLoginCleared(AUTH_EXPIRED_MSG); return; }
        if (!res.ok) { showToast('방 목록을 불러오지 못했습니다'); myRooms = []; renderCurrentView(); return; }
        const rooms = await res.json();
        myRooms = Array.isArray(rooms) ? rooms : [];
        await loadPendingRooms(); // [B] edit by smsong - 요청 대기중/거절 방도 함께 갱신
        renderCurrentView();
        maybeShowEntryNotices(); // [B] edit by smsong - 거절/강퇴 안내 또는 입장 수락 안내 1회 표시
    } catch (e) {
        console.error(e);
        showToast('서버에 연결하지 못했습니다');
    } finally {
        hideLoading(); // [smsong] 로딩 해제
    }
}

// [B] edit by smsong - 요청 대기중/거절된 방 목록 로드
async function loadPendingRooms() {
    if (!uid) return;
    try {
        const res = await fetch(`${API_BASE}/api/rooms/${encodeURIComponent(uid)}/pending`, { headers: authHeaders(true) });
        if (!res.ok) { myPendingRooms = []; return; }
        const list = await res.json();
        myPendingRooms = Array.isArray(list) ? list : [];
    } catch (e) {
        console.error(e);
        myPendingRooms = [];
    }
}

// 현재 탭에 맞춰 필터링 후 렌더
function renderCurrentView() {
    if (currentView === 'pending') {
        renderPendingRooms(myPendingRooms); // [B] edit by smsong
    } else {
        const list = (currentView === 'owner') ? myRooms.filter(r => r.owner) : myRooms;
        renderRooms(list);
    }
    if (mainEl) mainEl.scrollTop = 0; // [smsong] 렌더 직후 항상 맨 위에서 시작 (탭 전환 시 이전 스크롤 위치 캐시 방지)
}

// ===== 탭 전환 (내가 속한 방 / 내가 방장인 방 / 요청 대기중인 방) =====
function setView(view) {
    if (currentView === view) return;
    currentView = view;
    if (tabMemberEl)  tabMemberEl.classList.toggle('active', view === 'member');
    if (tabOwnerEl)   tabOwnerEl.classList.toggle('active', view === 'owner');
    if (tabPendingEl) tabPendingEl.classList.toggle('active', view === 'pending');
    renderCurrentView(); // 재요청 없이 캐시된 목록만 다시 필터 (스크롤 초기화 포함)
}

// ===== 렌더링 =====
function renderRooms(rooms) {
    listEl.innerHTML = '';
    if (!rooms.length) {
        emptyEl.innerHTML = (currentView === 'owner')
            ? '내가 방장인 방이 없어요.<br>방을 만들어보세요.'
            : '아직 참여한 방이 없어요.<br>방을 만들거나 초대 코드로 입장해보세요.';
        emptyEl.style.display = 'block';
        return;
    }
    emptyEl.style.display = 'none';

    rooms.forEach(r => {
        const card = document.createElement('div');
        card.className = 'room-card';

        const ownerBadge = r.owner ? '<span class="room-owner-badge">방장</span>' : '';
        const t = typeLabel(r.type);
        // [B] edit by smsong - 방 썸네일 (이미지 있으면 표시, 없으면 타입별 자리표시자)
        const imgUrl = r.imageUrl || r.thumbnailUrl || '';
        const thumbHtml = imgUrl
            ? `<div class="room-thumb"><img src="${esc(imgUrl)}" alt="" onerror="this.style.display='none';this.parentNode.classList.add('room-thumb-empty','${t.cls}')"></div>`
            : `<div class="room-thumb room-thumb-empty ${t.cls}"></div>`;
        // [E] edit by smsong
        card.innerHTML = `
            <div class="room-card-top">
                ${thumbHtml}
                <div class="room-card-body">
                    <div class="room-name"><span class="room-name-text">${esc(r.name)}</span> ${ownerBadge} <span class="room-type-badge ${t.cls}">${t.label}</span></div>
                    <div class="room-meta">멤버 ${Number(r.memberCount) || 0}명</div>
                </div>
            </div>
            <div class="room-card-footer">
                <div class="room-enter-hint">탭하여 입장 →</div>
                <div class="room-card-actions"></div>
            </div>
        `;

        // 카드 전체(버튼 영역 제외) 클릭 시 방 이동
        card.addEventListener('click', () => enterRoom(r));

        const actions = card.querySelector('.room-card-actions');
        // 버튼 영역 클릭은 이동으로 전파되지 않도록 차단 (개별 버튼도 stopPropagation)
        actions.addEventListener('click', (e) => e.stopPropagation());

        // 코드 복사
        const copyBtn = document.createElement('button');
        copyBtn.className = 'room-icon-btn';
        copyBtn.type = 'button';
        copyBtn.title = '초대 코드 복사';
        copyBtn.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
        copyBtn.addEventListener('click', (e) => { e.stopPropagation(); copyCode(r.inviteCode); });
        actions.appendChild(copyBtn);

        // 방장이면 이름 수정 버튼
        if (r.owner) {
            const editBtn = document.createElement('button');
            editBtn.className = 'room-icon-btn';
            editBtn.type = 'button';
            editBtn.title = '방 이름 수정';
            editBtn.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
            editBtn.addEventListener('click', (e) => { e.stopPropagation(); openRenameModal(r); });
            actions.appendChild(editBtn);
        }

        // 방장이면 삭제 / 아니면 나가기 (둘 다 내가 속한 방이므로 나가기 유효)
        const dangerBtn = document.createElement('button');
        dangerBtn.className = 'room-icon-btn danger';
        dangerBtn.type = 'button';
        if (r.owner) {
            dangerBtn.title = '방 삭제';
            dangerBtn.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';
            dangerBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteRoom(r); });
        } else {
            dangerBtn.title = '방 나가기';
            dangerBtn.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';
            dangerBtn.addEventListener('click', (e) => { e.stopPropagation(); leaveRoom(r); });
        }
        actions.appendChild(dangerBtn);

        listEl.appendChild(card);
    });
}

// ===== 요청 대기중/거절된 방 렌더링 =====
// [B] edit by smsong - PENDING: 승인 대기중 배지 / REJECTED: 거절됨 배지 + 사유 + X(제거)
function renderPendingRooms(rooms) {
    listEl.innerHTML = '';
    if (!rooms.length) {
        emptyEl.innerHTML = '요청 대기중인 방이 없어요.<br>코드로 입장을 요청하면 여기에 표시돼요.';
        emptyEl.style.display = 'block';
        return;
    }
    emptyEl.style.display = 'none';

    rooms.forEach(r => {
        const rejected = r.myStatus === 'REJECTED';
        // [B] edit by smsong - 강퇴(kicked)로 인한 REJECTED 는 '내보내짐' 문구로 구분
        const kicked = rejected && r.kicked === true;
        const card = document.createElement('div');
        card.className = 'room-card' + (rejected ? ' is-rejected' : '');

        const t = typeLabel(r.type);
        const imgUrl = r.imageUrl || r.thumbnailUrl || '';
        const thumbHtml = imgUrl
            ? `<div class="room-thumb"><img src="${esc(imgUrl)}" alt="" onerror="this.style.display='none';this.parentNode.classList.add('room-thumb-empty','${t.cls}')"></div>`
            : `<div class="room-thumb room-thumb-empty ${t.cls}"></div>`;
        const statusBadge = rejected
            ? (kicked
                ? '<span class="room-status-badge rejected">내보내짐</span>'
                : '<span class="room-status-badge rejected">거절됨</span>')
            : '<span class="room-status-badge pending">승인 대기중</span>';
        const reasonHtml = (rejected && r.rejectReason)
            ? `<div class="room-reject-reason">${kicked ? '강퇴 사유' : '거절 사유'}: ${esc(r.rejectReason)}</div>`
            : '';
        const footerLeft = rejected
            ? (kicked
                ? '<div class="room-pending-hint">방장이 회원님을 내보냈어요</div>'
                : '<div class="room-pending-hint">방장이 요청을 거절했어요</div>')
            : '<div class="room-pending-hint">방장 승인을 기다리는 중…</div>';

        card.innerHTML = `
            <div class="room-card-top">
                ${thumbHtml}
                <div class="room-card-body">
                    <div class="room-name"><span class="room-name-text">${esc(r.name)}</span> <span class="room-type-badge ${t.cls}">${t.label}</span> ${statusBadge}</div>
                    <div class="room-meta">멤버 ${Number(r.memberCount) || 0}명</div>
                    ${reasonHtml}
                </div>
            </div>
            <div class="room-card-footer">
                ${footerLeft}
                <div class="room-card-actions"></div>
            </div>
        `;

        const actions = card.querySelector('.room-card-actions');
        actions.addEventListener('click', (e) => e.stopPropagation());

        if (rejected) {
            // 거절된 방: X 버튼으로 목록에서 제거
            const xBtn = document.createElement('button');
            xBtn.className = 'room-icon-btn danger';
            xBtn.type = 'button';
            xBtn.title = '목록에서 제거';
            xBtn.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
            xBtn.addEventListener('click', (e) => { e.stopPropagation(); dismissRejected(r); });
            actions.appendChild(xBtn);
        } else {
            // 대기중: 요청 취소(제거) 버튼도 X 로 제공
            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'room-icon-btn';
            cancelBtn.type = 'button';
            cancelBtn.title = '요청 취소';
            cancelBtn.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
            cancelBtn.addEventListener('click', (e) => { e.stopPropagation(); dismissRejected(r, true); });
            actions.appendChild(cancelBtn);
        }

        listEl.appendChild(card);
    });
}

// [B] edit by smsong - 거절된 방(또는 대기중 요청) 제거 → 서버 dismiss 후 목록 갱신
async function dismissRejected(r, isPending) {
    if (isPending && !confirm(`'${r.name}' 방 입장 요청을 취소할까요?`)) return;
    showLoading('처리 중...');
    try {
        const res = await fetch(`${API_BASE}/api/permissions/dismiss`, {
            method: 'POST', headers: roomHeaders(r.id)
        });
        if (res.status === 401 || res.status === 403) { gotoLoginCleared(AUTH_EXPIRED_MSG); return; }
        // 성공/실패 무관하게 목록에서 즉시 제거(낙관적) 후 재동기화
        myPendingRooms = myPendingRooms.filter(x => x.id !== r.id);
        renderCurrentView();
        await loadPendingRooms();
        renderCurrentView();
        showToast(isPending ? '요청을 취소했어요' : '목록에서 제거했어요');
    } catch (e) {
        showToast('서버에 연결하지 못했습니다');
    } finally { hideLoading(); }
}

// [B] edit by smsong - rooms 최초 진입 안내: 거절/강퇴가 우선, 없으면 '입장 수락됨' 안내.
//  (한 화면에 모달 두 개가 겹치지 않도록 우선순위로 하나만 표시)
function maybeShowEntryNotices() {
    const rejected = (myPendingRooms || []).find(r => r.myStatus === 'REJECTED' && r.rejectSeen === false);
    if (rejected) { openRejectNotice(rejected); return; }
    const accepted = (myRooms || []).find(r => r.owner === false && r.acceptSeen === false);
    if (accepted) openAcceptNotice(accepted);
}

// [B] edit by smsong - 방장이 입장을 수락한 방이 있으면 최초 1회 안내 (acceptSeen=false)
let _acceptTarget = null;
function openAcceptNotice(r) {
    const modal = document.getElementById('accept-modal');
    if (!modal) return;
    _acceptTarget = r;
    const nameEl = document.getElementById('accept-room-name');
    if (nameEl) nameEl.textContent = r.name || '방';
    modal.classList.remove('hidden');
    // 서버에 '봤음' 기록 → 다음 진입부터는 안 뜸
    markAcceptSeen(r.id);
}
async function markAcceptSeen(roomId) {
    try {
        await fetch(`${API_BASE}/api/rooms/${roomId}/accept-seen?uid=${encodeURIComponent(uid)}`,
            { method: 'POST', headers: authHeaders(true) });
        const t = (myRooms || []).find(x => x.id === roomId);
        if (t) t.acceptSeen = true; // 로컬도 갱신(같은 세션 중복 표시 방지)
    } catch (e) { /* 조용히 무시 */ }
}
function closeAcceptNotice() {
    const modal = document.getElementById('accept-modal');
    if (modal) modal.classList.add('hidden');
    _acceptTarget = null;
}

// [B] edit by smsong - 거절된 방이 있으면 최초 1회 안내 모달 표시 (rejectSeen=false)
function maybeShowRejectNotice() {
    const target = (myPendingRooms || []).find(r => r.myStatus === 'REJECTED' && r.rejectSeen === false);
    if (!target) return;
    openRejectNotice(target);
}
function openRejectNotice(r) {
    if (!rejectModalEl) return;
    // [B] edit by smsong - 강퇴(kicked)면 '내보내짐' 문구로, 아니면 기존 '거절' 문구로 표시
    const kicked = r.kicked === true;
    const titleEl = document.getElementById('reject-title');
    if (titleEl) titleEl.textContent = kicked ? '방에서 내보내졌습니다' : '입장 요청이 거절되었습니다';
    if (rejectReasonEl) {
        if (r.rejectReason) {
            rejectReasonEl.innerHTML = '<span class="reject-reason-label">' +
                (kicked ? '방장이 남긴 사유' : '방장이 남긴 거절 사유') + '</span>' + esc(r.rejectReason);
            rejectReasonEl.style.display = 'block';
        } else {
            rejectReasonEl.style.display = 'none';
        }
    }
    const descEl = document.getElementById('reject-desc');
    if (descEl) descEl.textContent = kicked
        ? `'${r.name}' 방에서 방장에 의해 내보내져 더 이상 참여할 수 없습니다.`
        : `'${r.name}' 방의 입장 요청이 거절되어 이 방에서 제외되었습니다.`;
    rejectModalEl.classList.remove('hidden');
    // 서버에 '봤음' 기록 → 다음 진입부터는 안 뜸
    markRejectSeen(r.id);
}
async function markRejectSeen(roomId) {
    try {
        await fetch(`${API_BASE}/api/permissions/reject-seen`, { method: 'POST', headers: roomHeaders(roomId) });
        const t = (myPendingRooms || []).find(x => x.id === roomId);
        if (t) t.rejectSeen = true; // 로컬도 갱신(같은 세션 중복 표시 방지)
    } catch (e) { /* 조용히 무시 */ }
}
function closeRejectNotice() {
    if (rejectModalEl) rejectModalEl.classList.add('hidden');
}

// ===== 방 입장 =====
function enterRoom(r) {
    localStorage.setItem('selectedRoomId', r.id);
    localStorage.setItem('selectedRoomName', r.name || '');
    localStorage.setItem('selectedRoomType', r.type || 'COUPLE');
    localStorage.setItem('selectedRoomOwnerUid', r.ownerUid || '');
    showLoading('이동하는 중...'); // main 과 동일한 로딩 폼
    // 오버레이가 먼저 그려지도록 아주 짧게 지연 후 이동
    setTimeout(() => { location.href = 'main.html'; }, 60);
}

// ===== 코드 복사 =====
async function copyCode(code) {
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(code);
        } else {
            const ta = document.createElement('textarea');
            ta.value = code; document.body.appendChild(ta); ta.select();
            document.execCommand('copy'); document.body.removeChild(ta);
        }
        showToast('초대 코드를 복사했어요');
    } catch (e) { showToast('복사에 실패했습니다'); }
}

// ===== 모달 =====
function openModal(mode) {
    modalMode = mode;
    if (mode === 'create') {
        modalTitle.textContent = '방 만들기';
        modalDesc.textContent = '방 이름과 종류를 정하세요. 만든 사람이 방장이 됩니다.';
        modalInput.value = '';
        modalInput.placeholder = '예: 우리의 추억';
        modalInput.classList.remove('code');
        modalInput.maxLength = 30;
        typeRow.style.display = 'flex';
        selectedType = null; // [smsong] 아무 타입도 선택되지 않은 상태로 시작
        updateTypeChips();
        if (imgPickerRow) imgPickerRow.style.display = 'flex'; // [smsong] 대표 이미지 첨부
        resetRoomImagePicker('');
        if (pasteRow) pasteRow.style.display = 'none'; // [B] edit by smsong - 붙여넣기는 코드 입장 전용
    } else {
        modalTitle.textContent = '코드로 입장';
        modalDesc.textContent = '초대 코드를 입력하면 방을 확인하고 입장을 요청할 수 있어요.';
        modalInput.value = '';
        modalInput.placeholder = '초대 코드 6자리';
        modalInput.classList.add('code');
        modalInput.maxLength = 8;
        typeRow.style.display = 'none';
        if (ddayRow) ddayRow.style.display = 'none';
        if (imgPickerRow) imgPickerRow.style.display = 'none'; // [smsong] 입장 모드엔 이미지 없음
        if (pasteRow) pasteRow.style.display = 'block'; // [B] edit by smsong - 코드 붙여넣기 노출
    }
    modalEl.classList.remove('hidden');
    setTimeout(() => modalInput.focus(), 50);
}

// [smsong] 방 이름 수정 모달 (방장 전용)
function openRenameModal(r) {
    modalMode = 'rename';
    renameTarget = r;
    modalTitle.textContent = '방 이름 수정';
    modalDesc.textContent = '방장만 이름을 바꿀 수 있어요.';
    modalInput.value = r.name || '';
    modalInput.placeholder = '방 이름';
    modalInput.classList.remove('code');
    modalInput.maxLength = 30;
    typeRow.style.display = 'none';
    if (ddayRow) ddayRow.style.display = 'none';
    if (imgPickerRow) imgPickerRow.style.display = 'flex'; // [smsong] 이름 수정 시 대표 이미지도 변경 가능
    resetRoomImagePicker(r.imageUrl || r.thumbnailUrl || '');
    if (pasteRow) pasteRow.style.display = 'none'; // [B] edit by smsong
    modalEl.classList.remove('hidden');
    setTimeout(() => { modalInput.focus(); modalInput.select(); }, 50);
}

function closeModal() {
    modalEl.classList.add('hidden'); modalMode = null; renameTarget = null;
    resetRoomImagePicker(''); // [smsong] 닫을 때 이미지 선택 초기화
}

// [B] edit by smsong - 클립보드의 복사한 코드를 입력창에 붙여넣기
async function pasteCodeFromClipboard() {
    try {
        if (navigator.clipboard && navigator.clipboard.readText) {
            const text = await navigator.clipboard.readText();
            const code = String(text || '').trim().toUpperCase().replace(/\s+/g, '');
            if (!code) { showToast('클립보드가 비어 있어요'); return; }
            const max = modalInput.maxLength && modalInput.maxLength > 0 ? modalInput.maxLength : 8;
            modalInput.value = code.slice(0, max);
            modalInput.focus();
            showToast('코드를 붙여넣었어요');
        } else {
            showToast('이 브라우저에서는 붙여넣기를 지원하지 않아요');
        }
    } catch (e) {
        showToast('붙여넣기 권한이 없어요. 길게 눌러 붙여넣어 주세요');
    }
}

async function submitModal() {
    const val = (modalInput.value || '').trim();
    if (!val) { showToast(modalMode === 'join' ? '초대 코드를 입력하세요' : '방 이름을 입력하세요'); return; }
    if (modalMode === 'create' && !selectedType) { showToast('방 종류를 선택하세요'); return; }
    modalOk.disabled = true;
    try {
        if (modalMode === 'create') await createRoom(val);
        else if (modalMode === 'rename') await renameRoom(renameTarget, val);
        else await joinRoom(val);
    } finally { modalOk.disabled = false; }
}

// ===== 방 이름 수정 (방장) =====
async function renameRoom(r, name) {
    if (!r) { closeModal(); return; }
    showLoading('저장하는 중...');
    try {
        const res = await fetch(`${API_BASE}/api/rooms/${r.id}/name`, {
            method: 'PUT', headers: authHeaders(true),
            body: JSON.stringify({ uid: uid, name: name })
        });
        if (res.status === 401) { gotoLoginCleared(AUTH_EXPIRED_MSG); return; }
        if (res.status === 403) { showToast('방장만 이름을 수정할 수 있습니다'); return; }
        if (!res.ok) { showToast('이름을 수정하지 못했습니다'); return; }
        if (selectedImageFile) await uploadRoomImage(r.id, selectedImageFile); // [smsong] 대표 이미지 변경
        closeModal();
        showToast('방 정보를 수정했어요');
        await loadRooms();
    } catch (e) { showToast('서버에 연결하지 못했습니다'); }
    finally { hideLoading(); }
}

// ===== 방 생성 =====
async function createRoom(name) {
    showLoading('방을 만드는 중...');
    try {
        const body = { uid: uid, name: name, type: selectedType };
        if (selectedType === 'COUPLE' && ddayInput && ddayInput.value) {
            body.coupleSince = ddayInput.value; // 만난 날짜 → 방 디데이 기준일
        }
        const res = await fetch(`${API_BASE}/api/rooms`, {
            method: 'POST', headers: authHeaders(true),
            body: JSON.stringify(body)
        });
        if (res.status === 401 || res.status === 403) { gotoLoginCleared(AUTH_EXPIRED_MSG); return; }
        if (!res.ok) { showToast('방을 만들지 못했습니다'); return; }
        const room = await res.json();
        if (selectedImageFile && room && room.id) await uploadRoomImage(room.id, selectedImageFile); // [smsong] 대표 이미지 첨부
        closeModal();
        showToast('방이 만들어졌어요');
        await loadRooms(); // 목록에서 코드 확인/공유 후 입장
    } catch (e) { showToast('서버에 연결하지 못했습니다'); }
    finally { hideLoading(); }
}

// ===== 코드로 입장 (1단계: 미리보기) =====
// [B] edit by smsong - 코드로 바로 입장하지 않고, 어떤 방인지 미리보기 후 '입장 요청'을 보낸다.
async function joinRoom(code) {
    showLoading('방을 확인하는 중...');
    try {
        const res = await fetch(`${API_BASE}/api/rooms/preview?code=${encodeURIComponent(code.toUpperCase())}`, {
            headers: authHeaders(true)
        });
        if (res.status === 401 || res.status === 403) { gotoLoginCleared(AUTH_EXPIRED_MSG); return; }
        if (res.status === 404) { showToast('유효하지 않은 초대 코드입니다'); return; }
        if (!res.ok) { showToast('방을 확인하지 못했습니다'); return; }
        const room = await res.json();
        previewCode = code.toUpperCase(); // [B] edit by smsong - 요청 전송 시 재사용
        closeModal();
        openPreviewModal(room); // 미리보기 폼 표시
    } catch (e) { showToast('서버에 연결하지 못했습니다'); }
    finally { hideLoading(); }
}

// 미리보기 모달 열기 — 방 상태(myStatus)에 따라 안내/버튼 조정
function openPreviewModal(room) {
    previewRoom = room;
    const t = typeLabel(room.type);
    if (previewNameEl) previewNameEl.textContent = room.name || '이름 없는 방';
    if (previewTypeEl) { previewTypeEl.textContent = t.label; previewTypeEl.className = 'room-type-badge ' + t.cls; }
    if (previewCountEl) previewCountEl.textContent = `멤버 ${Number(room.memberCount) || 0}명`;
    if (previewThumbEl) {
        const imgUrl = room.imageUrl || room.thumbnailUrl || '';
        if (imgUrl) {
            previewThumbEl.className = 'preview-thumb';
            previewThumbEl.style.backgroundImage = `url('${imgUrl}')`;
        } else {
            previewThumbEl.className = 'preview-thumb room-thumb-empty ' + t.cls;
            previewThumbEl.style.backgroundImage = '';
        }
    }

    let note = '', okText = '입장 요청 보내기', okDisabled = false;
    switch (room.myStatus) {
        case 'OWNER':
            note = '내가 방장인 방이에요. 바로 입장할 수 있어요.'; okText = '입장하기'; break;
        case 'MEMBER':
            note = '이미 참여 중인 방이에요. 바로 입장할 수 있어요.'; okText = '입장하기'; break;
        case 'PENDING':
            note = '이미 입장 요청을 보낸 방이에요. 방장 승인을 기다리는 중이에요.'; okText = '확인'; okDisabled = false; break;
        case 'REJECTED':
            note = '이전에 거절된 방이에요. 다시 입장 요청을 보낼 수 있어요.'; okText = '다시 요청 보내기'; break;
        default:
            note = ''; okText = '입장 요청 보내기';
    }
    if (previewNoteEl) {
        if (note) { previewNoteEl.textContent = note; previewNoteEl.style.display = 'block'; }
        else previewNoteEl.style.display = 'none';
    }
    if (previewOkBtn) { previewOkBtn.textContent = okText; previewOkBtn.disabled = okDisabled; }
    if (previewModalEl) previewModalEl.classList.remove('hidden');
}
function closePreviewModal() {
    if (previewModalEl) previewModalEl.classList.add('hidden');
    previewRoom = null;
    previewCode = null;
}

// 미리보기 확인 → 상태별 동작 (멤버/방장이면 입장, 그 외엔 요청 전송)
async function confirmPreview() {
    const room = previewRoom;
    if (!room) { closePreviewModal(); return; }
    // 이미 멤버/방장이면 바로 입장
    if (room.myStatus === 'OWNER' || room.myStatus === 'MEMBER') {
        closePreviewModal();
        enterRoom(room);
        return;
    }
    // 이미 대기중이면 대기 탭으로 이동만
    if (room.myStatus === 'PENDING') {
        closePreviewModal();
        await loadPendingRooms();
        setView('pending');
        renderCurrentView();
        return;
    }
    // NONE / REJECTED → 입장 요청 전송
    if (previewOkBtn) previewOkBtn.disabled = true;
    showLoading('요청을 보내는 중...');
    try {
        const res = await fetch(`${API_BASE}/api/rooms/join`, {
            method: 'POST', headers: authHeaders(true),
            body: JSON.stringify({ uid: uid, code: previewCode || room.inviteCode || '' })
        });
        if (res.status === 401 || res.status === 403) { gotoLoginCleared(AUTH_EXPIRED_MSG); return; }
        if (!res.ok) { showToast('요청을 보내지 못했습니다'); return; }
        const result = await res.json();
        closePreviewModal();
        if (result && (result.myStatus === 'OWNER' || result.myStatus === 'MEMBER')) {
            enterRoom(result); // 방장/이미 멤버였다면 바로 입장
            return;
        }
        showToast('입장 요청을 보냈어요. 방장 승인을 기다려주세요');
        await loadPendingRooms();
        setView('pending');
        renderCurrentView();
    } catch (e) { showToast('서버에 연결하지 못했습니다'); }
    finally { hideLoading(); if (previewOkBtn) previewOkBtn.disabled = false; }
}

// ===== 방 삭제 (방장) =====
async function deleteRoom(r) {
    if (!confirm(`'${r.name}' 방을 삭제할까요?\n방의 모든 멤버가 나가게 됩니다.`)) return;
    showLoading('삭제하는 중...');
    try {
        const res = await fetch(`${API_BASE}/api/rooms/${r.id}?uid=${encodeURIComponent(uid)}`, {
            method: 'DELETE', headers: authHeaders(true)
        });
        if (res.status === 401 || res.status === 403) { gotoLoginCleared(AUTH_EXPIRED_MSG); return; }
        if (!res.ok) { showToast('삭제하지 못했습니다'); return; }
        // 현재 보던 방을 삭제했다면 선택 해제
        if (localStorage.getItem('selectedRoomId') === String(r.id)) {
            localStorage.removeItem('selectedRoomId');
            localStorage.removeItem('selectedRoomName');
        }
        showToast('방을 삭제했어요');
        await loadRooms();
    } catch (e) { showToast('서버에 연결하지 못했습니다'); }
    finally { hideLoading(); }
}

// ===== 방 나가기 (멤버) =====
async function leaveRoom(r) {
    if (!confirm(`'${r.name}' 방에서 나갈까요?`)) return;
    showLoading('나가는 중...');
    try {
        const res = await fetch(`${API_BASE}/api/rooms/${r.id}/leave?uid=${encodeURIComponent(uid)}`, {
            method: 'POST', headers: authHeaders(true)
        });
        if (res.status === 401 || res.status === 403) { gotoLoginCleared(AUTH_EXPIRED_MSG); return; }
        if (!res.ok) { showToast('나가지 못했습니다'); return; }
        if (localStorage.getItem('selectedRoomId') === String(r.id)) {
            localStorage.removeItem('selectedRoomId');
            localStorage.removeItem('selectedRoomName');
        }
        showToast('방에서 나왔어요');
        await loadRooms();
    } catch (e) { showToast('서버에 연결하지 못했습니다'); }
    finally { hideLoading(); }
}

// ===== 이벤트 바인딩 =====
if (tabMemberEl) tabMemberEl.addEventListener('click', () => setView('member'));
if (tabOwnerEl)  tabOwnerEl.addEventListener('click', () => setView('owner'));
if (tabPendingEl) tabPendingEl.addEventListener('click', () => setView('pending'));
// [B] edit by smsong - 미리보기/거절 모달 이벤트
if (previewOkBtn) previewOkBtn.addEventListener('click', confirmPreview);
if (previewCancelBtn) previewCancelBtn.addEventListener('click', closePreviewModal);
if (previewModalEl) previewModalEl.addEventListener('click', (e) => { if (e.target === previewModalEl) closePreviewModal(); });
if (rejectOkBtn) rejectOkBtn.addEventListener('click', closeRejectNotice);
if (rejectModalEl) rejectModalEl.addEventListener('click', (e) => { if (e.target === rejectModalEl) closeRejectNotice(); });
// [B] edit by smsong - 입장 수락 안내 모달: '지금 입장'(해당 방으로 이동) / '확인'(닫기) / 배경 탭(닫기)
const acceptModalEl = document.getElementById('accept-modal');
const acceptEnterBtn = document.getElementById('accept-enter');
const acceptOkBtn = document.getElementById('accept-ok');
if (acceptEnterBtn) acceptEnterBtn.addEventListener('click', () => {
    const target = _acceptTarget;
    closeAcceptNotice();
    if (target) enterRoom(target);
});
if (acceptOkBtn) acceptOkBtn.addEventListener('click', closeAcceptNotice);
if (acceptModalEl) acceptModalEl.addEventListener('click', (e) => { if (e.target === acceptModalEl) closeAcceptNotice(); });
// [E] edit by smsong
document.getElementById('btn-create-room').addEventListener('click', () => openModal('create'));
document.getElementById('btn-join-room').addEventListener('click', () => openModal('join'));
document.querySelectorAll('.type-chip').forEach(ch => {
    ch.addEventListener('click', () => { selectedType = ch.dataset.type; updateTypeChips(); });
});
// [B] edit by smsong - 로그아웃은 프로필 패널 안 버튼으로 이동
function doLogout() {
    if (!confirm('로그아웃 하시겠어요?')) return;
    AUTH_KEYS.forEach(k => localStorage.removeItem(k));
    location.replace('login.html');
}
const _btnProfileLogout = document.getElementById('btn-profile-logout');
if (_btnProfileLogout) _btnProfileLogout.addEventListener('click', doLogout);
// [E] edit by smsong
modalOk.addEventListener('click', submitModal);
modalCancel.addEventListener('click', closeModal);
// [B] edit by smsong - 복사한 코드 붙여넣기
if (pasteBtn) pasteBtn.addEventListener('click', pasteCodeFromClipboard);
modalEl.addEventListener('click', (e) => { if (e.target === modalEl) closeModal(); });
modalInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitModal(); });

// =====================================================
// [B] edit by smsong - 내 프로필 (보기 / 수정 / 최초 닉네임 설정)
//   프로필 수정은 방 화면(rooms.html)에서 가능하도록 이동.
//   최초 진입(닉네임 없음) 시 main.html 이 아닌 이 화면에서 닉네임을 받는다.
//   저장 API 는 main.html 과 동일: PUT /user (multipart: userData + mediaData)
// =====================================================
const DEFAULT_AVATAR_SVG =
    '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';

let me = null;                 // 현재 로그인 사용자 (GET /user/uid/{uid})
let pePendingFile = null;      // 프로필 수정: 선택한 새 이미지
let peRemovePhoto = false;     // 프로필 수정: 사진 제거 여부

function _bustImg(url) {
    if (!url) return url;
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + '_v=' + Date.now();
}

async function loadMe() {
    try {
        const res = await fetch(`${API_BASE}/user/uid/${encodeURIComponent(uid)}`, { headers: authHeaders(true) });
        if (res.status === 401 || res.status === 403) { gotoLoginCleared(AUTH_EXPIRED_MSG); return; }
        if (!res.ok) return;
        me = await res.json();
        maybePromptNicknameRooms();
    } catch (e) { /* 네트워크 오류 시 조용히 무시 (방 목록은 계속 사용 가능) */ }
}

// 닉네임이 없으면 최초 설정 모달 노출 (있으면 노출하지 않음)
function maybePromptNicknameRooms() {
    if (!me) return;
    const nick = me.nickname;
    const modal = document.getElementById('nickname-modal');
    if (!modal) return;
    if ((!nick || !String(nick).trim()) && modal.classList.contains('hidden')) {
        const inp = document.getElementById('nickname-input');
        if (inp) inp.value = '';
        modal.classList.remove('hidden');
        setTimeout(() => { if (inp) inp.focus(); }, 120);
    }
}

// PUT /user (main.html saveUser 와 동일 계약). file 없으면 빈 파트로 mediaData 채워 백엔드 기존 이미지 유지
async function saveUser(userObj, file) {
    const fd = new FormData();
    fd.append('userData', JSON.stringify(userObj));
    if (file) fd.append('mediaData', file);
    else fd.append('mediaData', new Blob([], { type: 'application/octet-stream' }), 'empty');
    const res = await fetch(`${API_BASE}/user`, { method: 'PUT', headers: authHeaders(false), body: fd });
    if (res.status === 401 || res.status === 403) { gotoLoginCleared(AUTH_EXPIRED_MSG); throw new Error('auth'); }
    if (!res.ok) { let m = ''; try { m = await res.text(); } catch (e) {} throw new Error(m || ('저장 실패(' + res.status + ')')); }
    try { return await res.json(); } catch (e) { return userObj; }
}

// ----- 프로필 보기 패널 -----
function _setViewAvatar(url) {
    const el = document.getElementById('profile-view-avatar');
    if (!el) return;
    if (url) { el.style.backgroundImage = "url('" + _bustImg(url) + "')"; el.innerHTML = ''; }
    else { el.style.backgroundImage = 'none'; el.innerHTML = DEFAULT_AVATAR_SVG; }
}
function openProfileModal() {
    const nameEl = document.getElementById('profile-view-name');
    const nick = (me && me.nickname && String(me.nickname).trim()) ? me.nickname : '나';
    if (nameEl) nameEl.textContent = nick;
    // [B] edit by smsong - 닉네임 밑 'Daylog' 서브텍스트 제거
    _setViewAvatar(me && me.profileURL);
    const m = document.getElementById('profile-modal');
    if (m) m.classList.remove('hidden');
    // 최신 정보 반영을 위해 조용히 재조회
    loadMe().then(() => { if (m && !m.classList.contains('hidden')) {
        if (nameEl) nameEl.textContent = (me && me.nickname && String(me.nickname).trim()) ? me.nickname : '나';
        _setViewAvatar(me && me.profileURL);
    }});
}
function closeProfileModal() { const m = document.getElementById('profile-modal'); if (m) m.classList.add('hidden'); }

// ----- 프로필 수정 폼 -----
function _setPeAvatar(src, hasPhoto) {
    const av = document.getElementById('pe-avatar');
    if (av) { if (src) { av.style.backgroundImage = "url('" + src + "')"; av.innerHTML = ''; } else { av.style.backgroundImage = 'none'; av.innerHTML = DEFAULT_AVATAR_SVG; } }
    const rm = document.getElementById('pe-remove-photo');
    if (rm) rm.classList.toggle('hidden', !hasPhoto);
}
function openProfileEdit() {
    if (!me) { showToast('사용자 정보를 불러오는 중입니다'); loadMe(); return; }
    pePendingFile = null; peRemovePhoto = false;
    const nick = document.getElementById('pe-nickname');
    if (nick) nick.value = me.nickname || '';
    _setPeAvatar(me.profileURL ? _bustImg(me.profileURL) : '', !!me.profileURL);
    closeProfileModal();
    const m = document.getElementById('profile-edit-modal');
    if (m) m.classList.remove('hidden');
}
function closeProfileEdit() { const m = document.getElementById('profile-edit-modal'); if (m) m.classList.add('hidden'); }

// 이벤트 바인딩
const _btnProfile = document.getElementById('btn-profile');
if (_btnProfile) _btnProfile.addEventListener('click', openProfileModal);
const _profileCloseBtn = document.getElementById('profile-close');
if (_profileCloseBtn) _profileCloseBtn.addEventListener('click', closeProfileModal);
const _profileModalEl = document.getElementById('profile-modal');
if (_profileModalEl) _profileModalEl.addEventListener('click', (e) => { if (e.target === _profileModalEl) closeProfileModal(); });
const _btnOpenPe = document.getElementById('btn-open-profile-edit');
if (_btnOpenPe) _btnOpenPe.addEventListener('click', openProfileEdit);
const _peCancel = document.getElementById('pe-cancel');
if (_peCancel) _peCancel.addEventListener('click', closeProfileEdit);
const _peModalEl = document.getElementById('profile-edit-modal');
if (_peModalEl) _peModalEl.addEventListener('click', (e) => { if (e.target === _peModalEl) closeProfileEdit(); });

const _peWrap = document.getElementById('pe-avatar-wrap');
const _peFile = document.getElementById('pe-file');
if (_peWrap && _peFile) _peWrap.addEventListener('click', () => _peFile.click());
if (_peFile) _peFile.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    _peFile.value = '';
    if (!file) return;
    pePendingFile = file; peRemovePhoto = false;
    const reader = new FileReader();
    reader.onload = (ev) => _setPeAvatar(ev.target.result, true);
    reader.readAsDataURL(file);
});
const _peRemove = document.getElementById('pe-remove-photo');
if (_peRemove) _peRemove.addEventListener('click', () => {
    pePendingFile = null; peRemovePhoto = true;
    _setPeAvatar('', false);
    showToast('저장하면 사진이 제거됩니다');
});

const _peSave = document.getElementById('pe-save');
if (_peSave) _peSave.addEventListener('click', async () => {
    if (!me) { showToast('사용자 정보 조회 실패'); return; }
    const nick = (document.getElementById('pe-nickname').value || '').trim();
    if (!nick) { showToast('닉네임을 입력해주세요'); return; }
    _peSave.disabled = true; const prev = _peSave.textContent; _peSave.textContent = '저장 중...';
    showLoading('저장 중...');
    try {
        const payload = { uid: me.uid, id: me.id, nickname: nick };
        if (!pePendingFile && peRemovePhoto) payload.profileURL = '';
        const updated = await saveUser(payload, pePendingFile);
        me = updated || Object.assign({}, me, payload);
        if (peRemovePhoto) me.profileURL = '';
        pePendingFile = null; peRemovePhoto = false;
        showToast('프로필 저장 완료');
        closeProfileEdit();
    } catch (err) {
        if (String(err && err.message) !== 'auth') showToast('저장 실패: ' + (err.message || '서버 오류'));
    } finally {
        _peSave.disabled = false; _peSave.textContent = prev; hideLoading();
    }
});

// ----- 최초 닉네임 설정 -----
async function submitNicknameFirst() {
    const val = (document.getElementById('nickname-input').value || '').trim();
    if (!val) { showToast('닉네임을 입력해주세요'); return; }
    if (!me) { showToast('사용자 정보 조회 실패'); return; }
    const btn = document.getElementById('nickname-ok');
    if (btn) { btn.disabled = true; btn.textContent = '저장 중...'; }
    showLoading('설정 중...');
    try {
        const payload = { uid: me.uid, id: me.id, nickname: val };
        const updated = await saveUser(payload, null);
        me = updated || Object.assign({}, me, payload);
        const modal = document.getElementById('nickname-modal');
        if (modal) modal.classList.add('hidden');
        showToast('닉네임 설정 완료');
    } catch (err) {
        if (String(err && err.message) !== 'auth') showToast('설정 실패: ' + (err.message || '서버 오류'));
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '시작하기'; }
        hideLoading();
    }
}
const _nickOk = document.getElementById('nickname-ok');
if (_nickOk) _nickOk.addEventListener('click', submitNicknameFirst);
const _nickInput = document.getElementById('nickname-input');
if (_nickInput) _nickInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitNicknameFirst(); });
// [E] edit by smsong

// ===== 시작 =====
// 유효한 세션일 때만 로드. (이미 gotoLoginCleared() 로 이동 중이면 실행 안 함)
if (validSession) { loadRooms(); loadMe(); }
