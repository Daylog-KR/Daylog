package com.example.Daylog.Service;

import com.example.Daylog.DTO.RoomDTO;
import com.example.Daylog.Entity.RoomEntity;
import com.example.Daylog.Entity.RoomMemberEntity;
import com.example.Daylog.Entity.UserEntity;
import com.example.Daylog.Repository.RoomMemberRepository;
import com.example.Daylog.Repository.RoomRepository;
import com.example.Daylog.Repository.UserRepository;
import com.google.cloud.storage.BlobId;
import com.google.cloud.storage.BlobInfo;
import com.google.cloud.storage.Storage;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

// [smsong] 방 생성/입장/삭제/조회 + 멤버십 검사
@Service
@RequiredArgsConstructor
public class RoomService {

    private final RoomRepository roomRepository;
    private final RoomMemberRepository roomMemberRepository;
    private final UserRepository userRepository;
    private final Storage storage; // [smsong] 방 대표 이미지 GCS 업로드

    // [smsong] GCS 설정 (MemoryService/ChecklistService 와 동일 프로퍼티)
    @Value("${google.cloud.storage.bucket}")
    private String bucket;
    @Value("${google.cloud.credentials.header}")
    private String googleCloudHeader;

    // 헷갈리는 문자(0/O/1/I) 제외한 초대 코드용 알파벳
    private static final String CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static final int CODE_LEN = 6;
    private final SecureRandom random = new SecureRandom();

    // ===== 멤버십 ======
    public boolean isMember(String uid, Long roomId) {
        if (uid == null || roomId == null) return false;
        return roomMemberRepository.existsByRoomIdAndUid(roomId, uid);
    }

