package com.example.Daylog.Service;

import com.example.Daylog.DTO.PermissionDTO;
import com.example.Daylog.Entity.PermissionEntity;
import com.example.Daylog.Entity.UserEntity;
import com.example.Daylog.Repository.PermissionRepository;
import com.example.Daylog.Repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

// [B] edit by smsong - 사용자 권한 관리 서비스
//  관리자: name '송성민' (무조건 모든 권한 + 접근 허용)
//  부트스트랩 접근 허용: 송성민 / s s / 강미르 (기존 사용자 호환, DB 행이 없어도 접근 가능)
@Service
@RequiredArgsConstructor
public class PermissionService {

    private final PermissionRepository permissionRepository;
    private final UserRepository userRepository;

    public static final String ADMIN_NAME = "송성민";
    private static final Set<String> BOOTSTRAP_ACCESS = Set.of("송성민", "강미르"); // [smsong] s s 제거 — 자동 접근 차단

    // ===== 이름/관리자 판별 =====
    private String nameOf(UserDetails ud) {
        if (ud == null) return null;
        return userRepository.findByUid(ud.getUsername()).map(UserEntity::getName).orElse(null);
    }

    public boolean isAdmin(UserDetails ud) {
        String n = nameOf(ud);
        return n != null && ADMIN_NAME.equals(n.trim());
    }

    private boolean isBootstrapAccess(String name) {
        return name != null && BOOTSTRAP_ACCESS.contains(name.trim());
    }

    // ===== 권한 조회 =====
    private Optional<PermissionEntity> rowOf(UserDetails ud) {
        if (ud == null) return Optional.empty();
        return permissionRepository.findByUid(ud.getUsername());
    }

    public boolean hasAccess(UserDetails ud) {
        if (ud == null) return false;
        if (isAdmin(ud)) return true;
        if (isBootstrapAccess(nameOf(ud))) return true;
        return rowOf(ud).map(PermissionEntity::isAccessAllowed).orElse(false);
    }

    public boolean canEdit(UserDetails ud) {
        if (isAdmin(ud)) return true;
        return rowOf(ud).map(PermissionEntity::isCanEdit).orElse(false);
    }

    public boolean canTrash(UserDetails ud) {
        if (isAdmin(ud)) return true;
        return rowOf(ud).map(PermissionEntity::isCanTrash).orElse(false);
    }

    public boolean canDelete(UserDetails ud) {
        if (isAdmin(ud)) return true;
        return rowOf(ud).map(PermissionEntity::isCanDelete).orElse(false);
    }

    // ===== 등록(upsert) : 로그인한 사용자를 권한 목록에 올리고 본인 권한 반환 =====
    @Transactional
    public PermissionDTO registerAndGetMine(UserDetails ud) {
        if (ud == null) throw new RuntimeException("권한이 없습니다");
        String uid = ud.getUsername();
        UserEntity user = userRepository.findByUid(uid).orElse(null);
        PermissionEntity e = permissionRepository.findByUid(uid).orElse(null);
        boolean isNew = (e == null);
        if (isNew) {
            e = PermissionEntity.builder().uid(uid).requestStatus("NONE").build();
        }
        if (user != null) {
            e.setName(user.getName());
            e.setNickname(user.getNickname());
            e.setEmail(user.getEmail());
            e.setProvider(user.getProvider());
            e.setProfileURL(user.getProfileURL());
        }
        // 부트스트랩/관리자는 접근 자동 허용
        boolean admin = isAdmin(ud);
        if (admin || isBootstrapAccess(user != null ? user.getName() : null)) {
            e.setAccessAllowed(true);
            if (admin) { e.setCanEdit(true); e.setCanTrash(true); e.setCanDelete(true); }
            if (!"APPROVED".equals(e.getRequestStatus())) e.setRequestStatus("APPROVED");
        }
        e = permissionRepository.save(e);
        return PermissionDTO.entityToDto(e, admin);
    }

