// ==========================================
// 1. JWT 인증 및 공통 유틸 (부동산 프로젝트 패턴 동일)
// ==========================================
const API_BASE_URL = (window.APP_CONFIG && window.APP_CONFIG.BACKEND_BASE) || 'http://localhost:8086';
const TOKEN_KEY = 'accessToken';

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
    alert(msg || '토큰이 만료되었거나 존재하지 않습니다. 다시 로그인해주세요.');
    logout();                              // accessToken 제거 → login.js 되튕김 방지
    location.href = 'login.html';
}

// 유효하지 않으면 로그인 페이지로 보냄
function requireAuthOrRedirect() {
    if (!isTokenValid()) { redirectToLogin(); return false; }
    return true;
}

// 공통 fetch 응답 처리
async function handleResponse(res) {
    if (res.status === 401 || res.status === 403) {
        redirectToLogin('세션이 만료되었습니다. 다시 로그인해주세요.');
        throw new Error('인증이 만료되었습니다');
    }
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        if (/jwt|token|expired|signature|malformed|unauthor|forbidden|authentication/i.test(text)) {
            redirectToLogin('세션이 만료되었습니다. 다시 로그인해주세요.');
            throw new Error('인증이 만료되었습니다');
        }
        throw new Error(text || (res.status + ' ' + res.statusText));
    }
    if (res.status === 204) return null;
    return res.json();
}

