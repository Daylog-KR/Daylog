package com.example.Daylog.Controller;

import com.example.Daylog.DTO.RoomDTO;
import com.example.Daylog.Service.RoomService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;

// [smsong] 방(공유 공간) API — 로그인 후 방 목록/생성/입장/삭제
@RestController
@RequestMapping("/api/rooms")
@RequiredArgsConstructor
public class RoomController {

    private final RoomService roomService;

    // 토큰 사용자와 요청 uid 일치 검증
    private void verify(String uid, UserDetails ud) {
        if (ud == null || uid == null || !uid.equals(ud.getUsername())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "권한이 없습니다");
        }
    }

    // 내가 속한 방 목록
    @GetMapping("/{uid}")
    public ResponseEntity<List<RoomDTO>> listRooms(@PathVariable("uid") String uid,
                                                   @AuthenticationPrincipal UserDetails ud) {
        verify(uid, ud);
        return ResponseEntity.ok(roomService.listForUser(uid));
    }

    // 방 생성 (body: { uid, name, type })
    @PostMapping
    public ResponseEntity<RoomDTO> createRoom(@RequestBody Map<String, Object> body,
                                              @AuthenticationPrincipal UserDetails ud) {
        String uid = body.get("uid") == null ? null : String.valueOf(body.get("uid"));
        verify(uid, ud);
        String name = body.get("name") == null ? null : String.valueOf(body.get("name"));
        String type = body.get("type") == null ? null : String.valueOf(body.get("type"));
        String coupleSince = body.get("coupleSince") == null ? null : String.valueOf(body.get("coupleSince"));
        return ResponseEntity.ok(roomService.createRoom(uid, name, type, coupleSince));
    }

    // [B] edit by smsong - 코드로 방 미리보기 (입장 전 어떤 방인지 확인)
    @GetMapping("/preview")
    public ResponseEntity<RoomDTO> previewRoom(@RequestParam("code") String code,
                                               @AuthenticationPrincipal UserDetails ud) {
        if (ud == null) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "권한이 없습니다");
        return ResponseEntity.ok(roomService.previewByCode(ud.getUsername(), code));
    }

    // [B] edit by smsong - 내가 요청 대기중/거절된 방 목록
    @GetMapping("/{uid}/pending")
    public ResponseEntity<List<RoomDTO>> pendingRooms(@PathVariable("uid") String uid,
                                                      @AuthenticationPrincipal UserDetails ud) {
        verify(uid, ud);
        return ResponseEntity.ok(roomService.listPendingForUser(uid));
    }

    // 코드로 입장 요청 (body: { uid, code }) — 즉시 입장이 아니라 방장 승인 대기 요청 생성
    @PostMapping("/join")
    public ResponseEntity<RoomDTO> joinRoom(@RequestBody Map<String, String> body,
                                            @AuthenticationPrincipal UserDetails ud) {
        String uid = body.get("uid");
        verify(uid, ud);
        return ResponseEntity.ok(roomService.requestJoinByCode(uid, body.get("code")));
    }

    // 방 멤버 상세
    @GetMapping("/{roomId}/members")
    public ResponseEntity<RoomDTO> members(@PathVariable("roomId") Long roomId,
                                           @AuthenticationPrincipal UserDetails ud) {
        if (ud == null) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "권한이 없습니다");
        return ResponseEntity.ok(roomService.getRoomWithMembers(roomId, ud.getUsername()));
    }

    // [B] edit by smsong - #4 특정 멤버가 이 방에서 단 댓글 상세(게시글 + 댓글 내용)
    @GetMapping("/{roomId}/member/{uid}/commented")
    public ResponseEntity<List<Map<String, Object>>> commentedItems(@PathVariable("roomId") Long roomId,
                                                                    @PathVariable("uid") String uid,
                                                                    @AuthenticationPrincipal UserDetails ud) {
        if (ud == null) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "권한이 없습니다");
        return ResponseEntity.ok(roomService.getCommentedItems(roomId, uid, ud.getUsername()));
    }

    // 방 삭제 (방장만) — ?uid= 로 요청자 전달
    @DeleteMapping("/{roomId}")
    public ResponseEntity<Void> deleteRoom(@PathVariable("roomId") Long roomId,
                                           @RequestParam("uid") String uid,
                                           @AuthenticationPrincipal UserDetails ud) {
        verify(uid, ud);
        roomService.deleteRoom(roomId, uid);
        return ResponseEntity.ok().build();
    }

    // 방 나가기 (멤버 탈퇴) — ?uid=
    @PostMapping("/{roomId}/leave")
    public ResponseEntity<Void> leaveRoom(@PathVariable("roomId") Long roomId,
                                          @RequestParam("uid") String uid,
                                          @AuthenticationPrincipal UserDetails ud) {
        verify(uid, ud);
        roomService.leaveRoom(roomId, uid);
        return ResponseEntity.ok().build();
    }

    // 커플 슬롯 지정 (방장만) — body: { uid, leftUid, rightUid }
    @PutMapping("/{roomId}/couple")
    public ResponseEntity<RoomDTO> setCouple(@PathVariable("roomId") Long roomId,
                                             @RequestBody Map<String, String> body,
                                             @AuthenticationPrincipal UserDetails ud) {
        String uid = body.get("uid");
        verify(uid, ud);
        return ResponseEntity.ok(roomService.setCouple(roomId, uid, body.get("leftUid"), body.get("rightUid")));
    }

    // 방 이름 수정 (방장만) — body: { uid, name }
    @PutMapping("/{roomId}/name")
    public ResponseEntity<RoomDTO> renameRoom(@PathVariable("roomId") Long roomId,
                                              @RequestBody Map<String, String> body,
                                              @AuthenticationPrincipal UserDetails ud) {
        String uid = body.get("uid");
        verify(uid, ud);
        return ResponseEntity.ok(roomService.renameRoom(roomId, uid, body.get("name")));
    }

    // [B] edit by smsong - 방 대표 이미지 변경 (방장만) — multipart, part명 'mediaData'
    @PostMapping(value = "/{roomId}/image", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<RoomDTO> uploadRoomImage(@PathVariable("roomId") Long roomId,
                                                   @RequestPart("mediaData") MultipartFile mediaData,
                                                   @AuthenticationPrincipal UserDetails ud) {
        if (ud == null) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "권한이 없습니다");
        return ResponseEntity.ok(roomService.updateRoomImage(roomId, ud.getUsername(), mediaData));
    }
    // [E] edit by smsong

    // 디데이(만난 날짜) 설정 (방장만) — body: { uid, since }
    @PutMapping("/{roomId}/dday")
    public ResponseEntity<RoomDTO> setDday(@PathVariable("roomId") Long roomId,
                                           @RequestBody Map<String, String> body,
                                           @AuthenticationPrincipal UserDetails ud) {
        String uid = body.get("uid");
        verify(uid, ud);
        return ResponseEntity.ok(roomService.setDday(roomId, uid, body.get("since")));
    }

    // [B] edit by smsong - 입장 수락 안내를 봤음을 기록 (rooms 페이지 최초 1회 안내 후 호출) — ?uid=
    @PostMapping("/{roomId}/accept-seen")
    public ResponseEntity<Void> markAcceptSeen(@PathVariable("roomId") Long roomId,
                                               @RequestParam("uid") String uid,
                                               @AuthenticationPrincipal UserDetails ud) {
        verify(uid, ud);
        roomService.markAcceptSeen(roomId, uid);
        return ResponseEntity.ok().build();
    }
    // [E] edit by smsong

    // 멤버 강퇴 (방장만) — ?uid=방장uid&reason=강퇴사유(선택), path=대상 uid
    // [B] edit by smsong - 강퇴 사유(reason)를 함께 받아 강퇴된 유저에게 rooms 진입 시 안내
    @DeleteMapping("/{roomId}/members/{targetUid}")
    public ResponseEntity<Void> kickMember(@PathVariable("roomId") Long roomId,
                                           @PathVariable("targetUid") String targetUid,
                                           @RequestParam("uid") String uid,
                                           @RequestParam(value = "reason", required = false) String reason,
                                           @AuthenticationPrincipal UserDetails ud) {
        verify(uid, ud);
        roomService.kickMember(roomId, uid, targetUid, reason);
        return ResponseEntity.ok().build();
    }
    // [E] edit by smsong
}
