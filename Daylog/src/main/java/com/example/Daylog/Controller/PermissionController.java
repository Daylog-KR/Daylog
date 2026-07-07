package com.example.Daylog.Controller;

import com.example.Daylog.DTO.PermissionDTO;
import com.example.Daylog.Service.PermissionService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

// [smsong] 방별 사용자 권한 관리 API — 방은 X-Room-Id 헤더로 구분, 관리자 = 방장
@RestController
@RequestMapping("/api/permissions")
@RequiredArgsConstructor
public class PermissionController {

    private final PermissionService permissionService;

    private String uidOf(UserDetails ud) {
        if (ud == null) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "권한이 없습니다");
        return ud.getUsername();
    }

    // 로그인 사용자 등록(upsert) + 본인 권한 반환 (앱 진입 시)
    @PostMapping("/register")
    public ResponseEntity<PermissionDTO> register(@RequestHeader(value = "X-Room-Id", required = false) Long roomId,
                                                  @AuthenticationPrincipal UserDetails ud) {
        return ResponseEntity.ok(permissionService.registerAndGetMine(uidOf(ud), roomId));
    }

    // 본인 권한 조회
    @GetMapping("/me")
    public ResponseEntity<PermissionDTO> me(@RequestHeader(value = "X-Room-Id", required = false) Long roomId,
                                            @AuthenticationPrincipal UserDetails ud) {
        return ResponseEntity.ok(permissionService.getMine(uidOf(ud), roomId));
    }

    // 접근 권한 요청 (차단 화면에서 호출)
    @PostMapping("/request")
    public ResponseEntity<PermissionDTO> request(@RequestHeader(value = "X-Room-Id", required = false) Long roomId,
                                                 @AuthenticationPrincipal UserDetails ud) {
        return ResponseEntity.ok(permissionService.requestAccess(uidOf(ud), roomId));
    }

    // 방장: 방 멤버 목록(권한 포함)
    @GetMapping("/users")
    public ResponseEntity<List<PermissionDTO>> users(@RequestHeader(value = "X-Room-Id", required = false) Long roomId,
                                                     @AuthenticationPrincipal UserDetails ud) {
        return ResponseEntity.ok(permissionService.listAll(roomId, uidOf(ud)));
    }

    // [B] edit by smsong - 방장: 대기중 접근 요청 목록 (방 진입 시 알림 폼용)
    @GetMapping("/pending")
    public ResponseEntity<List<PermissionDTO>> pending(@RequestHeader(value = "X-Room-Id", required = false) Long roomId,
                                                       @AuthenticationPrincipal UserDetails ud) {
        return ResponseEntity.ok(permissionService.listPending(roomId, uidOf(ud)));
    }
    // [E] edit by smsong

    // 방장: 권한 변경
    @PutMapping("/{uid}")
    public ResponseEntity<PermissionDTO> update(@PathVariable("uid") String targetUid,
                                                @RequestHeader(value = "X-Room-Id", required = false) Long roomId,
                                                @RequestBody PermissionDTO patch,
                                                @AuthenticationPrincipal UserDetails ud) {
        return ResponseEntity.ok(permissionService.updatePermission(roomId, targetUid, patch, uidOf(ud)));
    }

    // 방장: 접근 요청 승인/거절 (거절 시 ?reason= 로 거절 사유 전달, 선택)
    @PostMapping("/{uid}/decide")
    public ResponseEntity<PermissionDTO> decide(@PathVariable("uid") String targetUid,
                                                @RequestHeader(value = "X-Room-Id", required = false) Long roomId,
                                                @RequestParam("approve") boolean approve,
                                                @RequestParam(value = "reason", required = false) String reason,
                                                @AuthenticationPrincipal UserDetails ud) {
        return ResponseEntity.ok(permissionService.decideAccess(roomId, targetUid, approve, uidOf(ud), reason));
    }

    // [B] edit by smsong - 거절된 유저: 거절 안내를 봤음을 기록 (rooms 페이지 1회 안내 후)
    @PostMapping("/reject-seen")
    public ResponseEntity<Void> rejectSeen(@RequestHeader(value = "X-Room-Id", required = false) Long roomId,
                                           @AuthenticationPrincipal UserDetails ud) {
        permissionService.markRejectSeen(uidOf(ud), roomId);
        return ResponseEntity.ok().build();
    }

    // [B] edit by smsong - 거절된 유저: '요청 대기중인 방'에서 해당 방 제거(X)
    @PostMapping("/dismiss")
    public ResponseEntity<Void> dismiss(@RequestHeader(value = "X-Room-Id", required = false) Long roomId,
                                        @AuthenticationPrincipal UserDetails ud) {
        permissionService.dismissRequest(uidOf(ud), roomId);
        return ResponseEntity.ok().build();
    }
    // [E] edit by smsong
}
