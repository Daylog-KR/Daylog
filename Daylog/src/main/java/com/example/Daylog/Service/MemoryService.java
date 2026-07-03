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
import java.util.List;
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
    // [smsong] 서비스 접근 권한 검사 (관리자/부트스트랩/관리자승인 외 전부 403 차단)
    private void requireAccess(UserDetails ud) {
        if (!permissionService.hasAccess(ud)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "서비스 접근 권한이 없습니다");
        }
    }
    // [E] edit by smsong

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
            return googleCloudHeader + fileName;
        } catch (IOException e) {
            throw new RuntimeException("업로드 실패", e);
        }
    }

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
        // [smsong] 방 멤버만 생성 가능
        roomService.requireMember(uid, roomId);

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

    @Transactional(readOnly = true)
    public List<MemoryDTO> getAllMemories(String uid, Long roomId, UserDetails userDetails) {
        roomService.requireMember(uid, roomId); // [smsong] 방 멤버만 조회
        return memoryRepository.findByRoomIdAndDeletedFalse(roomId).stream()
                .map(MemoryDTO::entityToDto)
                .collect(Collectors.toList());
    }

    // 본인 소유 추억 수정 (제목/내용/날짜 + 이미지 정렬/추가/삭제)
    @Transactional
    public MemoryDTO updateMemory(Long id, MemoryDTO memoryDTO, List<MultipartFile> mediaFiles, UserDetails userDetails) {
        MemoryEntity memory = memoryRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("추억을 찾을 수 없습니다"));

        // [smsong] 이 콘텐츠가 속한 방의 멤버만 수정 가능
        roomService.requireMember(userDetails.getUsername(), memory.getRoomId());

        if (memoryDTO.getTitle() != null)   memory.setTitle(memoryDTO.getTitle());
        if (memoryDTO.getContent() != null) memory.setContent(memoryDTO.getContent());
        if (memoryDTO.getCreatedAt() != null) memory.setCreatedAt(memoryDTO.getCreatedAt());

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
        roomService.requireMember(userDetails.getUsername(), memory.getRoomId()); // [smsong] 방 멤버만
        memory.setDeleted(true);
        memory.setTrashedAt(java.time.LocalDateTime.now()); // [smsong] 30일 자동삭제 기준 시각
        memoryRepository.save(memory);
    }

    // 휴지통에서 복원 — 소유자 또는 '휴지통 이동 권한'
    @Transactional
    public MemoryDTO restoreMemory(Long id, UserDetails userDetails) {
        MemoryEntity memory = findMemory(id);
        roomService.requireMember(userDetails.getUsername(), memory.getRoomId()); // [smsong] 방 멤버만
        memory.setDeleted(false);
        memory.setTrashedAt(null); // [smsong] 복원 시 자동삭제 타이머 해제
        return MemoryDTO.entityToDto(memoryRepository.save(memory));
    }

    // 영구 삭제 (연관 댓글 일괄 제거 포함) — 소유자 또는 '삭제 권한'
    @Transactional
    public void permanentDelete(Long id, UserDetails userDetails) {
        MemoryEntity memory = findMemory(id);
        roomService.requireMember(userDetails.getUsername(), memory.getRoomId()); // [smsong] 방 멤버만
        commentService.deleteAllByMemory(id);
        memoryRepository.delete(memory);
    }

    // 내가 휴지통으로 보낸 추억 목록 (조회 시 만료 항목 자동 삭제 + 남은 일수 계산)
    // [B] edit by smsong - 휴지통 30일 자동 삭제 + 오브젝트별 '며칠 뒤 자동 삭제' 계산
    @Transactional
    public List<MemoryDTO> getTrash(String uid, Long roomId, UserDetails userDetails) {
        UserEntity user = getAuthorizedUser(uid, userDetails);
        roomService.requireMember(uid, roomId); // [smsong] 방 멤버만
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