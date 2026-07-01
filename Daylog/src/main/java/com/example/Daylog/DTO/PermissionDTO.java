package com.example.Daylog.DTO;

import com.example.Daylog.Entity.PermissionEntity;
import lombok.*;

import java.time.LocalDateTime;

// [B] edit by smsong - 사용자 권한 DTO
@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class PermissionDTO {
    private Long id;
    private String uid;
    private String name;
    private String nickname;
    private String email;
    private String provider;
    private String profileURL;
    private boolean accessAllowed;
    private boolean canCreate;   // 생성 권한
    private boolean canEdit;     // 수정 권한
    private boolean canTrash;    // 휴지통 이동/복원 권한
    private boolean canDelete;   // 영구 삭제 권한
    private boolean admin;       // 관리자(name '송성민') 여부
    private boolean bootstrap;   // 부트스트랩 상시 허용(송성민/강미르) 여부 → 관리자 UI 토글 잠금용
    private String requestStatus;
    private LocalDateTime requestedAt;
    private LocalDateTime decidedAt;

    // 관리자 목록용: 실제 저장된 원본 플래그 그대로 (토글 상태 관리)
    public static PermissionDTO raw(PermissionEntity e, boolean isAdmin, boolean isBootstrap) {
        return base(e, isAdmin, isBootstrap)
                .accessAllowed(isAdmin || isBootstrap || e.isAccessAllowed())
                .canCreate(e.isCanCreate())
                .canEdit(e.isCanEdit())
                .canTrash(e.isCanTrash())
                .canDelete(e.isCanDelete())
                .build();
    }

    // 본인용: 실효 권한(관리자/부트스트랩은 전부 true) → 프론트 버튼 표시 판정에 그대로 사용
    public static PermissionDTO effective(PermissionEntity e, boolean isAdmin, boolean isBootstrap) {
        boolean all = isAdmin || isBootstrap;
        return base(e, isAdmin, isBootstrap)
                .accessAllowed(all || e.isAccessAllowed())
                .canCreate(all || e.isCanCreate())
                .canEdit(all || e.isCanEdit())
                .canTrash(all || e.isCanTrash())
                .canDelete(all || e.isCanDelete())
                .build();
    }

    private static PermissionDTOBuilder base(PermissionEntity e, boolean isAdmin, boolean isBootstrap) {
        return PermissionDTO.builder()
                .id(e.getId())
                .uid(e.getUid())
                .name(e.getName())
                .nickname(e.getNickname())
                .email(e.getEmail())
                .provider(e.getProvider())
                .profileURL(e.getProfileURL())
                .admin(isAdmin)
                .bootstrap(isBootstrap)
                .requestStatus(e.getRequestStatus())
                .requestedAt(e.getRequestedAt())
                .decidedAt(e.getDecidedAt());
    }
}
// [E] edit by smsong
