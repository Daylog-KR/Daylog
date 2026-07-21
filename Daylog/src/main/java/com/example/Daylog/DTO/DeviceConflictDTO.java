package com.example.Daylog.DTO;

import lombok.*;

import java.time.LocalDateTime;
import java.util.List;

// [B] edit by smsong - "다른 기기에 이미 로그인됨" 응답(HTTP 409 본문).
@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class DeviceConflictDTO {
    private boolean requiresConfirmation;
    private List<DeviceInfo> devices;

    @NoArgsConstructor @AllArgsConstructor @Getter @Setter @Builder
    public static class DeviceInfo {
        private String deviceName;
        private String userAgent;
        private LocalDateTime lastSeenAt;
    }
}
// [E] edit by smsong
