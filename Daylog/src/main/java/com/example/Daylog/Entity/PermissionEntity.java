package com.example.Daylog.Entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

// [B] edit by smsong - 사용자 권한 관리 테이블
//  서비스 접근(accessAllowed) + 수정(canEdit) + 휴지통 이동(canTrash) + 삭제(canDelete) 권한,
//  그리고 접근 요청 상태(requestStatus)를 관리자(name '송성민')가 메뉴에서 관리.
@Entity(name = "user_permissions")
@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class PermissionEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true)
    private String uid;

    // [smsong] 제공된 UserEntity 와 외래키(user_id)로 연결 (users.id 참조, 단방향 1:1)
    @OneToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", referencedColumnName = "id", unique = true)
    private UserEntity user;

    // 표시용 스냅샷 (관리자 목록에서 보여주기 위함)
    private String name;
    private String nickname;
    private String email;
    private String provider;
    @Column(length = 1000)
    private String profileURL;

    // 권한 플래그
    @Builder.Default private boolean accessAllowed = false; // 서비스 접근 허용(표시/미러)
    @Builder.Default private boolean canCreate = false;     // 추억/가볼곳 생성
    @Builder.Default private boolean canEdit = false;       // 추억/가볼곳 수정
    @Builder.Default private boolean canTrash = false;      // 휴지통으로 이동/복원
    @Builder.Default private boolean canDelete = false;     // 영구 삭제
    // [smsong] 관리자가 명시적으로 승인했는지 (부트스트랩 자동허용과 구분 · 기본 false → 신규/기존행 모두 미승인)
    @Builder.Default private boolean adminApproved = false;

    // 접근 요청 상태: NONE / PENDING / APPROVED / REJECTED
    @Builder.Default private String requestStatus = "NONE";

    private LocalDateTime requestedAt; // 마지막 권한 요청 시각
    private LocalDateTime decidedAt;   // 관리자 승인/거절 시각
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
// [E] edit by smsong
