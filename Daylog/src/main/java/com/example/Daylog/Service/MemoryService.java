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

    @Transactional
    public MemoryDTO createMemory(String uid, MemoryDTO memoryDTO, MultipartFile mediaFile, UserDetails userDetails) {
        UserEntity owner = getAuthorizedUser(uid, userDetails);

        // 위치 데이터가 넘어오지 않은 경우 예외 처리
        if(memoryDTO.getLat() == null || memoryDTO.getLng() == null) {
            throw new IllegalArgumentException("위치 정보가 필수입니다.");
        }

        MemoryEntity memoryEntity = memoryDTO.dtoToEntity(owner);
        String mediaURL = uploadMedia(mediaFile);
        if (mediaURL != null) memoryEntity.setMediaURL(mediaURL);

        MemoryEntity saved = memoryRepository.save(memoryEntity);
        return MemoryDTO.entityToDto(saved);
    }

    @Transactional(readOnly = true)
    public List<MemoryDTO> getAllMemories(String uid, UserDetails userDetails) {
        return memoryRepository.findByDeletedFalse().stream()
                .map(MemoryDTO::entityToDto)
                .collect(Collectors.toList());
    }

    // 본인 소유 추억의 제목/내용/날짜만 수정 (이미지는 변경하지 않음)
    @Transactional
    public MemoryDTO updateMemory(Long id, MemoryDTO memoryDTO, UserDetails userDetails) {
        MemoryEntity memory = memoryRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("추억을 찾을 수 없습니다"));

        // 소유자 검증 — 로그인한 본인이 작성한 추억만 수정 가능
        String ownerUid = (memory.getOwner() != null) ? memory.getOwner().getUid() : null;
        if (userDetails == null || ownerUid == null || !ownerUid.equals(userDetails.getUsername())) {
            throw new RuntimeException("권한이 없습니다");
        }

        // 이미지(mediaURL)와 위치(lat/lng)는 변경하지 않음
        if (memoryDTO.getTitle() != null)   memory.setTitle(memoryDTO.getTitle());
        if (memoryDTO.getContent() != null) memory.setContent(memoryDTO.getContent());
        if (memoryDTO.getCreatedAt() != null) memory.setCreatedAt(memoryDTO.getCreatedAt());

        return MemoryDTO.entityToDto(memoryRepository.save(memory));
    }

    // 소유자 검증 후 추억 반환
    private MemoryEntity getOwnedMemory(Long id, UserDetails userDetails) {
        MemoryEntity memory = memoryRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("추억을 찾을 수 없습니다"));
        String ownerUid = (memory.getOwner() != null) ? memory.getOwner().getUid() : null;
        if (userDetails == null || ownerUid == null || !ownerUid.equals(userDetails.getUsername())) {
            throw new RuntimeException("권한이 없습니다");
        }
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