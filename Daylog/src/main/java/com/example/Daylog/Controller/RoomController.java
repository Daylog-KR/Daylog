package com.example.Daylog.Controller;

import com.example.Daylog.DTO.RoomDTO;
import com.example.Daylog.Service.RoomService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;
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

    // 방 생성 (body: { uid, name })
    @PostMapping
    public ResponseEntity<RoomDTO> createRoom(@RequestBody Map<String, String> body,
                                              @AuthenticationPrincipal UserDetails ud) {
        String uid = body.get("uid");
        verify(uid, ud);
        return ResponseEntity.ok(roomService.createRoom(uid, body.get("name")));
    }

    // 코드로 입장 (body: { uid, code })
    @PostMapping("/join")
    public ResponseEntity<RoomDTO> joinRoom(@RequestBody Map<String, String> body,
                                            @AuthenticationPrincipal UserDetails ud) {
        String uid = body.get("uid");
        verify(uid, ud);
        return ResponseEntity.ok(roomService.joinByCode(uid, body.get("code")));
    }

    // 방 멤버 상세
    @GetMapping("/{roomId}/members")
    public ResponseEntity<RoomDTO> members(@PathVariable("roomId") Long roomId,
                                           @AuthenticationPrincipal UserDetails ud) {
        if (ud == null) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "권한이 없습니다");
        return ResponseEntity.ok(roomService.getRoomWithMembers(roomId, ud.getUsername()));
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
}
