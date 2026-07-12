package com.example.Daylog.Controller;

import com.example.Daylog.DTO.CommentDTO;
import com.example.Daylog.Service.CommentService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/comment")
@RequiredArgsConstructor
public class CommentController {

    private final CommentService commentService;

    private static Long toLong(Object v) {
        if (v == null) return null;
        String s = String.valueOf(v).trim();
        if (s.isEmpty() || "null".equalsIgnoreCase(s)) return null;
        try { return Long.valueOf(s.contains(".") ? s.substring(0, s.indexOf('.')) : s); }
        catch (NumberFormatException e) { return null; }
    }

    private static String toStr(Object v) {
        return v == null ? null : String.valueOf(v);
    }

    // 댓글/대댓글 작성  (body: { memoryId?, checklistId?, parentId?, content })
    @PostMapping
    public ResponseEntity<CommentDTO> create(@RequestBody Map<String, Object> body,
                                             @AuthenticationPrincipal UserDetails userDetails) {
        Long memoryId = toLong(body.get("memoryId"));
        Long checklistId = toLong(body.get("checklistId"));
        Long parentId = toLong(body.get("parentId"));
        String content = toStr(body.get("content"));
        return ResponseEntity.ok(commentService.createComment(memoryId, checklistId, parentId, content, userDetails));
    }

    // 특정 추억의 댓글 목록 (대댓글 포함)
    @GetMapping("/memory/{memoryId}")
    public ResponseEntity<List<CommentDTO>> getByMemory(@PathVariable("memoryId") Long memoryId) {
        return ResponseEntity.ok(commentService.getCommentsByMemory(memoryId));
    }

    // [smsong] 특정 가볼곳(체크리스트)의 댓글 목록 (대댓글 포함)
    @GetMapping("/checklist/{checklistId}")
    public ResponseEntity<List<CommentDTO>> getByChecklist(@PathVariable("checklistId") Long checklistId) {
        return ResponseEntity.ok(commentService.getCommentsByChecklist(checklistId));
    }

    // [smsong] 댓글 수 배치 집계 (썸네일 표시용)
    @GetMapping("/counts/memory")
    public ResponseEntity<Map<Long, Long>> countsByMemory() {
        return ResponseEntity.ok(commentService.countsByMemory());
    }
    @GetMapping("/counts/checklist")
    public ResponseEntity<Map<Long, Long>> countsByChecklist() {
        return ResponseEntity.ok(commentService.countsByChecklist());
    }

    // 본인 댓글 수정 (내용)
    @PutMapping("/{id}")
    public ResponseEntity<CommentDTO> update(@PathVariable("id") Long id,
                                             @RequestBody Map<String, Object> body,
                                             @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(commentService.updateComment(id, toStr(body.get("content")), userDetails));
    }

    // 휴지통으로 이동 (소프트 삭제)
    @PutMapping("/{id}/trash")
    public ResponseEntity<Void> moveToTrash(@PathVariable("id") Long id,
                                            @AuthenticationPrincipal UserDetails userDetails) {
        commentService.moveToTrash(id, userDetails);
        return ResponseEntity.ok().build();
    }

    // 휴지통에서 복원
    @PutMapping("/{id}/restore")
    public ResponseEntity<CommentDTO> restore(@PathVariable("id") Long id,
                                              @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(commentService.restore(id, userDetails));
    }

    // 영구 삭제
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> permanentDelete(@PathVariable("id") Long id,
                                                @AuthenticationPrincipal UserDetails userDetails) {
        commentService.permanentDelete(id, userDetails);
        return ResponseEntity.ok().build();
    }

    // 내가 휴지통으로 보낸 댓글 목록
    @GetMapping("/trash")
    public ResponseEntity<List<CommentDTO>> getTrash(@AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(commentService.getTrash(userDetails));
    }

    // [B] edit by smsong - #5 가볼곳 → 추억 전환 시 댓글 이동
    @PostMapping("/move")
    public ResponseEntity<Map<String, Integer>> move(@RequestParam("fromChecklist") Long fromChecklist,
                                                     @RequestParam("toMemory") Long toMemory,
                                                     @AuthenticationPrincipal UserDetails userDetails) {
        int moved = commentService.moveChecklistCommentsToMemory(fromChecklist, toMemory, userDetails);
        return ResponseEntity.ok(Map.of("moved", moved));
    }
}