// ==========================================
// 2. 메인 앱 로직
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // 페이지 진입 시 가장 먼저 인증 체크
    if (!requireAuthOrRedirect()) return;

    let map = null;
    let selectedFile = null;
    let currentLatLng = null;
    let isWaitingForMapClick = false;
    let mapClickListener = null;
    let memoryList = [];

    const currentUid = getUid();
    const mapWrapper = document.getElementById('map-wrapper');
    const locationMode = document.getElementById('location-mode');
    const fileInput = document.getElementById('memory-file');

    // --- 디데이 ---
    calculateDDay(new Date("2026-05-09"));

    // --- 로그아웃 ---
    document.getElementById('btn-logout').addEventListener('click', (e) => {
        e.preventDefault();
        if (confirm('정말 로그아웃 하시겠어요?')) redirectToLogin('로그아웃 되었습니다.');
    });

    // --- 탭 전환 ---
    const navItems = document.querySelectorAll('.nav-item');
    const tabContents = document.querySelectorAll('.tab-content');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            const targetTab = item.getAttribute('data-tab');
            tabContents.forEach(tab => {
                const show = (tab.id === targetTab);
                tab.style.display = show ? 'block' : 'none';
                // 재진입 시 페이드 애니메이션 다시 트리거
                if (show) { tab.classList.remove('tab-content'); void tab.offsetWidth; tab.classList.add('tab-content'); }
            });
            if (targetTab === 'tab-map' && map) {
                naver.maps.Event.trigger(map, 'resize');
            }
            if (targetTab === 'tab-profile') {
                loadProfiles();
            }
        });
    });

    // --- 네이버 지도 초기화 ---
    if (window.APP_CONFIG && window.APP_CONFIG.NAVER_MAP_CLIENT_ID) {
        const script = document.createElement('script');
        script.src = 'https://openapi.map.naver.com/openapi/v3/maps.js?submodules=geocoder&ncpKeyId=' + window.APP_CONFIG.NAVER_MAP_CLIENT_ID;
        script.async = true;
        script.onload = () => initMap();
        script.onerror = () => showMapFallback('지도를 불러오지 못했어요. 네트워크나 키 설정을 확인해주세요.');
        document.head.appendChild(script);
    } else {
        showMapFallback('지도 키가 설정되지 않았어요. config.js의 NAVER_MAP_CLIENT_ID를 확인해주세요.');
    }

    function showMapFallback(msg) {
        const mapEl = document.getElementById('naver-map');
        if (!mapEl) return;
        mapEl.innerHTML = '<div class="map-fallback"><span class="mf-icon">🗺️</span><p>' + escapeHtml(msg) + '</p></div>';
    }

    function initMap() {
        map = new naver.maps.Map('naver-map', {
            center: new naver.maps.LatLng(37.5665, 126.9780),
            zoom: 12
        });
        loadMemoriesFromServer();
    }

    // --- 위치 선택 모드 ---
    function enterPickMode() {
        isWaitingForMapClick = true;
        locationMode.classList.remove('hidden');
        mapWrapper.classList.add('picking');

        if (mapClickListener) naver.maps.Event.removeListener(mapClickListener);
        mapClickListener = naver.maps.Event.addListener(map, 'click', (event) => {
            if (!isWaitingForMapClick) return;
            // 클릭 좌표는 정확한 상세 위치
            currentLatLng = { lat: event.coord.lat(), lng: event.coord.lng() };
            reverseGeocodeAndLabel(currentLatLng.lat, currentLatLng.lng, '🎯');
            exitPickMode();
            openMemoryModal();
        });
    }

    // 좌표 → 상세 주소 (역지오코딩)로 배지 문구 채우기
    function setBadgeManual(text) {
        const b = document.getElementById('location-status-badge');
        b.innerText = text;
        b.className = 'location-badge manual';
    }
    function reverseGeocodeAndLabel(lat, lng, prefix) {
        const tag = prefix || '🎯';
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
            setBadgeManual(tag + ' ' + (addr || '지정한 위치로 설정되었습니다'));
        });
    }

    // --- 위치 다시 설정하기 (작성 폼 내용은 유지) ---
    const resetLocBtn = document.getElementById('btn-reset-location');
    if (resetLocBtn) {
        resetLocBtn.addEventListener('click', () => {
            document.getElementById('memory-modal').classList.add('hidden'); // reset() 호출 안 함 → 입력 유지
            enterPickMode();
        });
    }

    function exitPickMode() {
        isWaitingForMapClick = false;
        locationMode.classList.add('hidden');
        mapWrapper.classList.remove('picking');
        const si = document.getElementById('lm-search-input');
        if (si) si.value = '';
        const sg = document.getElementById('lm-suggestions');
        if (sg) { sg.classList.add('hidden'); sg.innerHTML = ''; }
        if (mapClickListener) { naver.maps.Event.removeListener(mapClickListener); mapClickListener = null; }
    }

    document.getElementById('lm-cancel').addEventListener('click', () => {
        exitPickMode();
        selectedFile = null;
        if (fileInput) fileInput.value = '';
        showToast('위치 선택을 취소했어요');
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
        const lat = parseFloat(item.y);
        const lng = parseFloat(item.x);
        if (isNaN(lat) || isNaN(lng)) { showToast('좌표를 찾지 못했어요'); return; }
        currentLatLng = { lat: lat, lng: lng };

        // 모달 뒤로 위치가 보이도록 지도 이동
        map.setCenter(new naver.maps.LatLng(lat, lng));
        map.setZoom(16);

        const label = item.roadAddress || item.jibunAddress || (searchInput.value || '').trim();
        const badge = document.getElementById('location-status-badge');
        badge.innerText = "🔍 '" + label + "' 위치로 설정되었습니다";
        badge.className = "location-badge manual";

        hideSuggestions();
        exitPickMode();
        openMemoryModal();
    }

    function renderSuggestions(addresses) {
        if (!suggestBox) return;
        lastSuggestions = addresses;
        suggestBox.innerHTML = '';
        addresses.forEach((item) => {
            const main = item.roadAddress || item.jibunAddress || '주소 정보 없음';
            const sub = (item.roadAddress && item.jibunAddress && item.roadAddress !== item.jibunAddress)
                ? item.jibunAddress : '';
            const li = document.createElement('li');
            li.innerHTML = '<span class="sg-main">' + escapeHtml(main) + '</span>' +
                (sub ? '<span class="sg-sub">' + escapeHtml(sub) + '</span>' : '');
            li.addEventListener('click', () => setLocationFromItem(item));
            suggestBox.appendChild(li);
        });
        suggestBox.classList.remove('hidden');
    }

    function showEmptySuggestion() {
        if (!suggestBox) return;
        suggestBox.innerHTML = '<li class="sg-empty">검색 결과가 없어요</li>';
        suggestBox.classList.remove('hidden');
        lastSuggestions = [];
    }

    // 입력 중 연관 검색어 조회 (디바운스)
    function fetchSuggestions(query) {
        if (!map || !(window.naver && naver.maps.Service)) return;
        naver.maps.Service.geocode({ query: query }, (status, response) => {
            if ((searchInput.value || '').trim().length < 2) { hideSuggestions(); return; }
            if (status !== naver.maps.Service.Status.OK) { hideSuggestions(); return; }
            const addresses = response.v2 && response.v2.addresses;
            if (!addresses || addresses.length === 0) { showEmptySuggestion(); return; }
            renderSuggestions(addresses.slice(0, 6));
        });
    }

    // 검색 버튼/Enter: 떠 있는 후보 중 첫 번째 선택, 없으면 직접 조회
    function runSearch() {
        const query = (searchInput.value || '').trim();
        if (!query) { showToast('검색할 주소를 입력해주세요'); return; }
        if (!map || !(window.naver && naver.maps.Service)) { showToast('지도가 아직 준비되지 않았어요'); return; }
        if (lastSuggestions.length > 0) { setLocationFromItem(lastSuggestions[0]); return; }
        naver.maps.Service.geocode({ query: query }, (status, response) => {
            if (status !== naver.maps.Service.Status.OK) { showToast('주소 검색에 실패했어요'); return; }
            const addresses = response.v2 && response.v2.addresses;
            if (!addresses || addresses.length === 0) { showToast('검색 결과가 없어요. 다른 키워드로 시도해보세요.'); return; }
            setLocationFromItem(addresses[0]);
        });
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
    if (fileInput) {
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            selectedFile = file;

            // 미리보기
            const reader = new FileReader();
            reader.onload = (ev) => {
                const preview = document.getElementById('image-preview');
                preview.src = ev.target.result;
                preview.classList.remove('hidden');
            };
            reader.readAsDataURL(file);

            if (!map) {
                showToast('지도가 아직 준비되지 않았어요');
                return;
            }

            try {
                const gps = await exifr.gps(file);
                if (gps && gps.latitude && gps.longitude) {
                    // 사진 메타데이터로 위치 자동 설정
                    currentLatLng = { lat: gps.latitude, lng: gps.longitude };
                    const badge = document.getElementById('location-status-badge');
                    badge.innerText = "📍 사진 위치가 자동으로 설정되었습니다!";
                    badge.className = "location-badge success";
                    openMemoryModal();
                } else {
                    // 메타데이터 없음 → 지도 클릭 모드
                    enterPickMode();
                }
            } catch (error) {
                showToast('사진 분석에 실패했어요. 지도에서 위치를 골라주세요.');
                enterPickMode();
            }
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

            const memoryDTO = {
                title: document.getElementById('memory-title').value,
                content: document.getElementById('memory-content').value,
                lat: currentLatLng.lat,
                lng: currentLatLng.lng,
                createdAt: new Date(document.getElementById('memory-date').value).toISOString()
            };

            const formData = new FormData();
            formData.append("uid", currentUid);
            formData.append("memoryData", JSON.stringify(memoryDTO));
            if (selectedFile) formData.append("mediaData", selectedFile);

            fetch(`${API_BASE_URL}/api/memories`, {
                method: 'POST',
                headers: authHeaders(false),
                body: formData
            })
                .then(handleResponse)
                .then(() => {
                    closeMemoryModal();
                    showToast('소중한 기억이 기록되었어요 🤎');
                    loadMemoriesFromServer();
                })
                .catch(err => {
                    console.error(err);
                    showToast('기록에 실패했어요. 다시 시도해주세요.');
                })
                .finally(() => {
                    submitBtn.disabled = false;
                    submitBtn.innerText = '기록하기 ✨';
                });
        });
    }

    // --- 데이터 불러오기 및 렌더링 ---
    function loadMemoriesFromServer() {
        if (!requireAuthOrRedirect()) return;

        fetch(`${API_BASE_URL}/api/memories/${currentUid}`, { headers: authHeaders(true) })
            .then(handleResponse)
            .then(memories => {
                memoryList = memories || [];
                updateProfileStats();

                const timelineFeed = document.getElementById('timeline-feed');
                timelineFeed.innerHTML = '';

                if (memoryList.length === 0) {
                    timelineFeed.innerHTML =
                        '<div class="empty-state"><span class="es-icon">🤎</span>' +
                        '<p>아직 기록된 추억이 없어요.<br>지도 탭에서 첫 추억을 남겨보세요!</p></div>';
                    return;
                }

                const sorted = [...memoryList].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

                sorted.forEach((memory, idx) => {
                    // 1. 지도 마커
                    if (map && memory.lat && memory.lng) {
                        const markerHtml = memory.mediaURL
                            ? `<div class="custom-marker"><img src="${memory.mediaURL}" alt=""></div>`
                            : `<div class="marker-heart">💖</div>`;

                        const marker = new naver.maps.Marker({
                            position: new naver.maps.LatLng(memory.lat, memory.lng),
                            map: map,
                            icon: { content: markerHtml, anchor: new naver.maps.Point(24, 24) }
                        });
                        naver.maps.Event.addListener(marker, 'click', () => openDetailModal(memory));
                    }

                    // 2. 타임라인 카드 (등장 stagger)
                    const formattedDate = memory.createdAt ? memory.createdAt.substring(0, 10).replace(/-/g, '.') : '';
                    const card = document.createElement('div');
                    card.classList.add('memory-card');
                    card.style.animationDelay = (idx * 0.06) + 's';
                    card.innerHTML = `
                        <div class="card-header">
                            <span class="card-date">${formattedDate}</span>
                            <h4 class="card-title">${escapeHtml(memory.title)}</h4>
                        </div>
                        <p class="card-text">${escapeHtml(memory.content)}</p>`;
                    card.addEventListener('click', () => openDetailModal(memory));
                    timelineFeed.appendChild(card);
                });
            })
            .catch(err => console.error("데이터 로드 실패:", err));
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
    let editingUser = null;
    const profileFileInput = document.getElementById('profile-file');

    function loadProfiles() {
        if (!requireAuthOrRedirect()) return;
        fetch(`${API_BASE_URL}/user/all/${currentUid}`, { headers: authHeaders(true) })
            .then(handleResponse)
            .then(users => {
                const list = users || [];
                meUser = list.find(isMe) || null;
                partnerUser = list.find(u => !isMe(u)) || null;
                renderProfileBox('me', meUser, '👦', '나');
                renderProfileBox('partner', partnerUser, '👧', '여자친구');
                updateProfileStats();
            })
            .catch(err => console.error("프로필 로드 실패:", err));
    }

    function renderProfileBox(role, user, fallbackEmoji, relationLabel) {
        const avatar = document.getElementById('avatar-' + role);
        const nameEl = document.getElementById('name-' + role);
        const subEl = document.getElementById('sub-' + role);
        const editEl = document.getElementById('edit-' + role);
        const wrap = document.getElementById('wrap-' + role);
        if (!avatar || !wrap) return;

        // 아바타 이미지 / 기본 이모지
        if (user && user.profileURL) {
            avatar.innerHTML = '<img src="' + user.profileURL + '" alt="프로필">';
        } else {
            avatar.innerHTML = fallbackEmoji;
        }

        // 이름(닉네임 우선) / 관계 라벨
        const displayName = (user && (user.nickname || user.name)) ? (user.nickname || user.name) : relationLabel;
        nameEl.innerText = displayName;
        subEl.innerText = relationLabel;

        // 편집 권한: 백엔드는 '로그인한 본인'만 수정 가능
        const editable = !!(user && user.uid === currentUid);
        wrap.classList.remove('editable', 'viewable');
        editEl.classList.add('hidden');
        wrap.onclick = null;

        if (editable) {
            wrap.classList.add('editable');
            editEl.classList.remove('hidden');
            wrap.onclick = () => { editingUser = user; profileFileInput.click(); };
        } else if (user && user.profileURL) {
            wrap.classList.add('viewable');
            wrap.onclick = () => openLightbox(user.profileURL);
        }
    }

    if (profileFileInput) {
        profileFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            profileFileInput.value = ''; // 같은 파일 재선택 허용
            if (!file || !editingUser) return;
            uploadProfileImage(editingUser, file);
        });
    }

    function uploadProfileImage(user, file) {
        if (!requireAuthOrRedirect()) return;
        showToast('프로필 사진을 올리는 중...');
        // 백엔드가 파일 없으면 profileURL을 비우고, 보낸 필드로 덮어쓰므로
        // 받은 user 객체(전체 필드)를 그대로 다시 보냄
        const fd = new FormData();
        fd.append('userData', JSON.stringify(user));
        fd.append('mediaData', file);

        fetch(`${API_BASE_URL}/user`, {
            method: 'PUT',
            headers: authHeaders(false),
            body: fd
        })
            .then(handleResponse)
            .then(() => {
                showToast('프로필 사진이 변경되었어요 🤎');
                loadProfiles();
            })
            .catch(err => {
                console.error(err);
                showToast('변경에 실패했어요. 다시 시도해주세요.');
            });
    }

    function updateProfileStats() {
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v; };
        set('stat-days', daysSince(DDAY_START));
        set('stat-total', memoryList.length);
        const meUid = meUser && meUser.uid;
        const pUid = partnerUser && partnerUser.uid;
        set('stat-me-count', memoryList.filter(m => m.ownerUid === meUid).length);
        set('stat-partner-count', memoryList.filter(m => m.ownerUid === pUid).length);
        // 라벨에 실제 이름 반영
        const meLabel = document.getElementById('stat-me-label');
        const pLabel = document.getElementById('stat-partner-label');
        if (meLabel && meUser) meLabel.innerText = (meUser.nickname || meUser.name || '내') + '의 추억';
        if (pLabel && partnerUser) pLabel.innerText = (partnerUser.nickname || partnerUser.name || '상대') + '의 추억';
    }

    // 첫 진입 시 프로필 로드
    loadProfiles();

    // 모달 바깥 클릭 시 닫기
    document.getElementById('memory-modal').addEventListener('click', (e) => {
        if (e.target.id === 'memory-modal') closeMemoryModal();
    });
    document.getElementById('detail-modal').addEventListener('click', (e) => {
        if (e.target.id === 'detail-modal') closeDetailModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { closeLightbox(); closeMemoryModal(); closeDetailModal(); }
    });

    // ===== 이미지 라이트박스 (확대 + 드래그) =====
    const lbStage = document.getElementById('lightbox-stage');
    const lbImg = document.getElementById('lightbox-img');
    const lbHint = document.getElementById('lightbox-hint');

    document.getElementById('lightbox-close').addEventListener('click', closeLightbox);

    // 이미지 탭 → 확대/축소 토글
    lbImg.addEventListener('click', (e) => {
        e.stopPropagation();
        if (_lb.moved) { _lb.moved = false; return; }
        if (_lb.scale === 1) { _lb.scale = 2.4; }
        else { _lb.scale = 1; _lb.x = 0; _lb.y = 0; }
        _lbApply();
        if (lbHint) lbHint.style.opacity = (_lb.scale === 1) ? '1' : '0';
    });

    // 확대 상태에서 드래그하여 이동
    lbStage.addEventListener('pointerdown', (e) => {
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
    function _lbEndDrag() { _lb.dragging = false; lbImg.classList.remove('dragging'); }
    lbStage.addEventListener('pointerup', _lbEndDrag);
    lbStage.addEventListener('pointercancel', _lbEndDrag);

    // 이미지 밖(배경) 탭 → 닫기
    lbStage.addEventListener('click', (e) => {
        if (e.target === lbImg) return;
        if (_lb.moved) { _lb.moved = false; return; }
        closeLightbox();
    });

    // 미리보기 / 상세 이미지 클릭 → 라이트박스 열기
    const previewImg = document.getElementById('image-preview');
    if (previewImg) previewImg.addEventListener('click', function () { if (this.src) openLightbox(this.src); });
    const detailImg = document.getElementById('detail-image');
    if (detailImg) detailImg.addEventListener('click', function () { if (this.src) openLightbox(this.src); });
});

