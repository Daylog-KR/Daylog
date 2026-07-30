package com.example.Daylog.DTO;

import lombok.*;

import java.util.List;
import java.util.Map;

// [B] edit by smsong - 방 채팅 DTO 묶음
public class ChatDTO {

    // 단일 메시지
    @NoArgsConstructor
    @AllArgsConstructor
    @Getter
    @Setter
    @Builder
    public static class Message {
        private Long id;
        private Long roomId;
        private String senderUid;
        private String senderName;      // 표시 이름(닉네임 우선, 없으면 name)
        private String senderProfileURL;
        private String content;
        private String type;            // TEXT / SYSTEM / SHARE / IMAGE
        private String createdAt;       // ISO 문자열
        private boolean mine;           // 요청자가 보낸 메시지인지
        // [B] edit by smsong - 답장(카톡식) 인용 표시용
        private Long replyToId;         // 원본 메시지 id
        private String replyToName;     // 원본 발신자 표시 이름
        private String replyToContent;  // 원본 내용 미리보기
        // [B] edit by smsong - 이미지 메시지: content 에 이미지 URL 이 들어감(type=IMAGE)
        // [B] edit by smsong - 공유(전송) 카드용
        private String shareKind;       // CHECKLIST / MEMORY
        private Long shareRefId;
        private Long shareSrcRoomId;
        private String shareSrcRoomName;
        private String shareTitle;
        private String shareImage;
    }

    // 히스토리 응답: 메시지 목록 + 방 멤버 uid + 각 멤버의 마지막 읽은 id
    //  (프론트가 이 스냅샷으로 메시지별 '안 읽은 수'를 실시간 계산/갱신한다)
    @NoArgsConstructor
    @AllArgsConstructor
    @Getter
    @Setter
    @Builder
    public static class History {
        private String me;                    // 요청자 uid
        private long memberCount;             // 방 전체 멤버 수
        private List<String> memberUids;      // 방 멤버 uid 목록
        private Map<String, Long> reads;      // uid -> 마지막으로 읽은 메시지 id
        private List<Message> messages;       // 오름차순(과거 → 최신)
        private boolean hasMore;              // 위로 더 불러올 과거가 있는지
        // [B] edit by smsong - 채팅 헤더 표시용(어느 방 / 누구와의 채팅인지)
        private String title;                 // 방 이름(1:1 이면 상대 표시 이름)
        private boolean direct;               // 1:1 채팅 여부
        private String peerUid;               // 1:1 상대 uid (그룹이면 null)
        private String peerProfileURL;        // 1:1 상대 프로필(헤더 아바타)
        private String roomImageURL;          // [B] edit by smsong - 그룹방 헤더 썸네일(방 대표 이미지)
        private List<String> memberImages;    // [B] edit by smsong - 단체방 헤더 멤버 합성 썸네일(최대4)
        private boolean muted;                // 이 방 채팅 알림 꺼짐 여부
    }

    // [B] edit by smsong - 채팅방 리스트(카카오톡 대화목록) 한 줄
    //  · 채팅 탭에서 내가 속한 방들의 채팅을 최근 메시지 순으로 보여준다.
    //  · direct=true 면 1:1 방(다음 단계에서 사용). 이때 title/imageURL 은 상대방 기준으로 채워진다.
    @NoArgsConstructor
    @AllArgsConstructor
    @Getter
    @Setter
    @Builder
    public static class RoomSummary {
        private Long roomId;
        private String title;          // 방 이름(1:1 이면 상대방 표시 이름)
        private String imageURL;       // 방 대표 이미지(1:1 이면 상대방 프로필)
        private String type;           // 방 타입(COUPLE/FAMILY/... 또는 DIRECT)
        private boolean direct;        // 1:1 채팅 여부
        private String peerUid;        // 1:1 일 때 상대방 uid (그룹이면 null)
        private String lastMessage;    // 마지막 메시지 미리보기(없으면 null)
        private String lastMessageAt;  // 마지막 메시지 시각 ISO (없으면 null)
        private long unreadCount;      // 내가 안 읽은 메시지 수
        private long memberCount;      // 방 멤버 수
        private boolean muted;         // 이 방 채팅 알림을 껐는지
        // [B] edit by smsong - 카톡식 단체방 썸네일: 멤버 프로필 이미지(최대 4, null 은 기본 아바타)
        private List<String> memberImages;
    }
}
// [E] edit by smsong
