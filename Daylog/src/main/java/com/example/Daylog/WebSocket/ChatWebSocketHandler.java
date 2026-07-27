package com.example.Daylog.WebSocket;

import com.example.Daylog.DTO.ChatDTO;
import com.example.Daylog.Service.ChatService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

// [B] edit by smsong - 방 채팅 실시간 처리(raw WebSocket).
//  클라이언트 → 서버 (JSON):
//    { "type":"sub",  "roomId":123 }              방 구독
//    { "type":"msg",  "roomId":123, "content":".."} 메시지 전송
//    { "type":"read", "roomId":123, "lastId":456 }  여기까지 읽음
//  서버 → 클라이언트 (JSON):
//    { "type":"msg",  "message": {ChatDTO.Message} }
//    { "type":"read", "roomId":123, "uid":"..", "lastId":456 }
@Component
@RequiredArgsConstructor
public class ChatWebSocketHandler extends TextWebSocketHandler {

    private final ChatService chatService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    // roomId -> 그 방을 구독중인 세션들
    private final Map<Long, Set<WebSocketSession>> roomSessions = new ConcurrentHashMap<>();

    private String uidOf(WebSocketSession s) {
        Object u = s.getAttributes().get("uid");
        return u == null ? null : u.toString();
    }

    @SuppressWarnings("unchecked")
    private Set<Long> subsOf(WebSocketSession s) {
        return (Set<Long>) s.getAttributes().computeIfAbsent(
                "rooms", k -> Collections.synchronizedSet(new HashSet<Long>()));
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        try {
            JsonNode node = objectMapper.readTree(message.getPayload());
            String type = node.path("type").asText("");
            String uid = uidOf(session);
            if (uid == null) { close(session); return; }

            switch (type) {
                case "sub":  handleSub(session, uid, node.path("roomId").asLong(0)); break;
                case "msg":  handleMsg(session, uid, node.path("roomId").asLong(0), node.path("content").asText("")); break;
                case "read": handleRead(session, uid, node.path("roomId").asLong(0), node.path("lastId").asLong(0)); break;
                default: break;
            }
        } catch (Exception e) {
            // 파싱/전송 오류는 무시 (연결은 유지)
        }
    }

    private void handleSub(WebSocketSession session, String uid, long roomId) {
        if (roomId <= 0 || !chatService.isMember(uid, roomId)) return;
        roomSessions.computeIfAbsent(roomId, k -> Collections.newSetFromMap(new ConcurrentHashMap<>()))
                .add(session);
        subsOf(session).add(roomId);
    }

    private void handleMsg(WebSocketSession session, String uid, long roomId, String content) {
        if (roomId <= 0) return;
        // 구독 안 한 상태로 바로 보내는 경우도 허용(멤버십은 서비스가 검증)
        ChatDTO.Message saved = chatService.send(roomId, uid, content); // 멤버 아니면 예외
        // 발신자가 아직 이 방을 구독 안 했다면 등록(응답 수신용)
        roomSessions.computeIfAbsent(roomId, k -> Collections.newSetFromMap(new ConcurrentHashMap<>()))
                .add(session);
        subsOf(session).add(roomId);

        Map<String, Object> out = new HashMap<>();
        out.put("type", "msg");
        out.put("message", saved);
        broadcast(roomId, out);
    }

    private void handleRead(WebSocketSession session, String uid, long roomId, long lastId) {
        if (roomId <= 0 || lastId <= 0 || !chatService.isMember(uid, roomId)) return;
        chatService.markRead(roomId, uid, lastId);
        Map<String, Object> out = new HashMap<>();
        out.put("type", "read");
        out.put("roomId", roomId);
        out.put("uid", uid);
        out.put("lastId", lastId);
        broadcast(roomId, out);
    }

    private void broadcast(long roomId, Object payload) {
        Set<WebSocketSession> set = roomSessions.get(roomId);
        if (set == null || set.isEmpty()) return;
        String json;
        try { json = objectMapper.writeValueAsString(payload); }
        catch (Exception e) { return; }
        TextMessage tm = new TextMessage(json);
        for (WebSocketSession s : set) {
            if (s == null || !s.isOpen()) continue;
            try {
                synchronized (s) { s.sendMessage(tm); } // 세션 send 는 스레드 안전하지 않음
            } catch (Exception e) {
                // 개별 세션 전송 실패는 무시
            }
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        for (Long roomId : new ArrayList<>(subsOf(session))) {
            Set<WebSocketSession> set = roomSessions.get(roomId);
            if (set != null) {
                set.remove(session);
                if (set.isEmpty()) roomSessions.remove(roomId);
            }
        }
    }

    private void close(WebSocketSession s) {
        try { s.close(CloseStatus.POLICY_VIOLATION); } catch (Exception ignored) {}
    }
}
// [E] edit by smsong
