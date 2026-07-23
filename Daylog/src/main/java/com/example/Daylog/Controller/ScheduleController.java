package com.example.Daylog.Controller;

import com.example.Daylog.DTO.ScheduleDTO;
import com.example.Daylog.Service.ScheduleService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

// [B] edit by smsong - #12 일정 API
//  · 사진이 없어 multipart 가 필요 없다 → 순수 JSON.
//  · 방 스코프는 다른 API 와 동일하게 X-Room-Id 헤더로 받는다.
@RestController
@RequestMapping("/api/schedules")
@RequiredArgsConstructor
public class ScheduleController {

    private final ScheduleService scheduleService;

    /** 생성 */
    @PostMapping
    public ResponseEntity<ScheduleDTO> create(@RequestParam("uid") String uid,
                                              @RequestBody ScheduleDTO dto,
                                              @RequestHeader(value = "X-Room-Id", required = false) Long roomId,
                                              @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(scheduleService.create(uid, roomId, dto, userDetails));
    }

    /** 방의 정상 일정 전체 (달력/목록 공용) */
    @GetMapping("/{uid}")
    public ResponseEntity<List<ScheduleDTO>> getAll(@PathVariable("uid") String uid,
                                                    @RequestHeader(value = "X-Room-Id", required = false) Long roomId,
                                                    @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(scheduleService.getAll(uid, roomId, userDetails));
    }

    /** 수정 (제목/내용/날짜/시간/완료/색상) */
    @PutMapping("/{id}")
    public ResponseEntity<ScheduleDTO> update(@PathVariable("id") Long id,
                                              @RequestBody ScheduleDTO dto,
                                              @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(scheduleService.update(id, dto, userDetails));
    }

    /** 완료 토글만 (목록에서 체크박스로 바로) */
    @PutMapping("/{id}/done")
    public ResponseEntity<ScheduleDTO> toggleDone(@PathVariable("id") Long id,
                                                  @RequestParam("done") boolean done,
                                                  @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(scheduleService.setDone(id, done, userDetails));
    }

    /** 휴지통으로 */
    @PutMapping("/{id}/trash")
    public ResponseEntity<Void> moveToTrash(@PathVariable("id") Long id,
                                            @AuthenticationPrincipal UserDetails userDetails) {
        scheduleService.moveToTrash(id, userDetails);
        return ResponseEntity.ok().build();
    }

    /** 휴지통에서 복원 */
    @PutMapping("/{id}/restore")
    public ResponseEntity<ScheduleDTO> restore(@PathVariable("id") Long id,
                                               @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(scheduleService.restore(id, userDetails));
    }

    /** 영구 삭제 */
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> permanentDelete(@PathVariable("id") Long id,
                                                @AuthenticationPrincipal UserDetails userDetails) {
        scheduleService.permanentDelete(id, userDetails);
        return ResponseEntity.ok().build();
    }

    /** 내가 휴지통으로 보낸 일정 */
    @GetMapping("/trash/{uid}")
    public ResponseEntity<List<ScheduleDTO>> getTrash(@PathVariable("uid") String uid,
                                                      @RequestHeader(value = "X-Room-Id", required = false) Long roomId,
                                                      @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(scheduleService.getTrash(uid, roomId, userDetails));
    }

    // ===== 일괄 처리 (보관함/휴지통 선택 모드) =====

    /** 여러 건을 한 번에 휴지통으로 */
    @PostMapping("/bulk/trash")
    public ResponseEntity<Map<String, Object>> bulkTrash(@RequestBody Map<String, List<Long>> body,
                                                         @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(scheduleService.bulkTrash(body.get("ids"), userDetails));
    }

    /** 여러 건을 한 번에 영구 삭제 */
    @PostMapping("/bulk/delete")
    public ResponseEntity<Map<String, Object>> bulkDelete(@RequestBody Map<String, List<Long>> body,
                                                          @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(scheduleService.bulkDelete(body.get("ids"), userDetails));
    }
}
// [E] edit by smsong
