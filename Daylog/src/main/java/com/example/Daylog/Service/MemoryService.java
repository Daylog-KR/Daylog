package com.example.Daylog.Service;

import com.example.Daylog.DTO.MemoryDTO;
import com.example.Daylog.Entity.MemoryEntity;
import com.example.Daylog.Entity.UserEntity;
import com.example.Daylog.Repository.MemoryRepository;
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
import java.util.LinkedHashMap;   // [B][E] edit by smsong - #34
import java.util.List;
import java.util.Map;             // [B][E] edit by smsong - #34
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class MemoryService {

    private final MemoryRepository memoryRepository;
    private final UserRepository userRepository;
    private final CommentService commentService;
    private final Storage storage;
    private final PermissionService permissionService; // [smsong] 권한 관리 연동
    private final RoomService roomService; // [smsong] 방(공유 공간) 멤버십 검사

    @Value("${google.cloud.credentials.header}")
    private String googleCloudHeader;
    @Value("${google.cloud.storage.bucket}")
    private String bucket;

    private UserEntity getAuthorizedUser(String uid, UserDetails userDetails) {
        if (userDetails == null || !userDetails.getUsername().equals(uid)) {
            throw new RuntimeException("권한이 없습니다");
        }
        return userRepository.findByUid(uid)
                .orElseThrow(() -> new IllegalArgumentException("사용자를 찾을 수 없습니다"));
    }

    // [B] edit by smsong - 권한은 PermissionService(DB·관리자 메뉴 관리) 기준으로 판정
    private static final int TRASH_RETENTION_DAYS = 30; // 휴지통 보관 후 자동 삭제 기준일
    private boolean isOwner(MemoryEntity m, UserDetails ud) {
        String ownerUid = (m.getOwner() != null) ? m.getOwner().getUid() : null;
        return ud != null && ownerUid != null && ownerUid.equals(ud.getUsername());
    }

    // [B] edit by smsong - #2 작성자(본인) 또는 방장(관리자)만 수정/휴지통/삭제 허용
    private void requireOwnerOrAdmin(MemoryEntity m, UserDetails ud, String action) {
        boolean admin = ud != null && m.getRoomId() != null
                && permissionService.isOwner(m.getRoomId(), ud.getUsername());
        // [B][E] edit by smsong - #36 '커플' 방이면 관리자/멤버는 작성자가 아니어도 관리할 수 있다.
        //  (일반 등급은 canManageAny 에서 걸러진다. 실제 수정/삭제 가능 여부는 requireCanEdit 등이 별도로 검사)
        boolean coupleManager = ud != null && m.getRoomId() != null
                && permissionService.canManageAny(ud.getUsername(), m.getRoomId());
        if (!isOwner(m, ud) && !admin && !coupleManager) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "본인이 작성한 게시글만 " + action + "할 수 있습니다");
        }
    }

    // GCS 업로드 로직 (BuildingService와 동일)
    private String uploadMedia(MultipartFile mediaFile) {
        if (mediaFile == null || mediaFile.isEmpty()) return null;
        try {
            UUID uuid = UUID.randomUUID();
            String original = mediaFile.getOriginalFilename();
            String ext = (original != null && original.contains(".")) ? original.substring(original.lastIndexOf(".")) : "";
            String fileName = uuid.toString() + ext;
            String contentType = "image/jpeg"; // 간략화

            BlobId blobId = BlobId.of(bucket, fileName);
            BlobInfo blobInfo = BlobInfo.newBuilder(blobId)
                    .setContentType(contentType)
                    .build();
            storage.create(blobInfo, mediaFile.getBytes());
            uploadThumbnailQuietly(mediaFile, fileName); // [smsong] 지도 마커/목록용 소형 썸네일 동시 생성
            return googleCloudHeader + fileName;
        } catch (IOException e) {
            throw new RuntimeException("업로드 실패", e);
        }
    }

    // [B] edit by smsong - 원본과 같은 이름 앞에 'thumb_' 를 붙인 소형 JPEG 썸네일 생성.
    //  프론트는 원본 URL 에서 'thumb_' 파생 URL 을 만들어 지도 마커/목록 썸네일에 사용(원본은 상세/라이트박스용).
    //  ※ 별도 DB 컬럼/DTO 필드 불필요. 실패(HEIC 등 디코드 불가) 시 조용히 skip → 프론트가 원본으로 폴백.
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

    // [B] edit by smsong - 기존 기록 썸네일 일괄 재생성.
    //  옛 기록은 thumb_ 가 없어 원본으로 폴백(느림/빈 마커) → 원본을 다시 읽어 EXIF 방향 반영 썸네일 생성/덮어쓰기.
    //  (옛 사진의 눕는 방향도 함께 교정됨) 관리자용 일회성 유지보수.
    public int regenerateThumbnails() {
        java.util.Set<String> urls = new java.util.LinkedHashSet<>();
        for (MemoryEntity m : memoryRepository.findAll()) {
            if (m.getMediaUrls() != null) urls.addAll(m.getMediaUrls());
            if (m.getMediaURL() != null) urls.add(m.getMediaURL());
        }
        return regenThumbsForUrls(urls);
    }

    // URL 집합의 thumb_ 를 원본에서 재생성 → 성공 개수 반환 (개별 실패는 건너뜀)
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
                if (thumb == null) continue; // 디코드 불가(HEIC 등)
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

    // 여러 파일 업로드 → URL 리스트(순서 유지)
    private List<String> uploadMediaList(List<MultipartFile> files) {
        List<String> urls = new ArrayList<>();
        if (files == null) return urls;
        for (MultipartFile f : files) {
            String u = uploadMedia(f);
            if (u != null) urls.add(u);
        }
        return urls;
    }

    // 정렬 토큰(order)으로 최종 이미지 순서 구성: "$NEW$"=업로드한 새 파일 순서대로, 그 외=유지할 기존 URL
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
    public MemoryDTO createMemory(String uid, Long roomId, MemoryDTO memoryDTO, List<MultipartFile> mediaFiles, UserDetails userDetails) {
        UserEntity owner = getAuthorizedUser(uid, userDetails);
        // [smsong] 방 멤버 + 생성 권한
        roomService.requireMember(uid, roomId);
        permissionService.requireCanCreate(uid, roomId);

        // 위치 데이터가 넘어오지 않은 경우 예외 처리
        if (memoryDTO.getLat() == null || memoryDTO.getLng() == null) {
            throw new IllegalArgumentException("위치 정보가 필수입니다.");
        }

        MemoryEntity memoryEntity = memoryDTO.dtoToEntity(owner);
        memoryEntity.setRoomId(roomId); // [smsong] 방 스코프

        List<String> uploaded = uploadMediaList(mediaFiles);
        List<String> finalUrls = buildOrderedUrls(memoryDTO.getMediaOrder(), uploaded);
        if (finalUrls.size() > MAX_IMAGES) {
            throw new IllegalArgumentException("이미지는 최대 " + MAX_IMAGES + "장까지 첨부할 수 있습니다.");
        }
        memoryEntity.setMediaUrls(finalUrls);
        memoryEntity.setMediaURL(finalUrls.isEmpty() ? null : finalUrls.get(0));

        // [B] edit by smsong - 최초 작성자 = 최초 수정자
        memoryEntity.setLastEditorUid(owner.getUid());
        // [E] edit by smsong
        MemoryEntity saved = memoryRepository.save(memoryEntity);
        return MemoryDTO.entityToDto(saved);
    }

    // [B] edit by smsong - #34 추억 표시 순서 일괄 저장.
    //  요청 본문: [{ "id": 12, "sortOrder": 0 }, { "id": 7, "sortOrder": 1 }, ...]
    //
    //  권한: 방 멤버 + 편집 권한(requireCanEdit)까지만 본다.
    //   · 순서는 '방 전체가 함께 보는 목록의 배치'라서, 게시글별 작성자 검사(requireOwnerOrAdmin)는 걸지 않는다.
    //     그걸 걸면 남이 올린 추억이 하나라도 섞인 날짜는 순서를 못 바꾸게 된다.
    //   · '일반' 등급(canEdit=false)은 requireCanEdit 에서 막힌다.
    //
    //  다른 방의 id 가 섞여 들어와도 findByIdInAndRoomId 가 걸러낸다.
    @Transactional
    public void updateOrder(String uid, Long roomId, List<Map<String, Object>> items, UserDetails userDetails) {
        getAuthorizedUser(uid, userDetails);
        roomService.requireMember(uid, roomId);
        permissionService.requireCanEdit(uid, roomId);
        if (items == null || items.isEmpty()) return;

        // id → sortOrder 로 정리 (잘못된 값은 건너뛴다)
        //  Jackson 이 JSON 숫자를 Integer/Long/Double 중 무엇으로 주든 동일하게 처리한다.
        Map<Long, Integer> wanted = new LinkedHashMap<>();
        for (Map<String, Object> it : items) {
            if (it == null || it.get("id") == null) continue;
            try {
                Object rawId = it.get("id");
                Long id = (rawId instanceof Number)
                        ? ((Number) rawId).longValue()
                        : Long.valueOf(String.valueOf(rawId).trim());

                Object so = it.get("sortOrder");
                Integer order;
                if (so == null || String.valueOf(so).isBlank()) {
                    order = null;                                   // null 로 보내면 '미지정'으로 되돌린다
                } else if (so instanceof Number) {
                    order = ((Number) so).intValue();
                } else {
                    order = Integer.valueOf(String.valueOf(so).trim());
                }
                wanted.put(id, order);
            } catch (NumberFormatException ignore) { }
        }
        if (wanted.isEmpty()) return;

        List<MemoryEntity> targets = memoryRepository.findByIdInAndRoomId(new ArrayList<>(wanted.keySet()), roomId);
        for (MemoryEntity m : targets) {
            m.setSortOrder(wanted.get(m.getId()));
        }
        memoryRepository.saveAll(targets);
    }
    // [E] edit by smsong

    @Transactional(readOnly = true)
    public List<MemoryDTO> getAllMemories(String uid, Long roomId, UserDetails userDetails) {
        roomService.requireMember(uid, roomId); // [smsong] 방 멤버만 조회
        permissionService.requireAccess(uid, roomId); // [smsong] 방 접근 권한(방장 승인) 필요
        return memoryRepository.findByRoomIdAndDeletedFalse(roomId).stream()
                .map(MemoryDTO::entityToDto)
                .collect(Collectors.toList());
    }

    // 본인 소유 추억 수정 (제목/내용/날짜 + 이미지 정렬/추가/삭제)
    @Transactional
    public MemoryDTO updateMemory(Long id, MemoryDTO memoryDTO, List<MultipartFile> mediaFiles, UserDetails userDetails) {
        MemoryEntity memory = memoryRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("추억을 찾을 수 없습니다"));

        // [smsong] 이 방의 멤버 + 수정 권한
        roomService.requireMember(userDetails.getUsername(), memory.getRoomId());
        requireOwnerOrAdmin(memory, userDetails, "수정"); // [B] #2
        permissionService.requireCanEdit(userDetails.getUsername(), memory.getRoomId());

        if (memoryDTO.getTitle() != null)   memory.setTitle(memoryDTO.getTitle());
        if (memoryDTO.getContent() != null) memory.setContent(memoryDTO.getContent());
        if (memoryDTO.getCreatedAt() != null) memory.setCreatedAt(memoryDTO.getCreatedAt());

        // [B] edit by smsong - 위치 수정 반영: lat/lng 이 함께 넘어온 경우에만 위치 갱신
        //  (프론트는 위치를 '실제로 변경'했을 때만 lat/lng/placeName/address 를 전송 → 일반 수정에는 영향 없음)
        if (memoryDTO.getLat() != null && memoryDTO.getLng() != null) {
            memory.setLat(memoryDTO.getLat());
            memory.setLng(memoryDTO.getLng());
            if (memoryDTO.getPlaceName() != null) memory.setPlaceName(memoryDTO.getPlaceName());
            if (memoryDTO.getAddress() != null)   memory.setAddress(memoryDTO.getAddress());
        }
        // [E] edit by smsong

        // 이미지: mediaOrder 가 오면 그 순서대로 재구성(기존 유지 + 새 파일 삽입), 없으면 변경하지 않음
        List<String> order = memoryDTO.getMediaOrder();
        List<String> uploaded = uploadMediaList(mediaFiles);
        if (order != null) {
            List<String> finalUrls = buildOrderedUrls(order, uploaded);
            if (finalUrls.size() > MAX_IMAGES) {
                throw new IllegalArgumentException("이미지는 최대 " + MAX_IMAGES + "장까지 첨부할 수 있습니다.");
            }
            memory.setMediaUrls(finalUrls);
            memory.setMediaURL(finalUrls.isEmpty() ? null : finalUrls.get(0));
        } else if (!uploaded.isEmpty()) {
            List<String> cur = (memory.getMediaUrls() != null) ? new ArrayList<>(memory.getMediaUrls()) : new ArrayList<>();
            cur.addAll(uploaded);
            if (cur.size() > MAX_IMAGES) {
                throw new IllegalArgumentException("이미지는 최대 " + MAX_IMAGES + "장까지 첨부할 수 있습니다.");
            }
            memory.setMediaUrls(cur);
            memory.setMediaURL(cur.isEmpty() ? null : cur.get(0));
        }

        // [B] edit by smsong - 마지막 수정 시각/수정자 기록
        memory.setUpdatedAt(java.time.LocalDateTime.now());
        memory.setLastEditorUid(userDetails.getUsername());
        // [E] edit by smsong
        return MemoryDTO.entityToDto(memoryRepository.save(memory));
    }

    // [B] edit by smsong - 추억 단순 조회 (권한 체크는 호출부에서)
    private MemoryEntity findMemory(Long id) {
        return memoryRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("추억을 찾을 수 없습니다"));
    }
    // [E] edit by smsong

    // 휴지통으로 이동 (소프트 삭제) — 소유자 또는 '휴지통 이동 권한'
    @Transactional
    public void moveToTrash(Long id, UserDetails userDetails) {
        MemoryEntity memory = findMemory(id);
        roomService.requireMember(userDetails.getUsername(), memory.getRoomId());
        requireOwnerOrAdmin(memory, userDetails, "휴지통으로 이동"); // [B] #2
        permissionService.requireCanTrash(userDetails.getUsername(), memory.getRoomId()); // [smsong] 휴지통 권한
        memory.setDeleted(true);
        memory.setTrashedAt(java.time.LocalDateTime.now()); // [smsong] 30일 자동삭제 기준 시각
        memoryRepository.save(memory);
    }

    // 휴지통에서 복원 — 소유자 또는 '휴지통 이동 권한'
    @Transactional
    public MemoryDTO restoreMemory(Long id, UserDetails userDetails) {
        MemoryEntity memory = findMemory(id);
        roomService.requireMember(userDetails.getUsername(), memory.getRoomId());
        requireOwnerOrAdmin(memory, userDetails, "복원"); // [B] #2
        permissionService.requireCanTrash(userDetails.getUsername(), memory.getRoomId()); // [smsong] 휴지통 권한
        memory.setDeleted(false);
        memory.setTrashedAt(null); // [smsong] 복원 시 자동삭제 타이머 해제
        return MemoryDTO.entityToDto(memoryRepository.save(memory));
    }

    // 영구 삭제 (연관 댓글 일괄 제거 포함) — 소유자 또는 '삭제 권한'
    @Transactional
    public void permanentDelete(Long id, UserDetails userDetails) {
        MemoryEntity memory = findMemory(id);
        roomService.requireMember(userDetails.getUsername(), memory.getRoomId());
        requireOwnerOrAdmin(memory, userDetails, "삭제"); // [B] #2
        permissionService.requireCanDelete(userDetails.getUsername(), memory.getRoomId()); // [smsong] 삭제 권한
        commentService.deleteAllByMemory(id);
        memoryRepository.delete(memory);
    }

    // 내가 휴지통으로 보낸 추억 목록 (조회 시 만료 항목 자동 삭제 + 남은 일수 계산)
    // [B] edit by smsong - 휴지통 30일 자동 삭제 + 오브젝트별 '며칠 뒤 자동 삭제' 계산
    @Transactional
    public List<MemoryDTO> getTrash(String uid, Long roomId, UserDetails userDetails) {
        UserEntity user = getAuthorizedUser(uid, userDetails);
        roomService.requireMember(uid, roomId);
        permissionService.requireAccess(uid, roomId); // [smsong] 방 접근 권한 필요
        java.time.LocalDateTime now = java.time.LocalDateTime.now();
        List<MemoryEntity> trashed = memoryRepository.findByOwnerUidAndRoomIdAndDeletedTrue(user.getUid(), roomId);

        List<MemoryDTO> result = new ArrayList<>();
        for (MemoryEntity m : trashed) {
            // 기존(휴지통 시각 미기록) 항목은 지금을 기준으로 타이머 시작
            if (m.getTrashedAt() == null) {
                m.setTrashedAt(now);
                memoryRepository.save(m);
            }
            java.time.LocalDateTime autoDeleteAt = m.getTrashedAt().plusDays(TRASH_RETENTION_DAYS);
            if (!autoDeleteAt.isAfter(now)) {
                // 보관 기간(30일) 경과 → 영구 삭제 (연관 댓글 포함)
                commentService.deleteAllByMemory(m.getId());
                memoryRepository.delete(m);
                continue;
            }
            long daysLeft = java.time.temporal.ChronoUnit.DAYS.between(now, autoDeleteAt);
            if (daysLeft < 0) daysLeft = 0;
            MemoryDTO dto = MemoryDTO.entityToDto(m);
            dto.setDaysUntilAutoDelete((int) daysLeft);
            result.add(dto);
        }
        return result;
    }

    // ===== [B] edit by smsong - #12 일괄 처리 (휴지통 선택 모드) =====
    //  권한 없는 항목이 섞여도 나머지는 처리하고 실패한 id 만 돌려준다.

    @Transactional
    public Map<String, Object> bulkTrash(List<Long> ids, UserDetails userDetails) {
        return bulkRun(ids, userDetails, "trash");
    }

    @Transactional
    public Map<String, Object> bulkDelete(List<Long> ids, UserDetails userDetails) {
        return bulkRun(ids, userDetails, "delete");
    }

    @Transactional
    public Map<String, Object> bulkRestore(List<Long> ids, UserDetails userDetails) {
        return bulkRun(ids, userDetails, "restore");
    }

    private Map<String, Object> bulkRun(List<Long> ids, UserDetails userDetails, String op) {
        int ok = 0;
        List<Long> failed = new ArrayList<>();
        if (ids != null) {
            for (Long id : ids) {
                try {
                    if ("trash".equals(op)) moveToTrash(id, userDetails);
                    else if ("delete".equals(op)) permanentDelete(id, userDetails);
                    else restoreMemory(id, userDetails);
                    ok++;
                } catch (Exception e) {
                    failed.add(id);
                }
            }
        }
        Map<String, Object> res = new java.util.HashMap<>();
        res.put("success", ok);
        res.put("failed", failed);
        return res;
    }
    // [E] edit by smsong

    // 스케줄러용: 보관 기간(30일) 경과한 휴지통 추억 일괄 영구 삭제
    @Transactional
    public int purgeExpiredTrash() {
        java.time.LocalDateTime cutoff = java.time.LocalDateTime.now().minusDays(TRASH_RETENTION_DAYS);
        List<MemoryEntity> expired = memoryRepository.findByDeletedTrueAndTrashedAtBefore(cutoff);
        for (MemoryEntity m : expired) {
            commentService.deleteAllByMemory(m.getId());
            memoryRepository.delete(m);
        }
        return expired.size();
    }
    // [E] edit by smsong
}