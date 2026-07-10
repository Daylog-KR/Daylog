package com.example.Daylog.Entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

// [B] edit by smsong - 웹푸시(Web Push) 구독 정보. 한 사용자가 기기마다 하나씩 가질 수 있어 (uid, endpoint) 다건.
@Entity(name = "push_subscriptions")
@Table(uniqueConstraints = @UniqueConstraint(columnNames = "endpoint"))
@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class PushSubscriptionEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    // 구독 소유자 uid
    @Column(nullable = false)
    private String uid;

    // 푸시 서비스 엔드포인트 URL (고유)
    @Column(nullable = false, length = 1000)
    private String endpoint;

    // 브라우저 공개키(p256dh) / 인증 시크릿(auth)
    @Column(nullable = false, length = 255)
    private String p256dh;

    @Column(nullable = false, length = 255)
    private String auth;

    private LocalDateTime createdAt;

    @PrePersist
    public void prePersist() {
        if (this.createdAt == null) this.createdAt = LocalDateTime.now();
    }
}
