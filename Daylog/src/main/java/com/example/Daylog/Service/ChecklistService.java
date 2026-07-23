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

    // [B] edit by smsong - #2 작성자(본인) 또는 방장(관리자)만 수정/휴지통/삭제 허용
    private void requireOwnerOrAdmin(ChecklistEntity c, UserDetails ud, String action) {
        boolean admin = ud != null && c.getRoomId() != null
                && permissionService.isOwner(c.getRoomId(), ud.getUsername());
        if (!isOwner(c, ud) && !admin) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "본인이 작성한 게시글만 " + action + "할 수 있습니다");
        }
    }

    private ChecklistEntity findChecklist(Long id) {
        return checklistRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("가볼곳을 찾을 수 없습니다"));
    }
    // 수정용: 소유자 또는 '수정 권한'
    private ChecklistEntity getEditableChecklist(Long id, UserDetails userDetails) {
        ChecklistEntity c = findChecklist(id);
        roomService.requireMember(userDetails.getUsername(), c.getRoomId());
        requireOwnerOrAdmin(c, userDetails, "수정"); // [B] #2
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
            uploadThumbnailQuietly(mediaFile, fileName); // [smsong] 목록/지도용 소형 썸네일 동시 생성
            return googleCloudHeader + fileName;
        } catch (IOException e) {
            throw new RuntimeException("업로드 실패", e);
        }
    }

    // [B] edit by smsong - 원본과 같은 이름 앞에 'thumb_' 를 붙인 소형 JPEG 썸네일 생성 (MemoryService 와 동일 패턴).
    //  별도 DB 컬럼/DTO 필드 불필요. 실패 시 조용히 skip → 프론트가 원본으로 폴백.
    private static final int THUMB_MAX = 400; // 썸네일 최대 변(px)
    private void uploadThumbnailQuietly(MultipartFile file, String baseFileName) {
        try {
            // [B] edit by smsong - ImageIO.read 는 EXIF 방향을 무시 → EXIF 반영 디코드로 세로사진 눕힘 방지
            java.awt.image.BufferedImage src = com.example.Daylog.Util.ImageUtil.decodeOriented(file.getBytes());
            if (src == null) return;
            int w = src.getWidth(), h = src.getHeight();
            if (w <= 0 || h <= 0) return;
            double scale = Math.min(1.0, (double) THUMB_MAX / Math.max(w, h));
            int tw = Math.max(1, (int) Math.round(w * scale));
            int th = Math.max(1, (int) Math.round(h * scale));
            java.awt.image.BufferedImage dst = new java.awt.image.BufferedImage(tw, th, java.awt.image.BufferedImage.TYPE_INT_RGB);
            java.awt.Graphics2D g = dst.createGraphics();
            g.setRenderingHint(java.awt.RenderingHints.KEY_INTERPOLATION, java.awt.RenderingHints.VALUE_INTERPOLATION_BILINEAR);
            g.setRenderingHint(java.awt.RenderingHints.KEY_RENDERING, java.awt.RenderingHints.VALUE_RENDER_QUALITY);
            g.drawImage(src, 0, 0, tw, th, null);
            g.dispose();
            java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
            javax.imageio.ImageIO.write(dst, "jpg", baos);
            BlobId thumbId = BlobId.of(bucket, "thumb_" + baseFileName);
            BlobInfo thumbInfo = BlobInfo.newBuilder(thumbId).setContentType("image/jpeg").build();
            storage.create(thumbInfo, baos.toByteArray());
        } catch (Exception e) {
            // 썸네일 실패는 치명적이지 않음 → 조용히 무시(원본으로 폴백)
        }
    }
    // [E] edit by smsong

    // [B] edit by smsong - 기존 가볼곳 썸네일 일괄 재생성 (옛 기록 thumb_ 생성 + 방향 교정). 관리자용 일회성.
    public int regenerateThumbnails() {
        java.util.Set<String> urls = new java.util.LinkedHashSet<>();
        for (ChecklistEntity c : checklistRepository.findAll()) {
            if (c.getMediaUrls() != null) urls.addAll(c.getMediaUrls());
            if (c.getMediaURL() != null) urls.add(c.getMediaURL());
        }
        return regenThumbsForUrls(urls);
    }

    private int regenThumbsForUrls(java.util.Collection<String> urls) {
        int ok = 0;
        for (String url : urls) {
            if (url == null || url.isEmpty()) continue;
            if (googleCloudHeader != null && !url.startsWith(googleCloudHeader)) continue;
            String fileName = (googleCloudHeader != null) ? url.substring(googleCloudHeader.length()) : url;
            if (fileName.isEmpty() || fileName.startsWith("thumb_")) continue;
            try {
                byte[] original = storage.readAllBytes(BlobId.of(bucket, fileName));
                byte[] thumb = com.example.Daylog.Util.ImageUtil.buildThumbnailJpeg(original, THUMB_MAX);
                if (thumb == null) continue;
                BlobId thumbId = BlobId.of(bucket, "thumb_" + fileName);
                BlobInfo thumbInfo = BlobInfo.newBuilder(thumbId).setContentType("image/jpeg").build();
                storage.create(thumbInfo, thumb);
                ok++;
            } catch (Exception e) {
                // 개별 실패 무시
            }
        }
        return ok;
    }
    // [E] edit by smsong

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
        entity.setArchived(false); // [B][E] edit by smsong - #12

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
        // [B] edit by smsong - #12 보관함(archived) 항목은 일반 화면에 노출하지 않는다
        return checklistRepository.findByRoomIdAndDeletedFalseAndArchivedFalse(roomId).stream()
                .map(ChecklistDTO::entityToDto)
                .collect(Collectors.toList());
        // [E] edit by smsong
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
        // [B] edit by smsong - #12 갈 예정일 (달력 표시용). null 로 보내면 해제된다.
        c.setPlannedDate(dto.getPlannedDate());
        // [E] edit by smsong

        // [B] edit by smsong - 위치 수정 반영: lat/lng 이 함께 넘어온 경우에만 위치 갱신
        //  (프론트는 위치를 '실제로 변경'했을 때만 lat/lng/placeName/address 를 전송 → 일반 수정에는 영향 없음)
        if (dto.getLat() != null && dto.getLng() != null) {
            c.setLat(dto.getLat());
            c.setLng(dto.getLng());
            if (dto.getPlaceName() != null) c.setPlaceName(dto.getPlaceName());
            if (dto.getAddress() != null)   c.setAddress(dto.getAddress());
        }
        // [E] edit by smsong

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
        requireOwnerOrAdmin(c, userDetails, "휴지통으로 이동"); // [B] #2
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
        requireOwnerOrAdmin(c, userDetails, "복원"); // [B] #2
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
        requireOwnerOrAdmin(c, userDetails, "삭제"); // [B] #2
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

    // ===================================================================
    // [B] edit by smsong - #12 보관함
    //  '다녀왔습니다' → 추억 생성 후 원본 체크리스트를 휴지통이 아니라 여기로 옮긴다.
    //  · 보관함 항목은 getAllChecklists 에서 제외되어 지도/목록에 뜨지 않는다.
    //  · 보관함 → 휴지통 이동은 moveToTrash 를 그대로 쓴다(archived 는 유지되지만
    //    deleted=true 가 되어 보관함 목록에서도 빠진다).
    // ===================================================================

    /** 보관함으로 이동 */
    @Transactional
    public ChecklistDTO archive(Long id, UserDetails userDetails) {
        ChecklistEntity c = findChecklist(id);
        roomService.requireMember(userDetails.getUsername(), c.getRoomId());
        requireOwnerOrAdmin(c, userDetails, "보관");
        c.setArchived(true);
        c.setArchivedAt(java.time.LocalDateTime.now());
        c.setDeleted(false);
        c.setTrashedAt(null);
        return ChecklistDTO.entityToDto(checklistRepository.save(c));
    }

    /** 보관 해제 — 다시 일반 목록으로 */
    @Transactional
    public ChecklistDTO unarchive(Long id, UserDetails userDetails) {
        ChecklistEntity c = findChecklist(id);
        roomService.requireMember(userDetails.getUsername(), c.getRoomId());
        requireOwnerOrAdmin(c, userDetails, "보관 해제");
        c.setArchived(false);
        c.setArchivedAt(null);
        return ChecklistDTO.entityToDto(checklistRepository.save(c));
    }

    /**
     * 달력용 조회 — 휴지통(deleted)만 제외하고 보관함(archived)은 포함한다.
     *  · 지도/목록에서는 보관함이 빠지지만, 달력에는 '다녀온 기록'으로 남아야 하기 때문.
     *  · 그래서 달력에서 완전히 사라지는 시점은 '영구 삭제' 뿐이다.
     *    (프론트는 영구 삭제 전에 "달력에서도 사라집니다" 확인창을 띄운다)
     */
    @Transactional(readOnly = true)
    public List<ChecklistDTO> getForCalendar(String uid, Long roomId, UserDetails userDetails) {
        roomService.requireMember(uid, roomId);
        permissionService.requireAccess(uid, roomId);
        return checklistRepository.findByRoomIdAndDeletedFalse(roomId).stream()
                .map(ChecklistDTO::entityToDto)
                .collect(Collectors.toList());
    }

    /** 보관함 목록 (방 전체 공유 — 작성자 제한 없음) */
    @Transactional(readOnly = true)
    public List<ChecklistDTO> getArchived(String uid, Long roomId, UserDetails userDetails) {
        roomService.requireMember(uid, roomId);
        permissionService.requireAccess(uid, roomId);
        return checklistRepository
                .findByRoomIdAndArchivedTrueAndDeletedFalseOrderByVisitedDateDesc(roomId).stream()
                .map(ChecklistDTO::entityToDto)
                .collect(Collectors.toList());
    }

    // ===== 일괄 처리 (보관함/휴지통 선택 모드) =====
    //  권한이 없는 항목이 섞여도 나머지는 처리하고, 실패한 id 만 돌려준다.

    @Transactional
    public java.util.Map<String, Object> bulkTrash(List<Long> ids, UserDetails userDetails) {
        return bulkRun(ids, userDetails, "trash");
    }

    @Transactional
    public java.util.Map<String, Object> bulkDelete(List<Long> ids, UserDetails userDetails) {
        return bulkRun(ids, userDetails, "delete");
    }

    @Transactional
    public java.util.Map<String, Object> bulkRestore(List<Long> ids, UserDetails userDetails) {
        return bulkRun(ids, userDetails, "restore");
    }

    private java.util.Map<String, Object> bulkRun(List<Long> ids, UserDetails userDetails, String op) {
        int ok = 0;
        List<Long> failed = new ArrayList<>();
        if (ids != null) {
            for (Long id : ids) {
                try {
                    if ("trash".equals(op)) moveToTrash(id, userDetails);
                    else if ("delete".equals(op)) permanentDelete(id, userDetails);
                    else restoreChecklist(id, userDetails);
                    ok++;
                } catch (Exception e) {
                    failed.add(id);
                }
            }
        }
        java.util.Map<String, Object> res = new java.util.HashMap<>();
        res.put("success", ok);
        res.put("failed", failed);
        return res;
    }
    // [E] edit by smsong

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
