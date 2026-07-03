package com.example.Daylog.Service;

import com.example.Daylog.DTO.ChecklistDTO;
import com.example.Daylog.Entity.ChecklistEntity;
import com.example.Daylog.Entity.UserEntity;
import com.example.Daylog.Repository.ChecklistRepository;
import com.example.Daylog.Repository.UserRepository;
import com.google.cloud.storage.BlobId;
import com.google.cloud.storage.BlobInfo;
import com.google.cloud.storage.Storage;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class ChecklistService {

    private final ChecklistRepository checklistRepository;
    private final UserRepository userRepository;
    private final Storage storage;
    private final PermissionService permissionService; // [smsong] 권한 관리 연동
    private final CommentService commentService; // [smsong] 가볼곳 영구삭제 시 댓글 정리
    private final RoomService roomService; // [smsong] 방(공유 공간) 멤버십 검사

    @Value("${google.cloud.credentials.header}")
    private String googleCloudHeader;
    @Value("${google.cloud.storage.bucket}")
    private String bucket;

    // 토큰의 사용자와 요청 uid 가 일치하는지 확인 (MemoryService 동일)
    private UserEntity getAuthorizedUser(String uid, UserDetails userDetails) {
        if (userDetails == null || !userDetails.getUsername().equals(uid)) {
            throw new RuntimeException("권한이 없습니다");
        }
        return userRepository.findByUid(uid)
                .orElseThrow(() -> new IllegalArgumentException("사용자를 찾을 수 없습니다"));
    }

    // [B] edit by smsong - 권한은 PermissionService(DB·관리자 메뉴 관리) 기준으로 판정
    private static final int TRASH_RETENTION_DAYS = 30; // 휴지통 보관 후 자동 삭제 기준일
    private boolean isOwner(ChecklistEntity c, UserDetails ud) {
        String ownerUid = (c.getOwner() != null) ? c.getOwner().getUid() : null;
        return ud != null && ownerUid != null && ownerUid.equals(ud.getUsername());
    }

    private ChecklistEntity findChecklist(Long id) {
        return checklistRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("가볼곳을 찾을 수 없습니다"));
    }
    // 수정용: 소유자 또는 '수정 권한'
    private ChecklistEntity getEditableChecklist(Long id, UserDetails userDetails) {
        ChecklistEntity c = findChecklist(id);
        roomService.requireMember(userDetails.getUsername(), c.getRoomId());
        permissionService.requireCanEdit(userDetails.getUsername(), c.getRoomId()); // [smsong] 수정 권한
        return c;
    }
    // [E] edit by smsong

    // GCS 업로드 (선택 — 이미지 없으면 null)
    private String uploadMedia(MultipartFile mediaFile) {
        if (mediaFile == null || mediaFile.isEmpty()) return null;
        try {
            UUID uuid = UUID.randomUUID();
            String original = mediaFile.getOriginalFilename();
            String ext = (original != null && original.contains(".")) ? original.substring(original.lastIndexOf(".")) : "";
            String fileName = uuid.toString() + ext;

            BlobId blobId = BlobId.of(bucket, fileName);
            BlobInfo blobInfo = BlobInfo.newBuilder(blobId)
                    .setContentType("image/jpeg")
                    .build();
            storage.create(blobInfo, mediaFile.getBytes());
            return googleCloudHeader + fileName;
        } catch (IOException e) {
            throw new RuntimeException("업로드 실패", e);
        }
    }

    private static final int MAX_IMAGES = 10;

    private List<String> uploadMediaList(List<MultipartFile> files) {
        List<String> urls = new ArrayList<>();
        if (files == null) return urls;
        for (MultipartFile f : files) {
            String u = uploadMedia(f);
            if (u != null) urls.add(u);
        }
        return urls;
    }

    private List<String> buildOrderedUrls(List<String> order, List<String> uploaded) {
        List<String> result = new ArrayList<>();
        if (order == null || order.isEmpty()) {
            result.addAll(uploaded);
            return result;
        }
        int ni = 0;
        for (String token : order) {
            if (token == null) continue;
            if ("$NEW$".equals(token)) {
                if (ni < uploaded.size()) result.add(uploaded.get(ni++));
            } else {
                result.add(token);
            }
        }
        while (ni < uploaded.size()) result.add(uploaded.get(ni++));
        return result;
    }

    @Transactional
    public ChecklistDTO createChecklist(String uid, Long roomId, ChecklistDTO dto, List<MultipartFile> mediaFiles, UserDetails userDetails) {
        UserEntity owner = getAuthorizedUser(uid, userDetails);
        // [smsong] 방 멤버 + 생성 권한
        roomService.requireMember(uid, roomId);
        permissionService.requireCanCreate(uid, roomId);

        if (dto.getLat() == null || dto.getLng() == null) {
            throw new IllegalArgumentException("위치 정보가 필수입니다.");
        }
        // 다녀오지 않았으면 다녀온 날짜는 무시
        if (!dto.isVisited()) {
            dto.setVisitedDate(null);
        }

        ChecklistEntity entity = dto.dtoToEntity(owner);
        entity.setRoomId(roomId); // [smsong] 방 스코프

        List<String> uploaded = uploadMediaList(mediaFiles);
        List<String> finalUrls = buildOrderedUrls(dto.getMediaOrder(), uploaded);
        if (finalUrls.size() > MAX_IMAGES) {
            throw new IllegalArgumentException("이미지는 최대 " + MAX_IMAGES + "장까지 첨부할 수 있습니다.");
        }
        entity.setMediaUrls(finalUrls);
        entity.setMediaURL(finalUrls.isEmpty() ? null : finalUrls.get(0));

        // [B] edit by smsong - 최초 작성자 = 최초 수정자
        entity.setLastEditorUid(owner.getUid());
        // [E] edit by smsong
        ChecklistEntity saved = checklistRepository.save(entity);
        return ChecklistDTO.entityToDto(saved);
    }

    // 지도/목록 노출용 — 휴지통에 없는 가볼곳 조회 (커플 공유)
    @Transactional(readOnly = true)
    public List<ChecklistDTO> getAllChecklists(String uid, Long roomId, UserDetails userDetails) {
        roomService.requireMember(uid, roomId); // [smsong] 방 멤버만 조회
        permissionService.requireAccess(uid, roomId); // [smsong] 방 접근 권한 필요
        return checklistRepository.findByRoomIdAndDeletedFalse(roomId).stream()
                .map(ChecklistDTO::entityToDto)
                .collect(Collectors.toList());
    }

    // 본인 소유 체크리스트 수정 (제목/내용/타입/방문여부/방문일 + 이미지 정렬/추가/삭제)
    @Transactional
    public ChecklistDTO updateChecklist(Long id, ChecklistDTO dto, List<MultipartFile> mediaFiles, UserDetails userDetails) {
        ChecklistEntity c = getEditableChecklist(id, userDetails); // [smsong] 수정은 소유자 또는 커플

        if (dto.getTitle() != null)   c.setTitle(dto.getTitle());
        if (dto.getContent() != null) c.setContent(dto.getContent());
        if (dto.getType() != null)    c.setType(dto.getType());
        c.setVisited(dto.isVisited());
        c.setVisitedDate(dto.isVisited() ? dto.getVisitedDate() : null);

        // 이미지: mediaOrder 가 오면 그 순서대로 재구성, 없으면 새 파일만 뒤에 추가(없으면 변경 없음)
        List<String> order = dto.getMediaOrder();
        List<String> uploaded = uploadMediaList(mediaFiles);
        if (order != null) {
            List<String> finalUrls = buildOrderedUrls(order, uploaded);
            if (finalUrls.size() > MAX_IMAGES) {
                throw new IllegalArgumentException("이미지는 최대 " + MAX_IMAGES + "장까지 첨부할 수 있습니다.");
            }
            c.setMediaUrls(finalUrls);
            c.setMediaURL(finalUrls.isEmpty() ? null : finalUrls.get(0));
        } else if (!uploaded.isEmpty()) {
            List<String> cur = (c.getMediaUrls() != null) ? new ArrayList<>(c.getMediaUrls()) : new ArrayList<>();
            cur.addAll(uploaded);
            if (cur.size() > MAX_IMAGES) {
                throw new IllegalArgumentException("이미지는 최대 " + MAX_IMAGES + "장까지 첨부할 수 있습니다.");
            }
            c.setMediaUrls(cur);
            c.setMediaURL(cur.isEmpty() ? null : cur.get(0));
        }

        // [B] edit by smsong - 마지막 수정 시각/수정자 기록
        c.setUpdatedAt(java.time.LocalDateTime.now());
        c.setLastEditorUid(userDetails.getUsername());
        // [E] edit by smsong
        return ChecklistDTO.entityToDto(checklistRepository.save(c));
    }

    // 휴지통으로 이동 (소프트 삭제 · 소유자만)
    @Transactional
    public void moveToTrash(Long id, UserDetails userDetails) {
        ChecklistEntity c = findChecklist(id);
        roomService.requireMember(userDetails.getUsername(), c.getRoomId());
        permissionService.requireCanTrash(userDetails.getUsername(), c.getRoomId()); // [smsong] 휴지통 권한
        c.setDeleted(true);
        c.setTrashedAt(java.time.LocalDateTime.now()); // [smsong] 30일 자동삭제 기준 시각
        checklistRepository.save(c);
    }

    // 휴지통에서 복원 (소유자만)
    @Transactional
    public ChecklistDTO restoreChecklist(Long id, UserDetails userDetails) {
        ChecklistEntity c = findChecklist(id);
        roomService.requireMember(userDetails.getUsername(), c.getRoomId());
        permissionService.requireCanTrash(userDetails.getUsername(), c.getRoomId()); // [smsong] 휴지통 권한
        c.setDeleted(false);
        c.setTrashedAt(null); // [smsong] 복원 시 자동삭제 타이머 해제
        return ChecklistDTO.entityToDto(checklistRepository.save(c));
    }

    // 영구 삭제 (소유자만)
    @Transactional
    public void permanentDelete(Long id, UserDetails userDetails) {
        ChecklistEntity c = findChecklist(id);
        roomService.requireMember(userDetails.getUsername(), c.getRoomId());
        permissionService.requireCanDelete(userDetails.getUsername(), c.getRoomId()); // [smsong] 삭제 권한
        commentService.deleteAllByChecklist(id); // [smsong] 연관 댓글 정리
        checklistRepository.delete(c);
    }

    // 내가 휴지통으로 보낸 가볼곳 목록 (조회 시 만료 항목 자동 삭제 + 남은 일수 계산)
    // [B] edit by smsong - 휴지통 30일 자동 삭제 + 오브젝트별 '며칠 뒤 자동 삭제' 계산
    @Transactional
    public List<ChecklistDTO> getTrash(String uid, Long roomId, UserDetails userDetails) {
        UserEntity user = getAuthorizedUser(uid, userDetails);
        roomService.requireMember(uid, roomId);
        permissionService.requireAccess(uid, roomId); // [smsong] 방 접근 권한 필요
        java.time.LocalDateTime now = java.time.LocalDateTime.now();
        List<ChecklistEntity> trashed = checklistRepository.findByOwnerUidAndRoomIdAndDeletedTrue(user.getUid(), roomId);

        List<ChecklistDTO> result = new ArrayList<>();
        for (ChecklistEntity c : trashed) {
            if (c.getTrashedAt() == null) {
                c.setTrashedAt(now);
                checklistRepository.save(c);
            }
            java.time.LocalDateTime autoDeleteAt = c.getTrashedAt().plusDays(TRASH_RETENTION_DAYS);
            if (!autoDeleteAt.isAfter(now)) {
                commentService.deleteAllByChecklist(c.getId()); // [smsong] 연관 댓글 정리
                checklistRepository.delete(c); // 30일 경과 → 영구 삭제
                continue;
            }
            long daysLeft = java.time.temporal.ChronoUnit.DAYS.between(now, autoDeleteAt);
            if (daysLeft < 0) daysLeft = 0;
            ChecklistDTO dto = ChecklistDTO.entityToDto(c);
            dto.setDaysUntilAutoDelete((int) daysLeft);
            result.add(dto);
        }
        return result;
    }

    // 스케줄러용: 보관 기간(30일) 경과한 휴지통 가볼곳 일괄 영구 삭제
    @Transactional
    public int purgeExpiredTrash() {
        java.time.LocalDateTime cutoff = java.time.LocalDateTime.now().minusDays(TRASH_RETENTION_DAYS);
        List<ChecklistEntity> expired = checklistRepository.findByDeletedTrueAndTrashedAtBefore(cutoff);
        for (ChecklistEntity ex : expired) commentService.deleteAllByChecklist(ex.getId()); // [smsong] 연관 댓글 정리
        checklistRepository.deleteAll(expired);
        return expired.size();
    }
    // [E] edit by smsong
}
