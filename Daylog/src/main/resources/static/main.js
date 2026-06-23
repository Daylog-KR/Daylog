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
    // 1. 401(Unauthorized), 403(Forbidden) 또는 500(Internal Server Error)이 발생하면 튕겨냄
    if (res.status === 401 || res.status === 403 || res.status === 500) {
        redirectToLogin('토큰이 만료되었거나 존재하지 않습니다. 다시 로그인해주세요.');
        throw new Error('인증 만료 또는 서버 에러 발생');
    }

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        // 2. 에러 텍스트 내부에 토큰 관련 키워드가 있거나 500 에러 오브젝트 구조가 보이면 튕겨냄
        if (/jwt|token|expired|signature|malformed|unauthor|forbidden|authentication|Internal Server Error/i.test(text)) {
            redirectToLogin('토큰이 만료되었거나 존재하지 않습니다. 다시 로그인해주세요.');
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
        if (confirm('로그아웃을 진행합니다.')) redirectToLogin('로그아웃 되었습니다.');
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
        script.onerror = () => showMapFallback('지도 조회 실패. 네트워크나 키 설정을 확인해주세요.');
        document.head.appendChild(script);
    } else {
        showMapFallback('지도 키가 설정되지 않음. config.js의 NAVER_MAP_CLIENT_ID를 확인해주세요.');
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
        showToast('위치 선택을 취소함');
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
        if (isNaN(lat) || isNaN(lng)) { showToast('좌표 조회 실패'); return; }
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
        suggestBox.innerHTML = '<li class="sg-empty">검색 결과가 없음</li>';
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
        if (!map || !(window.naver && naver.maps.Service)) { showToast('지도가 아직 준비되지 않음'); return; }
        if (lastSuggestions.length > 0) { setLocationFromItem(lastSuggestions[0]); return; }
        naver.maps.Service.geocode({ query: query }, (status, response) => {
            if (status !== naver.maps.Service.Status.OK) { showToast('주소 검색에 실패함'); return; }
            const addresses = response.v2 && response.v2.addresses;
            if (!addresses || addresses.length === 0) { showToast('검색 결과가 없음. 다른 키워드로 시도해보세요.'); return; }
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
                showToast('지도가 아직 준비되지 않음');
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
                showToast('사진 분석 실패. 지도에서 위치를 골라주세요.');
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
                    showToast('기록 성공');
                    loadMemoriesFromServer();
                })
                .catch(err => {
                    console.error(err);
                    showToast('기록 실패. 다시 시도해주세요.');
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
                        '<p>기록이 존재하지 않음</p></div>';
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
    let currentUser = null;
    let editingUser = null;
    const profileFileInput = document.getElementById('profile-file');

    function loadProfiles() {
        if (!requireAuthOrRedirect()) return;
        fetch(`${API_BASE_URL}/user/all/${currentUid}`, { headers: authHeaders(true) })
            .then(handleResponse)
            .then(users => {
                const list = users || [];
                console.log('[Daylog] /user/all 응답:', list);
                // 로그인한 본인 = '나', 나머지 = '상대방' (uid 기준으로 확실히 구분)
                meUser = list.find(u => u.uid === currentUid) || null;
                partnerUser = list.find(u => u.uid !== currentUid) || null;
                currentUser = meUser;
                if (!meUser) {
                    console.warn('[Daylog] 로그인 uid(' + currentUid + ')와 일치하는 사용자가 목록에 없습니다.');
                }
                renderProfileBox('me', meUser, '👦', '나');
                renderProfileBox('partner', partnerUser, '👧', '상대방');
                updateProfileStats();
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
                renderProfileBox('me', me, '👦', '나');
                updateProfileStats();
                maybePromptNickname();
            })
            .catch(err => console.error("본인 프로필 폴백 실패(/user/uid):", err));
    }

    // 닉네임이 없으면 최초 설정 모달 노출 (있으면 노출하지 않음)
    function maybePromptNickname() {
        if (!currentUser) return;
        const nick = currentUser.nickname;
        const modal = document.getElementById('nickname-modal');
        if ((!nick || !String(nick).trim()) && modal.classList.contains('hidden')) {
            document.getElementById('nickname-input').value = '';
            modal.classList.remove('hidden');
            setTimeout(() => { const i = document.getElementById('nickname-input'); if (i) i.focus(); }, 120);
        }
    }

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
        return fetch(`${API_BASE_URL}/user`, {
            method: 'PUT',
            headers: authHeaders(false),
            body: fd
        }).then(handleResponse);
    }

    function renderProfileBox(role, user, fallbackEmoji, relationLabel) {
        const avatar = document.getElementById('avatar-' + role);
        const nameEl = document.getElementById('name-' + role);
        const subEl = document.getElementById('sub-' + role);
        const editEl = document.getElementById('edit-' + role);
        const wrap = document.getElementById('wrap-' + role);
        if (!avatar || !wrap) return;

        // 아바타 이미지 / 기본 이모지 (이미지 로드 실패 시 이모지로 폴백)
        if (user && user.profileURL) {
            avatar.innerHTML = '';
            const img = document.createElement('img');
            img.src = user.profileURL;
            img.alt = '프로필';
            img.onerror = () => { avatar.innerHTML = fallbackEmoji; };
            avatar.appendChild(img);
        } else {
            avatar.innerHTML = fallbackEmoji;
        }

        // 닉네임만 표시 (없으면 name 이 아니라 관계 라벨로)
        const hasNick = !!(user && user.nickname && String(user.nickname).trim());
        nameEl.innerText = hasNick ? user.nickname : relationLabel;
        subEl.innerText = hasNick ? relationLabel : '';

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
            const target = editingUser;
            openCropper(file, (cropped) => uploadProfileImage(target, cropped));
        });
    }

    function uploadProfileImage(user, file) {
        if (!requireAuthOrRedirect()) return;
        showToast('프로필 사진을 올리는 중...');
        saveUser({ uid: user.uid, id: user.id }, file)
            .then(() => {
                showToast('프로필 사진이 변경 완료');
                loadProfiles();
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
            if (!val) { showToast('닉네임을 입력해주세요'); return; }
            if (!currentUser) { showToast('사용자 정보 조회 실패'); return; }
            const btn = nicknameForm.querySelector('.submit-btn');
            btn.disabled = true; btn.innerText = '저장 중...';
            const payload = { uid: currentUser.uid, id: currentUser.id, nickname: val };
            saveUser(payload, null)
                .then(updated => {
                    currentUser = updated || payload;
                    document.getElementById('nickname-modal').classList.add('hidden');
                    showToast('닉네임이 설정 완료');
                    loadProfiles();
                })
                .catch(err => { console.error(err); showToast('설정 실패: ' + (err.message || '서버 오류')); })
                .finally(() => { btn.disabled = false; btn.innerText = '시작하기 ✨'; });
        });
    }

    // ----- 프로필 수정 페이지 -----
    let editPendingFile = null;
    const editFileInput = document.getElementById('edit-file');
    const editPage = document.getElementById('edit-page');

    function openEditPage() {
        if (!currentUser) { showToast('사용자 정보를 불러오는 중이에요'); loadProfiles(); return; }
        editPendingFile = null;
        document.getElementById('edit-nickname').value = currentUser.nickname || '';
        document.getElementById('edit-avatar').innerHTML =
            currentUser.profileURL ? '<img src="' + currentUser.profileURL + '" alt="프로필">' : '👤';
        editPage.classList.add('open');
    }
    function closeEditPage() { editPage.classList.remove('open'); }

    document.getElementById('btn-edit-profile').addEventListener('click', openEditPage);
    document.getElementById('edit-back').addEventListener('click', closeEditPage);
    document.getElementById('edit-avatar-wrap').addEventListener('click', () => editFileInput.click());

    editFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        editFileInput.value = '';
        if (!file) return;
        openCropper(file, (cropped) => {
            editPendingFile = cropped;
            const reader = new FileReader();
            reader.onload = (ev) => {
                document.getElementById('edit-avatar').innerHTML = '<img src="' + ev.target.result + '" alt="프로필">';
            };
            reader.readAsDataURL(cropped);
        });
    });

    const editForm = document.getElementById('edit-form');
    editForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!currentUser) return;
        const nick = document.getElementById('edit-nickname').value.trim();
        if (!nick) { showToast('닉네임을 입력해주세요'); return; }
        const btn = editForm.querySelector('.submit-btn');
        btn.disabled = true; btn.innerText = '저장 중...';
        // 닉네임과 프로필 이미지만 수정 (uid/id 는 본인 식별용)
        const payload = { uid: currentUser.uid, id: currentUser.id, nickname: nick };
        saveUser(payload, editPendingFile)
            .then(updated => {
                currentUser = updated || payload;
                editPendingFile = null;
                showToast('프로필 저장 완료');
                closeEditPage();
                loadProfiles();
            })
            .catch(err => { console.error(err); showToast('저장 실패: ' + (err.message || '서버 오류')); })
            .finally(() => { btn.disabled = false; btn.innerText = '저장하기'; });
    });

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
        if (meLabel && meUser) meLabel.innerText = (meUser.nickname && String(meUser.nickname).trim() ? meUser.nickname : '나') + '의 추억';
        if (pLabel && partnerUser) pLabel.innerText = (partnerUser.nickname && String(partnerUser.nickname).trim() ? partnerUser.nickname : '상대방') + '의 추억';
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
        if (e.key === 'Escape') { closeLightbox(); closeEditPage(); closeMemoryModal(); closeDetailModal(); }
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

    // ===== 사진 편집(크롭/줌) 이벤트 =====
    const cropStage = document.getElementById('crop-stage');
    document.getElementById('crop-cancel').addEventListener('click', closeCropper);
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

