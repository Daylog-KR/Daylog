package com.example.Daylog.Entity;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;

// [B] edit by smsong - 방 채팅 메시지. 방(roomId) 안의 멤버끼리 주고받는 실시간 채팅.
@Entity(name = "chat_messages")
@Table(indexes = {
        @Index(name = "idx_chat_room_id", columnList = "roomId, id")
})
@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class ChatMessageEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long roomId;

    // 보낸 사람 uid (SYSTEM 메시지는 null 가능)
    @Column(length = 128)
    private String senderUid;

    @Column(length = 2000)
    private String content;

    // [B] edit by smsong - 답장(카톡식): 이 메시지가 답장하는 원본 메시지 id (없으면 null)
    private Long replyToId;

    // TEXT / SYSTEM (입장/퇴장 안내 등) / SHARE (추억·체크리스트 공유) / IMAGE (사진)
    @Column(length = 16)
    private String type;

    // [B] edit by smsong - 공유(전송) payload: type=SHARE 일 때 사용
    @Column(length = 16)
    private String shareKind;        // CHECKLIST / MEMORY
    private Long shareRefId;         // 원본 추억/체크리스트 id
    private Long shareSrcRoomId;     // 원본이 속한 방 id (클릭 시 이동)
    @Column(length = 300)
    private String shareTitle;       // 제목
    @Column(length = 1000)
    private String shareImage;       // 대표 이미지 URL

    private LocalDateTime createdAt;

    @PrePersist
    public void prePersist() {
        if (this.createdAt == null) this.createdAt = LocalDateTime.now();
        if (this.type == null) this.type = "TEXT";
    }
}
// [E] edit by smsong
