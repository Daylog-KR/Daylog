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
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-192.png',
        vibrate: [80, 40, 80],
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
