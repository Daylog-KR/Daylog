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

    // [B] edit by smsong - 방장이 입력한 거절 사유 + 거절 안내 1회 표시 여부
    //  거절 시 방장이 사유를 남기고, 거절된 유저는 rooms 페이지 최초 진입 때 이 사유를 1회만 안내받는다.
    @Column(length = 500)
    private String rejectReason;
    @Builder.Default private boolean rejectSeen = false; // 거절 안내를 이미 봤는지(중복 표시 방지)
    // [E] edit by smsong

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
