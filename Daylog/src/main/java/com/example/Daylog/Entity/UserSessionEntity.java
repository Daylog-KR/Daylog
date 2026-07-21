package com.example.Daylog.Entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

// [B] edit by smsong - 로그인 세션(기기) 기록.
//   한 사용자(uid)가 로그인한 각 기기를 1행으로 보관한다.
//   · deviceId   : 프론트가 기기별로 생성해 localStorage 에 보관하는 무작위 ID(같은 기기 식별)
//   · deviceName : 사용자가 지정한 이름("내 갤럭시 S24" 등)
//   · token      : 현재 그 기기의 활성 JWT (기기별 세션 유지의 핵심)
//   다른 기기에서 로그인 시 이 목록을 보여주고, 강제 로그인하면 기존 행을 지운다.
@Entity(name = "user_sessions")
@Table(uniqueConstraints = @UniqueConstraint(columnNames = {"uid", "deviceId"}))
@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class UserSessionEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String uid;
    private String deviceId;      // 기기 고유 ID(프론트 생성)
    private String deviceName;    // 사용자 지정 이름

    @Column(length = 512)
    private String userAgent;     // 참고용(브라우저/OS 추정)

    @Column(length = 1024)
    private String token;         // 이 기기의 현재 활성 토큰

    private LocalDateTime createdAt;
    private LocalDateTime lastSeenAt;
}
// [E] edit by smsong
