package com.example.Daylog.Entity;

import jakarta.persistence.*;
import lombok.*;

// [B] edit by smsong - 방별 · 유저별 '채팅 알림 끄기' 상태 (방 알림 토글과 별개)
//  · muted=true 인 유저에게는 그 방의 새 채팅 푸시를 보내지 않는다(실시간 메시지/배지는 정상 동작).
@Entity(name = "chat_mutes")
@Table(uniqueConstraints = @UniqueConstraint(columnNames = {"roomId", "uid"}))
@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class ChatMuteEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long roomId;

    @Column(nullable = false, length = 128)
    private String uid;

    @Column(nullable = false)
    private boolean muted;
}
// [E] edit by smsong
