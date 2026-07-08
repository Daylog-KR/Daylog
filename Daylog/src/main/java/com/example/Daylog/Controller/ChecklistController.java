package com.example.Daylog.Controller;

import com.example.Daylog.DTO.ChecklistDTO;
import com.example.Daylog.DTO.RoomDTO;
import com.example.Daylog.Service.ChecklistService;
import com.example.Daylog.Service.RoomService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import lombok.RequiredArgsConstructor;
import lombok.SneakyThrows;
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

@RestController
@RequestMapping("/api/checklists")
@RequiredArgsConstructor
public class ChecklistController {

    private final ChecklistService checklistService;

    // 생성 — 이미지 여러 장(mediaData 반복) 선택
    @SneakyThrows
    @PostMapping(consumes = {MediaType.APPLICATION_JSON_VALUE, MediaType.MULTIPART_FORM_DATA_VALUE})
    public ResponseEntity<ChecklistDTO> createChecklist(@RequestPart("uid") String uid,
                                                        @RequestPart("checklistData") String checklistData,
                                                        @RequestPart(value = "mediaData", required = false) List<MultipartFile> mediaData,
                                                        @RequestHeader(value = "X-Room-Id", required = false) Long roomId,
                                                        @AuthenticationPrincipal UserDetails userDetails) {
        ObjectMapper mapper = new ObjectMapper();
        mapper.registerModule(new JavaTimeModule());
        ChecklistDTO dto = mapper.readValue(checklistData, ChecklistDTO.class);
        return ResponseEntity.ok(checklistService.createChecklist(uid, roomId, dto, mediaData, userDetails));
    }

    // 전체 조회 (지도/목록 공용)
    @GetMapping("/{uid}")
    public ResponseEntity<List<ChecklistDTO>> getAllChecklists(@PathVariable("uid") String uid,
                                                               @RequestHeader(value = "X-Room-Id", required = false) Long roomId,
                                                               @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(checklistService.getAllChecklists(uid, roomId, userDetails));
    }

    // 본인 소유 수정 (제목/내용/타입/방문여부/방문일 + 이미지 정렬/추가/삭제) — 이미지 여러 장 선택
    @SneakyThrows
    @PutMapping(value = "/{id}", consumes = {MediaType.APPLICATION_JSON_VALUE, MediaType.MULTIPART_FORM_DATA_VALUE})
    public ResponseEntity<ChecklistDTO> updateChecklist(@PathVariable("id") Long id,
                                                        @RequestPart("checklistData") String checklistData,
                                                        @RequestPart(value = "mediaData", required = false) List<MultipartFile> mediaData,
                                                        @AuthenticationPrincipal UserDetails userDetails) {
        ObjectMapper mapper = new ObjectMapper();
        mapper.registerModule(new JavaTimeModule());
        ChecklistDTO dto = mapper.readValue(checklistData, ChecklistDTO.class);
        // 다녀오지 않았으면 방문일 무시
        if (!dto.isVisited()) dto.setVisitedDate(null);
        return ResponseEntity.ok(checklistService.updateChecklist(id, dto, mediaData, userDetails));
    }

    // 휴지통으로 이동 (소프트 삭제)
    @PutMapping("/{id}/trash")
    public ResponseEntity<Void> moveToTrash(@PathVariable("id") Long id,
                                            @AuthenticationPrincipal UserDetails userDetails) {
        checklistService.moveToTrash(id, userDetails);
        return ResponseEntity.ok().build();
    }

    // 휴지통에서 복원
    @PutMapping("/{id}/restore")
    public ResponseEntity<ChecklistDTO> restoreChecklist(@PathVariable("id") Long id,
                                                         @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(checklistService.restoreChecklist(id, userDetails));
    }

    // 영구 삭제 (소유자만)
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> permanentDelete(@PathVariable("id") Long id,
                                                @AuthenticationPrincipal UserDetails userDetails) {
        checklistService.permanentDelete(id, userDetails);
        return ResponseEntity.ok().build();
    }

    // 내가 휴지통으로 보낸 가볼곳 목록
    @GetMapping("/trash/{uid}")
    public ResponseEntity<List<ChecklistDTO>> getTrash(@PathVariable("uid") String uid,
                                                       @RequestHeader(value = "X-Room-Id", required = false) Long roomId,
                                                       @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(checklistService.getTrash(uid, roomId, userDetails));
    }

    // [smsong] 방(공유 공간) API — 로그인 후 방 목록/생성/입장/삭제
    @RestController
    @RequestMapping("/api/rooms")
    @RequiredArgsConstructor
    public static class RoomController {

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
}
