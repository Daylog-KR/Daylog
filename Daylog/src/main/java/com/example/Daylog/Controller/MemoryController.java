package com.example.Daylog.Controller;

import com.example.Daylog.DTO.MemoryDTO;
import com.example.Daylog.Service.MemoryService;
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

@RestController
@RequestMapping("/api/memories")
@RequiredArgsConstructor
public class MemoryController {

    private final MemoryService memoryService;

    @SneakyThrows
    @PostMapping(consumes = {MediaType.APPLICATION_JSON_VALUE, MediaType.MULTIPART_FORM_DATA_VALUE})
    public ResponseEntity<MemoryDTO> createMemory(@RequestPart("uid") String uid,
                                                  @RequestPart("memoryData") String memoryData,
                                                  @RequestPart(value = "mediaData") MultipartFile mediaData,
                                                  @AuthenticationPrincipal UserDetails userDetails) {
        ObjectMapper mapper = new ObjectMapper();
        mapper.registerModule(new JavaTimeModule());
        MemoryDTO memoryDTO = mapper.readValue(memoryData, MemoryDTO.class);
        return ResponseEntity.ok(memoryService.createMemory(uid, memoryDTO, mediaData, userDetails));
    }

    @GetMapping("/{uid}")
    public ResponseEntity<List<MemoryDTO>> getAllMemories(@PathVariable("uid") String uid,
                                                          @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(memoryService.getAllMemories(uid, userDetails));
    }

    // 본인 소유 추억 수정 (제목/내용/날짜) — JSON 본문
    @PutMapping("/{id}")
    public ResponseEntity<MemoryDTO> updateMemory(@PathVariable("id") Long id,
                                                  @RequestBody java.util.Map<String, Object> body,
                                                  @AuthenticationPrincipal UserDetails userDetails) {
        MemoryDTO dto = MemoryDTO.builder()
                .title(body.get("title") != null ? String.valueOf(body.get("title")) : null)
                .content(body.get("content") != null ? String.valueOf(body.get("content")) : null)
                .createdAt(parseDateTime(body.get("createdAt")))
                .build();
        return ResponseEntity.ok(memoryService.updateMemory(id, dto, userDetails));
    }

    // 다양한 날짜 문자열("yyyy-MM-dd", ISO, 'Z' 포함)을 LocalDateTime 으로 안전 변환
    private static java.time.LocalDateTime parseDateTime(Object v) {
        if (v == null) return null;
        String s = String.valueOf(v).trim();
        if (s.isEmpty()) return null;
        try {
            if (s.length() == 10) return java.time.LocalDate.parse(s).atStartOfDay();
            if (s.endsWith("Z")) {
                return java.time.Instant.parse(s)
                        .atZone(java.time.ZoneId.systemDefault())
                        .toLocalDateTime();
            }
            return java.time.LocalDateTime.parse(s);
        } catch (Exception e) {
            try {
                return java.time.LocalDate.parse(s.substring(0, 10)).atStartOfDay();
            } catch (Exception ex) {
                return null;
            }
        }
    }

    // 휴지통으로 이동 (소프트 삭제)
    @PutMapping("/{id}/trash")
    public ResponseEntity<Void> moveToTrash(@PathVariable("id") Long id,
                                            @AuthenticationPrincipal UserDetails userDetails) {
        memoryService.moveToTrash(id, userDetails);
        return ResponseEntity.ok().build();
    }

    // 휴지통에서 복원
    @PutMapping("/{id}/restore")
    public ResponseEntity<MemoryDTO> restoreMemory(@PathVariable("id") Long id,
                                                   @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(memoryService.restoreMemory(id, userDetails));
    }

    // 영구 삭제
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> permanentDelete(@PathVariable("id") Long id,
                                                @AuthenticationPrincipal UserDetails userDetails) {
        memoryService.permanentDelete(id, userDetails);
        return ResponseEntity.ok().build();
    }

    // 내가 휴지통으로 보낸 추억 목록
    @GetMapping("/trash/{uid}")
    public ResponseEntity<List<MemoryDTO>> getTrash(@PathVariable("uid") String uid,
                                                    @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(memoryService.getTrash(uid, userDetails));
    }
}