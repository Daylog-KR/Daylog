// =====================================================
// 마이빌딩 — 소셜 로그인
// 프론트가 각 소셜의 인가 URL을 직접 생성 (PKCE 미사용)
// 설정값은 config.js 의 window.APP_CONFIG 에서 읽음.
// ⚠ login.html 에서 config.js 를 login.js 보다 먼저 로드해야 함.
// =====================================================

const CFG = window.APP_CONFIG || {};
const SUCCESS_REDIRECT = 'main.html';

// provider 별 인가 엔드포인트 + config.js 의 client_id 매핑
const OAUTH = {
    kakao: {
        authorizeUrl: 'https://kauth.kakao.com/oauth/authorize',
        clientId: CFG.KAKAO_CLIENT_ID
    },
    naver: {
        authorizeUrl: 'https://nid.naver.com/oauth2.0/authorize',
        clientId: CFG.NAVER_CLIENT_ID
    },
    google: {
        authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        clientId: CFG.GOOGLE_CLIENT_ID,
        scope: 'openid email profile' // sub/email/name 수집을 위해 openid 포함
    }
};

// =====================================================
// 로그인 시작 — PKCE 없이 인가 URL 생성
// =====================================================
function startSocialLogin(provider) {
    if (!window.APP_CONFIG) { showToast('설정 파일을 불러오지 못했습니다'); return; }

    const cfg = OAUTH[provider];
    if (!cfg) { showToast('지원하지 않는 로그인 방식입니다'); return; }
    if (!cfg.clientId || cfg.clientId.startsWith('YOUR_')) {
        showToast(`${labelOf(provider)} 클라이언트가 설정되지 않았습니다.`);
        return;
    }
    debugger;
    const redirectUri = CFG.FRONT_LOGIN_BASE;

    // provider 식별을 위해 state 에 담아 보냄 (콜백이 다른 출처여도 읽힘)
    const state = provider + '__' + randomState();
    sessionStorage.setItem('provider', provider);

    const params = new URLSearchParams({
        response_type: 'code',
        client_id: cfg.clientId,
        redirect_uri: redirectUri,
        state: state
    });
    if (cfg.scope) params.set('scope', cfg.scope);

    // ⚠ code_challenge 를 넣지 않음 → PKCE 미적용 (백엔드 수동 교환과 호환)
    window.location.href = `${cfg.authorizeUrl}?${params.toString()}`;
}

function labelOf(p) { return { kakao: '카카오', naver: '네이버', google: '구글' }[p] || p; }

function randomState() {
    if (window.crypto && crypto.getRandomValues) {
        const a = new Uint8Array(12);
        crypto.getRandomValues(a);
        return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
    }
    return Math.random().toString(36).slice(2);
}

// =====================================================
// 이벤트 바인딩
// =====================================================
document.querySelectorAll('.social-btn').forEach(btn => {
    btn.addEventListener('click', () => startSocialLogin(btn.dataset.provider));
});

if (localStorage.getItem('accessToken')) {
    window.location.href = SUCCESS_REDIRECT;
}

// =====================================================
// TOAST
// =====================================================
function showToast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
}