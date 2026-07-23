// [B] edit by smsong - Daylog 서비스워커: 웹푸시 수신/클릭 처리
self.addEventListener('install', function (event) {
    self.skipWaiting();
});
self.addEventListener('activate', function (event) {
    event.waitUntil(self.clients.claim());
});

// 푸시 수신 → 알림 표시
self.addEventListener('push', function (event) {
    var data = {};
    try { data = event.data ? event.data.json() : {}; }
    catch (e) { data = { title: 'Daylog', body: (event.data ? event.data.text() : '') }; }

    var title = data.title || 'Daylog';
    var options = {
        body: data.body || '',
        // 안드로이드 상태바/알림 왼쪽 작은 아이콘 = badge.
        //  시스템이 알파(투명도)만 읽고 색을 다시 칠하므로, 불투명한 컬러 PNG 를 주면
        //  전체가 칠해져 '네모'로 보인다. → 투명 배경 + 흰색 실루엣 전용 아이콘을 쓴다.
        badge: 'icons/badge-96.png',
        // 알림 오른쪽 큰 아이콘 (안드로이드) — 여기는 컬러 앱 아이콘 그대로 OK
        icon: 'icons/icon-192.png',
        vibrate: [80, 40, 80],
        // 같은 대상에 대한 알림이 겹쳐 쌓이지 않도록 (tag 없으면 목록이 지저분해짐)
        tag: data.tag || undefined,
        renotify: data.tag ? true : undefined,
        data: { url: data.url || '/' }
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

// 알림 클릭 → 앱 열기(있으면 포커스, 없으면 새 창)
self.addEventListener('notificationclick', function (event) {
    event.notification.close();
    var url = (event.notification.data && event.notification.data.url) || '/';
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
            for (var i = 0; i < list.length; i++) {
                var client = list[i];
                if ('focus' in client) {
                    try { if ('navigate' in client) client.navigate(url); } catch (e) {}
                    return client.focus();
                }
            }
            if (self.clients.openWindow) return self.clients.openWindow(url);
        })
    );
});
