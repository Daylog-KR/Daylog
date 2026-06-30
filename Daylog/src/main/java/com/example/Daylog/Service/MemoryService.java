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

    // [B] edit by smsong - 커플(송성민/강미르)은 소유자가 아니어도 모든 추억을 수정·휴지통 이동 가능
    private static final java.util.Set<String> PRIVILEGED_NICKNAMES = java.util.Set.of("송성민", "강미르");
    private boolean isPrivilegedEditor(UserDetails userDetails) {
        if (userDetails == null) return false;
        return userRepository.findByUid(userDetails.getUsername())
                .map(u -> u.getNickname() != null && PRIVILEGED_NICKNAMES.contains(u.getNickname().trim()))
                .orElse(false);
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
    public MemoryDTO createMemory(String uid, MemoryDTO memoryDTO, List<MultipartFile> mediaFiles, UserDetails userDetails) {
        UserEntity owner = getAuthorizedUser(uid, userDetails);

        // 위치 데이터가 넘어오지 않은 경우 예외 처리
        if (memoryDTO.getLat() == null || memoryDTO.getLng() == null) {
            throw new IllegalArgumentException("위치 정보가 필수입니다.");
        }

        MemoryEntity memoryEntity = memoryDTO.dtoToEntity(owner);

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
    public List<MemoryDTO> getAllMemories(String uid, UserDetails userDetails) {
        return memoryRepository.findByDeletedFalse().stream()
                .map(MemoryDTO::entityToDto)
                .collect(Collectors.toList());
    }

    // 본인 소유 추억 수정 (제목/내용/날짜 + 이미지 정렬/추가/삭제)
    @Transactional
    public MemoryDTO updateMemory(Long id, MemoryDTO memoryDTO, List<MultipartFile> mediaFiles, UserDetails userDetails) {
        MemoryEntity memory = memoryRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("추억을 찾을 수 없습니다"));

        // [B] edit by smsong - 소유자 또는 커플(송성민/강미르)이면 수정 가능
        String ownerUid = (memory.getOwner() != null) ? memory.getOwner().getUid() : null;
        boolean isOwner = (userDetails != null && ownerUid != null && ownerUid.equals(userDetails.getUsername()));
        if (!isOwner && !isPrivilegedEditor(userDetails)) {
            throw new RuntimeException("권한이 없습니다");
        }
        // [E] edit by smsong

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

    // 소유자 검증 후 추억 반환
    private MemoryEntity getOwnedMemory(Long id, UserDetails userDetails) {
        MemoryEntity memory = memoryRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("추억을 찾을 수 없습니다"));
        // [B] edit by smsong - 소유자 또는 커플(송성민/강미르)이면 휴지통 이동/복원/삭제 가능
        String ownerUid = (memory.getOwner() != null) ? memory.getOwner().getUid() : null;
        boolean isOwner = (userDetails != null && ownerUid != null && ownerUid.equals(userDetails.getUsername()));
        if (!isOwner && !isPrivilegedEditor(userDetails)) {
            throw new RuntimeException("권한이 없습니다");
        }
        // [E] edit by smsong
        return memory;
    }

    // 휴지통으로 이동 (소프트 삭제)
    @Transactional
    public void moveToTrash(Long id, UserDetails userDetails) {
        MemoryEntity memory = getOwnedMemory(id, userDetails);
        memory.setDeleted(true);
        memoryRepository.save(memory);
    }

    // 휴지통에서 복원
    @Transactional
    public MemoryDTO restoreMemory(Long id, UserDetails userDetails) {
        MemoryEntity memory = getOwnedMemory(id, userDetails);
        memory.setDeleted(false);
        return MemoryDTO.entityToDto(memoryRepository.save(memory));
    }

    // 영구 삭제 (연관 댓글 일괄 제거 포함)
    @Transactional
    public void permanentDelete(Long id, UserDetails userDetails) {
        MemoryEntity memory = getOwnedMemory(id, userDetails);
        commentService.deleteAllByMemory(id);
        memoryRepository.delete(memory);
    }

    // 내가 휴지통으로 보낸 추억 목록
    @Transactional(readOnly = true)
    public List<MemoryDTO> getTrash(String uid, UserDetails userDetails) {
        UserEntity user = getAuthorizedUser(uid, userDetails);
        return memoryRepository.findByOwnerUidAndDeletedTrue(user.getUid()).stream()
                .map(MemoryDTO::entityToDto)
                .collect(Collectors.toList());
    }
}