// ==========================================
// 3. UI 제어 유틸
// ==========================================
function openMemoryModal() {
    const modal = document.getElementById('memory-modal');
    modal.classList.remove('hidden');
    const d = document.getElementById('memory-date');
    if (!d.value) d.value = new Date().toISOString().substring(0, 10);
}

function closeMemoryModal() {
    document.getElementById('memory-modal').classList.add('hidden');
    document.getElementById('memory-form').reset();
    document.getElementById('image-preview').classList.add('hidden');
    const lm = document.getElementById('location-mode');
    if (lm) lm.classList.add('hidden');
}

function openDetailModal(memory) {
    const formattedDate = memory.createdAt ? memory.createdAt.substring(0, 10).replace(/-/g, '.') : '';
    document.getElementById('detail-date').innerText = formattedDate;
    document.getElementById('detail-title').innerText = memory.title;
    document.getElementById('detail-text').innerText = memory.content;

    const imgEl = document.getElementById('detail-image');
    if (memory.mediaURL) {
        imgEl.src = memory.mediaURL;
        imgEl.classList.remove('hidden');
    } else {
        imgEl.classList.add('hidden');
        imgEl.src = "";
    }
    document.getElementById('detail-modal').classList.remove('hidden');
}

function closeDetailModal() {
    document.getElementById('detail-modal').classList.add('hidden');
}

const DDAY_START = "2026-05-09"; // 사귀기 시작한 날
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

// ===== 라이트박스 상태 & 제어 =====
const _lb = { scale: 1, x: 0, y: 0, dragging: false, sx: 0, sy: 0, bx: 0, by: 0, moved: false };
function _lbApply() {
    const img = document.getElementById('lightbox-img');
    if (img) img.style.transform = 'translate(' + _lb.x + 'px, ' + _lb.y + 'px) scale(' + _lb.scale + ')';
}
function openLightbox(src) {
    if (!src) return;
    const lb = document.getElementById('lightbox');
    const img = document.getElementById('lightbox-img');
    const hint = document.getElementById('lightbox-hint');
    if (!lb || !img) return;
    img.src = src;
    _lb.scale = 1; _lb.x = 0; _lb.y = 0; _lbApply();
    if (hint) hint.style.opacity = '1';
    lb.classList.remove('hidden');
}
function closeLightbox() {
    const lb = document.getElementById('lightbox');
    if (!lb || lb.classList.contains('hidden')) return;
    lb.classList.add('hidden');
    const img = document.getElementById('lightbox-img');
    if (img) img.src = '';
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