package com.example.Daylog.Entity;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;

// [smsong] 방(공유 공간). 초대 코드로 멤버가 모여 그 방 멤버끼리만 추억/가볼곳 공유
@Entity(name = "rooms")
@Table(uniqueConstraints = @UniqueConstraint(columnNames = "inviteCode"))
@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class RoomEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String name;

    // 방장 uid (삭제 권한)
    @Column(nullable = false)
    private String ownerUid;

    // 초대 코드 (대문자/숫자, 유일)
    @Column(nullable = false, length = 16)
    private String inviteCode;

    // [smsong] 방 타입: COUPLE(커플) / FRIEND(친구) / FAMILY(가족)
    // 기존 레코드(타입 없이 생성된 방) 호환을 위해 nullable — 부트스트랩에서 null 은 COUPLE 로 백필
    @Column(length = 16)
    private String type;

    // [smsong] 커플 방 전용: '나'(왼쪽)/'상대방'(오른쪽) 슬롯에 지정된 멤버 uid (방장이 설정)
    private String coupleLeftUid;
    private String coupleRightUid;

    // [smsong] 커플 방 디데이 기준일 (YYYY-MM-DD) — 방마다 개별 설정
    private String coupleSince;

    private LocalDateTime createdAt;

    @PrePersist
    public void prePersist() {
        if (this.createdAt == null) this.createdAt = LocalDateTime.now();
    }
}
