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
    private final WebPushService webPushService; // [B] edit by smsong - 입장요청/입장수락 푸시알림

    // ===== 관리자(=방장) 판별 =====
    public boolean isOwner(Long roomId, String uid) {
        if (roomId == null || uid == null) return false;
        return roomRepository.findById(roomId).map(r -> uid.equals(r.getOwnerUid())).orElse(false);
    }
    private Optional<PermissionEntity> rowOf(Long roomId, String uid) {
        if (roomId == null || uid == null) return Optional.empty();
        return permissionRepository.findByRoomIdAndUid(roomId, uid);
    }
    // [B] edit by smsong - 현재 방의 실제 구성원인지 확인 (강퇴/탈퇴 후 잔여 권한행으로 통과되는 것 차단)
    private boolean isMember(Long roomId, String uid) {
        if (roomId == null || uid == null) return false;
        return roomMemberRepository.existsByRoomIdAndUid(roomId, uid);
    }
    // [E] edit by smsong

    // ===== 실효 권한 (Memory/Checklist에서 사용). 방장은 전권 =====
    // [B] edit by smsong - 방장이 아니면 '현재 멤버 + adminApproved' 둘 다 만족해야 통과 (강퇴자 즉시 차단)
    public boolean hasAccess(String uid, Long roomId) { return isOwner(roomId, uid) || (isMember(roomId, uid) && rowOf(roomId, uid).map(PermissionEntity::isAdminApproved).orElse(false)); }
    public boolean canCreate(String uid, Long roomId) { return isOwner(roomId, uid) || (isMember(roomId, uid) && rowOf(roomId, uid).map(PermissionEntity::isCanCreate).orElse(false)); }
    public boolean canEdit(String uid, Long roomId)   { return isOwner(roomId, uid) || (isMember(roomId, uid) && rowOf(roomId, uid).map(PermissionEntity::isCanEdit).orElse(false)); }
    public boolean canTrash(String uid, Long roomId)  { return isOwner(roomId, uid) || (isMember(roomId, uid) && rowOf(roomId, uid).map(PermissionEntity::isCanTrash).orElse(false)); }
    public boolean canDelete(String uid, Long roomId) { return isOwner(roomId, uid) || (isMember(roomId, uid) && rowOf(roomId, uid).map(PermissionEntity::isCanDelete).orElse(false)); }
    // [E] edit by smsong

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
        // [B] edit by smsong - 방장이 아니면 '현재 멤버'여야 접근 허용. 강퇴 후 잔여 adminApproved 로 자동 통과 방지.
        boolean access = owner || (isMember(roomId, uid) && e.isAdminApproved());
        // [E] edit by smsong
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
        if (!owner && !e.isAdminApproved()) {
            e.setRequestStatus("PENDING");
            e.setRequestedAt(LocalDateTime.now());
            // [B] edit by smsong - 재요청 시 이전 거절/강퇴 흔적 초기화 (요청 대기중으로 되돌림)
            e.setRejectReason(null);
            e.setRejectSeen(false);
            e.setKicked(false);
            // [E] edit by smsong
        }
        e = permissionRepository.save(e);
        // [B] edit by smsong - 입장 요청이 대기(PENDING)로 생성되면 방장에게 푸시알림
        if (!owner && "PENDING".equals(e.getRequestStatus())) {
            try { notifyJoinRequest(roomId, uid); } catch (Exception ignore) {}
        }
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
    //  [B] edit by smsong - 승인 시 비로소 방 멤버로 등록(코드 입장은 이제 '요청'만 생성).
    //   거절 시 거절 사유를 저장하고 멤버십을 제거(요청만 있던 유저는 멤버가 아니라 no-op).
    @Transactional
    public PermissionDTO decideAccess(Long roomId, String targetUid, boolean approve, String requesterUid, String reason) {
        requireOwner(roomId, requesterUid);
        PermissionEntity e = permissionRepository.findByRoomIdAndUid(roomId, targetUid)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "대상 사용자를 찾을 수 없습니다."));
        e.setAdminApproved(approve); e.setAccessAllowed(approve);
        e.setRequestStatus(approve ? "APPROVED" : "REJECTED"); e.setDecidedAt(LocalDateTime.now());
        if (approve) {
            // 승인: 아직 멤버가 아니면 지금 멤버로 등록 → '내가 속한 방'에 노출
            if (!roomMemberRepository.existsByRoomIdAndUid(roomId, targetUid)) {
                roomMemberRepository.save(RoomMemberEntity.builder().roomId(roomId).uid(targetUid).build());
            }
            e.setRejectReason(null); e.setRejectSeen(false); e.setKicked(false);
            e.setAcceptSeen(false); // [B] edit by smsong - 수락됨: rooms 최초 진입 시 1회 안내 대상으로 표시
        } else {
            // 거절: 권한 전부 회수 + 멤버십 제거 + 거절 사유 저장(유저에게 1회 안내)
            e.setCanCreate(false); e.setCanEdit(false); e.setCanTrash(false); e.setCanDelete(false);
            e.setRejectReason((reason == null || reason.trim().isEmpty()) ? null : reason.trim());
            e.setRejectSeen(false);
            roomMemberRepository.deleteByRoomIdAndUid(roomId, targetUid);
        }
        e = permissionRepository.save(e);
        // [B] edit by smsong - 입장 수락 시 방의 모든 멤버(새 멤버 포함)에게 푸시알림
        if (approve) {
            try { notifyRoomAccepted(roomId, targetUid); } catch (Exception ignore) {}
        }
        boolean owner = isOwner(roomId, targetUid);
        return PermissionDTO.raw(e, owner, owner);
    }

    // [B] edit by smsong - 입장 요청 시 방장에게 알림
    private void notifyJoinRequest(Long roomId, String requesterUid) {
        RoomEntity room = roomRepository.findById(roomId).orElse(null);
        if (room == null || room.getOwnerUid() == null || room.getOwnerUid().equals(requesterUid)) return;
        String name = pushName(requesterUid);
        webPushService.sendToUid(room.getOwnerUid(),
                name + "님이 입장을 요청했어요",
                "'" + safeName(room.getName()) + "' 방 · 요청을 확인해보세요", "/rooms.html");
    }

    // [B] edit by smsong - 입장 수락 시 방 전체 멤버에게 알림
    private void notifyRoomAccepted(Long roomId, String newUid) {
        RoomEntity room = roomRepository.findById(roomId).orElse(null);
        if (room == null) return;
        List<String> uids = new ArrayList<>();
        for (RoomMemberEntity m : roomMemberRepository.findByRoomId(roomId)) {
            if (m.getUid() != null) uids.add(m.getUid());
        }
        if (uids.isEmpty()) return;
        String name = pushName(newUid);
        webPushService.sendToUids(uids,
                name + "님이 방에 입장했어요",
                "'" + safeName(room.getName()) + "' 방에 새 멤버가 합류했어요", "/rooms.html");
    }

    private String pushName(String uid) {
        UserEntity u = (uid == null) ? null : userRepository.findByUid(uid).orElse(null);
        if (u != null) {
            if (u.getNickname() != null && !u.getNickname().isBlank()) return u.getNickname();
            if (u.getName() != null && !u.getName().isBlank()) return u.getName();
        }
        return "누군가";
    }

    private String safeName(String s) { return (s == null || s.isBlank()) ? "우리" : s; }

    // [B] edit by smsong - 승인된 멤버: 환영/이용수칙 폼을 봤음을 기록 (최초 1회 표시 후 호출)
    @Transactional
    public void markWelcomeSeen(String uid, Long roomId) {
        requireRoom(roomId);
        permissionRepository.findByRoomIdAndUid(roomId, uid).ifPresent(e -> {
            if (!e.isWelcomeSeen()) { e.setWelcomeSeen(true); permissionRepository.save(e); }
        });
    }

    // [B] edit by smsong - 수락 안내 대상 여부: 권한행의 acceptSeen 반환(행 없으면 true=안내 없음).
    //  rooms '내가 속한 방' 목록 DTO 에 실어 최초 1회 '입장 수락됨' 안내를 판단한다.
    @Transactional(readOnly = true)
    public boolean getAcceptSeen(Long roomId, String uid) {
        return permissionRepository.findByRoomIdAndUid(roomId, uid)
                .map(PermissionEntity::isAcceptSeen)
                .orElse(true);
    }

    // [B] edit by smsong - 수락 안내를 봤음을 기록 (rooms 페이지 1회 안내 후 호출)
    @Transactional
    public void markAcceptSeen(String uid, Long roomId) {
        requireRoom(roomId);
        permissionRepository.findByRoomIdAndUid(roomId, uid).ifPresent(e -> {
            if (!e.isAcceptSeen()) { e.setAcceptSeen(true); permissionRepository.save(e); }
        });
    }

    // [B] edit by smsong - 거절 안내를 봤음을 기록 (rooms 페이지 1회 안내 후 호출)
    @Transactional
    public void markRejectSeen(String uid, Long roomId) {
        requireRoom(roomId);
        permissionRepository.findByRoomIdAndUid(roomId, uid).ifPresent(e -> {
            if ("REJECTED".equals(e.getRequestStatus()) && !e.isRejectSeen()) {
                e.setRejectSeen(true);
                permissionRepository.save(e);
            }
        });
    }

    // [B] edit by smsong - 거절된 방을 '요청 대기중인 방' 목록에서 제거(X). 권한행 자체를 삭제한다.
    //  (멤버가 아니므로 안전. 다시 코드 입력하면 새로 요청 가능)
    @Transactional
    public void dismissRequest(String uid, Long roomId) {
        requireRoom(roomId);
        permissionRepository.findByRoomIdAndUid(roomId, uid).ifPresent(e -> {
            if (isOwner(roomId, uid)) return;                 // 방장 본인 행은 건드리지 않음(방어)
            if (isMember(roomId, uid)) return;                // 이미 멤버면 삭제 금지(방어)
            permissionRepository.delete(e);
        });
    }

    // [B] edit by smsong - '요청 대기중인 방' 탭용: 내가 요청/거절된 권한행(멤버 아님 전제)
    @Transactional(readOnly = true)
    public List<PermissionEntity> listMyRequestRows(String uid) {
        if (uid == null) return new ArrayList<>();
        return permissionRepository.findByUidAndRequestStatusInOrderByRequestedAtDesc(
                uid, List.of("PENDING", "REJECTED"));
    }

    // [B] edit by smsong - 미리보기용: 특정 방에 대한 내 권한행 조회
    @Transactional(readOnly = true)
    public Optional<PermissionEntity> findRow(Long roomId, String uid) {
        return rowOf(roomId, uid);
    }
    // [E] edit by smsong

    // [B] edit by smsong - 멤버 강퇴 시 호출: 권한 회수 + 거절 사유(=강퇴 사유) 저장.
    //  거절(decideAccess reject)과 동일하게 requestStatus=REJECTED + rejectReason + rejectSeen=false 로 두되,
    //  kicked=true 로 표시해 rooms 진입 시 '내보내짐' 문구의 안내 폼을 1회 띄운다.
    //  → RoomService.kickMember 에서 호출(자발적 탈퇴 leaveRoom 은 revokeMembership 를 그대로 사용).
    @Transactional
    public void kickMembership(Long roomId, String uid, String reason) {
        permissionRepository.findByRoomIdAndUid(roomId, uid).ifPresent(e -> {
            e.setAdminApproved(false);
            e.setAccessAllowed(false);
            e.setCanCreate(false);
            e.setCanEdit(false);
            e.setCanTrash(false);
            e.setCanDelete(false);
            e.setRequestStatus("REJECTED");
            e.setDecidedAt(LocalDateTime.now());
            e.setRejectReason((reason == null || reason.trim().isEmpty()) ? null : reason.trim());
            e.setRejectSeen(false);
            e.setKicked(true);
            // 재승인되어 다시 입장하면 환영/이용수칙 동의 화면을 처음부터 다시 보게 됨.
            e.setWelcomeSeen(false);
            permissionRepository.save(e);
        });
    }
    // [E] edit by smsong

    // [B] edit by smsong - 멤버 자발적 탈퇴 시 호출: 권한행 초기화 → 재입장해도 방장 승인부터 다시.
    //  RoomService.leaveRoom 에서 호출.
    @Transactional
    public void revokeMembership(Long roomId, String uid) {
        permissionRepository.findByRoomIdAndUid(roomId, uid).ifPresent(e -> {
            e.setAdminApproved(false);
            e.setAccessAllowed(false);
            e.setCanCreate(false);
            e.setCanEdit(false);
            e.setCanTrash(false);
            e.setCanDelete(false);
            e.setRequestStatus("NONE");
            e.setRequestedAt(null);
            e.setDecidedAt(LocalDateTime.now());
            // [B] edit by smsong - 강퇴/탈퇴 시 환영·동의 화면 표시 이력 초기화.
            //  → 재승인되어 다시 입장하면 환영/이용수칙 동의 화면을 처음부터 다시 보게 됨.
            e.setWelcomeSeen(false);
            // [E] edit by smsong
            permissionRepository.save(e);
        });
    }

    // 방 삭제 시: 해당 방의 모든 권한행 정리 (고아 행 방지)
    @Transactional
    public void purgeRoom(Long roomId) {
        if (roomId == null) return;
        permissionRepository.deleteByRoomId(roomId);
    }
    // [E] edit by smsong

    private void requireRoom(Long roomId) { if (roomId == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "방 정보(X-Room-Id)가 없습니다"); }
    private void requireOwner(Long roomId, String uid) { requireRoom(roomId); if (!isOwner(roomId, uid)) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "방장만 접근할 수 있습니다."); }
    private ResponseStatusException notFound() { return new ResponseStatusException(HttpStatus.NOT_FOUND, "방을 찾을 수 없습니다"); }
}
