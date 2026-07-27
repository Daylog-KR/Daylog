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
        private String type;            // TEXT / SYSTEM
        private String createdAt;       // ISO 문자열
        private boolean mine;           // 요청자가 보낸 메시지인지
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
    }
}
// [E] edit by smsong
