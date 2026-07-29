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

    // [B] edit by smsong - 현재 채팅방 멤버 리스트 (설정 > 멤버 보기). 방 멤버만 조회 가능.
    //  방장(owner) → 나(me) → 나머지 순으로 정렬해 반환.
    public List<Map<String, Object>> memberList(Long roomId, String requesterUid) {
        assertMember(requesterUid, roomId);
        RoomEntity room = roomRepository.findById(roomId).orElse(null);
        String ownerUid = (room != null) ? room.getOwnerUid() : null;

        List<Map<String, Object>> out = new ArrayList<>();
        for (String uid : memberUids(roomId)) {
            UserEntity u = userRepository.findByUid(uid).orElse(null);
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("uid", uid);
            m.put("displayName", (u != null) ? displayName(uid) : uid);
            m.put("profileURL", (u != null) ? u.getProfileURL() : null);
            m.put("me", uid.equals(requesterUid));
            m.put("owner", ownerUid != null && ownerUid.equals(uid));
            out.add(m);
        }
        // 방장 먼저, 그다음 나, 그다음 이름순
        out.sort((a, b) -> {
            int ao = Boolean.TRUE.equals(a.get("owner")) ? 0 : 1;
            int bo = Boolean.TRUE.equals(b.get("owner")) ? 0 : 1;
            if (ao != bo) return ao - bo;
            int am = Boolean.TRUE.equals(a.get("me")) ? 0 : 1;
            int bm = Boolean.TRUE.equals(b.get("me")) ? 0 : 1;
            if (am != bm) return am - bm;
            return String.valueOf(a.get("displayName")).compareToIgnoreCase(String.valueOf(b.get("displayName")));
        });
        return out;
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
        String roomImageURL = (room != null && !direct) ? room.getImageUrl() : null; // [B] edit by smsong - 그룹방 헤더 썸네일
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
                .roomImageURL(roomImageURL)
                .muted(isChatMuted(roomId, requesterUid))
                .build();
    }

    // ===== 전송 =====
    @Transactional
    public ChatDTO.Message send(Long roomId, String senderUid, String content) {
        return send(roomId, senderUid, content, null);
    }

    // [B] edit by smsong - 답장 지원: replyToId 를 저장. (WebSocket 핸들러가 이 4-인자 버전을 호출)
    public ChatDTO.Message send(Long roomId, String senderUid, String content, Long replyToId) {
        assertMember(senderUid, roomId);
        if (content == null) content = "";
        content = content.trim();
        if (content.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "빈 메시지는 보낼 수 없습니다");
        }
        if (content.length() > 2000) content = content.substring(0, 2000);

        // 답장 원본이 같은 방 메시지가 아니면 무시(안전)
        Long safeReply = null;
        if (replyToId != null) {
            ChatMessageEntity orig = chatMessageRepository.findById(replyToId).orElse(null);
            if (orig != null && roomId.equals(orig.getRoomId())) safeReply = replyToId;
        }

        ChatMessageEntity saved = chatMessageRepository.save(ChatMessageEntity.builder()
                .roomId(roomId)
                .senderUid(senderUid)
                .content(content)
                .type("TEXT")
                .replyToId(safeReply)
                .build());

        // 보낸 사람은 자기 메시지를 읽은 것으로 간주 → 읽음 커서를 이 메시지로 전진
        markRead(roomId, senderUid, saved.getId());

        return toMessage(saved, senderUid, new HashMap<>());
    }

    // [B] edit by smsong - 시스템 메시지(카톡식 입장/퇴장 안내) 저장. senderUid=null, type=SYSTEM.
    //  RoomService(강퇴/나가기/입장 승인)에서 호출 → 반환된 메시지를 WS 로 브로드캐스트하면 실시간 표시.
    @Transactional
    public ChatDTO.Message postSystem(Long roomId, String text) {
        if (roomId == null || text == null || text.isBlank()) return null;
        if (text.length() > 2000) text = text.substring(0, 2000);
        ChatMessageEntity saved = chatMessageRepository.save(ChatMessageEntity.builder()
                .roomId(roomId)
                .senderUid(null)
                .content(text)
                .type("SYSTEM")
                .build());
        return toMessage(saved, null, new HashMap<>());
    }

    // [B] edit by smsong - 채팅 이미지 전송: IMAGE 타입 메시지(content=이미지 URL) 저장 후 반환
    @Transactional
    public ChatDTO.Message sendImage(Long roomId, String senderUid, String imageUrl, Long replyToId) {
        assertMember(senderUid, roomId);
        if (imageUrl == null || imageUrl.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "이미지가 없습니다");
        }
        if (imageUrl.length() > 2000) imageUrl = imageUrl.substring(0, 2000);
        Long safeReply = null;
        if (replyToId != null) {
            ChatMessageEntity orig = chatMessageRepository.findById(replyToId).orElse(null);
            if (orig != null && roomId.equals(orig.getRoomId())) safeReply = replyToId;
        }
        ChatMessageEntity saved = chatMessageRepository.save(ChatMessageEntity.builder()
                .roomId(roomId)
                .senderUid(senderUid)
                .content(imageUrl)
                .type("IMAGE")
                .replyToId(safeReply)
                .build());
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
            boolean direct = isDirectRoom(room);
            // [B] edit by smsong - 메시지가 하나도 없는 방(방 생성 직후 등)은 채팅 목록에 표시하지 않는다.
            //  1:1이든 일반 방이든 '첫 채팅(입장 안내 포함 어떤 메시지든)'이 생겨야 목록에 뜬다.
            if (last == null) continue;
            long unread = unreadCount(roomId, uid);
            long members = roomMemberRepository.findByRoomId(roomId).size();

            String title = room.getName();
            String image = room.getImageUrl();
            String peerUid = null;
            // [B] edit by smsong - 단체방: 멤버 프로필 이미지 최대 4개(카톡식 썸네일)
            List<String> memberImages = null;
            if (!direct) {
                memberImages = new ArrayList<>();
                for (String mUid : memberUids(roomId)) {
                    if (mUid == null) continue;
                    UserEntity mu = userRepository.findByUid(mUid).orElse(null);
                    memberImages.add(mu != null ? mu.getProfileURL() : null);
                    if (memberImages.size() >= 4) break;
                }
            }

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
                    .memberImages(memberImages)
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
        if ("IMAGE".equals(m.getType())) return "사진";
        if ("SHARE".equals(m.getType())) return ("MEMORY".equals(m.getShareKind()) ? "[추억] " : "[체크리스트] ") + (m.getShareTitle() == null ? "" : m.getShareTitle());
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
            // [B] edit by smsong - 채팅 알림 클릭 시 마지막 방 자동입장을 우회하고 rooms.html 채팅을 바로 연다
            String url = "/rooms.html?chat=1&room=" + roomId;

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
        String shareSrcRoomName = null;
        if ("SHARE".equals(m.getType()) && m.getShareSrcRoomId() != null) {
            RoomEntity sr = roomRepository.findById(m.getShareSrcRoomId()).orElse(null);
            if (sr != null) shareSrcRoomName = sr.getName();
        }
        // [B] edit by smsong - 답장 원본 정보(발신자명 + 내용 미리보기)
        String replyToName = null, replyToContent = null;
        if (m.getReplyToId() != null) {
            ChatMessageEntity orig = chatMessageRepository.findById(m.getReplyToId()).orElse(null);
            if (orig != null) {
                replyToName = orig.getSenderUid() == null ? "" : displayName(orig.getSenderUid());
                if ("IMAGE".equals(orig.getType())) replyToContent = "사진";
                else if ("SHARE".equals(orig.getType())) replyToContent = ("MEMORY".equals(orig.getShareKind()) ? "[추억] " : "[체크리스트] ") + (orig.getShareTitle() == null ? "" : orig.getShareTitle());
                else replyToContent = orig.getContent();
                if (replyToContent != null && replyToContent.length() > 120) replyToContent = replyToContent.substring(0, 120);
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
                .replyToId(m.getReplyToId())
                .replyToName(replyToName)
                .replyToContent(replyToContent)
                .shareKind(m.getShareKind())
                .shareRefId(m.getShareRefId())
                .shareSrcRoomId(m.getShareSrcRoomId())
                .shareSrcRoomName(shareSrcRoomName)
                .shareTitle(m.getShareTitle())
                .shareImage(m.getShareImage())
                .build();
    }

    // [B] edit by smsong - 전송 대상 사용자 검색: 나와 방을 공유하는 사람들 중 이름/닉네임 매칭.
    //  (아직 1:1 방이 없어도 전송 시 방을 만들어 보낼 수 있게, 후보를 돌려준다)
    public List<Map<String, Object>> userSearch(String myUid, String q) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (myUid == null || q == null) return out;
        String needle = q.trim().toLowerCase();
        if (needle.isEmpty()) return out;

        Set<String> coUids = new LinkedHashSet<>();
        for (RoomMemberEntity m : roomMemberRepository.findByUid(myUid)) {
            for (String u : memberUids(m.getRoomId())) {
                if (u != null && !u.equals(myUid)) coUids.add(u);
            }
        }
        for (String uid : coUids) {
            UserEntity u = userRepository.findByUid(uid).orElse(null);
            if (u == null) continue;
            String nick = u.getNickname() == null ? "" : u.getNickname();
            String name = u.getName() == null ? "" : u.getName();
            if (nick.toLowerCase().contains(needle) || name.toLowerCase().contains(needle)) {
                Map<String, Object> mp = new LinkedHashMap<>();
                mp.put("uid", uid);
                mp.put("displayName", displayName(uid));
                mp.put("profileURL", u.getProfileURL());
                out.add(mp);
            }
        }
        return out;
    }

    // ===== [B] edit by smsong - 추억/체크리스트 공유(전송) =====
    //  여러 방에 카드 메시지를 저장하고(선택 시 내용 텍스트 포함), 각 방에 푸시 발송.
    @Transactional
    public List<ChatDTO.Message> shareToRooms(String senderUid, List<Long> roomIds, String kind, Long refId,
                             Long srcRoomId, String title, String image, String content) {
        List<ChatDTO.Message> results = new ArrayList<>();
        if (roomIds == null || roomIds.isEmpty()) return results;
        String k = "MEMORY".equalsIgnoreCase(kind) ? "MEMORY" : "CHECKLIST";
        String text = content == null ? "" : content.trim();
        if (text.length() > 2000) text = text.substring(0, 2000);
        String ttl = title == null ? "" : (title.length() > 300 ? title.substring(0, 300) : title);
        String img = image == null ? null : (image.length() > 1000 ? image.substring(0, 1000) : image);
        Map<String, UserEntity> cache = new HashMap<>();

        for (Long roomId : roomIds) {
            if (roomId == null || !isMember(senderUid, roomId)) continue;
            ChatMessageEntity saved = chatMessageRepository.save(ChatMessageEntity.builder()
                    .roomId(roomId)
                    .senderUid(senderUid)
                    .content(text)                 // 카드 아래 표시할 내용(있으면)
                    .type("SHARE")
                    .shareKind(k)
                    .shareRefId(refId)
                    .shareSrcRoomId(srcRoomId)
                    .shareTitle(ttl)
                    .shareImage(img)
                    .build());
            markRead(roomId, senderUid, saved.getId());
            results.add(toMessage(saved, senderUid, cache)); // 컨트롤러가 실시간 브로드캐스트에 사용
            // 접속중 여부와 무관하게 발송(전송은 명시적 행동이라 대상 전원에게)
            //  [B] edit by smsong - 함께 작성한 내용이 있으면 푸시 본문에도 덧붙인다.
            //   예) "[추억] 롯데월드 어드벤처 · 오늘 진짜 재밌었어!"
            String label = k.equals("MEMORY") ? "[추억] " : "[체크리스트] ";
            String head = label + (ttl.isEmpty() ? "공유" : ttl);
            String note = text.replaceAll("\\s+", " ").trim();
            if (note.length() > 80) note = note.substring(0, 80) + "…";
            String body = note.isEmpty() ? head : (head + " · " + note);
            try { notifyNewMessage(roomId, senderUid, body, null); } catch (Exception ignore) {}
        }
        return results;
    }
}
// [E] edit by smsong
