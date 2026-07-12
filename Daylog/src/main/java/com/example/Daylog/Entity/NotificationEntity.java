package com.example.Daylog.Entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

// [B] edit by smsong - 사용자별 알림함(인스타 하트 목록)용 저장 엔티티. 푸시 발송과 함께 여기에도 1건 저장한다.
@Entity(name = "notifications")
@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class NotificationEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    // 받는 사람 uid
    @Column(nullable = false)
    private String recipientUid;

    // COMMENT / REPLY / JOIN_REQUEST / ACCEPTED / JOINED / KICKED
    @Column(nullable = false, length = 30)
    private String type;

    @Column(length = 200)
    private String title;

    @Column(length = 500)
    private String body;

    // 클릭 시 이동할 딥링크 (프론트 상대경로)
    @Column(length = 500)
    private String url;

    // [B] edit by smsong - #1 방별 알림 필터용 (댓글/답글/입장 등이 속한 방)
    private Long roomId;

    @Builder.Default
    @Column(nullable = false)
    private boolean isRead = false;

    private LocalDateTime createdAt;

    @PrePersist
    public void prePersist() {
        if (this.createdAt == null) this.createdAt = LocalDateTime.now();
    }
}
