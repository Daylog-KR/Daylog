package com.example.Daylog.Controller;

import com.example.Daylog.DTO.ChatDTO;
import com.example.Daylog.Service.ChatService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

// [B] edit by smsong - 방 채팅 REST. 실시간 송수신은 WebSocket(/ws/chat) 이 담당하고,
//  여기서는 히스토리 로딩 / 안읽음 배지 / 읽음 처리(폴백)만 담당한다.
@RestController
@RequestMapping("/api/chat")
@RequiredArgsConstructor
public class ChatController {

    private final ChatService chatService;

    private String uidOf(UserDetails ud) {
        if (ud == null) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "권한이 없습니다");
        return ud.getUsername();
    }

    // 히스토리 (첫 진입: beforeId 없음 → 최신 30개 + 읽음 처리. 위로 스크롤: beforeId 지정)
    @GetMapping("/{roomId}")
    public ResponseEntity<ChatDTO.History> history(@PathVariable("roomId") Long roomId,
                                                   @RequestParam(value = "beforeId", required = false) Long beforeId,
                                                   @AuthenticationPrincipal UserDetails ud) {
        String uid = uidOf(ud);
        boolean firstPage = (beforeId == null || beforeId <= 0);
        return ResponseEntity.ok(chatService.history(roomId, uid, beforeId, firstPage));
    }

    // 안 읽은 메시지 수 (상단 채팅 아이콘 배지)
    @GetMapping("/{roomId}/unread-count")
    public ResponseEntity<Map<String, Object>> unreadCount(@PathVariable("roomId") Long roomId,
                                                           @AuthenticationPrincipal UserDetails ud) {
        String uid = uidOf(ud);
        return ResponseEntity.ok(Map.of("count", chatService.unreadCount(roomId, uid)));
    }

    // 읽음 처리 (WebSocket 이 끊겼을 때의 폴백; 정상 시엔 소켓으로 처리)
    @PostMapping("/{roomId}/read")
    public ResponseEntity<Void> markRead(@PathVariable("roomId") Long roomId,
                                         @RequestParam("lastId") Long lastId,
                                         @AuthenticationPrincipal UserDetails ud) {
        String uid = uidOf(ud);
        chatService.assertMember(uid, roomId);
        chatService.markRead(roomId, uid, lastId);
        return ResponseEntity.ok().build();
    }
}
// [E] edit by smsong
