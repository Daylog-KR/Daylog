package com.example.Daylog.Controller;

import com.example.Daylog.DTO.ChecklistDTO;
import com.example.Daylog.Service.ChecklistService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import lombok.RequiredArgsConstructor;
import lombok.SneakyThrows;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.Map; // [B][E] edit by smsong - #12

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

    // ===== [B] edit by smsong - #12 보관함 =====

    /** 보관함으로 이동 ('다녀왔습니다' → 추억 생성 후 원본을 여기로) */
    @PutMapping("/{id}/archive")
    public ResponseEntity<ChecklistDTO> archive(@PathVariable("id") Long id,
                                                @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(checklistService.archive(id, userDetails));
    }

    /** 보관 해제 — 다시 일반 목록으로 */
    @PutMapping("/{id}/unarchive")
    public ResponseEntity<ChecklistDTO> unarchive(@PathVariable("id") Long id,
                                                  @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(checklistService.unarchive(id, userDetails));
    }

    /** 달력용 목록 — 보관함 포함, 휴지통 제외 */
    @GetMapping("/calendar/{uid}")
    public ResponseEntity<List<ChecklistDTO>> getForCalendar(@PathVariable("uid") String uid,
                                                             @RequestHeader(value = "X-Room-Id", required = false) Long roomId,
                                                             @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(checklistService.getForCalendar(uid, roomId, userDetails));
    }

    /** 보관함 목록 (방 전체 공유) */
    @GetMapping("/archive/{uid}")
    public ResponseEntity<List<ChecklistDTO>> getArchived(@PathVariable("uid") String uid,
                                                          @RequestHeader(value = "X-Room-Id", required = false) Long roomId,
                                                          @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(checklistService.getArchived(uid, roomId, userDetails));
    }

    // ===== 일괄 처리 (보관함/휴지통 선택 모드) =====

    @PostMapping("/bulk/trash")
    public ResponseEntity<Map<String, Object>> bulkTrash(@RequestBody Map<String, List<Long>> body,
                                                         @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(checklistService.bulkTrash(body.get("ids"), userDetails));
    }

    @PostMapping("/bulk/delete")
    public ResponseEntity<Map<String, Object>> bulkDelete(@RequestBody Map<String, List<Long>> body,
                                                          @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(checklistService.bulkDelete(body.get("ids"), userDetails));
    }

    @PostMapping("/bulk/restore")
    public ResponseEntity<Map<String, Object>> bulkRestore(@RequestBody Map<String, List<Long>> body,
                                                           @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(checklistService.bulkRestore(body.get("ids"), userDetails));
    }
    // [E] edit by smsong

    // 내가 휴지통으로 보낸 가볼곳 목록
    @GetMapping("/trash/{uid}")
    public ResponseEntity<List<ChecklistDTO>> getTrash(@PathVariable("uid") String uid,
                                                       @RequestHeader(value = "X-Room-Id", required = false) Long roomId,
                                                       @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(checklistService.getTrash(uid, roomId, userDetails));
    }

}