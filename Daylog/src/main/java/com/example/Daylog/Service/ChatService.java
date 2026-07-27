package com.example.Daylog.Service;

import com.example.Daylog.DTO.ChatDTO;
import com.example.Daylog.Entity.ChatMessageEntity;
import com.example.Daylog.Entity.ChatMuteEntity;
import com.example.Daylog.Entity.ChatReadEntity;
import com.example.Daylog.Entity.RoomEntity;
import com.example.Daylog.Entity.RoomMemberEntity;
import com.example.Daylog.Entity.UserEntity;
import com.example.Daylog.Repository.ChatMessageRepository;
import com.example.Daylog.Repository.ChatMuteRepository;
import com.example.Daylog.Repository.ChatReadRepository;
import com.example.Daylog.Repository.RoomMemberRepository;
import com.example.Daylog.Repository.RoomRepository;
import com.example.Daylog.Repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.*;

// [B] edit by smsong - 방 채팅 서비스. 방 멤버만 읽기/쓰기 가능. 읽음 상태로 카카오톡식 안읽은 수 계산.
@Service
@RequiredArgsConstructor
public class ChatService {

    private final ChatMessageRepository chatMessageRepository;
    private final ChatReadRepository chatReadRepository;
    private final ChatMuteRepository chatMuteRepository;
    private final RoomMemberRepository roomMemberRepository;
    private final RoomRepository roomRepository;
    private final UserRepository userRepository;
    private final WebPushService webPushService; // 기존 웹푸시 발송 서비스

    private static final int PAGE = 30;

    // ===== 멤버십 =====
    public boolean isMember(String uid, Long roomId) {
        if (uid == null || roomId == null) return false;
        return roomMemberRepository.existsByRoomIdAndUid(roomId, uid);
    }

    public void assertMember(String uid, Long roomId) {
        if (!isMember(uid, roomId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "방 멤버만 채팅할 수 있습니다");
        }
    }

    public List<String> memberUids(Long roomId) {
        List<String> uids = new ArrayList<>();
        for (RoomMemberEntity m : roomMemberRepository.findByRoomId(roomId)) uids.add(m.getUid());
        return uids;
    }

    // ===== [B] edit by smsong - 1:1(DIRECT) 채팅방 생성/조회 =====
    //  기존 Room 을 재활용한다. type="DIRECT", 멤버는 나+상대 2명.
    //  이미 둘만 있는 DIRECT 방이 있으면 그대로 재사용(중복 생성 방지).
    private static final String DIRECT_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private final java.security.SecureRandom directRandom = new java.security.SecureRandom();

