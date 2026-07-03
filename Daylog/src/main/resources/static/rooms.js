// =====================================================
// Daylog — 방 목록 (셋로그 스타일)
// 로그인 후 진입: 방 목록 → 방 입장 → main.html
// 방은 초대 코드로 멤버가 모여, 그 방 멤버끼리만 추억/가볼곳 공유
// =====================================================

const CFG = window.APP_CONFIG || {};
const API_BASE = (CFG && CFG.BACKEND_BASE) || 'http://localhost:8086';
const TOKEN_KEY = 'accessToken';

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

// ===== 인증 가드 =====
const token = getToken();
const payload = decodeJwt(token);
if (!token || !payload || (payload.exp && Date.now() >= payload.exp * 1000)) {
    location.replace('login.html');
}
const uid = payload && (payload.sub || payload.uid || payload.username || payload.userId);

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

let modalMode = null; // 'create' | 'join'
let selectedType = 'COUPLE';

function typeLabel(type) {
    if (type === 'FRIEND') return { label: '친구', cls: 'friend' };
    if (type === 'FAMILY') return { label: '가족', cls: 'family' };
    return { label: '커플', cls: 'couple' };
}
function updateTypeChips() {
    document.querySelectorAll('.type-chip').forEach(ch => {
        ch.classList.toggle('active', ch.dataset.type === selectedType);
    });
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
async function loadRooms() {
    if (!uid) { location.replace('login.html'); return; }
    try {
        const res = await fetch(`${API_BASE}/api/rooms/${encodeURIComponent(uid)}`, { headers: authHeaders(true) });
        if (res.status === 401 || res.status === 403) { location.replace('login.html'); return; }
        if (!res.ok) { showToast('방 목록을 불러오지 못했습니다'); return; }
        const rooms = await res.json();
        renderRooms(Array.isArray(rooms) ? rooms : []);
    } catch (e) {
        console.error(e);
        showToast('서버에 연결하지 못했습니다');
    }
}

// ===== 렌더링 =====
function renderRooms(rooms) {
    listEl.innerHTML = '';
    if (!rooms.length) { emptyEl.style.display = 'block'; return; }
    emptyEl.style.display = 'none';

    rooms.forEach(r => {
        const card = document.createElement('div');
        card.className = 'room-card';

        const ownerBadge = r.owner ? '<span class="room-owner-badge">방장</span>' : '';
        const t = typeLabel(r.type);
        card.innerHTML = `
            <div class="room-card-main">
                <div class="room-name">${esc(r.name)} ${ownerBadge} <span class="room-type-badge ${t.cls}">${t.label}</span></div>
                <div class="room-meta">멤버 ${Number(r.memberCount) || 0}명 · 코드 <span class="room-code">${esc(r.inviteCode)}</span></div>
                <div class="room-enter-hint">탭하여 입장 →</div>
            </div>
            <div class="room-card-actions"></div>
        `;

        const main = card.querySelector('.room-card-main');
        main.addEventListener('click', () => enterRoom(r));

        const actions = card.querySelector('.room-card-actions');

        // 코드 복사
        const copyBtn = document.createElement('button');
        copyBtn.className = 'room-icon-btn';
        copyBtn.type = 'button';
        copyBtn.title = '초대 코드 복사';
        copyBtn.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
        copyBtn.addEventListener('click', (e) => { e.stopPropagation(); copyCode(r.inviteCode); });
        actions.appendChild(copyBtn);

        // 방장이면 삭제 / 아니면 나가기
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
        showToast('초대 코드를 복사했어요: ' + code);
    } catch (e) { showToast('복사에 실패했습니다: ' + code); }
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
        selectedType = 'COUPLE';
        updateTypeChips();
    } else {
        modalTitle.textContent = '코드로 입장';
        modalDesc.textContent = '초대 코드를 입력하면 그 방의 멤버가 됩니다.';
        modalInput.value = '';
        modalInput.placeholder = '초대 코드 6자리';
        modalInput.classList.add('code');
        modalInput.maxLength = 8;
        typeRow.style.display = 'none';
    }
    modalEl.classList.remove('hidden');
    setTimeout(() => modalInput.focus(), 50);
}
function closeModal() { modalEl.classList.add('hidden'); modalMode = null; }

async function submitModal() {
    const val = (modalInput.value || '').trim();
    if (!val) { showToast(modalMode === 'create' ? '방 이름을 입력하세요' : '초대 코드를 입력하세요'); return; }
    modalOk.disabled = true;
    try {
        if (modalMode === 'create') await createRoom(val);
        else await joinRoom(val);
    } finally { modalOk.disabled = false; }
}

// ===== 방 생성 =====
async function createRoom(name) {
    try {
        const payload = { uid: uid, name: name, type: selectedType };
        const res = await fetch(`${API_BASE}/api/rooms`, {
            method: 'POST', headers: authHeaders(true),
            body: JSON.stringify(payload)
        });
        if (!res.ok) { showToast('방을 만들지 못했습니다'); return; }
        const room = await res.json();
        closeModal();
        showToast('방이 만들어졌어요 · 코드 ' + (room.inviteCode || ''));
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
document.getElementById('btn-create-room').addEventListener('click', () => openModal('create'));
document.getElementById('btn-join-room').addEventListener('click', () => openModal('join'));
document.querySelectorAll('.type-chip').forEach(ch => {
    ch.addEventListener('click', () => { selectedType = ch.dataset.type; updateTypeChips(); });
});
document.getElementById('btn-logout').addEventListener('click', () => {
    if (!confirm('로그아웃 하시겠어요?')) return;
    ['accessToken','currentUser','auth','selectedRoomId','selectedRoomName','selectedRoomType','selectedRoomOwnerUid']
        .forEach(k => localStorage.removeItem(k));
    location.replace('login.html');
});
modalOk.addEventListener('click', submitModal);
modalCancel.addEventListener('click', closeModal);
modalEl.addEventListener('click', (e) => { if (e.target === modalEl) closeModal(); });
modalInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitModal(); });

// ===== 시작 =====
loadRooms();