    // 멤버가 아니면 403 — Memory/Checklist 서비스에서 방 스코프 강제용
    public RoomEntity requireMember(String uid, Long roomId) {
        if (roomId == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "방 정보(X-Room-Id)가 없습니다");
        }
        RoomEntity room = roomRepository.findById(roomId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "방을 찾을 수 없습니다"));
        if (!isMember(uid, roomId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "이 방의 멤버가 아닙니다");
        }
        return room;
    }

    // ===== 코드 생성 =====
    private String generateUniqueCode() {
        for (int attempt = 0; attempt < 50; attempt++) {
            StringBuilder sb = new StringBuilder(CODE_LEN);
            for (int i = 0; i < CODE_LEN; i++) {
                sb.append(CODE_ALPHABET.charAt(random.nextInt(CODE_ALPHABET.length())));
            }
            String code = sb.toString();
            if (!roomRepository.existsByInviteCode(code)) return code;
        }
        throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "초대 코드 생성 실패");
    }

    // ===== 생성 =====
    private static final java.util.Set<String> VALID_TYPES = java.util.Set.of("COUPLE", "FRIEND", "FAMILY");

    @Transactional
    public RoomDTO createRoom(String uid, String name, String type, String coupleSince) {
        String roomName = (name == null || name.trim().isEmpty()) ? "새로운 방" : name.trim();
        String t = (type == null) ? "COUPLE" : type.trim().toUpperCase();
        if (!VALID_TYPES.contains(t)) t = "FRIEND";
        RoomEntity.RoomEntityBuilder b = RoomEntity.builder()
                .name(roomName)
                .ownerUid(uid)
                .inviteCode(generateUniqueCode())
                .type(t);
        if ("COUPLE".equals(t)) {
            // 커플 방: 생성자를 기본 '나'로, 디데이 기준일 저장
            b.coupleLeftUid(uid);
            if (coupleSince != null && !coupleSince.trim().isEmpty()) b.coupleSince(coupleSince.trim());
        }
        RoomEntity room = roomRepository.save(b.build());
        // 방장 자동 가입
        roomMemberRepository.save(RoomMemberEntity.builder().roomId(room.getId()).uid(uid).build());
        return RoomDTO.from(room, uid, roomMemberRepository.countByRoomId(room.getId()));
    }

    // ===== 방 이름 수정 (방장만) =====
    @Transactional
    public RoomDTO renameRoom(Long roomId, String ownerUid, String name) {
        RoomEntity room = roomRepository.findById(roomId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "방을 찾을 수 없습니다"));
        if (!room.getOwnerUid().equals(ownerUid)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "방장만 이름을 수정할 수 있습니다");
        }
        if (name == null || name.trim().isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "방 이름을 입력하세요");
        }
        room.setName(name.trim());
        roomRepository.save(room);
        return RoomDTO.from(room, ownerUid, roomMemberRepository.countByRoomId(room.getId()));
    }

    // ===== 디데이(만난 날짜) 설정 (방장만) =====
    @Transactional
    public RoomDTO setDday(Long roomId, String ownerUid, String since) {
        RoomEntity room = roomRepository.findById(roomId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "방을 찾을 수 없습니다"));
        if (!room.getOwnerUid().equals(ownerUid)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "방장만 설정할 수 있습니다");
        }
        room.setCoupleSince((since == null || since.trim().isEmpty()) ? null : since.trim());
        roomRepository.save(room);
        return getRoomWithMembers(roomId, ownerUid);
    }

    // ===== 코드로 입장 =====
    @Transactional
    public RoomDTO joinByCode(String uid, String code) {
        if (code == null || code.trim().isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "초대 코드를 입력하세요");
        }
        String norm = code.trim().toUpperCase();
        RoomEntity room = roomRepository.findByInviteCode(norm)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "유효하지 않은 초대 코드입니다"));
        if (!roomMemberRepository.existsByRoomIdAndUid(room.getId(), uid)) {
            roomMemberRepository.save(RoomMemberEntity.builder().roomId(room.getId()).uid(uid).build());
        }
        return RoomDTO.from(room, uid, roomMemberRepository.countByRoomId(room.getId()));
    }

    // ===== 삭제 (방장만) — 멤버십 제거 + 방 삭제. 방 내부 콘텐츠는 별도 정리(오퍼레이션 문서 참고) =====
    @Transactional
    public void deleteRoom(Long roomId, String uid) {
        RoomEntity room = roomRepository.findById(roomId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "방을 찾을 수 없습니다"));
        if (!room.getOwnerUid().equals(uid)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "방장만 삭제할 수 있습니다");
        }
        String imageUrl = room.getImageUrl(); // [smsong] 삭제 전 대표 이미지 URL 확보
        roomMemberRepository.deleteByRoomId(roomId);
        roomRepository.delete(room);
        deleteMediaQuietly(imageUrl); // [smsong] 방 삭제 시 대표 이미지(원본+썸네일) GCS 정리
    }

    // ===== 방 나가기 (멤버 스스로 탈퇴, 방장은 불가 → 삭제 사용) =====
    @Transactional
    public void leaveRoom(Long roomId, String uid) {
        RoomEntity room = roomRepository.findById(roomId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "방을 찾을 수 없습니다"));
        if (room.getOwnerUid().equals(uid)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "방장은 나갈 수 없습니다. 방을 삭제하세요");
        }
        roomMemberRepository.deleteByRoomIdAndUid(roomId, uid);
    }

    // ===== 멤버 강퇴 (방장만) =====
    @Transactional
    public void kickMember(Long roomId, String ownerUid, String targetUid) {
        RoomEntity room = roomRepository.findById(roomId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "방을 찾을 수 없습니다"));
        if (!room.getOwnerUid().equals(ownerUid)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "방장만 멤버를 내보낼 수 있습니다");
        }
        if (room.getOwnerUid().equals(targetUid)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "방장은 내보낼 수 없습니다");
        }
        roomMemberRepository.deleteByRoomIdAndUid(roomId, targetUid);
    }

    // ===== 커플 슬롯 지정 (방장만) — '나'/'상대방'에 방 멤버 배정 =====
    @Transactional
    public RoomDTO setCouple(Long roomId, String ownerUid, String leftUid, String rightUid) {
        RoomEntity room = roomRepository.findById(roomId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "방을 찾을 수 없습니다"));
        if (!room.getOwnerUid().equals(ownerUid)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "방장만 설정할 수 있습니다");
        }
        String left = (leftUid == null || leftUid.isEmpty()) ? null : leftUid;
        String right = (rightUid == null || rightUid.isEmpty()) ? null : rightUid;
        if (left != null && !roomMemberRepository.existsByRoomIdAndUid(roomId, left)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "'나'로 지정한 사용자가 방 멤버가 아닙니다");
        }
        if (right != null && !roomMemberRepository.existsByRoomIdAndUid(roomId, right)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "'상대방'으로 지정한 사용자가 방 멤버가 아닙니다");
        }
        room.setCoupleLeftUid(left);
        room.setCoupleRightUid(right);
        roomRepository.save(room);
        return getRoomWithMembers(roomId, ownerUid);
    }

    // ===== 내가 속한 방 목록 =====
    @Transactional(readOnly = true)
    public List<RoomDTO> listForUser(String uid) {
        List<RoomMemberEntity> memberships = roomMemberRepository.findByUid(uid);
        List<RoomDTO> result = new ArrayList<>();
        for (RoomMemberEntity m : memberships) {
            roomRepository.findById(m.getRoomId()).ifPresent(room ->
                    result.add(RoomDTO.from(room, uid, roomMemberRepository.countByRoomId(room.getId())))
            );
        }
        // 최근 생성 방이 위로
        result.sort((a, b) -> {
            if (a.getCreatedAt() == null || b.getCreatedAt() == null) return 0;
            return b.getCreatedAt().compareTo(a.getCreatedAt());
        });
        return result;
    }

    // ===== 방 멤버 상세 =====
    @Transactional(readOnly = true)
    public RoomDTO getRoomWithMembers(Long roomId, String requesterUid) {
        RoomEntity room = requireMember(requesterUid, roomId); // 멤버만 조회 가능
        List<RoomMemberEntity> members = roomMemberRepository.findByRoomId(roomId);
        List<RoomDTO.Member> memberDtos = new ArrayList<>();
        for (RoomMemberEntity m : members) {
            Optional<UserEntity> u = userRepository.findByUid(m.getUid());
            memberDtos.add(RoomDTO.Member.builder()
                    .uid(m.getUid())
                    .name(u.map(UserEntity::getName).orElse(null))
                    .nickname(u.map(UserEntity::getNickname).orElse(null))
                    .profileURL(u.map(UserEntity::getProfileURL).orElse(null))
                    .owner(room.getOwnerUid().equals(m.getUid()))
                    .build());
        }
        RoomDTO dto = RoomDTO.from(room, requesterUid, members.size());
        dto.setMembers(memberDtos);
        return dto;
    }

    // ===== 방 대표 이미지 변경 (방장만) =====
    // [B] edit by smsong - 방 카드 썸네일용 대표 이미지 업로드. 프론트: POST /api/rooms/{id}/image (multipart, part명 'mediaData')
    @Transactional
    public RoomDTO updateRoomImage(Long roomId, String ownerUid, MultipartFile file) {
        RoomEntity room = roomRepository.findById(roomId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "방을 찾을 수 없습니다"));
        if (!room.getOwnerUid().equals(ownerUid)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "방장만 이미지를 변경할 수 있습니다");
        }
        if (file == null || file.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "이미지가 없습니다");
        }
        String oldUrl = room.getImageUrl();
        String url = uploadMedia(file);
        room.setImageUrl(url);
        roomRepository.save(room);
        deleteMediaQuietly(oldUrl); // 이전 이미지/썸네일 정리(있으면)
        return RoomDTO.from(room, ownerUid, roomMemberRepository.countByRoomId(room.getId()));
    }

    // GCS 업로드 (MemoryService.uploadMedia 와 동일 패턴 + 썸네일 동시 생성)
    private String uploadMedia(MultipartFile mediaFile) {
        try {
            UUID uuid = UUID.randomUUID();
            String original = mediaFile.getOriginalFilename();
            String ext = (original != null && original.contains(".")) ? original.substring(original.lastIndexOf(".")) : "";
            String fileName = uuid.toString() + ext;

            BlobId blobId = BlobId.of(bucket, fileName);
            BlobInfo blobInfo = BlobInfo.newBuilder(blobId).setContentType("image/jpeg").build();
            storage.create(blobInfo, mediaFile.getBytes());
            uploadThumbnailQuietly(mediaFile, fileName); // [smsong] 카드용 소형 썸네일 동시 생성
            return googleCloudHeader + fileName;
        } catch (IOException e) {
            throw new RuntimeException("업로드 실패", e);
        }
    }

    // 원본과 같은 이름 앞에 'thumb_' 를 붙인 소형 JPEG 썸네일 생성 (실패 시 조용히 skip)
    private static final int THUMB_MAX = 400;
    private void uploadThumbnailQuietly(MultipartFile file, String baseFileName) {
        try {
            java.awt.image.BufferedImage src = javax.imageio.ImageIO.read(file.getInputStream());
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
            // 썸네일 실패는 치명적이지 않음 → 조용히 무시(프론트가 원본으로 폴백)
        }
    }

    // 이전 대표 이미지(원본+썸네일)를 GCS 에서 제거 (실패해도 무시)
    private void deleteMediaQuietly(String url) {
        try {
            if (url == null || url.isEmpty()) return;
            if (googleCloudHeader == null || !url.startsWith(googleCloudHeader)) return;
            String fileName = url.substring(googleCloudHeader.length());
            if (fileName.isEmpty()) return;
            storage.delete(BlobId.of(bucket, fileName));
            storage.delete(BlobId.of(bucket, "thumb_" + fileName));
        } catch (Exception e) {
            // 정리 실패는 무시
        }
    }
    // [E] edit by smsong
}
