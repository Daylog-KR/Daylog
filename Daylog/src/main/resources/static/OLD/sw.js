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

// 알림 클릭 → 앱 열기(있으면 '정확히 이 URL 로 이동' + 포커스, 없으면 새 창)
//  [B] edit by smsong - 기존엔 navigate 실패 시 그냥 focus 만 해서 '처음 열린 방'에 머물렀다(채팅 알림이 특정 방으로만 이동).
//   → 열린 창에 목적지 URL 을 postMessage 로 넘겨 앱이 스스로 이동하게 하고(location.href), navigate 도 병행 시도해 확실히 해당 방으로 간다.
self.addEventListener('notificationclick', function (event) {
    event.notification.close();
    var url = (event.notification.data && event.notification.data.url) || '/';
    var absUrl;
    try { absUrl = new URL(url, self.location.origin).href; } catch (e) { absUrl = url; }

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
            for (var i = 0; i < list.length; i++) {
                var client = list[i];
                if ('focus' in client) {
                    // (1) 앱에게 목적지 URL 을 알려 스스로 이동(가장 확실 — navigate 미지원/실패 대비)
                    try { client.postMessage({ type: 'OPEN_URL', url: url }); } catch (e) {}
                    // (2) navigate 도 병행 시도(메시지 처리가 안 되는 예외 상황 대비)
                    try { if ('navigate' in client) client.navigate(absUrl); } catch (e) {}
                    return client.focus();
                }
            }
            // 열린 창이 없으면 새 창
            if (self.clients.openWindow) return self.clients.openWindow(absUrl);
        })
    );
});
