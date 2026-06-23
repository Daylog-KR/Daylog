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
// 1-b. 사용자 이름 기반 접근 권한 (송성민 / 강미르 전용)
// ==========================================
const AUTH_NAMES = ['송성민', 's s', '강미르']; // 허용된 사용자 이름
const ME_ALIAS = ['송성민', 's s'];             // '나'(송성민)로 취급할 이름

// 여러 소스(localStorage / JWT)에서 로그인 사용자 name 을 최대한 확보
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

// true=허용, false=차단, null=이름 모름(서버 조회 필요)
function isAuthorizedName(name) {
    if (!name || !String(name).trim()) return null;
    const n = String(name).trim().toLowerCase();
    return AUTH_NAMES.map(s => s.toLowerCase()).includes(n);
}

// 표시용 정규화: 송성민/s s -> '송성민', 그 외 허용 사용자 -> '강미르'
function normalizeDisplayName(name) {
    const n = String(name || '').trim().toLowerCase();
    if (ME_ALIAS.map(s => s.toLowerCase()).includes(n)) return '송성민';
    return '강미르';
}

let _blocked = false;
function blockUnauthorizedUser() {
    if (_blocked) return;
    _blocked = true;
    logout(); // 토큰 즉시 폐기 (로그아웃)

    const ov = document.createElement('div');
    ov.id = 'auth-block-overlay';
    ov.innerHTML =
        '<div class="abx-card">' +
        '<div class="abx-icon">🔒</div>' +
        '<p class="abx-msg">인증된 유저가 아닙니다.<br>권한을 부여받으려면 관리자에게 문의하세요.</p>' +
        '<div class="abx-sub">잠시 후 로그인 화면으로 이동합니다…</div>' +
        '</div>';
    document.body.appendChild(ov);

    setTimeout(() => { location.replace('login.html'); }, 2600);
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
    handleResponse: async function (r) { return r; }
};

// 좌표 → 주소 역지오코딩 (캐시 사용)
const _geoCache = {};
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

function sortByDateDesc(a, b) { return new Date(b.createdAt) - new Date(a.createdAt); }

