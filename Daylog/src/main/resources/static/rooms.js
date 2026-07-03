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
const typeRow = document.getElementById('room-type-row');
const ddayRow = document.getElementById('room-dday-row');
const ddayInput = document.getElementById('room-dday-input');
// [smsong] 상단 탭
const tabMemberEl = document.getElementById('tab-member'); // 내가 속한 방
const tabOwnerEl = document.getElementById('tab-owner');   // 내가 방장인 방
const mainEl = document.querySelector('.rooms-main');

let modalMode = null; // 'create' | 'join' | 'rename'
let selectedType = null; // [smsong] 방 생성 시 기본 미선택
let currentView = 'member'; // [smsong] 'member'(내가 속한 방) | 'owner'(내가 방장인 방)
let myRooms = []; // [smsong] 내가 속한 방 원본(한 번 받아 탭별로 필터링)
let renameTarget = null; // [smsong] 이름 수정 대상 방

function typeLabel(type) {
    if (type === 'FRIEND') return { label: '친구', cls: 'friend' };
    if (type === 'FAMILY') return { label: '가족', cls: 'family' };
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

// ===== 방 목록 로드 =====
// 두 탭 모두 '내가 속한 방'(기존 엔드포인트) 하나만 호출하고,
//  받은 목록을 탭에 따라 프론트에서 필터링한다. (전체 방 조회 안 함 → 데이터 정합성 유지)
//   - 내가 속한 방  : 전부
//   - 내가 방장인 방: owner === true 만
async function loadRooms() {
    if (!uid) { gotoLoginCleared(AUTH_EXPIRED_MSG); return; }
    try {
        const res = await fetch(`${API_BASE}/api/rooms/${encodeURIComponent(uid)}`, { headers: authHeaders(true) });
        // 서버가 토큰을 거부(401/403)하면 → 토큰 정리 후 로그인으로 (여기서 안 지우면 login 이 되튕김)
        if (res.status === 401 || res.status === 403) { gotoLoginCleared(AUTH_EXPIRED_MSG); return; }
        if (!res.ok) { showToast('방 목록을 불러오지 못했습니다'); myRooms = []; renderCurrentView(); return; }
        const rooms = await res.json();
        myRooms = Array.isArray(rooms) ? rooms : [];
        renderCurrentView();
    } catch (e) {
        console.error(e);
        showToast('서버에 연결하지 못했습니다');
    }
}

// 현재 탭에 맞춰 필터링 후 렌더
function renderCurrentView() {
    const list = (currentView === 'owner') ? myRooms.filter(r => r.owner) : myRooms;
    renderRooms(list);
    if (mainEl) mainEl.scrollTop = 0; // [smsong] 렌더 직후 항상 맨 위에서 시작 (탭 전환 시 이전 스크롤 위치 캐시 방지)
}

// ===== 탭 전환 (내가 속한 방 / 내가 방장인 방) =====
function setView(view) {
    if (currentView === view) return;
    currentView = view;
    if (tabMemberEl) tabMemberEl.classList.toggle('active', view === 'member');
    if (tabOwnerEl)  tabOwnerEl.classList.toggle('active', view === 'owner');
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
        card.innerHTML = `
            <div class="room-card-body">
                <div class="room-name"><span class="room-name-text">${esc(r.name)}</span> ${ownerBadge} <span class="room-type-badge ${t.cls}">${t.label}</span></div>
                <div class="room-meta">멤버 ${Number(r.memberCount) || 0}명</div>
            </div>
            <div class="room-card-footer">
                <div class="room-enter-hint">탭하여 입장 →</div>
                <div class="room-card-actions"></div>
            </div>
        `;

        const body = card.querySelector('.room-card-body');
        body.addEventListener('click', () => enterRoom(r));

        const actions = card.querySelector('.room-card-actions');

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

// ===== 방 입장 =====
function enterRoom(r) {
    localStorage.setItem('selectedRoomId', r.id);
    localStorage.setItem('selectedRoomName', r.name || '');
    localStorage.setItem('selectedRoomType', r.type || 'COUPLE');
    localStorage.setItem('selectedRoomOwnerUid', r.ownerUid || '');
    location.href = 'main.html';
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
    } else {
        modalTitle.textContent = '코드로 입장';
        modalDesc.textContent = '초대 코드를 입력하면 그 방의 멤버가 됩니다.';
        modalInput.value = '';
        modalInput.placeholder = '초대 코드 6자리';
        modalInput.classList.add('code');
        modalInput.maxLength = 8;
        typeRow.style.display = 'none';
        if (ddayRow) ddayRow.style.display = 'none';
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
    modalEl.classList.remove('hidden');
    setTimeout(() => { modalInput.focus(); modalInput.select(); }, 50);
}

function closeModal() { modalEl.classList.add('hidden'); modalMode = null; renameTarget = null; }

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
    try {
        const res = await fetch(`${API_BASE}/api/rooms/${r.id}/name`, {
            method: 'PUT', headers: authHeaders(true),
            body: JSON.stringify({ uid: uid, name: name })
        });
        if (res.status === 401) { gotoLoginCleared(AUTH_EXPIRED_MSG); return; }
        if (res.status === 403) { showToast('방장만 이름을 수정할 수 있습니다'); return; }
        if (!res.ok) { showToast('이름을 수정하지 못했습니다'); return; }
        closeModal();
        showToast('방 이름을 수정했어요');
        await loadRooms();
    } catch (e) { showToast('서버에 연결하지 못했습니다'); }
}

// ===== 방 생성 =====
async function createRoom(name) {
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
        closeModal();
        showToast('방이 만들어졌어요');
        await loadRooms(); // 목록에서 코드 확인/공유 후 입장
    } catch (e) { showToast('서버에 연결하지 못했습니다'); }
}