    @Transactional(readOnly = true)
    public PermissionDTO getMine(UserDetails ud) {
        if (ud == null) throw new RuntimeException("권한이 없습니다");
        boolean admin = isAdmin(ud);
        PermissionEntity e = permissionRepository.findByUid(ud.getUsername())
                .orElseGet(() -> PermissionEntity.builder()
                        .uid(ud.getUsername())
                        .accessAllowed(hasAccess(ud))
                        .requestStatus("NONE")
                        .build());
        // 부트스트랩/관리자 접근 반영(미저장 객체라도 정확히 표시)
        if (admin || isBootstrapAccess(nameOf(ud))) e.setAccessAllowed(true);
        if (admin) { e.setCanEdit(true); e.setCanTrash(true); e.setCanDelete(true); }
        return PermissionDTO.entityToDto(e, admin);
    }

    // ===== 접근 요청 (차단된 사용자도 호출 가능) =====
    @Transactional
    public PermissionDTO requestAccess(UserDetails ud) {
        if (ud == null) throw new RuntimeException("권한이 없습니다");
        String uid = ud.getUsername();
        UserEntity user = userRepository.findByUid(uid).orElse(null);
        PermissionEntity e = permissionRepository.findByUid(uid)
                .orElseGet(() -> PermissionEntity.builder().uid(uid).build());
        if (user != null) {
            e.setName(user.getName());
            e.setNickname(user.getNickname());
            e.setEmail(user.getEmail());
            e.setProvider(user.getProvider());
            e.setProfileURL(user.getProfileURL());
        }
        if (!e.isAccessAllowed()) {
            e.setRequestStatus("PENDING");
            e.setRequestedAt(LocalDateTime.now());
        }
        e = permissionRepository.save(e);
        return PermissionDTO.entityToDto(e, isAdmin(ud));
    }

    // ===== 관리자: 전체 사용자 목록 =====
    @Transactional(readOnly = true)
    public List<PermissionDTO> listAll(UserDetails ud) {
        requireAdmin(ud);
        return permissionRepository.findAllByOrderByAccessAllowedDescUpdatedAtDesc().stream()
                .map(e -> PermissionDTO.entityToDto(e, ADMIN_NAME.equals(e.getName() != null ? e.getName().trim() : "")))
                .collect(Collectors.toList());
    }

    // ===== 관리자: 특정 사용자 권한 변경 =====
    @Transactional
    public PermissionDTO updatePermission(String targetUid, PermissionDTO patch, UserDetails ud) {
        requireAdmin(ud);
        PermissionEntity e = permissionRepository.findByUid(targetUid)
                .orElseThrow(() -> new IllegalArgumentException("대상 사용자를 찾을 수 없습니다."));
        e.setAccessAllowed(patch.isAccessAllowed());
        e.setCanEdit(patch.isCanEdit());
        e.setCanTrash(patch.isCanTrash());
        e.setCanDelete(patch.isCanDelete());
        // 접근 허용/거절에 따라 요청 상태 정리
        if (patch.isAccessAllowed()) {
            e.setRequestStatus("APPROVED");
        } else if ("PENDING".equals(e.getRequestStatus()) || "APPROVED".equals(e.getRequestStatus())) {
            e.setRequestStatus("REJECTED");
        }
        e.setDecidedAt(LocalDateTime.now());
        e = permissionRepository.save(e);
        return PermissionDTO.entityToDto(e, ADMIN_NAME.equals(e.getName() != null ? e.getName().trim() : ""));
    }

    // ===== 관리자: 접근 요청 승인/거절 =====
    @Transactional
    public PermissionDTO decideAccess(String targetUid, boolean approve, UserDetails ud) {
        requireAdmin(ud);
        PermissionEntity e = permissionRepository.findByUid(targetUid)
                .orElseThrow(() -> new IllegalArgumentException("대상 사용자를 찾을 수 없습니다."));
        e.setAccessAllowed(approve);
        e.setRequestStatus(approve ? "APPROVED" : "REJECTED");
        e.setDecidedAt(LocalDateTime.now());
        e = permissionRepository.save(e);
        return PermissionDTO.entityToDto(e, ADMIN_NAME.equals(e.getName() != null ? e.getName().trim() : ""));
    }

    private void requireAdmin(UserDetails ud) {
        if (!isAdmin(ud)) throw new RuntimeException("관리자만 접근할 수 있습니다.");
    }
}
// [E] edit by smsong