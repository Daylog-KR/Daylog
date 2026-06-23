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
                                                  @RequestBody MemoryDTO memoryDTO,
                                                  @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(memoryService.updateMemory(id, memoryDTO, userDetails));
    }
}