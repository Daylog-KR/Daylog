package com.example.Daylog.Service;

import com.example.Daylog.Entity.PushSubscriptionEntity;
import com.example.Daylog.Repository.PushSubscriptionRepository;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import nl.martijndwars.webpush.Notification;
import nl.martijndwars.webpush.PushService;
import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.Security;
import java.util.List;
import java.util.concurrent.CompletableFuture;

// [B] edit by smsong - 웹푸시(Web Push, VAPID) 발송 서비스.
//  · 구독 저장/삭제(upsert) + 특정 uid / 여러 uid 에게 알림 발송.
//  · 발송은 비동기(CompletableFuture)라 댓글/입장요청 등 본 요청 응답을 지연시키지 않는다.
//  · VAPID 키(vapid.public-key / vapid.private-key)가 없으면 자동 비활성(앱은 정상 동작).
//  ⚠ build.gradle 의존성 필요:
//      implementation 'nl.martijndwars:web-push:5.1.1'
//      implementation 'org.bouncycastle:bcprov-jdk18on:1.78.1'
@Service
@RequiredArgsConstructor
public class WebPushService {

    private final PushSubscriptionRepository subscriptionRepository;

    @Value("${vapid.public-key:}")
    private String publicKey;
    @Value("${vapid.private-key:}")
    private String privateKey;
    @Value("${vapid.subject:mailto:admin@daylog.app}")
    private String subject;

    private PushService pushService;

    @PostConstruct
    public void init() {
        try {
            if (Security.getProvider(BouncyCastleProvider.PROVIDER_NAME) == null) {
                Security.addProvider(new BouncyCastleProvider());
            }
            if (publicKey != null && !publicKey.isBlank() && privateKey != null && !privateKey.isBlank()) {
                pushService = new PushService(publicKey, privateKey, subject);
            }
        } catch (Exception e) {
            pushService = null; // 설정 미비/오류 시 비활성
        }
    }

    public String getPublicKey() { return publicKey; }
    public boolean isEnabled() { return pushService != null; }

    // 구독 저장/갱신 (endpoint 기준 upsert)
    @org.springframework.transaction.annotation.Transactional
    public void saveSubscription(String uid, String endpoint, String p256dh, String auth) {
        if (uid == null || endpoint == null || endpoint.isBlank()) return;
        PushSubscriptionEntity e = subscriptionRepository.findByEndpoint(endpoint)
                .orElseGet(PushSubscriptionEntity::new);
        e.setUid(uid);
        e.setEndpoint(endpoint);
        e.setP256dh(p256dh);
        e.setAuth(auth);
        subscriptionRepository.save(e);
    }

    @org.springframework.transaction.annotation.Transactional
    public void removeSubscription(String endpoint) {
        if (endpoint == null || endpoint.isBlank()) return;
        subscriptionRepository.deleteByEndpoint(endpoint);
    }

    // ===== 발송 =====
    public void sendToUid(String uid, String title, String body, String url) {
        if (pushService == null || uid == null) return;
        dispatch(subscriptionRepository.findByUid(uid), title, body, url);
    }

    public void sendToUids(List<String> uids, String title, String body, String url) {
        if (pushService == null || uids == null || uids.isEmpty()) return;
        dispatch(subscriptionRepository.findByUidIn(uids), title, body, url);
    }

    private void dispatch(List<PushSubscriptionEntity> subs, String title, String body, String url) {
        if (pushService == null || subs == null || subs.isEmpty()) return;
        byte[] payload = buildPayload(title, body, url).getBytes(StandardCharsets.UTF_8);
        // 비동기 발송 (본 요청 트랜잭션/응답에 영향 없음)
        CompletableFuture.runAsync(() -> {
            for (PushSubscriptionEntity s : subs) {
                try {
                    Notification n = new Notification(s.getEndpoint(), s.getP256dh(), s.getAuth(), payload);
                    Object res = pushService.send(n);      // 반환 타입이 web-push/HttpClient 버전마다 다름
                    int code = statusCodeOf(res);          // getCode()(HC5) / getStatusLine().getStatusCode()(HC4) 모두 대응
                    if (code == 404 || code == 410) {
                        // 만료/해지된 구독 정리
                        try { subscriptionRepository.deleteByEndpoint(s.getEndpoint()); } catch (Exception ignore) {}
                    }
                } catch (Exception e) {
                    // 개별 발송 실패(네트워크/만료 등)는 무시하고 계속
                }
            }
        });
    }

    // web-push 버전(HttpClient4/5)에 따라 응답 타입이 달라 리플렉션으로 상태코드를 얻는다.
    //  · HttpClient5: HttpResponse.getCode()
    //  · HttpClient4: HttpResponse.getStatusLine().getStatusCode()
    private int statusCodeOf(Object res) {
        if (res == null) return 0;
        // 1) getCode()
        try {
            java.lang.reflect.Method m = res.getClass().getMethod("getCode");
            Object v = m.invoke(res);
            if (v instanceof Integer) return (Integer) v;
        } catch (Exception ignore) { }
        // 2) getStatusLine().getStatusCode()
        try {
            java.lang.reflect.Method sl = res.getClass().getMethod("getStatusLine");
            Object statusLine = sl.invoke(res);
            if (statusLine != null) {
                java.lang.reflect.Method sc = statusLine.getClass().getMethod("getStatusCode");
                Object v = sc.invoke(statusLine);
                if (v instanceof Integer) return (Integer) v;
            }
        } catch (Exception ignore) { }
        return 0; // 코드 확인 불가 → 정리 로직만 건너뜀(발송에는 영향 없음)
    }

    private String buildPayload(String title, String body, String url) {
        return "{\"title\":\"" + esc(title) + "\",\"body\":\"" + esc(body) + "\",\"url\":\"" + esc(url) + "\"}";
    }

    private String esc(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ").replace("\r", " ");
    }
}