document.addEventListener('DOMContentLoaded', () => {
    // ===== 로그아웃 기능 =====
    const logoutBtn = document.querySelector('.logout-btn');

    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();

            // 1. 사용자에게 로그아웃 여부 확인
            const isConfirmed = confirm('정말 로그아웃 하시겠어요? 🤎');

            if (isConfirmed) {
                // 2. oauth-redirect.html 에서 생성한 실제 키값들을 명확히 삭제
                localStorage.removeItem('accessToken');
                localStorage.removeItem('currentUser');
                localStorage.removeItem('auth');

                // 혹시 모를 임시 데이터 방지를 위해 세션 스토리지도 초기화 (선택사항)
                sessionStorage.clear();

                // 3. 로그인 페이지로 이동 (뒤로가기로 메인에 다시 오지 못하게 replace 사용)
                window.location.replace('./login.html');
            }
        });
    }

    // ===== 1. D-Day 카운터 로직 =====
    const startDate = new Date("2025-06-18");
    calculateDDay(startDate);

    // ===== 2. 추억 기록 등록 이벤트 인터랙션 =====
    const memoryForm = document.getElementById('memory-form');
    const timelineFeed = document.getElementById('timeline-feed');

    if (memoryForm && timelineFeed) {
        memoryForm.addEventListener('submit', (e) => {
            e.preventDefault();

            const dateInput = document.getElementById('memory-date').value;
            const titleInput = document.getElementById('memory-title').value;
            const contentInput = document.getElementById('memory-content').value;

            const formattedDate = dateInput.replace(/-/g, '.');

            const newCard = document.createElement('div');
            newCard.classList.add('memory-card');

            newCard.innerHTML = `
                <div class="card-header">
                    <span class="card-date">${formattedDate}</span>
                    <h4 class="card-title">${escapeHtml(titleInput)}</h4>
                </div>
                <p class="card-text">${escapeHtml(contentInput)}</p>
            `;

            timelineFeed.insertBefore(newCard, timelineFeed.firstChild);

            memoryForm.reset();
            timelineFeed.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }
});

// 디데이 계산 함수
function calculateDDay(start) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    start.setHours(0, 0, 0, 0);

    const diffTime = today.getTime() - start.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;

    const ddayCountEl = document.getElementById('dday-count');
    if (ddayCountEl) {
        ddayCountEl.innerText = diffDays;
    }
}

// XSS 방지를 위한 보안 처리 함수
function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}