package com.example.Daylog.Service;

import com.example.Daylog.DTO.RoomDTO;
import com.example.Daylog.Entity.RoomEntity;
import com.example.Daylog.Entity.RoomMemberEntity;
import com.example.Daylog.Entity.UserEntity;
import com.example.Daylog.Repository.RoomMemberRepository;
import com.example.Daylog.Repository.RoomRepository;
import com.example.Daylog.Repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

// [smsong] 방 생성/입장/삭제/조회 + 멤버십 검사
@Service
@RequiredArgsConstructor
public class RoomService {

    private final RoomRepository roomRepository;
    private final RoomMemberRepository roomMemberRepository;
    private final UserRepository userRepository;

    // 헷갈리는 문자(0/O/1/I) 제외한 초대 코드용 알파벳
    private static final String CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static final int CODE_LEN = 6;
    private final SecureRandom random = new SecureRandom();

    // ===== 멤버십 =====
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
        roomMemberRepository.deleteByRoomId(roomId);
        roomRepository.delete(room);
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
}
