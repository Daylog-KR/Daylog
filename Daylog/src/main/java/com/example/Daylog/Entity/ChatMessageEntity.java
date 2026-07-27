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

    // TEXT / SYSTEM (입장/퇴장 안내 등)
    @Column(length = 16)
    private String type;

    private LocalDateTime createdAt;

    @PrePersist
    public void prePersist() {
        if (this.createdAt == null) this.createdAt = LocalDateTime.now();
        if (this.type == null) this.type = "TEXT";
    }
}
// [E] edit by smsong
