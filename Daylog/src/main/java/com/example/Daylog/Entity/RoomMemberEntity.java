package com.example.Daylog.Entity;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;

// [smsong] 방 멤버십 (방 ↔ 유저 다대다 연결)
@Entity(name = "room_members")
@Table(uniqueConstraints = @UniqueConstraint(columnNames = {"roomId", "uid"}))
@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class RoomMemberEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long roomId;

    @Column(nullable = false)
    private String uid;

    private LocalDateTime joinedAt;

    @PrePersist
    public void prePersist() {
        if (this.joinedAt == null) this.joinedAt = LocalDateTime.now();
    }
}
