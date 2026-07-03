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
    @Column(nullable = false, length = 16)
    private String type;

    // [smsong] 최대 수용 인원 (커플=2 고정, 친구/가족=2~50)
    private Integer maxMembers;

    private LocalDateTime createdAt;

    @PrePersist
    public void prePersist() {
        if (this.createdAt == null) this.createdAt = LocalDateTime.now();
    }
}
