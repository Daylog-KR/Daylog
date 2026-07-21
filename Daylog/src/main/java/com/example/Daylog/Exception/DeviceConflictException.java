package com.example.Daylog.Exception;

import com.example.Daylog.DTO.DeviceConflictDTO;
import lombok.Getter;

// [B] edit by smsong - 다른 기기에 이미 로그인되어 확인이 필요할 때 던지는 예외 → 컨트롤러가 409 로 변환.
@Getter
public class DeviceConflictException extends RuntimeException {
    private final DeviceConflictDTO detail;

    public DeviceConflictException(DeviceConflictDTO detail) {
        super("이미 다른 기기에 로그인되어 있습니다");
        this.detail = detail;
    }
}
// [E] edit by smsong