// ==========================================
// 2. 메인 앱 로직
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // 페이지 진입 시 가장 먼저 인증 체크
    if (!requireAuthOrRedirect()) return;

    // 로컬에 이름이 있으면 즉시 권한 확인 (없으면 프로필 로드 시 서버 이름으로 재확인)
    const _localAuth = isAuthorizedName(readLocalName());
    if (_localAuth === false) { blockUnauthorizedUser(); return; }

    let map = null;
    let selectedFile = null;
    let currentLatLng = null;
    let currentLocationMeta = { placeName: '', address: '' }; // 장소명/상세주소 캡처
    let isWaitingForMapClick = false;
    let mapClickListener = null;
    let memoryList = [];
    let markers = []; // 지도 마커 인스턴스 보관 (중복 생성 방지)

    const currentUid = getUid();

    // 상세/리스트 모달(전역 함수)에서 사용할 컨텍스트 주입
    Daylog.currentUid = currentUid;
    Daylog.api = API_BASE_URL;
    Daylog.authHeaders = authHeaders;
    Daylog.handleResponse = handleResponse;
    Daylog.reload = () => loadMemoriesFromServer();

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
            currentLocationMeta = { placeName: '', address: addr || '' };
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

        const addr = item.roadAddress || item.jibunAddress || '';
        // 사용자가 입력한 검색어(예: "노들섬")를 장소 이름으로 저장 → 그대로 표시됨
        const typed = (searchInput.value || '').trim();
        const placeName = typed || addr;
        currentLocationMeta = { placeName: placeName, address: addr };

        const badge = document.getElementById('location-status-badge');
        badge.innerText = "🔍 '" + (placeName || addr) + "' 위치로 설정되었습니다";
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
                    currentLocationMeta = { placeName: '', address: '' };
                    reverseGeocode(gps.latitude, gps.longitude, (addr) => {
                        currentLocationMeta = { placeName: '', address: addr || '' };
                    });
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
                placeName: (currentLocationMeta && currentLocationMeta.placeName) || '',
                address: (currentLocationMeta && currentLocationMeta.address) || '',
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
                Daylog.memories = memoryList;
                updateProfileStats();

                const sorted = [...memoryList].sort(sortByDateDesc);
                renderMarkers(sorted);
                renderTimeline(sorted);
            })
            .catch(err => console.error("데이터 로드 실패:", err));
    }

    // --- 지도 마커 (줌 시 깜빡임 방지: 기존 마커 제거 후 재생성, 사진은 배경이미지) ---
    function renderMarkers(list) {
        if (!map) return;
        markers.forEach(m => m.setMap(null));
        markers = [];
        list.forEach(memory => {
            if (!(memory.lat && memory.lng)) return;
            let markerHtml;
            if (memory.mediaURL) {
                new Image().src = memory.mediaURL; // 사전 캐싱
                // <img> 대신 background-image 로 그려 줌 인/아웃 시 재로딩(깜빡임) 최소화
                markerHtml = `<div class="custom-marker"><div class="cm-photo" style="background-image:url('${memory.mediaURL}')"></div></div>`;
            } else {
                markerHtml = `<div class="marker-heart">💖</div>`;
            }
            const marker = new naver.maps.Marker({
                position: new naver.maps.LatLng(memory.lat, memory.lng),
                map: map,
                icon: { content: markerHtml, anchor: new naver.maps.Point(24, 24) }
            });
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
                '<div class="empty-state"><span class="es-icon">🤎</span>' +
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
                card.style.animationDelay = (idx * 0.05) + 's';
                idx++;

                const thumb = memory.mediaURL
                    ? `<div class="tl-thumb" style="background-image:url('${memory.mediaURL}')"></div>`
                    : '';

                card.innerHTML =
                    '<div class="tl-main">' +
                        '<h4 class="tl-title">' + escapeHtml(memory.title || '') + '</h4>' +
                        '<p class="tl-text">' + escapeHtml(memory.content || '') + '</p>' +
                        '<div class="tl-loc">' +
                            '<span class="tl-loc-icon">📍</span>' +
                            '<span class="tl-place"></span>' +
                            '<span class="tl-addr"></span>' +
                        '</div>' +
                    '</div>' +
                    thumb;

                applyCardLocation(card, memory);
                card.addEventListener('click', () => openDetailModal(memory));
                timelineFeed.appendChild(card);
            });
        });
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

                // 서버에서 받은 본인 이름으로 권한 재확인 (허용 외 사용자는 차단)
                if (meUser && isAuthorizedName(meUser.name) === false) { blockUnauthorizedUser(); return; }

                Daylog.meUid = meUser && meUser.uid;
                Daylog.partnerUid = partnerUser && partnerUser.uid;

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
                if (isAuthorizedName(me.name) === false) { blockUnauthorizedUser(); return; }
                Daylog.meUid = me.uid;
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

        // 닉네임 우선, 없으면 정규화된 실제 이름(송성민/강미르)으로 표시
        const hasNick = !!(user && user.nickname && String(user.nickname).trim());
        const realName = user ? normalizeDisplayName(user.name) : relationLabel;
        nameEl.innerText = hasNick ? user.nickname : realName;
        subEl.innerText = relationLabel;

        // ✋ 내 정보 탭에서는 이미지 수정 불가 — 클릭 시 확대(라이트박스)만 동작
        wrap.classList.remove('editable', 'viewable');
        editEl.classList.add('hidden'); // 📷 편집 배지 항상 숨김
        wrap.onclick = null;

        if (user && user.profileURL) {
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

    function displayNameOf(user, fallback) {
        if (!user) return fallback;
        if (user.nickname && String(user.nickname).trim()) return user.nickname;
        return normalizeDisplayName(user.name);
    }

    function updateProfileStats() {
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v; };
        set('stat-days', daysSince(DDAY_START));
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

    // --- 내 정보 통계 클릭 → 해당 추억 목록 / D-Day 날짜 표시 ---
    function bindStatClicks() {
        const bind = (id, fn) => {
            const el = document.getElementById(id);
            if (el) { el.style.cursor = 'pointer'; el.addEventListener('click', fn); }
        };
        bind('stat-card-dday', () => showDDayInfo());
        bind('stat-card-total', () => openMemoryListModal('우리의 추억 ', [...memoryList].sort(sortByDateDesc)));
        bind('stat-card-me', () => {
            const meUid = meUser && meUser.uid;
            openMemoryListModal(displayNameOf(meUser, '나') + '의 추억',
                memoryList.filter(m => m.ownerUid === meUid).sort(sortByDateDesc));
        });
        bind('stat-card-partner', () => {
            const pUid = partnerUser && partnerUser.uid;
            openMemoryListModal(displayNameOf(partnerUser, '상대방') + '의 추억',
                memoryList.filter(m => m.ownerUid === pUid).sort(sortByDateDesc));
        });
    }
    bindStatClicks();

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

let _detailMemory = null;

function openDetailModal(memory) {
    _detailMemory = memory;
    const view = document.getElementById('detail-view');
    const editForm = document.getElementById('detail-edit-form');
    if (editForm) editForm.classList.add('hidden');
    if (view) view.classList.remove('hidden');

    const dateStr = memory.createdAt ? memory.createdAt.substring(0, 10).replace(/-/g, '.') : '';
    const imageHtml = memory.mediaURL
        ? `<div class="detail-image-wrap"><img src="${memory.mediaURL}" alt="추억 사진" id="detail-image"></div>`
        : '';
    const isOwner = !!(memory.ownerUid && Daylog.currentUid && memory.ownerUid === Daylog.currentUid);
    const contentHtml = escapeHtml(memory.content || '').replace(/\n/g, '<br>');

    view.innerHTML =
        '<div class="detail-container">' +
            '<div class="detail-header">' +
                '<h2 class="detail-title">' + escapeHtml(memory.title || '') + '</h2>' +
                '<div class="detail-meta">' +
                    '<span class="meta-item">📅 ' + escapeHtml(dateStr) + '</span>' +
                    '<span class="meta-item" id="detail-loc">📍 위치 확인 중…</span>' +
                '</div>' +
            '</div>' +
            imageHtml +
            '<div class="detail-body"><p>' + contentHtml + '</p></div>' +
            (isOwner ? '<button type="button" class="detail-edit-btn" id="detail-edit-open">✏️ 수정하기</button>' : '') +
        '</div>';

    applyDetailLocation(memory);

    const di = document.getElementById('detail-image');
    if (di) di.addEventListener('click', () => { if (di.src) openLightbox(di.src); });

    const eo = document.getElementById('detail-edit-open');
    if (eo) eo.addEventListener('click', () => enterDetailEdit(memory));

    document.getElementById('detail-modal').classList.remove('hidden');
}

// 상세 모달의 위치 표기 (장소명 · 상세주소) — 없으면 좌표로 역지오코딩
function applyDetailLocation(memory) {
    const el = document.getElementById('detail-loc');
    if (!el) return;
    const place = (memory.placeName || '').trim();
    const addr = (memory.address || '').trim();
    const compose = (p, a) => '📍 ' + [p, a].filter(Boolean).join(' · ');
    if (place || addr) el.textContent = compose(place, addr);
    if (!place && !addr) {
        if (memory.lat != null && memory.lng != null) {
            reverseGeocode(memory.lat, memory.lng, (a) => { el.textContent = a ? ('📍 ' + a) : '📍 위치 정보 없음'; });
        } else { el.textContent = '📍 위치 정보 없음'; }
    } else if (place && !addr && memory.lat != null && memory.lng != null) {
        reverseGeocode(memory.lat, memory.lng, (a) => { if (a) el.textContent = compose(place, a); });
    }
}

function enterDetailEdit(memory) {
    const view = document.getElementById('detail-view');
    const editForm = document.getElementById('detail-edit-form');
    if (!editForm) return;
    document.getElementById('edit-memory-date').value = memory.createdAt ? memory.createdAt.substring(0, 10) : '';
    document.getElementById('edit-memory-title').value = memory.title || '';
    document.getElementById('edit-memory-content').value = memory.content || '';
    if (view) view.classList.add('hidden');
    editForm.classList.remove('hidden');
}

function exitDetailEdit() {
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
    if (!title || !content) { showToast('제목과 내용을 입력해주세요'); return; }

    const payload = {
        title: title,
        content: content,
        createdAt: date ? new Date(date).toISOString() : memory.createdAt
    };
    const btn = document.querySelector('#detail-edit-form .submit-btn');
    if (btn) { btn.disabled = true; btn.innerText = '저장 중...'; }

    fetch(`${Daylog.api}/api/memories/${memory.id}`, {
        method: 'PUT',
        headers: Daylog.authHeaders(true),
        body: JSON.stringify(payload)
    })
        .then(Daylog.handleResponse)
        .then(() => {
            showToast('수정 완료 ✨');
            closeDetailModal();
            Daylog.reload();
        })
        .catch(err => { console.error(err); showToast('수정 실패. 다시 시도해주세요.'); })
        .finally(() => { if (btn) { btn.disabled = false; btn.innerText = '저장하기 ✨'; } });
}

function closeDetailModal() {
    document.getElementById('detail-modal').classList.add('hidden');
    exitDetailEdit();
    _detailMemory = null;
}

// ===== 통계 클릭용 리스트 모달 / D-Day 정보 =====
function openMemoryListModal(title, items) {
    const modal = document.getElementById('list-modal');
    const titleEl = document.getElementById('list-modal-title');
    const body = document.getElementById('list-modal-body');
    if (!modal || !body) return;
    titleEl.textContent = title;
    body.innerHTML = '';

    if (!items || !items.length) {
        body.innerHTML = '<div class="empty-state"><span class="es-icon">🤎</span><p>표시할 추억이 없습니다</p></div>';
    } else {
        items.forEach(memory => {
            const dateStr = memory.createdAt ? memory.createdAt.substring(0, 10).replace(/-/g, '.') : '';
            const thumb = memory.mediaURL
                ? `<div class="lm-thumb" style="background-image:url('${memory.mediaURL}')"></div>`
                : '<div class="lm-thumb lm-thumb-empty">🤎</div>';
            const row = document.createElement('div');
            row.className = 'lm-row';
            row.innerHTML =
                thumb +
                '<div class="lm-row-main">' +
                    '<div class="lm-row-date">' + escapeHtml(dateStr) + '</div>' +
                    '<div class="lm-row-title">' + escapeHtml(memory.title || '') + '</div>' +
                    '<div class="lm-row-text">' + escapeHtml(memory.content || '') + '</div>' +
                '</div>';
            row.addEventListener('click', () => { closeListModal(); openDetailModal(memory); });
            body.appendChild(row);
        });
    }
    modal.classList.remove('hidden');
}

function closeListModal() {
    const modal = document.getElementById('list-modal');
    if (modal) modal.classList.add('hidden');
}

function showDDayInfo() {
    const modal = document.getElementById('list-modal');
    const titleEl = document.getElementById('list-modal-title');
    const body = document.getElementById('list-modal-body');
    if (!modal || !body) return;
    const start = new Date(DDAY_START);
    const y = start.getFullYear(), m = start.getMonth() + 1, d = start.getDate();
    const n = daysSince(DDAY_START);
    titleEl.textContent = 'D-Day 💍';
    body.innerHTML =
        '<div class="dday-info">' +
            '<div class="dday-info-emoji">📅</div>' +
            '<div class="dday-info-label">사귀기 시작한 날</div>' +
            '<div class="dday-info-date">' + y + '년 ' + m + '월 ' + d + '일</div>' +
            '<div class="dday-info-count">오늘로 <b>D+' + n + '</b> 일째</div>' +
        '</div>';
    modal.classList.remove('hidden');
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
                if (a) { placeEl.textContent = areaOf(a); addrEl.textContent = a; }
                else placeEl.textContent = '위치 정보 없음';
            });
        } else { placeEl.textContent = '위치 정보 없음'; }
    } else if (place && !addr && memory.lat != null && memory.lng != null) {
        reverseGeocode(memory.lat, memory.lng, (a) => { if (a) addrEl.textContent = a; });
    }
}
function areaOf(addr) { return String(addr || '').split(' ').slice(0, 2).join(' '); }

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

// ==========================================
// 4. 신규 모달(상세 수정 / 리스트) 이벤트 바인딩
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
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

    // ESC 로 리스트 모달도 닫기
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeListModal(); });
});