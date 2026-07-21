package com.example.Daylog.DTO;

import lombok.*;

// [B] edit by smsong - 로그인 요청(기기 정보 포함).
@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class LoginRequestDTO {
    private String uid;
    private String password;
    private String deviceId;      // 프론트가 생성해 보관하는 기기 고유 ID
    private String deviceName;    // 사용자 지정 이름("내 갤럭시 S24")
    private String userAgent;     // 참고용(브라우저/OS)
    private boolean force;        // true = 다른 기기 세션을 종료하고 이 기기로 로그인
}
// [E] edit by smsong
