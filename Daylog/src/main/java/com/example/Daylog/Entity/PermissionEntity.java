package com.example.Daylog.Entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

// [smsong] 방별 사용자 권한 (room_permissions). 관리자 = 각 방의 방장(고정 uid 아님).
//  서비스 접근(accessAllowed) + 생성/수정/휴지통/삭제 권한 + 접근 요청 상태(requestStatus)를 방장이 관리.
//  ※ 새 테이블명이라 기존 user_permissions 제약과 무관하게 안전히 생성됨.
@Entity(name = "room_permissions")
@Table(uniqueConstraints = @UniqueConstraint(columnNames = {"roomId", "uid"}))
@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class PermissionEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    // 소속 방
    @Column(nullable = false)
    private Long roomId;

    @Column(nullable = false)
    private String uid;

    // 표시용 스냅샷 (관리자 목록 표시)
    private String name;
    private String nickname;
    private String email;
    private String provider;
    @Column(length = 1000)
    private String profileURL;

    // 권한 플래그
    @Builder.Default private boolean accessAllowed = false; // 서비스 접근 허용
    @Builder.Default private boolean canCreate = false;     // 생성
    @Builder.Default private boolean canEdit = false;       // 수정
    @Builder.Default private boolean canTrash = false;      // 휴지통 이동/복원
    @Builder.Default private boolean canDelete = false;     // 영구 삭제
    @Builder.Default private boolean adminApproved = false; // 방장이 명시적으로 승인했는지

    // 접근 요청 상태: NONE / PENDING / APPROVED / REJECTED
    @Builder.Default private String requestStatus = "NONE";

    private LocalDateTime requestedAt;
    private LocalDateTime decidedAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    @PrePersist
    public void prePersist() {
        LocalDateTime now = LocalDateTime.now();
        if (createdAt == null) createdAt = now;
        updatedAt = now;
        if (requestStatus == null) requestStatus = "NONE";
    }

    @PreUpdate
    public void preUpdate() {
        updatedAt = LocalDateTime.now();
    }
}
