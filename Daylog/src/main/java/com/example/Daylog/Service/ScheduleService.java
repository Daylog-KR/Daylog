package com.example.Daylog.Service;

import com.example.Daylog.DTO.ScheduleDTO;
import com.example.Daylog.Entity.ScheduleEntity;
import com.example.Daylog.Entity.UserEntity;
import com.example.Daylog.Repository.ScheduleRepository;
import com.example.Daylog.Repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

// [B] edit by smsong - #12 일정 서비스 (ChecklistService 와 동일한 권한/휴지통 규칙)
@Service
@RequiredArgsConstructor
public class ScheduleService {

    private final ScheduleRepository scheduleRepository;
    private final UserRepository userRepository;
    private final PermissionService permissionService;
    private final RoomService roomService;

    private static final int TRASH_RETENTION_DAYS = 30;

    private UserEntity getAuthorizedUser(String uid, UserDetails userDetails) {
        if (userDetails == null || !userDetails.getUsername().equals(uid)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "권한이 없습니다");
        }
        return userRepository.findByUid(uid)
                .orElseThrow(() -> new IllegalArgumentException("사용자를 찾을 수 없습니다"));
    }

    private ScheduleEntity find(Long id) {
        return scheduleRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("일정을 찾을 수 없습니다"));
    }

    private boolean isOwner(ScheduleEntity s, UserDetails ud) {
        String ownerUid = (s.getOwner() != null) ? s.getOwner().getUid() : null;
        return ud != null && ownerUid != null && ownerUid.equals(ud.getUsername());
    }

    /** 작성자 본인 또는 방장만 수정/삭제 */
    private void requireOwnerOrAdmin(ScheduleEntity s, UserDetails ud, String action) {
        boolean admin = ud != null && s.getRoomId() != null
                && permissionService.isOwner(s.getRoomId(), ud.getUsername());
        // [B][E] edit by smsong - #36 '커플' 방이면 관리자/멤버는 작성자가 아니어도 관리할 수 있다.
        //  (일반 등급은 canManageAny 에서 걸러진다. 실제 수정/삭제 가능 여부는 requireCanEdit 등이 별도로 검사)
        boolean coupleManager = ud != null && s.getRoomId() != null
                && permissionService.canManageAny(ud.getUsername(), s.getRoomId());
        if (!isOwner(s, ud) && !admin && !coupleManager) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "본인이 등록한 일정만 " + action + "할 수 있습니다");
        }
    }

    private ScheduleEntity getEditable(Long id, UserDetails userDetails) {
        ScheduleEntity s = find(id);
        roomService.requireMember(userDetails.getUsername(), s.getRoomId());
        requireOwnerOrAdmin(s, userDetails, "수정");
        permissionService.requireCanEdit(userDetails.getUsername(), s.getRoomId());
        return s;
    }

    // ===== 생성 =====
    @Transactional
    public ScheduleDTO create(String uid, Long roomId, ScheduleDTO dto, UserDetails userDetails) {
        UserEntity owner = getAuthorizedUser(uid, userDetails);
        roomService.requireMember(uid, roomId);
        permissionService.requireCanCreate(uid, roomId);

        if (dto.getScheduleDate() == null) {
            throw new IllegalArgumentException("일정 날짜는 필수입니다.");
        }
        if (dto.getTitle() == null || dto.getTitle().isBlank()) {
            throw new IllegalArgumentException("일정 제목은 필수입니다.");
        }

        ScheduleEntity e = dto.dtoToEntity(owner);
        e.setId(null);
        e.setRoomId(roomId);
        e.setDeleted(false);
        e.setLastEditorUid(owner.getUid());
        return ScheduleDTO.entityToDto(scheduleRepository.save(e));
    }

    // ===== 조회 =====
    @Transactional(readOnly = true)
    public List<ScheduleDTO> getAll(String uid, Long roomId, UserDetails userDetails) {
        roomService.requireMember(uid, roomId);
        permissionService.requireAccess(uid, roomId);
        return scheduleRepository.findByRoomIdAndDeletedFalseOrderByScheduleDateAsc(roomId).stream()
                .map(ScheduleDTO::entityToDto)
                .collect(Collectors.toList());
    }

    // ===== 수정 =====
    @Transactional
    public ScheduleDTO update(Long id, ScheduleDTO dto, UserDetails userDetails) {
        ScheduleEntity s = getEditable(id, userDetails);

        if (dto.getTitle() != null && !dto.getTitle().isBlank()) s.setTitle(dto.getTitle());
        if (dto.getContent() != null) s.setContent(dto.getContent());
        if (dto.getScheduleDate() != null) s.setScheduleDate(dto.getScheduleDate());
        boolean allDay = dto.isAllDayOrDefault();   // [B][E] #21 null 이면 종일로
        s.setAllDay(allDay);
        s.setStartTime(allDay ? null : dto.getStartTime());
        if (dto.getColor() != null) s.setColor(dto.getColor());
        // [B][E] edit by smsong - #27 알림 예약 (null 로 보내면 해제)
        s.setRemind1(dto.getRemind1());
        s.setRemind2(dto.getRemind2());

        s.setUpdatedAt(LocalDateTime.now());
        s.setLastEditorUid(userDetails.getUsername());
        return ScheduleDTO.entityToDto(scheduleRepository.save(s));
    }

    // ===== 휴지통 =====
    @Transactional
    public void moveToTrash(Long id, UserDetails userDetails) {
        ScheduleEntity s = find(id);
        roomService.requireMember(userDetails.getUsername(), s.getRoomId());
        requireOwnerOrAdmin(s, userDetails, "휴지통으로 이동");
        s.setDeleted(true);
        s.setTrashedAt(LocalDateTime.now());
        scheduleRepository.save(s);
    }

    @Transactional
    public ScheduleDTO restore(Long id, UserDetails userDetails) {
        ScheduleEntity s = find(id);
        roomService.requireMember(userDetails.getUsername(), s.getRoomId());
        requireOwnerOrAdmin(s, userDetails, "복원");
        s.setDeleted(false);
        s.setTrashedAt(null);
        return ScheduleDTO.entityToDto(scheduleRepository.save(s));
    }

    @Transactional
    public void permanentDelete(Long id, UserDetails userDetails) {
        ScheduleEntity s = find(id);
        roomService.requireMember(userDetails.getUsername(), s.getRoomId());
        requireOwnerOrAdmin(s, userDetails, "영구 삭제");
        scheduleRepository.delete(s);
    }

    @Transactional(readOnly = true)
    public List<ScheduleDTO> getTrash(String uid, Long roomId, UserDetails userDetails) {
        getAuthorizedUser(uid, userDetails);
        roomService.requireMember(uid, roomId);
        permissionService.requireAccess(uid, roomId);
        return scheduleRepository.findByOwnerUidAndRoomIdAndDeletedTrue(uid, roomId).stream()
                .map(e -> {
                    ScheduleDTO d = ScheduleDTO.entityToDto(e);
                    d.setDaysUntilAutoDelete(daysUntilAutoDelete(e.getTrashedAt()));
                    return d;
                })
                .collect(Collectors.toList());
    }

    private Integer daysUntilAutoDelete(LocalDateTime trashedAt) {
        if (trashedAt == null) return null;
        long passed = ChronoUnit.DAYS.between(trashedAt.toLocalDate(), LocalDateTime.now().toLocalDate());
        return (int) Math.max(0, TRASH_RETENTION_DAYS - passed);
    }

    // ===== 일괄 처리 =====
    //  실패한 건은 건너뛰고 결과만 돌려준다 (권한 없는 항목이 섞여도 나머지는 처리된다)

    @Transactional
    public Map<String, Object> bulkTrash(List<Long> ids, UserDetails userDetails) {
        return bulk(ids, userDetails, true);
    }

    @Transactional
    public Map<String, Object> bulkDelete(List<Long> ids, UserDetails userDetails) {
        return bulk(ids, userDetails, false);
    }

    private Map<String, Object> bulk(List<Long> ids, UserDetails userDetails, boolean toTrash) {
        int ok = 0;
        List<Long> failed = new ArrayList<>();
        if (ids != null) {
            for (Long id : ids) {
                try {
                    if (toTrash) moveToTrash(id, userDetails);
                    else permanentDelete(id, userDetails);
                    ok++;
                } catch (Exception e) {
                    failed.add(id);
                }
            }
        }
        Map<String, Object> res = new HashMap<>();
        res.put("success", ok);
        res.put("failed", failed);
        return res;
    }
}
// [E] edit by smsong
