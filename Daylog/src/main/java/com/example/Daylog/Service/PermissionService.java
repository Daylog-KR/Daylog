package com.example.Daylog.Service;

import com.example.Daylog.DTO.PermissionDTO;
import com.example.Daylog.Entity.PermissionEntity;
import com.example.Daylog.Entity.RoomEntity;
import com.example.Daylog.Entity.RoomMemberEntity;
import com.example.Daylog.Entity.UserEntity;
import com.example.Daylog.Repository.PermissionRepository;
import com.example.Daylog.Repository.RoomMemberRepository;
import com.example.Daylog.Repository.RoomRepository;
import com.example.Daylog.Repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

// [smsong] 방별 사용자 권한 관리 서비스. 관리자 = 각 방의 방장(고정 uid 아님).
//  방장은 항상 전권. 그 외 멤버는 방장이 접근/CRUD 권한을 부여해야 사용 가능.
@Service
@RequiredArgsConstructor
public class PermissionService {

    private final PermissionRepository permissionRepository;
    private final UserRepository userRepository;
    private final RoomRepository roomRepository;
    private final RoomMemberRepository roomMemberRepository;

    // ===== 관리자(=방장) 판별 =====
    public boolean isOwner(Long roomId, String uid) {
        if (roomId == null || uid == null) return false;
        return roomRepository.findById(roomId).map(r -> uid.equals(r.getOwnerUid())).orElse(false);
    }
    private Optional<PermissionEntity> rowOf(Long roomId, String uid) {
        if (roomId == null || uid == null) return Optional.empty();
        return permissionRepository.findByRoomIdAndUid(roomId, uid);
    }

    // ===== 실효 권한 (Memory/Checklist에서 사용). 방장은 전권 =====
    public boolean hasAccess(String uid, Long roomId) { return isOwner(roomId, uid) || rowOf(roomId, uid).map(PermissionEntity::isAdminApproved).orElse(false); }
    public boolean canCreate(String uid, Long roomId) { return isOwner(roomId, uid) || rowOf(roomId, uid).map(PermissionEntity::isCanCreate).orElse(false); }
    public boolean canEdit(String uid, Long roomId)   { return isOwner(roomId, uid) || rowOf(roomId, uid).map(PermissionEntity::isCanEdit).orElse(false); }
    public boolean canTrash(String uid, Long roomId)  { return isOwner(roomId, uid) || rowOf(roomId, uid).map(PermissionEntity::isCanTrash).orElse(false); }
    public boolean canDelete(String uid, Long roomId) { return isOwner(roomId, uid) || rowOf(roomId, uid).map(PermissionEntity::isCanDelete).orElse(false); }

    public void requireAccess(String uid, Long roomId)   { if (!hasAccess(uid, roomId)) throw forbid("이 방에 대한 접근 권한이 없습니다"); }
    public void requireCanCreate(String uid, Long roomId){ if (!canCreate(uid, roomId)) throw forbid("생성 권한이 없습니다"); }
    public void requireCanEdit(String uid, Long roomId)  { if (!canEdit(uid, roomId))   throw forbid("수정 권한이 없습니다"); }
    public void requireCanTrash(String uid, Long roomId) { if (!canTrash(uid, roomId))  throw forbid("휴지통 권한이 없습니다"); }
    public void requireCanDelete(String uid, Long roomId){ if (!canDelete(uid, roomId)) throw forbid("삭제 권한이 없습니다"); }
    private ResponseStatusException forbid(String m) { return new ResponseStatusException(HttpStatus.FORBIDDEN, m); }

    private void syncSnapshot(PermissionEntity e, UserEntity u) {
        if (u == null) return;
        e.setName(u.getName()); e.setNickname(u.getNickname()); e.setEmail(u.getEmail());
        e.setProvider(u.getProvider()); e.setProfileURL(u.getProfileURL());
    }
    private PermissionEntity getOrCreate(Long roomId, String uid) {
        return permissionRepository.findByRoomIdAndUid(roomId, uid)
                .orElseGet(() -> PermissionEntity.builder().roomId(roomId).uid(uid).requestStatus("NONE").build());
    }

    // ===== 등록(upsert): 앱 진입 시 본인 실효권한 반환 + 접근 자가치유 =====
    @Transactional
    public PermissionDTO registerAndGetMine(String uid, Long roomId) {
        requireRoom(roomId);
        UserEntity user = userRepository.findByUid(uid).orElse(null);
        PermissionEntity e = getOrCreate(roomId, uid);
        syncSnapshot(e, user);
        boolean owner = isOwner(roomId, uid);
        boolean access = owner || e.isAdminApproved();
        e.setAccessAllowed(access);
        if (access && !"APPROVED".equals(e.getRequestStatus())) e.setRequestStatus("APPROVED");
        if (!access && "APPROVED".equals(e.getRequestStatus())) e.setRequestStatus("NONE");
        e = permissionRepository.save(e);
        return PermissionDTO.effective(e, owner, owner);
    }

    @Transactional(readOnly = true)
    public PermissionDTO getMine(String uid, Long roomId) {
        requireRoom(roomId);
        boolean owner = isOwner(roomId, uid);
        PermissionEntity e = getOrCreate(roomId, uid);
        return PermissionDTO.effective(e, owner, owner);
    }