    @Transactional
    public Long getOrCreateDirectRoom(String meUid, String peerUid) {
        if (meUid == null || peerUid == null || meUid.equals(peerUid)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "잘못된 대상입니다");
        }
        // 상대가 실제 존재하는 유저인지 확인
        userRepository.findByUid(peerUid)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "상대를 찾을 수 없습니다"));

        // 내가 속한 DIRECT 방들 중 상대도 멤버이고 멤버가 정확히 2명인 방 찾기
        for (RoomMemberEntity m : roomMemberRepository.findByUid(meUid)) {
            RoomEntity room = roomRepository.findById(m.getRoomId()).orElse(null);
            if (room == null || !"DIRECT".equalsIgnoreCase(room.getType())) continue;
            List<String> members = memberUids(room.getId());
            if (members.size() == 2 && members.contains(peerUid)) {
                return room.getId();
            }
        }

        // 없으면 새로 생성
        RoomEntity room = roomRepository.save(RoomEntity.builder()
                .name("1:1 대화")                 // 표시용 이름은 조회 시 상대 이름으로 대체됨
                .ownerUid(meUid)
                .inviteCode(genDirectCode())      // DIRECT 는 코드입장 미사용이지만 컬럼이 not-null
                .type("DIRECT")
                .build());
        roomMemberRepository.save(RoomMemberEntity.builder().roomId(room.getId()).uid(meUid).build());
        roomMemberRepository.save(RoomMemberEntity.builder().roomId(room.getId()).uid(peerUid).build());
        return room.getId();
    }

    private String genDirectCode() {
        for (int attempt = 0; attempt < 50; attempt++) {
            StringBuilder sb = new StringBuilder(8);
            sb.append("D"); // DIRECT 구분용 접두어(선택)
            for (int i = 0; i < 7; i++) sb.append(DIRECT_ALPHABET.charAt(directRandom.nextInt(DIRECT_ALPHABET.length())));
            String code = sb.toString();
            if (!roomRepository.existsByInviteCode(code)) return code;
        }
        return "D" + System.currentTimeMillis();
    }

    // 상대 프로필(1:1 시작 전 모달용) — 표시 이름/닉네임/프로필/성별 등 공개 가능한 정보만
    public Map<String, Object> peerProfile(String peerUid) {
        UserEntity u = userRepository.findByUid(peerUid)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "상대를 찾을 수 없습니다"));
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("uid", u.getUid());
        m.put("name", u.getName());
        m.put("nickname", u.getNickname());
        m.put("displayName", displayName(peerUid));
        m.put("profileURL", u.getProfileURL());
        return m;
    }

    // ===== 히스토리 =====
    @Transactional
    public ChatDTO.History history(Long roomId, String requesterUid, Long beforeId, boolean markRead) {
        assertMember(requesterUid, roomId);

        List<ChatMessageEntity> desc = (beforeId != null && beforeId > 0)
                ? chatMessageRepository.findTop30ByRoomIdAndIdLessThanOrderByIdDesc(roomId, beforeId)
                : chatMessageRepository.findTop30ByRoomIdOrderByIdDesc(roomId);

        boolean hasMore = desc.size() >= PAGE;

        // 오름차순으로 뒤집기
        Collections.reverse(desc);

        // 발신자 정보 캐시
        Map<String, UserEntity> userCache = new HashMap<>();
        List<ChatDTO.Message> msgs = new ArrayList<>(desc.size());
        for (ChatMessageEntity m : desc) {
            msgs.add(toMessage(m, requesterUid, userCache));
        }

        // 첫 페이지(beforeId 없음) 조회 시 요청자를 최신까지 읽음 처리
        if (markRead && (beforeId == null || beforeId <= 0) && !desc.isEmpty()) {
            Long latest = desc.get(desc.size() - 1).getId();
            markRead(roomId, requesterUid, latest);
        }

        List<String> members = memberUids(roomId);
        Map<String, Long> reads = new HashMap<>();
        for (ChatReadEntity r : chatReadRepository.findByRoomId(roomId)) {
            reads.put(r.getUid(), r.getLastReadMessageId());
        }

        // [B] edit by smsong - 헤더 표시용: 방 이름/1:1 상대
        RoomEntity room = roomRepository.findById(roomId).orElse(null);
        boolean direct = room != null && "DIRECT".equalsIgnoreCase(room.getType());
        String title = (room != null) ? room.getName() : "채팅";
        String peerUid = null, peerProfile = null;
        if (direct) {
            for (String mUid : members) {
                if (mUid != null && !mUid.equals(requesterUid)) { peerUid = mUid; break; }
            }
            if (peerUid != null) {
                title = displayName(peerUid);
                UserEntity peer = userRepository.findByUid(peerUid).orElse(null);
                if (peer != null) peerProfile = peer.getProfileURL();
            }
        }

        return ChatDTO.History.builder()
                .me(requesterUid)
                .memberCount(members.size())
                .memberUids(members)
                .reads(reads)
                .messages(msgs)
                .hasMore(hasMore)
                .title(title)
                .direct(direct)
                .peerUid(peerUid)
                .peerProfileURL(peerProfile)
                .muted(isChatMuted(roomId, requesterUid))
                .build();
    }

    // ===== 전송 =====
    @Transactional
    public ChatDTO.Message send(Long roomId, String senderUid, String content) {
        assertMember(senderUid, roomId);
        if (content == null) content = "";
        content = content.trim();
        if (content.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "빈 메시지는 보낼 수 없습니다");
        }
        if (content.length() > 2000) content = content.substring(0, 2000);

        ChatMessageEntity saved = chatMessageRepository.save(ChatMessageEntity.builder()
                .roomId(roomId)
                .senderUid(senderUid)
                .content(content)
                .type("TEXT")
                .build());

        // 보낸 사람은 자기 메시지를 읽은 것으로 간주 → 읽음 커서를 이 메시지로 전진
        markRead(roomId, senderUid, saved.getId());

        return toMessage(saved, senderUid, new HashMap<>());
    }

    // ===== 읽음 처리 (앞으로만 전진, upsert) =====
    @Transactional
    public void markRead(Long roomId, String uid, Long lastReadMessageId) {
        if (uid == null || roomId == null || lastReadMessageId == null) return;
        ChatReadEntity r = chatReadRepository.findByRoomIdAndUid(roomId, uid).orElse(null);
        if (r == null) {
            chatReadRepository.save(ChatReadEntity.builder()
                    .roomId(roomId).uid(uid).lastReadMessageId(lastReadMessageId).build());
        } else if (r.getLastReadMessageId() == null || lastReadMessageId > r.getLastReadMessageId()) {
            r.setLastReadMessageId(lastReadMessageId);
            chatReadRepository.save(r);
        }
    }

    // ===== 배지: 내가 안 읽은 메시지 수 (내가 보낸 건 제외) =====
    public long unreadCount(Long roomId, String uid) {
        if (!isMember(uid, roomId)) return 0;
        long lastRead = chatReadRepository.findByRoomIdAndUid(roomId, uid)
                .map(ChatReadEntity::getLastReadMessageId).orElse(0L);
        return chatMessageRepository.countByRoomIdAndIdGreaterThanAndSenderUidNot(roomId, lastRead, uid);
    }

    // ===== [B] edit by smsong - 채팅방 리스트(카카오톡 대화목록) =====
    //  내가 속한 모든 방을 최근 메시지 순으로. 각 방의 마지막 메시지/안읽음/음소거 포함.
    //  ⚠ RoomMemberRepository 에 findByUid(String uid) 가 필요하다(없으면 아래 [필요 메서드] 참고).
    //  ⚠ ChatMessageRepository 에 findTop1ByRoomIdOrderByIdDesc(Long roomId) 가 필요하다.
    public List<ChatDTO.RoomSummary> chatRoomList(String uid) {
        if (uid == null) return List.of();

        // 내가 속한 방 id 목록
        List<Long> roomIds = new ArrayList<>();
        for (RoomMemberEntity m : roomMemberRepository.findByUid(uid)) roomIds.add(m.getRoomId());
        if (roomIds.isEmpty()) return List.of();

        Set<String> mutedRoomKeys = new HashSet<>();
        for (ChatMuteEntity e : chatMuteRepository.findByUidAndMutedTrue(uid)) {
            mutedRoomKeys.add(String.valueOf(e.getRoomId()));
        }

        List<ChatDTO.RoomSummary> out = new ArrayList<>();
        for (Long roomId : roomIds) {
            RoomEntity room = roomRepository.findById(roomId).orElse(null);
            if (room == null) continue;

            ChatMessageEntity last = chatMessageRepository.findTop1ByRoomIdOrderByIdDesc(roomId).orElse(null);
            long unread = unreadCount(roomId, uid);
            long members = roomMemberRepository.findByRoomId(roomId).size();
            boolean direct = isDirectRoom(room);

            String title = room.getName();
            String image = room.getImageUrl();
            String peerUid = null;

            // 1:1 방이면 제목/이미지를 상대방 기준으로 (다음 단계 대비)
            if (direct) {
                for (String mUid : memberUids(roomId)) {
                    if (mUid != null && !mUid.equals(uid)) { peerUid = mUid; break; }
                }
                if (peerUid != null) {
                    UserEntity peer = userRepository.findByUid(peerUid).orElse(null);
                    if (peer != null) {
                        title = displayName(peerUid);
                        image = peer.getProfileURL();
                    }
                }
            }

            out.add(ChatDTO.RoomSummary.builder()
                    .roomId(roomId)
                    .title(title)
                    .imageURL(image)
                    .type(room.getType())
                    .direct(direct)
                    .peerUid(peerUid)
                    .lastMessage(last == null ? null : previewOf(last))
                    .lastMessageAt(last == null || last.getCreatedAt() == null ? null : last.getCreatedAt().toString())
                    .unreadCount(unread)
                    .memberCount(members)
                    .muted(mutedRoomKeys.contains(String.valueOf(roomId)))
                    .build());
        }

        // 최근 메시지 순 정렬(메시지 없는 방은 뒤로)
        out.sort((a, b) -> {
            String ta = a.getLastMessageAt(), tb = b.getLastMessageAt();
            if (ta == null && tb == null) return 0;
            if (ta == null) return 1;
            if (tb == null) return -1;
            return tb.compareTo(ta);
        });
        return out;
    }

    // 방이 1:1(DIRECT) 인지 판정. Room 타입에 "DIRECT" 가 있으면 그걸 쓰고,
    //  없으면 멤버 2명 + 이름 규칙으로 판정(다음 단계에서 1:1 생성 로직과 함께 확정).
    private boolean isDirectRoom(RoomEntity room) {
        return room != null && "DIRECT".equalsIgnoreCase(room.getType());
    }

    private String previewOf(ChatMessageEntity m) {
        if (m == null) return null;
        if ("SYSTEM".equals(m.getType())) return m.getContent();
        String c = m.getContent() == null ? "" : m.getContent().replaceAll("\\s+", " ").trim();
        if (c.length() > 60) c = c.substring(0, 60) + "…";
        return c;
    }

    // ===== 채팅 알림 끄기 (방별 · 유저별) =====
    public boolean isChatMuted(Long roomId, String uid) {
        if (roomId == null || uid == null) return false;
        return chatMuteRepository.findByRoomIdAndUid(roomId, uid)
                .map(ChatMuteEntity::isMuted).orElse(false);
    }

    @Transactional
    public boolean setChatMuted(Long roomId, String uid, boolean muted) {
        assertMember(uid, roomId);
        ChatMuteEntity e = chatMuteRepository.findByRoomIdAndUid(roomId, uid).orElse(null);
        if (e == null) {
            e = ChatMuteEntity.builder().roomId(roomId).uid(uid).muted(muted).build();
        } else {
            e.setMuted(muted);
        }
        chatMuteRepository.save(e);
        return muted;
    }

    // 방에서 채팅 알림을 끈 유저 uid 집합
    public Set<String> chatMutedUids(Long roomId) {
        Set<String> s = new HashSet<>();
        for (ChatMuteEntity e : chatMuteRepository.findByRoomIdAndMutedTrue(roomId)) s.add(e.getUid());
        return s;
    }

    // ===== 새 메시지 푸시 발송 =====
    //  대상 = 방 멤버 − 발신자 − 채팅음소거자 − 지금 채팅방 접속중(excludeUids)
    //  excludeUids: WebSocket 핸들러가 넘겨주는 '현재 이 방 채팅에 붙어있는 uid'(있으면 굳이 푸시 안 함)
    public void notifyNewMessage(Long roomId, String senderUid, String content, Set<String> excludeUids) {
        try {
            Set<String> muted = chatMutedUids(roomId);
            List<String> targets = new ArrayList<>();
            for (String uid : memberUids(roomId)) {
                if (uid == null) continue;
                if (uid.equals(senderUid)) continue;
                if (muted.contains(uid)) continue;
                if (excludeUids != null && excludeUids.contains(uid)) continue;
                targets.add(uid);
            }
            if (targets.isEmpty()) return;

            RoomEntity roomEnt = roomRepository.findById(roomId).orElse(null);
            boolean direct = roomEnt != null && "DIRECT".equalsIgnoreCase(roomEnt.getType());
            String senderName = displayName(senderUid);
            String roomName = direct
                    ? (senderName != null ? senderName : "1:1 대화")   // 1:1: 발신자 이름을 제목으로
                    : (roomEnt != null ? roomEnt.getName() : "채팅");
            String preview = content == null ? "" : content.replaceAll("\\s+", " ").trim();
            if (preview.length() > 80) preview = preview.substring(0, 80) + "…";
            // 1:1 은 제목이 이미 발신자라 본문엔 이름 생략, 그룹은 "이름: 내용"
            String body = direct ? preview : ((senderName != null ? senderName + ": " : "") + preview);
            String url = "/main.html?room=" + roomId;

            // 여러 uid 에게 비동기 발송(본 요청 응답을 지연시키지 않음). 푸시 비활성/구독없음 시 자동 no-op.
            webPushService.sendToUids(targets, roomName, body, url);
        } catch (Exception ignore) {
            // 푸시 실패가 채팅 전송을 막지 않도록 무시
        }
    }

    // 방 삭제 시 채팅 정리 (RoomService.deleteRoom 에서 호출 권장)
    @Transactional
    public void deleteRoomChats(Long roomId) {
        chatMessageRepository.deleteByRoomId(roomId);
        chatReadRepository.deleteByRoomId(roomId);
        chatMuteRepository.deleteByRoomId(roomId);
    }

    private String displayName(String uid) {
        if (uid == null) return null;
        UserEntity u = userRepository.findByUid(uid).orElse(null);
        if (u == null) return null;
        return (u.getNickname() != null && !u.getNickname().isBlank()) ? u.getNickname() : u.getName();
    }

    // ===== 내부 =====
    private ChatDTO.Message toMessage(ChatMessageEntity m, String requesterUid, Map<String, UserEntity> cache) {
        String name = null, profile = null;
        if (m.getSenderUid() != null) {
            UserEntity u = cache.get(m.getSenderUid());
            if (u == null && !cache.containsKey(m.getSenderUid())) {
                u = userRepository.findByUid(m.getSenderUid()).orElse(null);
                cache.put(m.getSenderUid(), u);
            }
            if (u != null) {
                name = (u.getNickname() != null && !u.getNickname().isBlank()) ? u.getNickname() : u.getName();
                profile = u.getProfileURL();
            }
        }
        return ChatDTO.Message.builder()
                .id(m.getId())
                .roomId(m.getRoomId())
                .senderUid(m.getSenderUid())
                .senderName(name)
                .senderProfileURL(profile)
                .content(m.getContent())
                .type(m.getType())
                .createdAt(m.getCreatedAt() == null ? null : m.getCreatedAt().toString())
                .mine(m.getSenderUid() != null && m.getSenderUid().equals(requesterUid))
                .build();
    }
}
// [E] edit by smsong