// ===== 코드로 입장 =====
async function joinRoom(code) {
    try {
        const res = await fetch(`${API_BASE}/api/rooms/join`, {
            method: 'POST', headers: authHeaders(true),
            body: JSON.stringify({ uid: uid, code: code.toUpperCase() })
        });
        if (res.status === 401 || res.status === 403) { gotoLoginCleared(AUTH_EXPIRED_MSG); return; }
        if (res.status === 404) { showToast('유효하지 않은 초대 코드입니다'); return; }
        if (!res.ok) { showToast('입장하지 못했습니다'); return; }
        const room = await res.json();
        closeModal();
        enterRoom(room); // 입장 의도이므로 바로 방으로 이동
    } catch (e) { showToast('서버에 연결하지 못했습니다'); }
}

// ===== 방 삭제 (방장) =====
async function deleteRoom(r) {
    if (!confirm(`'${r.name}' 방을 삭제할까요?\n방의 모든 멤버가 나가게 됩니다.`)) return;
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
}

// ===== 방 나가기 (멤버) =====
async function leaveRoom(r) {
    if (!confirm(`'${r.name}' 방에서 나갈까요?`)) return;
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
}

// ===== 이벤트 바인딩 =====
if (tabMemberEl) tabMemberEl.addEventListener('click', () => setView('member'));
if (tabOwnerEl)  tabOwnerEl.addEventListener('click', () => setView('owner'));
document.getElementById('btn-create-room').addEventListener('click', () => openModal('create'));
document.getElementById('btn-join-room').addEventListener('click', () => openModal('join'));
document.querySelectorAll('.type-chip').forEach(ch => {
    ch.addEventListener('click', () => { selectedType = ch.dataset.type; updateTypeChips(); });
});
document.getElementById('btn-logout').addEventListener('click', () => {
    if (!confirm('로그아웃 하시겠어요?')) return;
    AUTH_KEYS.forEach(k => localStorage.removeItem(k));
    location.replace('login.html');
});
modalOk.addEventListener('click', submitModal);
modalCancel.addEventListener('click', closeModal);
modalEl.addEventListener('click', (e) => { if (e.target === modalEl) closeModal(); });
modalInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitModal(); });

// ===== 시작 =====
// 유효한 세션일 때만 로드. (이미 gotoLoginCleared() 로 이동 중이면 실행 안 함)
if (validSession) loadRooms();
