package com.example.Daylog.Config;

import com.example.Daylog.WebSocket.ChatWebSocketHandler;
import com.example.Daylog.WebSocket.JwtHandshakeInterceptor;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

// [B] edit by smsong - 채팅 raw WebSocket 엔드포인트 등록: /ws/chat
//  ⚠ Spring Security 를 쓰는 경우 SecurityConfig 에서 "/ws/**" 를 permitAll 해야 한다
//    (실제 인증은 JwtHandshakeInterceptor 가 핸드셰이크 때 ?token= 으로 처리).
@Configuration
@EnableWebSocket
@RequiredArgsConstructor
public class WebSocketConfig implements WebSocketConfigurer {

    private final ChatWebSocketHandler chatWebSocketHandler;
    private final JwtHandshakeInterceptor jwtHandshakeInterceptor;

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(chatWebSocketHandler, "/ws/chat")
                .addInterceptors(jwtHandshakeInterceptor)
                .setAllowedOriginPatterns("*"); // 프론트가 static 동일 출처면 사실상 same-origin
    }
}
// [E] edit by smsong
