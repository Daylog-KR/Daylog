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

// [B] edit by smsong - 사용자 권한 관리 서비스 (UserEntity 외래키 연결 · 생성/수정/휴지통/삭제 권한)
//  관리자: name '송성민' (무조건 모든 권한 + 접근)
//  부트스트랩(상시 허용 + 모든 권한): 송성민 / 강미르 — 그 외에는 관리자가 승인/부여해야 함
//  접근 판정은 저장된 accessAllowed 가 아니라 'adminApproved(관리자 명시 승인)' 기준으로 자가치유
@Service
@RequiredArgsConstructor
public class PermissionService {

    private final PermissionRepository permissionRepository;
    private final UserRepository userRepository;

    public static final String ADMIN_NAME = "송성민";
    private static final Set<String> BOOTSTRAP = Set.of("송성민", "강미르");

    // ===== 이름/판별 =====
    private String nameOf(UserDetails ud) {
        if (ud == null) return null;
        return userRepository.findByUid(ud.getUsername()).map(UserEntity::getName).orElse(null);
    }
    private boolean isAdminName(String name) { return name != null && ADMIN_NAME.equals(name.trim()); }
    private boolean isBootstrap(String name) { return name != null && BOOTSTRAP.contains(name.trim()); }
    private boolean privileged(String name) { return isAdminName(name) || isBootstrap(name); }

    public boolean isAdmin(UserDetails ud) { return isAdminName(nameOf(ud)); }

    private Optional<PermissionEntity> rowOf(UserDetails ud) {
        if (ud == null) return Optional.empty();
        return permissionRepository.findByUid(ud.getUsername());
    }

    // ===== 실효 권한 판정 (Memory/Checklist 서비스에서 사용) =====
    public boolean hasAccess(UserDetails ud) {
        String n = nameOf(ud);
        if (privileged(n)) return true;
        return rowOf(ud).map(PermissionEntity::isAdminApproved).orElse(false);
    }
    public boolean canCreate(UserDetails ud) {
        String n = nameOf(ud);
        if (privileged(n)) return true;
        return rowOf(ud).map(PermissionEntity::isCanCreate).orElse(false);
    }
    public boolean canEdit(UserDetails ud) {
        String n = nameOf(ud);
        if (privileged(n)) return true;
        return rowOf(ud).map(PermissionEntity::isCanEdit).orElse(false);
    }
    public boolean canTrash(UserDetails ud) {
        String n = nameOf(ud);
        if (privileged(n)) return true;
        return rowOf(ud).map(PermissionEntity::isCanTrash).orElse(false);
    }
    public boolean canDelete(UserDetails ud) {
        String n = nameOf(ud);
        if (privileged(n)) return true;
        return rowOf(ud).map(PermissionEntity::isCanDelete).orElse(false);
    }

    private void syncSnapshot(PermissionEntity e, UserEntity user) {
        if (user == null) return;
        e.setUser(user);                 // 외래키 연결
        e.setName(user.getName());
        e.setNickname(user.getNickname());
        e.setEmail(user.getEmail());
        e.setProvider(user.getProvider());
        e.setProfileURL(user.getProfileURL());
    }

    // ===== 등록(upsert): 로그인 사용자를 권한 목록에 올리고 본인(실효)권한 반환 + 접근 자가치유 =====
    @Transactional
    public PermissionDTO registerAndGetMine(UserDetails ud) {
        if (ud == null) throw new RuntimeException("권한이 없습니다");
        String uid = ud.getUsername();
        UserEntity user = userRepository.findByUid(uid).orElse(null);
        PermissionEntity e = permissionRepository.findByUid(uid)
                .orElseGet(() -> PermissionEntity.builder().uid(uid).requestStatus("NONE").build());
        syncSnapshot(e, user);

        String name = (user != null) ? user.getName() : null;
        boolean admin = isAdminName(name);
        boolean priv = privileged(name);

        // 접근 실효값 = 관리자 || 부트스트랩 || 관리자 명시 승인
        boolean access = priv || e.isAdminApproved();
        e.setAccessAllowed(access);                     // 저장값을 실효값으로 자가치유
        if (access && !"APPROVED".equals(e.getRequestStatus())) e.setRequestStatus("APPROVED");
        if (!access && "APPROVED".equals(e.getRequestStatus())) e.setRequestStatus("NONE"); // 예전 부트스트랩 잔재 정리

        e = permissionRepository.save(e);
        return PermissionDTO.effective(e, admin, priv);
    }

