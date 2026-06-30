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

    // [B] edit by smsong - 커플(송성민/강미르)은 소유자가 아니어도 모든 가볼곳을 수정·휴지통 이동 가능
    private static final java.util.Set<String> PRIVILEGED_NICKNAMES = java.util.Set.of("송성민", "강미르");
    private boolean isPrivilegedEditor(UserDetails userDetails) {
        if (userDetails == null) return false;
        return userRepository.findByUid(userDetails.getUsername())
                .map(u -> u.getNickname() != null && PRIVILEGED_NICKNAMES.contains(u.getNickname().trim()))
                .orElse(false);
    }
    // [E] edit by smsong

    // 소유자 검증 후 체크리스트 반환
    private ChecklistEntity getOwnedChecklist(Long id, UserDetails userDetails) {
        ChecklistEntity c = checklistRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("가볼곳을 찾을 수 없습니다"));
        // [B] edit by smsong - 소유자 또는 커플(송성민/강미르)이면 수정/휴지통 이동/복원/삭제 가능
        String ownerUid = (c.getOwner() != null) ? c.getOwner().getUid() : null;
        boolean isOwner = (userDetails != null && ownerUid != null && ownerUid.equals(userDetails.getUsername()));
        if (!isOwner && !isPrivilegedEditor(userDetails)) {
            throw new RuntimeException("권한이 없습니다");
        }
        // [E] edit by smsong
        return c;
    }

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
    public ChecklistDTO createChecklist(String uid, ChecklistDTO dto, List<MultipartFile> mediaFiles, UserDetails userDetails) {
        UserEntity owner = getAuthorizedUser(uid, userDetails);

        if (dto.getLat() == null || dto.getLng() == null) {
            throw new IllegalArgumentException("위치 정보가 필수입니다.");
        }
        // 다녀오지 않았으면 다녀온 날짜는 무시
        if (!dto.isVisited()) {
            dto.setVisitedDate(null);
        }

        ChecklistEntity entity = dto.dtoToEntity(owner);

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
    public List<ChecklistDTO> getAllChecklists(String uid, UserDetails userDetails) {
        return checklistRepository.findByDeletedFalse().stream()
                .map(ChecklistDTO::entityToDto)
                .collect(Collectors.toList());
    }

    // 본인 소유 체크리스트 수정 (제목/내용/타입/방문여부/방문일 + 이미지 정렬/추가/삭제)
    @Transactional
    public ChecklistDTO updateChecklist(Long id, ChecklistDTO dto, List<MultipartFile> mediaFiles, UserDetails userDetails) {
        ChecklistEntity c = getOwnedChecklist(id, userDetails);

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
        ChecklistEntity c = getOwnedChecklist(id, userDetails);
        c.setDeleted(true);
        checklistRepository.save(c);
    }

    // 휴지통에서 복원 (소유자만)
    @Transactional
    public ChecklistDTO restoreChecklist(Long id, UserDetails userDetails) {
        ChecklistEntity c = getOwnedChecklist(id, userDetails);
        c.setDeleted(false);
        return ChecklistDTO.entityToDto(checklistRepository.save(c));
    }

    // 영구 삭제 (소유자만)
    @Transactional
    public void permanentDelete(Long id, UserDetails userDetails) {
        ChecklistEntity c = getOwnedChecklist(id, userDetails);
        checklistRepository.delete(c);
    }

    // 내가 휴지통으로 보낸 가볼곳 목록
    @Transactional(readOnly = true)
    public List<ChecklistDTO> getTrash(String uid, UserDetails userDetails) {
        UserEntity user = getAuthorizedUser(uid, userDetails);
        return checklistRepository.findByOwnerUidAndDeletedTrue(user.getUid()).stream()
                .map(ChecklistDTO::entityToDto)
                .collect(Collectors.toList());
    }
}
