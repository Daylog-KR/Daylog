package com.example.Daylog.Controller;

import com.example.Daylog.DTO.ChatDTO;
import com.example.Daylog.Service.ChatService;
import com.example.Daylog.Service.ChatImageStorage;
import com.example.Daylog.WebSocket.ChatWebSocketHandler;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
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
    private final ChatWebSocketHandler chatWebSocketHandler; // [B] edit by smsong - 공유 실시간 브로드캐스트
    @Autowired(required = false)
    private ChatImageStorage chatImageStorage; // [B] edit by smsong - 채팅 이미지 저장(어댑터 없으면 비활성)

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

    // [B] edit by smsong - 전송 대상 사용자 검색(이름/닉네임)
    @GetMapping("/user-search")
    public ResponseEntity<List<Map<String, Object>>> userSearch(@RequestParam("q") String q,
                                                                @AuthenticationPrincipal UserDetails ud) {
        String uid = uidOf(ud);
        return ResponseEntity.ok(chatService.userSearch(uid, q));
    }

    // [B] edit by smsong - 추억/체크리스트를 여러 채팅방/사용자에 전송(공유)
    //  body: { roomIds:[..], peerUids:[..], kind, refId, srcRoomId, title, image, content }
    //  peerUids 는 1:1 방이 없어도 전송 시 방을 생성/재사용해서 보낸다.
    @PostMapping("/share")
    public ResponseEntity<Map<String, Object>> share(@RequestBody Map<String, Object> body,
                                                     @AuthenticationPrincipal UserDetails ud) {
        String uid = uidOf(ud);
        List<Long> roomIds = new java.util.ArrayList<>();
        Object rid = body.get("roomIds");
        if (rid instanceof List<?> l) {
            for (Object o : l) { try { roomIds.add(Long.valueOf(String.valueOf(o))); } catch (Exception ignore) {} }
        }
        // 사용자(peerUids) → 1:1 방 생성/재사용 후 대상 방에 합침
        Object pu = body.get("peerUids");
        if (pu instanceof List<?> l) {
            for (Object o : l) {
                String peer = o == null ? null : String.valueOf(o);
                if (peer == null || peer.isBlank()) continue;
                try { Long rid2 = chatService.getOrCreateDirectRoom(uid, peer); if (rid2 != null && !roomIds.contains(rid2)) roomIds.add(rid2); }
                catch (Exception ignore) {}
            }
        }
        List<ChatDTO.Message> sent = chatService.shareToRooms(uid, roomIds,
                _s(body.get("kind")), _l(body.get("refId")), _l(body.get("srcRoomId")),
                _s(body.get("title")), _s(body.get("image")), _s(body.get("content")));
        // [B] edit by smsong - 열려 있는 채팅에 실시간 반영
        if (chatWebSocketHandler != null && sent != null) {
            for (ChatDTO.Message m : sent) {
                if (m != null && m.getRoomId() != null) {
                    try { chatWebSocketHandler.broadcastMessage(m.getRoomId(), m); } catch (Exception ignore) {}
                }
            }
        }
        return ResponseEntity.ok(Map.of("ok", true, "count", (sent == null ? 0 : sent.size())));
    }
    private static String _s(Object o) { return o == null ? null : String.valueOf(o); }
    private static Long _l(Object o) { if (o == null) return null; try { return Long.valueOf(String.valueOf(o)); } catch (Exception e) { return null; } }

    // [B] edit by smsong - 채팅 이미지 전송: multipart 'image' 업로드 → IMAGE 메시지 저장 → 실시간 브로드캐스트
    @PostMapping("/{roomId}/image")
    public ResponseEntity<ChatDTO.Message> sendImage(@PathVariable("roomId") Long roomId,
                                                     @RequestParam("image") MultipartFile image,
                                                     @RequestParam(value = "replyToId", required = false) Long replyToId,
                                                     @AuthenticationPrincipal UserDetails ud) {
        String uid = uidOf(ud);
        chatService.assertMember(uid, roomId);
        if (chatImageStorage == null) {
            throw new ResponseStatusException(HttpStatus.NOT_IMPLEMENTED, "이미지 저장이 설정되지 않았습니다(ChatImageStorage 어댑터 필요)");
        }
        if (image == null || image.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "이미지가 없습니다");
        }
        String url;
        try { url = chatImageStorage.store(roomId, image); }
        catch (Exception e) { throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "이미지 저장 실패"); }

        ChatDTO.Message saved = chatService.sendImage(roomId, uid, url, replyToId);
        try { if (chatWebSocketHandler != null) chatWebSocketHandler.broadcastMessage(roomId, saved); } catch (Exception ignore) {}
        try { chatService.notifyNewMessage(roomId, uid, "사진", null); } catch (Exception ignore) {}
        return ResponseEntity.ok(saved);
    }
}
// [E] edit by smsong
