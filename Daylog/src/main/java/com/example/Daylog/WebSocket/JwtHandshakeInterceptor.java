package com.example.Daylog.WebSocket;

import com.example.Daylog.Config.JWT.JwtTokenProvider;
import lombok.RequiredArgsConstructor;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;

import java.net.URI;
import java.util.Map;

// [B] edit by smsong - 채팅 WebSocket 핸드셰이크 시 JWT 검증.
//  브라우저 WebSocket 은 헤더를 못 붙이므로 쿼리스트링 ?token= 으로 받는다.
//  검증되면 uid 를 세션 attribute 로 심어 핸들러가 사용한다.
@Component
@RequiredArgsConstructor
public class JwtHandshakeInterceptor implements HandshakeInterceptor {

    private final JwtTokenProvider jwtTokenProvider;

    @Override
    public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                   WebSocketHandler wsHandler, Map<String, Object> attributes) {
        try {
            String token = extractToken(request.getURI());
            if (token == null || token.isBlank()) return false;
            String uid = jwtTokenProvider.getUidFromToken(token); // 유효하지 않으면 예외
            if (uid == null || uid.isBlank()) return false;
            attributes.put("uid", uid);
            return true;
        } catch (Exception e) {
            return false; // 인증 실패 → 핸드셰이크 거부
        }
    }

    @Override
    public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response,
                               WebSocketHandler wsHandler, Exception exception) {
        // no-op
    }

    private String extractToken(URI uri) {
        String q = uri.getQuery();
        if (q == null) return null;
        for (String pair : q.split("&")) {
            int i = pair.indexOf('=');
            if (i > 0 && "token".equals(pair.substring(0, i))) {
                String v = pair.substring(i + 1);
                try {
                    return java.net.URLDecoder.decode(v, java.nio.charset.StandardCharsets.UTF_8);
                } catch (Exception e) {
                    return v;
                }
            }
        }
        return null;
    }
}
// [E] edit by smsong
