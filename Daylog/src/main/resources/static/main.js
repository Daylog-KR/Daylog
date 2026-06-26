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
    // 업로드 용량 초과 → 로그인 튕김 대신 친절한 안내
    if (res.status === 413) {
        throw new Error('이미지 용량이 너무 큽니다. 사진 수를 줄이거나 더 작은 이미지를 사용해주세요.');
    }
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
    // 본문이 빈 200 응답(휴지통 이동/삭제 등) 안전 처리
    const text = await res.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) { return text; }
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

// 가볼곳(체크리스트) 타입 메타 — 라벨/이모지/색상을 한 곳에서 관리
const CHECKLIST_TYPES = {
    CAFE: { label: '카페',  emoji: '☕', color: '#b06a4f' },
    FOOD: { label: '식당',  emoji: '🍴', color: '#3f7fb0' },
    SPOT: { label: '장소',  emoji: '📍', color: '#5f9e6f' },
    ETC:  { label: '기타',  emoji: '✨', color: '#7a756e' }
};
function checklistType(t) { return CHECKLIST_TYPES[t] || CHECKLIST_TYPES.ETC; }
function fmtDate(s) { return s ? String(s).substring(0, 10).replace(/-/g, '.') : ''; }

// 카드 썸네일 HTML — 이미지가 있으면 배경이미지, 없으면 같은 크기의 '이미지 없음' 자리표시
function thumbHtml(mediaURL, cls) {
    const c = cls || 'tl-thumb';
    if (mediaURL) {
        return '<div class="' + c + '" style="background-image:url(\'' + mediaURL + '\')"></div>';
    }
    return '<div class="' + c + ' thumb-empty"><span class="thumb-empty-icon">🖼️</span><span class="thumb-empty-text">이미지 없음</span></div>';
}

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

    // 로컬에 이름이 있으면 즉시 권한 확인 (없으면 프로필 로드 시 서버 이름으로 재확인)
    const _localAuth = isAuthorizedName(readLocalName());
    if (_localAuth === false) { blockUnauthorizedUser(); return; }

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
    Daylog.openChecklistDetailById = (id) => {
        const c = checklistList.find(x => x.id === id);
        if (c) openChecklistDetail(c);
    };

    // 해당 마커를 잠깐 빠르게 흔들어 "여기예요" 표시
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
            map.setZoom(16);
            map.panTo(new naver.maps.LatLng(memory.lat, memory.lng));
            setTimeout(() => shakeMarker(memory), 460);
        }, 120);
        setTimeout(() => { _suppressDrop = false; }, 1400);
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
            map.setZoom(16);
            map.panTo(new naver.maps.LatLng(item.lat, item.lng));
            setTimeout(() => shakeChecklistMarker(item), 460);
        }, 120);
        setTimeout(() => { _suppressDrop = false; }, 1400);
    };

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
            if (!targetTab) return;
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

    let currentLocMarker = null; // 내 현재 위치(파란 점) 마커

    function placeMyLocation(lat, lng) {
        if (!map || !(window.naver && naver.maps)) return;
        const pos = new naver.maps.LatLng(lat, lng);
        if (!currentLocMarker) {
            currentLocMarker = new naver.maps.Marker({
                position: pos, map: map, zIndex: 50, clickable: false,
                icon: {
                    content: '<div class="my-loc-dot"><span class="my-loc-pulse"></span></div>',
                    anchor: new naver.maps.Point(11, 11)
                }
            });
        } else {
            currentLocMarker.setPosition(pos);
            if (!currentLocMarker.getMap()) currentLocMarker.setMap(map);
        }
    }

    // 현재 GPS 위치를 가져와 마커 표시 (recenter=true 면 지도 화면도 이동, announce=true 면 실패 시 안내)
    function locateMe(recenter, announce) {
        if (!navigator.geolocation) { if (announce) showToast('위치 기능을 사용할 수 없어요'); return; }
        navigator.geolocation.getCurrentPosition((pos) => {
            const lat = pos.coords.latitude, lng = pos.coords.longitude;
            placeMyLocation(lat, lng);
            if (recenter && map) { map.setCenter(new naver.maps.LatLng(lat, lng)); map.setZoom(15); }
        }, (err) => {
            console.warn('현재 위치 실패:', err);
            if (announce) showToast('현재 위치를 가져오지 못했어요');
        }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 });
    }

    function initMap() {
        map = new naver.maps.Map('naver-map', {
            center: new naver.maps.LatLng(37.5665, 126.9780),
            zoom: 14
        });
        loadMemoriesFromServer();
        locateMe(true, false); // 지도 처음 진입 시 현재 위치로 이동 + 마커 (실패해도 조용히)

        // 지도(빈 영역) 탭 → 헤더/하단바 숨김·표시 토글 (마커 클릭은 상세보기라 제외)
        naver.maps.Event.addListener(map, 'click', () => {
            if (isWaitingForMapClick) return; // 위치 선택 중에는 토글 안 함
            document.body.classList.toggle('map-immersive');
            setTimeout(() => { if (map) naver.maps.Event.trigger(map, 'resize'); }, 60);
        });
    }

    // 지도 우하단 '내 위치' 버튼 → 현재 위치로 이동
    const myLocBtn = document.getElementById('btn-my-location');
    if (myLocBtn) myLocBtn.addEventListener('click', () => locateMe(true, true));

    // --- 위치 선택 모드 (지도 중앙 점 기준) ---
    let mapIdleListener = null;
    let centerLabelTimer = null;

    function enterPickMode() {
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
        if (label) label.innerHTML = '<span class="lm-pin">📍</span> 위치 확인 중…';
        if (!(window.naver && naver.maps.Service && naver.maps.Service.reverseGeocode)) {
            if (label) label.innerHTML = '<span class="lm-pin">📍</span> 중앙 지점을 선택해주세요';
            return;
        }
        naver.maps.Service.reverseGeocode({
            coords: c,
            orders: [naver.maps.Service.OrderType.ROAD_ADDR, naver.maps.Service.OrderType.ADDR].join(',')
        }, (status, response) => {
            if (!isWaitingForMapClick) return;
            let addr = '중앙 지점을 선택해주세요';
            if (status === naver.maps.Service.Status.OK) {
                const r = response.v2;
                addr = (r && r.address) ? (r.address.roadAddress || r.address.jibunAddress || addr) : addr;
            }
            if (label) label.innerHTML = '<span class="lm-pin">📍</span> ' + escapeHtml(addr);
        });
    }

    // 좌표를 최종 확정 → 작성 폼으로 (중앙 점 / 현재 위치 공통)
    function confirmLocation(lat, lng, prefix) {
        currentLatLng = { lat: lat, lng: lng };
        reverseGeocodeAndLabel(lat, lng, prefix || '🎯');
        exitPickMode();
        pickReturnsToForm = false;
        if (pickTarget === 'checklist') openChecklistModal(); else openMemoryModal();
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
            currentLocationMeta = splitKoreanAddress(addr);
            setBadgeManual(tag + ' ' + (addr || '지정한 위치로 설정되었습니다'));
        });
    }

    // --- 위치 다시 설정하기 (작성 폼 내용은 유지) ---
    const resetLocBtn = document.getElementById('btn-reset-location');
    if (resetLocBtn) {
        resetLocBtn.addEventListener('click', () => {
            pickReturnsToForm = true; // 위치만 다시 고르고 폼으로 복귀
            document.getElementById('memory-modal').classList.add('hidden'); // reset() 호출 안 함 → 입력 유지
            enterPickMode();
        });
    }

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
        confirmLocation(c.lat(), c.lng(), '🎯');
    });

    // '현재 위치로 설정' — 현재 GPS 위치로 지도 중앙을 이동
    const lmCurrentBtn = document.getElementById('lm-current');
    if (lmCurrentBtn) lmCurrentBtn.addEventListener('click', () => {
        if (!navigator.geolocation) { showToast('위치 기능을 사용할 수 없어요'); return; }
        lmCurrentBtn.disabled = true;
        const prev = lmCurrentBtn.innerText;
        lmCurrentBtn.innerText = '현재 위치 찾는 중…';
        navigator.geolocation.getCurrentPosition((pos) => {
            lmCurrentBtn.disabled = false; lmCurrentBtn.innerText = prev;
            const lat = pos.coords.latitude, lng = pos.coords.longitude;
            if (map) { map.setCenter(new naver.maps.LatLng(lat, lng)); map.setZoom(16); }
            updateCenterLabel();
            showToast("현재 위치로 이동했어요. '이 위치로 설정하기'를 눌러 확정하세요.");
        }, (err) => {
            lmCurrentBtn.disabled = false; lmCurrentBtn.innerText = prev;
            console.warn('현재 위치 실패:', err);
            showToast('위치 접근이 거부되었어요. 지도를 움직여 설정해주세요.');
        }, { enableHighAccuracy: true, timeout: 8000 });
    });

    document.getElementById('lm-cancel').addEventListener('click', () => {
        exitPickMode();
        if (pickReturnsToForm) {
            // 위치 재설정 취소 → 입력하던 폼 그대로 복귀
            pickReturnsToForm = false;
            if (pickTarget === 'checklist') openChecklistModal(); else openMemoryModal();
            showToast('위치 변경을 취소했어요');
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
            currentLatLng = { lat: lat, lng: lng };
            map.setCenter(new naver.maps.LatLng(lat, lng));
            map.setZoom(17);
            currentLocationMeta = splitKoreanAddress(addr);
            window._pendingPlaceTitle = placeName; // 제목 자동입력용 (추억/체크리스트 공용)

            const badge = document.getElementById('location-status-badge');
            if (badge) {
                badge.innerText = "🔍 '" + (placeName || addr || '검색 위치') + "' 위치로 설정되었습니다";
                badge.className = "location-badge manual";
            }
            hideSuggestions();
            exitPickMode();
            pickReturnsToForm = false;
            if (pickTarget === 'checklist') openChecklistModal(); else openMemoryModal();
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
        if (!query) { showToast('검색어를 입력해주세요'); return; }
        if (lastSuggestions.length > 0) { setLocationFromItem(lastSuggestions[0]); return; }
        searchPlaces(query)
            .then(items => {
                if (!items.length) { showToast('검색 결과가 없음. 다른 키워드로 시도해보세요.'); return; }
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
                badge.innerText = "📍 사진 위치가 자동으로 설정되었습니다!";
                badge.className = "location-badge success";
                reverseGeocode(gps.latitude, gps.longitude, (addr) => {
                    currentLocationMeta = splitKoreanAddress(addr);
                    if (addr) badge.innerText = "📍 " + addr;
                });
                openMemoryModal();
            } else if (fromCamera && navigator.geolocation) {
                // 카메라 촬영 사진은 EXIF 위치가 없으므로 현재 GPS 사용
                const badge = document.getElementById('location-status-badge');
                if (badge) { badge.innerText = '📍 현재 위치를 가져오는 중…'; badge.className = 'location-badge'; }
                navigator.geolocation.getCurrentPosition((pos) => {
                    currentLatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                    currentLocationMeta = { placeName: '', address: '' };
                    if (badge) { badge.innerText = '📍 현재 위치로 설정되었습니다!'; badge.className = 'location-badge success'; }
                    reverseGeocode(currentLatLng.lat, currentLatLng.lng, (addr) => {
                        currentLocationMeta = splitKoreanAddress(addr);
                        if (addr && badge) badge.innerText = '📍 ' + addr;
                    });
                    openMemoryModal();
                }, () => {
                    if (badge) { badge.innerText = '📍 위치를 가져올 수 없어요 · 직접 설정'; badge.className = 'location-badge manual'; }
                    openMemoryModal();
                }, { enableHighAccuracy: true, timeout: 8000 });
            } else {
                // 메타데이터 없음 → 지도 클릭 모드
                enterPickMode();
            }
        } catch (error) {
            showToast('사진 분석 실패. 지도에서 위치를 골라주세요.');
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
            if (!files.length) { showToast('사진을 1장 이상 추가해주세요'); submitBtn.disabled = false; submitBtn.innerText = '기록하기 ✨'; return; }
            if (files.length > 10) { showToast('이미지는 최대 10장까지 첨부할 수 있어요'); submitBtn.disabled = false; submitBtn.innerText = '기록하기 ✨'; return; }
            memoryDTO.mediaOrder = mgr ? mgr.getMediaOrder() : files.map(() => '$NEW$');

            const formData = new FormData();
            formData.append("uid", currentUid);
            formData.append("memoryData", JSON.stringify(memoryDTO));
            files.forEach(f => formData.append("mediaData", f));

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
        if (!camVideo || !camVideo.videoWidth) { showToast('카메라가 준비되지 않았어요'); return; }
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
            if (badge) { badge.innerText = '📍 현재 위치를 가져오는 중…'; badge.className = 'location-badge'; }
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition((pos) => {
                    currentLatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                    currentLocationMeta = { placeName: '', address: '' };
                    if (badge) { badge.innerText = '📍 현재 위치로 설정되었습니다!'; badge.className = 'location-badge success'; }
                    reverseGeocode(currentLatLng.lat, currentLatLng.lng, (addr) => {
                        currentLocationMeta = splitKoreanAddress(addr);
                        if (addr && badge) badge.innerText = '📍 ' + addr;
                    });
                }, (err) => {
                    console.warn('위치 가져오기 실패:', err);
                    if (badge) { badge.innerText = '📍 위치를 가져올 수 없어요 · 아래에서 직접 설정'; badge.className = 'location-badge manual'; }
                    showToast('위치 접근이 거부되었어요. 위치를 직접 설정해주세요.');
                }, { enableHighAccuracy: true, timeout: 8000 });
            } else if (badge) {
                badge.innerText = '📍 위치 기능을 사용할 수 없어요 · 직접 설정';
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

    // 추억 상세 모달 당겨서 새로고침 — 폼은 고정(움직이지 않음), 링만 위쪽에 표시
    const detailScroll = document.querySelector('#detail-modal .modal-content');
    attachPullToRefresh(detailScroll,
        () => !document.getElementById('detail-modal').classList.contains('hidden') && _detailMemory != null,
        () => { if (_detailMemory) loadComments(_detailMemory.id); return Promise.resolve(loadMemoriesFromServer()); },
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
                updateProfileStats();

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
                applyChecklistFilter();
                if (typeof updateChecklistStats === 'function') updateChecklistStats();
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
            const check = item.visited ? '<span class="cl-marker-check">✓</span>' : '';
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
            toggle.innerText = isCl ? '📸' : '📌';
            toggle.title = isCl ? '추억 보기' : '체크리스트 보기';
            toggle.classList.toggle('to-memory', isCl);
            toggle.classList.toggle('to-checklist', !isCl);
        }
        if (action) {
            action.innerText = isCl ? '➕' : '➕';
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
            feed.innerHTML = '<div class="empty-state"><span class="es-icon">📌</span><p>아직 등록된 가볼곳이 없어요</p></div>';
            return;
        }
        let idx = 0;
        sorted.forEach(item => {
            const meta = checklistType(item.type);
            const card = document.createElement('div');
            card.className = 'cl-card' + (item.visited ? ' visited' : '');
            card.style.animationDelay = (idx * 0.05) + 's';
            idx++;
            const badge = item.visited
                ? '<span class="cl-visited-badge">✓ 다녀옴' + (item.visitedDate ? ' · ' + fmtDate(item.visitedDate) : '') + '</span>'
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
                (loc ? '<div class="cl-card-loc">📍 ' + escapeHtml(loc) + '</div>' : '') +
                '</div>' +
                thumbHtml(item.mediaURL, 'cl-thumb');
            card.addEventListener('click', () => openChecklistDetail(item));
            feed.appendChild(card);
        });
    }

    // 가볼곳 작성 폼 열기 (위치는 currentLatLng/currentLocationMeta 에서 가져옴)
    window._openChecklistForm = function () {
        const badge = document.getElementById('cl-location-badge');
        const place = (currentLocationMeta && currentLocationMeta.placeName) || '';
        const addr = (currentLocationMeta && currentLocationMeta.address) || '';
        const text = [place, addr].filter(Boolean).join(' ');
        if (badge) {
            badge.className = 'location-badge success';
            badge.innerText = text ? ('📍 ' + text) : '📍 선택한 위치';
            if (!text && currentLatLng) {
                reverseGeocode(currentLatLng.lat, currentLatLng.lng, (a) => {
                    if (a) { currentLocationMeta = splitKoreanAddress(a); badge.innerText = '📍 ' + a; }
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
        if (!title) { showToast('제목을 입력해주세요'); return; }
        const visited = document.getElementById('cl-visited').checked;
        const visitedDate = document.getElementById('cl-visited-date').value;
        const clMgr = window._clCreateMgr;
        const clFiles = clMgr ? clMgr.getNewFiles() : [];
        const hasImage = clFiles.length > 0;
        // '다녀왔어요'가 체크된 경우 이미지는 필수
        if (visited && !hasImage) {
            showToast('다녀왔어요로 표시하려면 사진을 첨부해주세요');
            alert('다녀온 곳은 사진을 반드시 첨부해야 합니다.');
            return;
        }
        if (clFiles.length > 10) { showToast('이미지는 최대 10장까지 첨부할 수 있어요'); return; }
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

        fetch(`${API_BASE_URL}/api/checklists`, { method: 'POST', headers: authHeaders(false), body: fd })
            .then(handleResponse)
            .then((created) => {
                closeChecklistModal();
                showToast('가볼곳을 추가했어요 📌');
                pickTarget = 'memory';
                // 다녀온 곳으로 추가하면 동일 위치에 추억도 자동 생성
                if (created && created.visited) {
                    createMemoryFromChecklist(created)
                        .then(() => showToast('다녀온 곳이라 추억에도 기록했어요 ✨'))
                        .catch(err => console.warn('추억 자동 생성 실패', err));
                }
                if (mapMode !== 'checklist') setMapMode('checklist');
                else loadChecklistsFromServer();
            })
            .catch(err => { console.error(err); showToast('추가 실패. 다시 시도해주세요.'); })
            .finally(() => { if (submitBtn) { submitBtn.disabled = false; submitBtn.innerText = '추가하기 📌'; } });
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
    if (clResetLoc) clResetLoc.addEventListener('click', () => {
        pickReturnsToForm = true;
        pickTarget = 'checklist';
        document.getElementById('checklist-modal').classList.add('hidden');
        enterPickMode();
    });
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
    const tlFilterBar = document.getElementById('tl-filter-bar');
    if (tlFilterToggle && tlFilterBar) {
        tlFilterToggle.addEventListener('click', () => tlFilterBar.classList.toggle('hidden'));
    }
    const clFilterToggle = document.getElementById('cl-filter-toggle');
    const clFilterWrap = document.getElementById('cl-filter-wrap');
    if (clFilterToggle && clFilterWrap) {
        clFilterToggle.addEventListener('click', () => clFilterWrap.classList.toggle('hidden'));
    }
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
                new Image().src = memory.mediaURL; // 사전 캐싱
                // <img> 대신 background-image 로 그려 줌 인/아웃 시 재로딩(깜빡임) 최소화
                markerHtml = `<div class="custom-marker${nd}"><div class="cm-photo" style="background-image:url('${memory.mediaURL}')"></div></div>`;
            } else {
                markerHtml = `<div class="marker-heart${nd}">👾</div>`;
            }
            const marker = new naver.maps.Marker({
                position: new naver.maps.LatLng(memory.lat, memory.lng),
                map: map,
                icon: { content: markerHtml, anchor: new naver.maps.Point(24, 24) }
            });
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
                '<div class="empty-state"><span class="es-icon">👾</span>' +
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

                const thumb = thumbHtml(memory.mediaURL, 'tl-thumb');

                card.innerHTML =
                    '<div class="tl-main">' +
                    '<h4 class="tl-title">' + escapeHtml(memory.title || '') + '</h4>' +
                    '<p class="tl-text">' + escapeHtml(memory.content || '') + '</p>' +
                    '<div class="tl-loc">' +
                    '<div class="tl-loc-row">' +
                    '<span class="tl-loc-icon">📍</span>' +
                    '<span class="tl-place"></span>' +
                    '</div>' +
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

    function loadProfiles(force) {
        if (force) _profSig = null; // 명시적 변경(사진/닉네임/프로필 수정) 후엔 강제 재렌더
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
                // 추억 상세의 작성자 표시용 사용자 맵
                Daylog.usersByUid = {};
                [meUser, partnerUser].forEach(u => { if (u && u.uid) Daylog.usersByUid[u.uid] = u; });

                if (!meUser) {
                    console.warn('[Daylog] 로그인 uid(' + currentUid + ')와 일치하는 사용자가 목록에 없습니다.');
                }
                // 이름/아바타는 실제로 바뀌었을 때만 다시 그림(이미지 재로딩 깜빡임 방지)
                const sig = _listSig(list);
                if (sig !== _profSig) {
                    _profSig = sig;
                    renderProfileBox('me', meUser, '👦', '나');
                    renderProfileBox('partner', partnerUser, '👧', '상대방');
                }
                profilesLoaded = true;
                updateProfileStats(); // 숫자만 갱신(저비용, 깜빡임 없음)
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
                if (isAuthorizedName(me.name) === false) { blockUnauthorizedUser(); return; }
                Daylog.meUid = me.uid;
                Daylog.usersByUid = {}; if (me.uid) Daylog.usersByUid[me.uid] = me;
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
            showImg(user.profileURL);
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
            wrap.onclick = () => openLightbox(user.profileURL, avatar);
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
                    loadProfiles(true);
                })
                .catch(err => { console.error(err); showToast('설정 실패: ' + (err.message || '서버 오류')); })
                .finally(() => { btn.disabled = false; btn.innerText = '시작하기 ✨'; });
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
        if (!currentUser) { showToast('사용자 정보를 불러오는 중이에요'); loadProfiles(); return; }
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
    const btnProfileLogout = document.getElementById('btn-profile-logout');
    if (btnProfileLogout) btnProfileLogout.addEventListener('click', () => {
        if (confirm('로그아웃을 진행합니다.')) redirectToLogin('로그아웃 되었습니다.');
    });
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
            showToast('저장하면 사진이 제거돼요');
        });
    }

    editFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        editFileInput.value = '';
        if (!file) return;
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
        if (!nick) { showToast('닉네임을 입력해주세요'); return; }
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
        showToast('편집한 사진을 적용했어요');
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

function openChecklistDetail(item) {
    _detailChecklist = item;
    const view = document.getElementById('cl-detail-view');
    const editForm = document.getElementById('cl-edit-form');
    if (editForm) editForm.classList.add('hidden');
    if (view) view.classList.remove('hidden');

    const meta = checklistType(item.type);
    const isOwner = !!(item.ownerUid && Daylog.currentUid && item.ownerUid === Daylog.currentUid);
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
        ? '<span class="meta-item cl-meta-visited">✓ 다녀옴' + (item.visitedDate ? ' · ' + fmtDate(item.visitedDate) : '') + '</span>'
        : '<span class="meta-item cl-meta-todo">아직 안 가봤어요</span>';
    const _clUrls = mediaUrlsOf(item);
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
        (loc ? '<span class="meta-item meta-loc-clickable" id="cl-detail-loc" title="지도에서 보기">📍 ' + escapeHtml(loc) + '</span>' : '') +
        '</div>' +
        '</div>' +
        imageHtml +
        (item.content ? '<div class="detail-body"><p>' + contentHtml + '</p></div>' : '') +
        '</div>';

    const headerActions = document.getElementById('cl-detail-header-actions');
    if (headerActions) {
        headerActions.innerHTML = isOwner
            ? '<button type="button" class="detail-edit-btn" id="cl-detail-edit-open" title="수정">✏️</button>' +
              '<button type="button" class="detail-trash-btn" id="cl-detail-del-open" title="휴지통">🗑️</button>'
            : '';
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

    const cdm = document.getElementById('checklist-detail-modal');
    cdm.classList.remove('hidden');
    const cdmScroll = cdm.querySelector('.modal-content');
    if (cdmScroll) cdmScroll.scrollTop = 0;
}

function enterChecklistEdit(item) {
    const view = document.getElementById('cl-detail-view');
    const editForm = document.getElementById('cl-edit-form');
    if (!editForm) return;

    // 위치(수정 불가) 표시
    const loc = [item.placeName, item.address].filter(Boolean).join(' ');
    const locEl = document.getElementById('cl-edit-loc');
    if (locEl) locEl.textContent = loc ? ('📍 ' + loc) : '📍 위치';

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

function saveChecklistEdit() {
    const item = _detailChecklist;
    if (!item) return;
    const wasVisited = !!item.visited; // 수정 전 방문여부 (새로 체크된 경우에만 추억 생성)
    const title = document.getElementById('cl-edit-title').value.trim();
    if (!title) { showToast('제목을 입력해주세요'); return; }
    const visited = document.getElementById('cl-edit-visited').checked;
    const visitedDate = document.getElementById('cl-edit-visited-date').value;
    const mgr = window._clEditMgr;
    const order = mgr ? mgr.getMediaOrder() : null;
    const newFiles = mgr ? mgr.getNewFiles() : [];
    if (visited && (!order || order.length === 0)) { showToast('다녀온 곳은 사진을 1장 이상 첨부해주세요'); return; }
    if (order && order.length > 10) { showToast('이미지는 최대 10장까지 첨부할 수 있어요'); return; }
    const dto = {
        title: title,
        content: document.getElementById('cl-edit-content').value,
        type: window._clEditSelectedType || item.type || 'ETC',
        visited: visited,
        visitedDate: (visited && visitedDate) ? visitedDate : null,
        mediaOrder: order
    };
    const fd = new FormData();
    fd.append('checklistData', JSON.stringify(dto));
    newFiles.forEach(f => fd.append('mediaData', f));

    const btn = document.querySelector('#cl-edit-form .submit-btn');
    if (btn) { btn.disabled = true; btn.innerText = '저장 중...'; }

    fetch(`${Daylog.api}/api/checklists/${item.id}`, {
        method: 'PUT',
        headers: Daylog.authHeaders(false), // FormData → Content-Type 자동 설정
        body: fd
    })
        .then(Daylog.handleResponse)
        .then((updated) => {
            showToast('수정 완료 ✨');
            closeChecklistDetail();
            Daylog.reloadChecklists();
            // 이번 수정에서 처음으로 '다녀옴'이 된 경우에만 추억 자동 생성
            if (updated && updated.visited && !wasVisited) {
                createMemoryFromChecklist(updated)
                    .then(() => showToast('다녀온 곳이라 추억에도 기록했어요 ✨'))
                    .catch(err => console.warn('추억 자동 생성 실패', err));
            }
        })
        .catch(err => { console.error(err); showToast('수정 실패. 다시 시도해주세요.'); })
        .finally(() => { if (btn) { btn.disabled = false; btn.innerText = '저장하기 ✨'; } });
}

function trashChecklist(id) {
    if (!confirm('이 가볼곳을 휴지통으로 옮길까요?')) return;
    fetch(`${Daylog.api}/api/checklists/${id}/trash`, { method: 'PUT', headers: Daylog.authHeaders(true) })
        .then(Daylog.handleResponse)
        .then(() => { showToast('휴지통으로 이동했어요'); closeChecklistDetail(); Daylog.reloadChecklists(); })
        .catch(err => { console.error(err); showToast('이동 실패. 다시 시도해주세요.'); });
}

function closeChecklistDetail() {
    const modal = document.getElementById('checklist-detail-modal');
    if (modal) modal.classList.add('hidden');
    const ha = document.getElementById('cl-detail-header-actions');
    if (ha) ha.innerHTML = '';
    exitChecklistEdit();
    _detailChecklist = null;
}

let _detailMemory = null;

function openDetailModal(memory) {
    _detailMemory = memory;
    const view = document.getElementById('detail-view');
    const editForm = document.getElementById('detail-edit-form');
    if (editForm) editForm.classList.add('hidden');
    if (view) view.classList.remove('hidden');

    const dateStr = memory.createdAt ? memory.createdAt.substring(0, 10).replace(/-/g, '.') : '';
    const _memUrls = mediaUrlsOf(memory);
    const imageHtml = carouselHtml(_memUrls);
    const isOwner = !!(memory.ownerUid && Daylog.currentUid && memory.ownerUid === Daylog.currentUid);
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
        '<span class="meta-item">📅 ' + escapeHtml(dateStr) + '</span>' +
        '<span class="meta-item meta-loc-clickable" id="detail-loc" title="지도에서 보기">📍 위치 확인 중…</span>' +
        '</div>' +
        '</div>' +
        imageHtml +
        '<div class="detail-body"><p>' + contentHtml + '</p></div>' +
        // 댓글 영역
        '<div class="comments-section">' +
        '<div class="comments-head">💬 댓글 <span class="comments-count" id="comments-count">0</span></div>' +
        '<div class="comments-list" id="comments-list"><div class="comments-loading">댓글을 불러오는 중…</div></div>' +
        '<div class="comment-compose">' +
        '<input type="text" class="comment-input" id="new-comment-input" placeholder="댓글을 남겨보세요" maxlength="1000">' +
        '<button type="button" class="comment-send-btn" id="new-comment-send">등록</button>' +
        '</div>' +
        '</div>' +
        '</div>';

    // 헤더 영역: (소유자만) 수정/휴지통 버튼을 '추억 상세' 위치에 작게 배치
    const headerActions = document.getElementById('detail-header-actions');
    if (headerActions) {
        headerActions.innerHTML = isOwner
            ? '<button type="button" class="detail-edit-btn" id="detail-edit-open" title="수정">✏️</button>' +
              '<button type="button" class="detail-trash-btn" id="detail-trash-open" title="휴지통">🗑️</button>'
            : '';
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
    if (sendBtn) sendBtn.addEventListener('click', () => submitComment(memory.id, null, 'new-comment-input'));
    if (newInput) newInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submitComment(memory.id, null, 'new-comment-input'); }
    });

    loadComments(memory.id);

    const dm = document.getElementById('detail-modal');
    dm.classList.remove('hidden');
    // 다른 추억으로 이동 시 항상 맨 위에서 시작 (이전 스크롤 위치 잔존 방지)
    const dmScroll = dm.querySelector('.modal-content');
    if (dmScroll) dmScroll.scrollTop = 0;
}

// 상세/수정 모달의 위치 표기 (장소명 + 상세주소) — 없으면 좌표로 역지오코딩
//  elId: 채워 넣을 요소 id ('detail-loc' 또는 'edit-loc')
function fillLocationInto(elId, memory) {
    const el = document.getElementById(elId);
    if (!el) return;
    const place = (memory.placeName || '').trim();
    const addr = (memory.address || '').trim();
    // 기존과 동일하게 한 줄 주소처럼 보이도록 공백으로 합침
    const compose = (p, a) => '📍 ' + [p, a].filter(Boolean).join(' ');
    if (place || addr) el.textContent = compose(place, addr);
    if (!place && !addr) {
        if (memory.lat != null && memory.lng != null) {
            reverseGeocode(memory.lat, memory.lng, (a) => { el.textContent = a ? ('📍 ' + a) : '📍 위치 정보 없음'; });
        } else { el.textContent = '📍 위치 정보 없음'; }
    } else if (place && !addr && memory.lat != null && memory.lng != null) {
        reverseGeocode(memory.lat, memory.lng, (a) => { if (a) el.textContent = compose(place, a); });
    }
}

function applyDetailLocation(memory) { fillLocationInto('detail-loc', memory); }

function enterDetailEdit(memory) {
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
    if (!title) { showToast('제목을 입력해주세요'); return; }

    const mgr = window._memEditMgr;
    const order = mgr ? mgr.getMediaOrder() : null;
    const newFiles = mgr ? mgr.getNewFiles() : [];
    if (order && order.length > 10) { showToast('이미지는 최대 10장까지 첨부할 수 있어요'); return; }

    // createdAt: LocalDateTime("yyyy-MM-ddT00:00:00") 형식으로 전송
    let createdAt = null;
    if (date) createdAt = date + 'T00:00:00';
    else if (memory.createdAt) createdAt = (String(memory.createdAt).length === 10) ? (memory.createdAt + 'T00:00:00') : memory.createdAt;

    const memoryData = { title: title, content: content, createdAt: createdAt, mediaOrder: order };
    const fd = new FormData();
    fd.append('memoryData', JSON.stringify(memoryData));
    newFiles.forEach(f => fd.append('mediaData', f));

    const btn = document.querySelector('#detail-edit-form .submit-btn');
    if (btn) { btn.disabled = true; btn.innerText = '저장 중...'; }

    fetch(`${Daylog.api}/api/memories/${memory.id}`, {
        method: 'PUT',
        headers: Daylog.authHeaders(false), // FormData → Content-Type 자동
        body: fd
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
    const ha = document.getElementById('detail-header-actions');
    if (ha) ha.innerHTML = '';
    exitDetailEdit();
    _detailMemory = null;
}

// ==========================================
//  댓글 / 대댓글
// ==========================================
const _commentCache = {};

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

function commentItemHtml(c, memoryId, isReply) {
    _commentCache[c.id] = c;
    const isOwner = !!(c.ownerUid && Daylog.currentUid && c.ownerUid === Daylog.currentUid);
    const contentHtml = escapeHtml(c.content || '').replace(/\n/g, '<br>');

    let actions =
        '<div class="c-actions">' +
        (isReply ? '' : '<button type="button" class="c-act-btn" onclick="toggleReplyForm(' + c.id + ')">답글</button>') +
        (isOwner ? '<button type="button" class="c-act-btn" onclick="enterCommentEdit(' + c.id + ',' + memoryId + ')">수정</button>' : '') +
        (isOwner ? '<button type="button" class="c-act-btn c-act-trash" onclick="trashComment(' + c.id + ',' + memoryId + ')">🗑️</button>' : '') +
        '</div>';

    let replyForm = isReply ? '' :
        '<div class="c-reply-form hidden" id="reply-form-' + c.id + '">' +
        '<input type="text" class="comment-input" id="reply-input-' + c.id + '" placeholder="답글을 입력하세요" maxlength="1000">' +
        '<button type="button" class="comment-send-btn" onclick="submitComment(' + memoryId + ',' + c.id + ',\'reply-input-' + c.id + '\')">등록</button>' +
        '</div>';

    let repliesHtml = '';
    if (!isReply && c.replies && c.replies.length) {
        repliesHtml = '<div class="c-replies">' +
            c.replies.map(r => commentItemHtml(r, memoryId, true)).join('') +
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

function loadComments(memoryId) {
    const list = document.getElementById('comments-list');
    if (!list) return;
    fetch(`${Daylog.api}/comment/memory/${memoryId}`, { headers: Daylog.authHeaders(true) })
        .then(Daylog.handleResponse)
        .then(comments => {
            comments = comments || [];
            const countEl = document.getElementById('comments-count');
            let total = comments.length;
            comments.forEach(c => { total += (c.replies ? c.replies.length : 0); });
            if (countEl) countEl.textContent = total;

            if (!comments.length) {
                list.innerHTML = '<div class="comments-empty">댓글이 존재하지 않습니다.</div>';
                return;
            }
            list.innerHTML = comments.map(c => commentItemHtml(c, memoryId, false)).join('');
        })
        .catch(err => {
            console.error(err);
            list.innerHTML = '<div class="comments-empty">댓글을 조회 실패</div>';
        });
}

function submitComment(memoryId, parentId, inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const content = input.value.trim();
    if (!content) { showToast('댓글을 입력해주세요'); return; }

    fetch(`${Daylog.api}/comment`, {
        method: 'POST',
        headers: Daylog.authHeaders(true),
        body: JSON.stringify({ memoryId: memoryId, parentId: parentId, content: content })
    })
        .then(Daylog.handleResponse)
        .then(() => {
            input.value = '';
            loadComments(memoryId);
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

function enterCommentEdit(commentId, memoryId) {
    const c = _commentCache[commentId];
    const box = document.getElementById('c-content-' + commentId);
    if (!c || !box) return;
    box.innerHTML =
        '<textarea class="c-edit-area" id="c-edit-' + commentId + '" maxlength="1000">' + escapeHtml(c.content || '') + '</textarea>' +
        '<div class="c-edit-actions">' +
        '<button type="button" class="c-edit-cancel" onclick="loadComments(' + memoryId + ')">취소</button>' +
        '<button type="button" class="c-edit-save" onclick="saveCommentEdit(' + commentId + ',' + memoryId + ')">저장</button>' +
        '</div>';
    const ta = document.getElementById('c-edit-' + commentId);
    if (ta) { ta.focus(); ta.value = c.content || ''; }
}

function saveCommentEdit(commentId, memoryId) {
    const ta = document.getElementById('c-edit-' + commentId);
    if (!ta) return;
    const content = ta.value.trim();
    if (!content) { showToast('내용을 입력해주세요'); return; }
    fetch(`${Daylog.api}/comment/${commentId}`, {
        method: 'PUT',
        headers: Daylog.authHeaders(true),
        body: JSON.stringify({ content: content })
    })
        .then(Daylog.handleResponse)
        .then(() => { showToast('댓글 수정 완료'); loadComments(memoryId); })
        .catch(err => { console.error(err); showToast('수정 실패'); });
}

function trashComment(commentId, memoryId) {
    if (!confirm('이 댓글을 휴지통으로 옮길까요?')) return;
    fetch(`${Daylog.api}/comment/${commentId}/trash`, {
        method: 'PUT',
        headers: Daylog.authHeaders(true)
    })
        .then(Daylog.handleResponse)
        .then(() => { showToast('휴지통으로 이동했어요'); loadComments(memoryId); })
        .catch(err => { console.error(err); showToast('이동 실패'); });
}

// ==========================================
//  추억 휴지통 이동
// ==========================================
function trashMemory(memoryId) {
    if (!confirm('이 추억을 휴지통으로 옮길까요?')) return;
    fetch(`${Daylog.api}/api/memories/${memoryId}/trash`, {
        method: 'PUT',
        headers: Daylog.authHeaders(true)
    })
        .then(Daylog.handleResponse)
        .then(() => { showToast('휴지통으로 이동했어요'); closeDetailModal(); Daylog.reload(); })
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
        body.innerHTML = '<div class="empty-state"><span class="es-icon">🗑️</span><p>휴지통이 비어 있어요</p></div>';
        return;
    }

    let html = '';

    if (memories.length) {
        html += '<div class="trash-group-title">추억 ' + memories.length + '</div>';
        memories.forEach(m => {
            const dateStr = m.createdAt ? m.createdAt.substring(0, 10).replace(/-/g, '.') : '';
            const thumb = m.mediaURL
                ? '<div class="lm-thumb" style="background-image:url(\'' + m.mediaURL + '\')"></div>'
                : '<div class="lm-thumb lm-thumb-empty">🤎</div>';
            html +=
                '<div class="trash-row">' +
                thumb +
                '<div class="lm-row-main">' +
                '<div class="lm-row-date">' + escapeHtml(dateStr) + '</div>' +
                '<div class="lm-row-title">' + escapeHtml(m.title || '') + '</div>' +
                '<div class="lm-row-text">' + escapeHtml(m.content || '') + '</div>' +
                '</div>' +
                '<div class="trash-actions">' +
                '<button type="button" class="trash-restore" onclick="restoreMemory(' + m.id + ')">복원</button>' +
                '<button type="button" class="trash-delete" onclick="deleteMemoryForever(' + m.id + ')">영구삭제</button>' +
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
                '<div class="lm-thumb lm-thumb-empty">💬</div>' +
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
            const meta = (typeof checklistType === 'function') ? checklistType(c.type) : { emoji: '📌', label: '' };
            const loc = [c.placeName, c.address].filter(Boolean).join(' ');
            html +=
                '<div class="trash-row">' +
                '<div class="lm-thumb lm-thumb-empty">' + meta.emoji + '</div>' +
                '<div class="lm-row-main">' +
                '<div class="lm-row-date">' + escapeHtml(meta.label || '가볼곳') + '</div>' +
                '<div class="lm-row-title">' + escapeHtml(c.title || '') + '</div>' +
                '<div class="lm-row-text">' + escapeHtml(loc) + '</div>' +
                '</div>' +
                '<div class="trash-actions">' +
                '<button type="button" class="trash-restore" onclick="restoreChecklist(' + c.id + ')">복원</button>' +
                '<button type="button" class="trash-delete" onclick="deleteChecklistForever(' + c.id + ')">영구삭제</button>' +
                '</div>' +
                '</div>';
        });
    }

    body.innerHTML = html;
}

function restoreMemory(id) {
    fetch(`${Daylog.api}/api/memories/${id}/restore`, { method: 'PUT', headers: Daylog.authHeaders(true) })
        .then(Daylog.handleResponse)
        .then(() => { showToast('복원했어요'); openTrashModal(); Daylog.reload(); })
        .catch(err => { console.error(err); showToast('복원 실패'); });
}

function deleteMemoryForever(id) {
    if (!confirm('이 추억을 영구적으로 삭제할까요?\n삭제하면 되돌릴 수 없어요.')) return;
    fetch(`${Daylog.api}/api/memories/${id}`, { method: 'DELETE', headers: Daylog.authHeaders(true) })
        .then(Daylog.handleResponse)
        .then(() => { showToast('영구 삭제했어요'); openTrashModal(); })
        .catch(err => { console.error(err); showToast('삭제 실패'); });
}

function restoreComment(id) {
    fetch(`${Daylog.api}/comment/${id}/restore`, { method: 'PUT', headers: Daylog.authHeaders(true) })
        .then(Daylog.handleResponse)
        .then(() => { showToast('복원했어요'); openTrashModal(); })
        .catch(err => { console.error(err); showToast('복원 실패'); });
}

function deleteCommentForever(id) {
    if (!confirm('이 댓글을 영구적으로 삭제할까요?\n삭제하면 되돌릴 수 없어요.')) return;
    fetch(`${Daylog.api}/comment/${id}`, { method: 'DELETE', headers: Daylog.authHeaders(true) })
        .then(Daylog.handleResponse)
        .then(() => { showToast('영구 삭제했어요'); openTrashModal(); })
        .catch(err => { console.error(err); showToast('삭제 실패'); });
}

function restoreChecklist(id) {
    fetch(`${Daylog.api}/api/checklists/${id}/restore`, { method: 'PUT', headers: Daylog.authHeaders(true) })
        .then(Daylog.handleResponse)
        .then(() => { showToast('복원했어요'); openTrashModal(); Daylog.reloadChecklists(); })
        .catch(err => { console.error(err); showToast('복원 실패'); });
}

function deleteChecklistForever(id) {
    if (!confirm('이 가볼곳을 영구적으로 삭제할까요?\n삭제하면 되돌릴 수 없어요.')) return;
    fetch(`${Daylog.api}/api/checklists/${id}`, { method: 'DELETE', headers: Daylog.authHeaders(true) })
        .then(Daylog.handleResponse)
        .then(() => { showToast('영구 삭제했어요'); openTrashModal(); })
        .catch(err => { console.error(err); showToast('삭제 실패'); });
}

// ===== 통계 클릭용 리스트 모달 / D-Day 정보 =====
function openMemoryListModal(title, items) {
    const modal = document.getElementById('list-modal');
    const titleEl = document.getElementById('list-modal-title');
    const body = document.getElementById('list-modal-body');
    if (!modal || !body) return;
    modal.classList.remove('dday-mode');
    titleEl.textContent = title;
    body.innerHTML = '';

    if (!items || !items.length) {
        body.innerHTML = '<div class="empty-state"><span class="es-icon">👾</span><p>표시할 추억이 없습니다</p></div>';
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
    if (body) body.scrollTop = 0;
    modal.classList.remove('hidden');
}

function closeListModal() {
    const modal = document.getElementById('list-modal');
    if (modal) { modal.classList.add('hidden'); modal.classList.remove('dday-mode'); }
    Daylog._openListKind = null;
}

// 유저별 체크리스트 목록 모달 (추억 목록과 동일한 UI, 클릭 시 가볼곳 상세)
function openChecklistListModal(title, items) {
    const modal = document.getElementById('list-modal');
    const titleEl = document.getElementById('list-modal-title');
    const body = document.getElementById('list-modal-body');
    if (!modal || !body) return;
    modal.classList.remove('dday-mode');
    Daylog._openListKind = null; // 새로고침 시 추억 목록 재구성 로직과 분리
    titleEl.textContent = title;
    body.innerHTML = '';

    if (!items || !items.length) {
        body.innerHTML = '<div class="empty-state"><span class="es-icon">📌</span><p>표시할 가볼곳이 없습니다</p></div>';
    } else {
        items.forEach(item => {
            const meta = (typeof checklistType === 'function') ? checklistType(item.type) : { emoji: '📌', label: '' };
            const loc = [item.placeName, item.address].filter(Boolean).join(' ');
            const thumb = item.mediaURL
                ? `<div class="lm-thumb" style="background-image:url('${item.mediaURL}')"></div>`
                : '<div class="lm-thumb lm-thumb-empty">' + meta.emoji + '</div>';
            const badge = item.visited
                ? '<span class="cl-visited-badge">✓ 다녀옴</span>'
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
            row.addEventListener('click', () => { closeListModal(); openChecklistDetail(item); });
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
    Daylog._openListKind = null;
    modal.classList.add('dday-mode'); // 디데이 폼 내부는 드래그(당겨서 새로고침) 비활성
    if (body) body.scrollTop = 0;
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
            if (items.length >= MEDIA_MAX) { showToast('이미지는 최대 ' + MEDIA_MAX + '장까지 첨부할 수 있어요'); break; }
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
    let idx = 0, startX = 0, dx = 0, dragging = false, moved = false;

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
    vp.addEventListener('pointerdown', (e) => { dragging = true; moved = false; startX = e.clientX; dx = 0; track.style.transition = 'none'; });
    vp.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        dx = e.clientX - startX;
        if (Math.abs(dx) > 6) moved = true;
        track.style.transform = 'translateX(calc(' + (-idx * 100) + '% + ' + dx + 'px))';
    });
    const endSwipe = () => {
        if (!dragging) return;
        dragging = false;
        if (dx < -50 && idx < urls.length - 1) go(idx + 1);
        else if (dx > 50 && idx > 0) go(idx - 1);
        else go(idx);
        setTimeout(() => { moved = false; }, 30);
    };
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