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

import java.util.List;
import java.util.Map;

// [B] edit by smsong - 방 채팅 REST. 실시간 송수신은 WebSocket(/ws/chat) 이 담당하고,
//  여기서는 히스토리 로딩 / 안읽음 배지 / 읽음 처리(폴백) / 채팅방 리스트만 담당한다.
@RestController
@RequestMapping("/api/chat")
@RequiredArgsConstructor
public class ChatController {

    private final ChatService chatService;

    private String uidOf(UserDetails ud) {
        if (ud == null) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "권한이 없습니다");
        return ud.getUsername();
    }

    // [B] edit by smsong - 채팅 탭: 내가 속한 모든 방의 대화목록(카카오톡식)
    //  ⚠ 경로 충돌 주의: "/rooms" 는 "/{roomId}" 보다 먼저 선언(고정 경로 우선 매칭).
    @GetMapping("/rooms")
    public ResponseEntity<List<ChatDTO.RoomSummary>> chatRooms(@AuthenticationPrincipal UserDetails ud) {
        String uid = uidOf(ud);
        return ResponseEntity.ok(chatService.chatRoomList(uid));
    }

    // [B] edit by smsong - 1:1 대화 시작: 상대와의 DIRECT 방을 생성하거나 기존 방 재사용 → {roomId}
    @PostMapping("/direct")
    public ResponseEntity<Map<String, Object>> direct(@RequestParam("peerUid") String peerUid,
                                                      @AuthenticationPrincipal UserDetails ud) {
        String uid = uidOf(ud);
        Long roomId = chatService.getOrCreateDirectRoom(uid, peerUid);
        return ResponseEntity.ok(Map.of("roomId", roomId));
    }

    // [B] edit by smsong - 상대 프로필(1:1 시작 전 프로필 모달용)
    @GetMapping("/peer/{peerUid}")
    public ResponseEntity<Map<String, Object>> peer(@PathVariable("peerUid") String peerUid,
                                                    @AuthenticationPrincipal UserDetails ud) {
        uidOf(ud); // 로그인 확인
        return ResponseEntity.ok(chatService.peerProfile(peerUid));
    }

    // [B] edit by smsong - 현재 채팅방 멤버 리스트 (설정 > 멤버 보기)
    //  ⚠ 경로 충돌 주의: "/{roomId}/members" 는 "/{roomId}" 보다 구체적이라 정상 매칭됨.
    @GetMapping("/{roomId}/members")
    public ResponseEntity<List<Map<String, Object>>> members(@PathVariable("roomId") Long roomId,
                                                             @AuthenticationPrincipal UserDetails ud) {
        String uid = uidOf(ud);
        return ResponseEntity.ok(chatService.memberList(roomId, uid));
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

    // 채팅 알림 끄기 상태 조회 → {muted: bool}
    @GetMapping("/{roomId}/mute")
    public ResponseEntity<Map<String, Object>> getMute(@PathVariable("roomId") Long roomId,
                                                       @AuthenticationPrincipal UserDetails ud) {
        String uid = uidOf(ud);
        return ResponseEntity.ok(Map.of("muted", chatService.isChatMuted(roomId, uid)));
    }

    // 채팅 알림 끄기 설정 → {muted: bool}
    @PostMapping("/{roomId}/mute")
    public ResponseEntity<Map<String, Object>> setMute(@PathVariable("roomId") Long roomId,
                                                       @RequestParam("muted") boolean muted,
                                                       @AuthenticationPrincipal UserDetails ud) {
        String uid = uidOf(ud);
        boolean now = chatService.setChatMuted(roomId, uid, muted);
        return ResponseEntity.ok(Map.of("muted", now));
    }
}
// [E] edit by smsong