// ===== 사진 편집(크롭/줌) 상태 & 제어 =====
const _crop = { natW: 0, natH: 0, base: 1, zoom: 1, x: 0, y: 0, size: 0, onDone: null, url: null, dragging: false, sx: 0, sy: 0, bx: 0, by: 0 };

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
    const out = 512;
    const sx = (0 - _crop.x) / s;
    const sy = (0 - _crop.y) / s;
    const sSize = _crop.size / s;
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

// 상세 모달 창 내용을 채워주는 함수 예시
function renderMemoryDetail(memory) {
    // 날짜 포맷, 줄바꿈 처리 등은 기존 로직 사용
    const dateStr = memory.date;
    const locationStr = memory.address || "위치 정보 없음";

    // 내용 줄바꿈 유지 및 XSS 방지 처리
    const contentHtml = escapeHtml(memory.content).replace(/\n/g, '<br>');

    // 이미지 태그 (이미지가 있을 때만 렌더링)
    const imageHtml = memory.imageUrl
        ? `<div class="detail-image-wrap"><img src="${memory.imageUrl}" alt="추억 사진"></div>`
        : '';

    const detailHtml = `
        <div class="detail-container">
            <!-- 헤더: 제목과 메타 정보(날짜, 위치) -->
            <div class="detail-header">
                <h3 class="detail-title">${escapeHtml(memory.title)}</h3>
                <div class="detail-meta">
                    <span class="meta-item">📅 ${dateStr}</span>
                    <span class="meta-item">📍 ${escapeHtml(locationStr)}</span>
                </div>
            </div>

            <!-- 사진 영역 -->
            ${imageHtml}

            <!-- 본문 영역 -->
            <div class="detail-body">
                <p>${contentHtml}</p>
            </div>
        </div>
    `;

    // 모달 내용 컨테이너(예: detailModalContent)에 주입
    document.getElementById('detailModalContent').innerHTML = detailHtml;
}