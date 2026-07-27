package com.example.Daylog.Entity;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;

// [B] edit by smsong - 방 채팅 읽음 상태. (roomId, uid) 당 한 행: 그 유저가 이 방에서
//  '어디까지 읽었는지'(lastReadMessageId)만 저장한다. 카카오톡식 '읽은/안읽은 수' 계산 근거.
@Entity(name = "chat_reads")
@Table(uniqueConstraints = @UniqueConstraint(columnNames = {"roomId", "uid"}))
@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class ChatReadEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long roomId;

    @Column(nullable = false, length = 128)
    private String uid;

    // 이 유저가 이 방에서 마지막으로 읽은 메시지의 id (없으면 0)
    @Column(nullable = false)
    private Long lastReadMessageId;

    private LocalDateTime updatedAt;

    @PrePersist
    @PreUpdate
    public void touch() {
        this.updatedAt = LocalDateTime.now();
        if (this.lastReadMessageId == null) this.lastReadMessageId = 0L;
    }
}
// [E] edit by smsong
