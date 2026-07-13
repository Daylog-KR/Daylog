package com.example.Daylog.Controller;

import com.example.Daylog.Entity.NotificationEntity;
import com.example.Daylog.Service.NotificationService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

// [B] edit by smsong - 알림함 API (인스타 하트 목록)
@RestController
@RequestMapping("/api/notifications")
@RequiredArgsConstructor
public class NotificationController {

    private final NotificationService notificationService;

    // 알림 목록 (최신순, 기본 50개) — roomId 주면 그 방 알림만
    @GetMapping
    public ResponseEntity<List<Map<String, Object>>> list(@AuthenticationPrincipal UserDetails ud,
                                                           @RequestParam(value = "limit", defaultValue = "50") int limit,
                                                           @RequestParam(value = "roomId", required = false) Long roomId) {
        if (ud == null) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "권한이 없습니다");
        List<NotificationEntity> src = (roomId != null)
                ? notificationService.listByRoom(ud.getUsername(), roomId, limit)
                : notificationService.list(ud.getUsername(), limit);
        List<Map<String, Object>> out = new ArrayList<>();
        for (NotificationEntity n : src) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", n.getId());
            m.put("type", n.getType());
            m.put("title", n.getTitle());
            m.put("body", n.getBody());
            m.put("url", n.getUrl());
            m.put("read", n.isRead());
            m.put("createdAt", n.getCreatedAt() == null ? null : n.getCreatedAt().toString());
            out.add(m);
        }
        return ResponseEntity.ok(out);
    }

    // 안 읽은 알림 수 (배지) — roomId 주면 그 방 기준
    @GetMapping("/unread-count")
    public ResponseEntity<Map<String, Object>> unreadCount(@AuthenticationPrincipal UserDetails ud,
                                                           @RequestParam(value = "roomId", required = false) Long roomId) {
        if (ud == null) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "권한이 없습니다");
        long count = (roomId != null)
                ? notificationService.unreadCountByRoom(ud.getUsername(), roomId)
                : notificationService.unreadCount(ud.getUsername());
        return ResponseEntity.ok(Map.of("count", count));
    }

    // 모두 읽음 처리 (목록 열 때 호출) — roomId 주면 그 방만
    @PostMapping("/read-all")
    public ResponseEntity<Void> readAll(@AuthenticationPrincipal UserDetails ud,
                                        @RequestParam(value = "roomId", required = false) Long roomId) {
        if (ud == null) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "권한이 없습니다");
        if (roomId != null) notificationService.markRoomRead(ud.getUsername(), roomId);
        else notificationService.markAllRead(ud.getUsername());
        return ResponseEntity.ok().build();
    }
}
