package com.example.Daylog.Controller;

import com.example.Daylog.Service.WebPushService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

// [B] edit by smsong - 웹푸시 구독 API. 프론트가 서비스워커 구독 후 여기로 등록/해지.
@RestController
@RequestMapping("/api/push")
@RequiredArgsConstructor
public class PushController {

    private final WebPushService webPushService;

    // VAPID 공개키 (프론트 구독 시 applicationServerKey 로 사용)
    @GetMapping("/public-key")
    public ResponseEntity<Map<String, String>> publicKey() {
        String k = webPushService.getPublicKey();
        return ResponseEntity.ok(Map.of("publicKey", k == null ? "" : k));
    }

    // 구독 등록/갱신 (body: { endpoint, keys: { p256dh, auth } })
    @PostMapping("/subscribe")
    public ResponseEntity<Void> subscribe(@RequestBody Map<String, Object> body,
                                          @AuthenticationPrincipal UserDetails ud) {
        if (ud == null) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "권한이 없습니다");
        String endpoint = str(body.get("endpoint"));
        String p256dh = null, auth = null;
        Object keys = body.get("keys");
        if (keys instanceof Map<?, ?> km) {
            p256dh = str(km.get("p256dh"));
            auth = str(km.get("auth"));
        }
        if (endpoint == null || p256dh == null || auth == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "잘못된 구독 정보");
        }
        webPushService.saveSubscription(ud.getUsername(), endpoint, p256dh, auth);
        return ResponseEntity.ok().build();
    }

    // 구독 해지 (body: { endpoint })
    @PostMapping("/unsubscribe")
    public ResponseEntity<Void> unsubscribe(@RequestBody Map<String, Object> body,
                                            @AuthenticationPrincipal UserDetails ud) {
        webPushService.removeSubscription(str(body.get("endpoint")));
        return ResponseEntity.ok().build();
    }

    private static String str(Object o) { return o == null ? null : String.valueOf(o); }
}
