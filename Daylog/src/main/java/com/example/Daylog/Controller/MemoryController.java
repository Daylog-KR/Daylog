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

    // 생성 — 이미지 여러 장(mediaData 반복) 가능
    @SneakyThrows
    @PostMapping(consumes = {MediaType.APPLICATION_JSON_VALUE, MediaType.MULTIPART_FORM_DATA_VALUE})
    public ResponseEntity<MemoryDTO> createMemory(@RequestPart("uid") String uid,
                                                  @RequestPart("memoryData") String memoryData,
                                                  @RequestPart(value = "mediaData", required = false) List<MultipartFile> mediaData,
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

    // 본인 소유 추억 수정 (제목/내용/날짜 + 이미지 정렬/추가/삭제) — multipart
    @SneakyThrows
    @PutMapping(value = "/{id}", consumes = {MediaType.APPLICATION_JSON_VALUE, MediaType.MULTIPART_FORM_DATA_VALUE})
    public ResponseEntity<MemoryDTO> updateMemory(@PathVariable("id") Long id,
                                                  @RequestPart("memoryData") String memoryData,
                                                  @RequestPart(value = "mediaData", required = false) List<MultipartFile> mediaData,
                                                  @AuthenticationPrincipal UserDetails userDetails) {
        ObjectMapper mapper = new ObjectMapper();
        mapper.registerModule(new JavaTimeModule());
        MemoryDTO dto = mapper.readValue(memoryData, MemoryDTO.class);
        return ResponseEntity.ok(memoryService.updateMemory(id, dto, mediaData, userDetails));
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
