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
    // [smsong] 기존 행이 있는 테이블에 NOT NULL 컬럼을 추가할 때 DEFAULT 가 없으면 실패하므로 명시.
    @Builder.Default
    @Column(nullable = false, columnDefinition = "boolean not null default false")
    private boolean rejectSeen = false; // 거절 안내를 이미 봤는지(중복 표시 방지)

    // [B] edit by smsong - 승인 후 환영/이용수칙 폼을 이미 봤는지(최초 1회 표시)
    @Builder.Default
    @Column(nullable = false, columnDefinition = "boolean not null default false")
    private boolean welcomeSeen = false;
    // [E] edit by smsong

    // [B] edit by smsong - 방장에게 '강퇴' 당한 상태인지 구분.
    //  거절(입장 요청 거절)과 동일하게 rooms 진입 시 사유 폼을 띄우되, 문구를 '내보내짐'으로 구분한다.
    //  강퇴 시 requestStatus 를 REJECTED 로 두고 kicked=true + rejectReason 을 함께 저장 → 기존 거절 안내 흐름 재사용.
    @Builder.Default
    @Column(nullable = false, columnDefinition = "boolean not null default false")
    private boolean kicked = false;
    // [E] edit by smsong

    // [B] edit by smsong - 방장이 입장을 '수락'했을 때, 수락된 유저가 rooms 페이지에서 안내를 받았는지 여부.
    //  기본값 true(기존 멤버/일반 행은 안내 안 뜸). decideAccess(승인) 시에만 false 로 내려 최초 1회 안내.
    @Builder.Default
    @Column(nullable = false, columnDefinition = "boolean not null default true")
    private boolean acceptSeen = true;
    // [E] edit by smsong
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