    // ===== 접근 요청 (차단된 사용자도 호출) =====
    @Transactional
    public PermissionDTO requestAccess(String uid, Long roomId) {
        requireRoom(roomId);
        UserEntity user = userRepository.findByUid(uid).orElse(null);
        PermissionEntity e = getOrCreate(roomId, uid);
        syncSnapshot(e, user);
        boolean owner = isOwner(roomId, uid);
        if (!owner && !e.isAdminApproved()) { e.setRequestStatus("PENDING"); e.setRequestedAt(LocalDateTime.now()); }
        e = permissionRepository.save(e);
        return PermissionDTO.effective(e, owner, owner);
    }

    // ===== 방장: 방 멤버 목록(권한 포함). 멤버마다 행 보장 =====
    @Transactional
    public List<PermissionDTO> listAll(Long roomId, String requesterUid) {
        requireOwner(roomId, requesterUid);
        RoomEntity room = roomRepository.findById(roomId).orElseThrow(this::notFound);
        List<RoomMemberEntity> members = roomMemberRepository.findByRoomId(roomId);
        List<PermissionDTO> result = new ArrayList<>();
        for (RoomMemberEntity m : members) {
            boolean owner = m.getUid().equals(room.getOwnerUid());
            PermissionEntity e = getOrCreate(roomId, m.getUid());
            syncSnapshot(e, userRepository.findByUid(m.getUid()).orElse(null));
            if (owner) { e.setAccessAllowed(true); e.setAdminApproved(true); if (!"APPROVED".equals(e.getRequestStatus())) e.setRequestStatus("APPROVED"); }
            e = permissionRepository.save(e);
            result.add(PermissionDTO.raw(e, owner, owner));
        }
        result.sort((a, b) -> rank(a) - rank(b));
        return result;
    }
    private int rank(PermissionDTO x) {
        if (Boolean.TRUE.equals(x.getAdmin())) return 0;
        if ("PENDING".equals(x.getRequestStatus())) return 1;
        if (Boolean.TRUE.equals(x.getAccessAllowed())) return 2;
        return 3;
    }

    // [B] edit by smsong - 방장: 대기중(PENDING) 접근 요청만 조회 (방 진입 시 알림 폼용)
    //  전체 멤버 목록(listAll)보다 가볍고, 아직 결정되지 않은 요청만 반환.
    @Transactional(readOnly = true)
    public List<PermissionDTO> listPending(Long roomId, String requesterUid) {
        requireOwner(roomId, requesterUid);
        List<PermissionEntity> rows = permissionRepository.findByRoomIdAndRequestStatusOrderByRequestedAtAsc(roomId, "PENDING");
        List<PermissionDTO> result = new ArrayList<>();
        for (PermissionEntity e : rows) {
            if (isOwner(roomId, e.getUid())) continue; // 방장 본인은 제외(방어적)
            if (e.isAdminApproved()) continue;          // 이미 승인된 잔여 PENDING 방어
            result.add(PermissionDTO.raw(e, false, false));
        }
        return result;
    }
    // [E] edit by smsong

    // ===== 방장: 권한 변경 =====
    @Transactional
    public PermissionDTO updatePermission(Long roomId, String targetUid, PermissionDTO patch, String requesterUid) {
        requireOwner(roomId, requesterUid);
        PermissionEntity e = permissionRepository.findByRoomIdAndUid(roomId, targetUid)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "대상 사용자를 찾을 수 없습니다."));
        e.setCanCreate(Boolean.TRUE.equals(patch.getCanCreate()));
        e.setCanEdit(Boolean.TRUE.equals(patch.getCanEdit()));
        e.setCanTrash(Boolean.TRUE.equals(patch.getCanTrash()));
        e.setCanDelete(Boolean.TRUE.equals(patch.getCanDelete()));
        boolean approve = Boolean.TRUE.equals(patch.getAccessAllowed());
        e.setAdminApproved(approve); e.setAccessAllowed(approve);
        e.setRequestStatus(approve ? "APPROVED" : "REJECTED"); e.setDecidedAt(LocalDateTime.now());
        e = permissionRepository.save(e);
        boolean owner = isOwner(roomId, targetUid);
        return PermissionDTO.raw(e, owner, owner);
    }

    // ===== 방장: 접근 요청 승인/거절 =====
    @Transactional
    public PermissionDTO decideAccess(Long roomId, String targetUid, boolean approve, String requesterUid) {
        requireOwner(roomId, requesterUid);
        PermissionEntity e = permissionRepository.findByRoomIdAndUid(roomId, targetUid)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "대상 사용자를 찾을 수 없습니다."));
        e.setAdminApproved(approve); e.setAccessAllowed(approve);
        e.setRequestStatus(approve ? "APPROVED" : "REJECTED"); e.setDecidedAt(LocalDateTime.now());
        if (!approve) { e.setCanCreate(false); e.setCanEdit(false); e.setCanTrash(false); e.setCanDelete(false); }
        e = permissionRepository.save(e);
        boolean owner = isOwner(roomId, targetUid);
        return PermissionDTO.raw(e, owner, owner);
    }

    private void requireRoom(Long roomId) { if (roomId == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "방 정보(X-Room-Id)가 없습니다"); }
    private void requireOwner(Long roomId, String uid) { requireRoom(roomId); if (!isOwner(roomId, uid)) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "방장만 접근할 수 있습니다."); }
    private ResponseStatusException notFound() { return new ResponseStatusException(HttpStatus.NOT_FOUND, "방을 찾을 수 없습니다"); }
}