    @Transactional(readOnly = true)
    public PermissionDTO getMine(UserDetails ud) {
        if (ud == null) throw new RuntimeException("권한이 없습니다");
        String name = nameOf(ud);
        boolean admin = isAdminName(name);
        boolean priv = privileged(name);
        PermissionEntity e = permissionRepository.findByUid(ud.getUsername())
                .orElseGet(() -> PermissionEntity.builder().uid(ud.getUsername()).requestStatus("NONE").build());
        return PermissionDTO.effective(e, admin, priv);
    }

    // ===== 접근 요청 (차단된 사용자도 호출 가능) =====
    @Transactional
    public PermissionDTO requestAccess(UserDetails ud) {
        if (ud == null) throw new RuntimeException("권한이 없습니다");
        String uid = ud.getUsername();
        UserEntity user = userRepository.findByUid(uid).orElse(null);
        PermissionEntity e = permissionRepository.findByUid(uid)
                .orElseGet(() -> PermissionEntity.builder().uid(uid).build());
        syncSnapshot(e, user);
        String name = (user != null) ? user.getName() : null;
        boolean priv = privileged(name);
        if (!priv && !e.isAdminApproved()) {
            e.setRequestStatus("PENDING");
            e.setRequestedAt(LocalDateTime.now());
        }
        e = permissionRepository.save(e);
        return PermissionDTO.effective(e, isAdminName(name), priv);
    }

    // ===== 관리자: 전체 사용자 목록 (원본 플래그) =====
    @Transactional(readOnly = true)
    public List<PermissionDTO> listAll(UserDetails ud) {
        requireAdmin(ud);
        return permissionRepository.findAllByOrderByAccessAllowedDescUpdatedAtDesc().stream()
                .map(e -> PermissionDTO.raw(e, isAdminName(e.getName()), isBootstrap(e.getName())))
                .collect(Collectors.toList());
    }

    // ===== 관리자: 특정 사용자 권한 변경 (생성/수정/휴지통/삭제) =====
    @Transactional
    public PermissionDTO updatePermission(String targetUid, PermissionDTO patch, UserDetails ud) {
        requireAdmin(ud);
        PermissionEntity e = permissionRepository.findByUid(targetUid)
                .orElseThrow(() -> new IllegalArgumentException("대상 사용자를 찾을 수 없습니다."));
        e.setCanCreate(patch.isCanCreate());
        e.setCanEdit(patch.isCanEdit());
        e.setCanTrash(patch.isCanTrash());
        e.setCanDelete(patch.isCanDelete());
        // 접근 허용 여부 반영 (관리자 명시 승인)
        boolean approve = patch.isAccessAllowed();
        e.setAdminApproved(approve);
        e.setAccessAllowed(approve);
        e.setRequestStatus(approve ? "APPROVED" : "REJECTED");
        e.setDecidedAt(LocalDateTime.now());
        e = permissionRepository.save(e);
        return PermissionDTO.raw(e, isAdminName(e.getName()), isBootstrap(e.getName()));
    }

    // ===== 관리자: 접근 요청 승인/거절 =====
    @Transactional
    public PermissionDTO decideAccess(String targetUid, boolean approve, UserDetails ud) {
        requireAdmin(ud);
        PermissionEntity e = permissionRepository.findByUid(targetUid)
                .orElseThrow(() -> new IllegalArgumentException("대상 사용자를 찾을 수 없습니다."));
        e.setAdminApproved(approve);
        e.setAccessAllowed(approve);
        e.setRequestStatus(approve ? "APPROVED" : "REJECTED");
        e.setDecidedAt(LocalDateTime.now());
        if (!approve) { // 거절 시 세부 권한도 회수
            e.setCanCreate(false); e.setCanEdit(false); e.setCanTrash(false); e.setCanDelete(false);
        }
        e = permissionRepository.save(e);
        return PermissionDTO.raw(e, isAdminName(e.getName()), isBootstrap(e.getName()));
    }

    private void requireAdmin(UserDetails ud) {
        if (!isAdmin(ud)) throw new RuntimeException("관리자만 접근할 수 있습니다.");
    }
}
// [E] edit by smsong
