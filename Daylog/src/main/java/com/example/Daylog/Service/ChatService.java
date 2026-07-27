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
import org.springframework.beans.factory.annotation.Autowired;
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

    // 새 메시지 → 웹푸시 발송 연결점. 구현 빈이 없으면 푸시만 생략(선택 주입).
    @Autowired(required = false)
    private ChatPushSender chatPushSender;

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

        return ChatDTO.History.builder()
                .me(requesterUid)
                .memberCount(members.size())
                .memberUids(members)
                .reads(reads)
                .messages(msgs)
                .hasMore(hasMore)
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
        if (chatPushSender == null) return; // 어댑터 미구현 → 푸시 생략
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

            String roomName = roomRepository.findById(roomId).map(RoomEntity::getName).orElse("채팅");
            String senderName = displayName(senderUid);
            String preview = content == null ? "" : content.replaceAll("\\s+", " ").trim();
            if (preview.length() > 80) preview = preview.substring(0, 80) + "…";
            String body = (senderName != null ? senderName + ": " : "") + preview;
            String url = "/main.html?room=" + roomId;

            chatPushSender.sendChatPush(targets, roomId, roomName, body, url);
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
