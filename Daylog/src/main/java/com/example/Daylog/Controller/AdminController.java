package com.example.Daylog.Controller;

import com.example.Daylog.Service.ChecklistService;
import com.example.Daylog.Service.MemoryService;
import com.example.Daylog.Service.RoomService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

// [B] edit by smsong - 관리자용 유지보수 API.
//  기존 이미지 썸네일(thumb_) 일괄 재생성: 옛 기록은 thumb_ 가 없어 원본으로 폴백(느림/빈 마커)했는데,
//  원본을 다시 읽어 EXIF 방향을 반영한 소형 썸네일을 생성/덮어써서 속도·방향을 함께 교정한다.
//  ⚠ 일회성으로만 호출(모든 원본을 다시 읽어 씀). 로그인한 사용자만 실행 가능.
@RestController
@RequestMapping("/api/admin")
@RequiredArgsConstructor
public class AdminController {

    private final MemoryService memoryService;
    private final ChecklistService checklistService;
    private final RoomService roomService;

    // POST /api/admin/regenerate-thumbnails
    @PostMapping("/regenerate-thumbnails")
    public ResponseEntity<Map<String, Integer>> regenerateThumbnails(@AuthenticationPrincipal UserDetails ud) {
        if (ud == null) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "권한이 없습니다");
        int memories = memoryService.regenerateThumbnails();
        int checklists = checklistService.regenerateThumbnails();
        int rooms = roomService.regenerateThumbnails();
        return ResponseEntity.ok(Map.of(
                "memories", memories,
                "checklists", checklists,
                "rooms", rooms,
                "total", memories + checklists + rooms
        ));
    }
}
