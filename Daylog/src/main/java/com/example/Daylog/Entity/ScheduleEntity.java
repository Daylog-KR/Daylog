package com.example.Daylog.Entity;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;

// [B] edit by smsong - #12 체크리스트 달력의 '일정'
//  · 방(roomId) 단위로 공유되는 예정 기록. 체크리스트 달력에 가볼곳(plannedDate)과 함께 표시된다.
//  · 사진은 갖지 않는다(가볼곳/추억과의 역할 구분). 필요해지면 ChecklistEntity 패턴으로 확장.
@Entity(name = "schedules")
@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class ScheduleEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String title;

    @Column(length = 2000)
    private String content;

    /** 달력에 찍히는 날짜 (필수) */
    @Column(nullable = false)
    private LocalDate scheduleDate;

    /** 시작 시각 — 종일 일정이면 null */
    private LocalTime startTime;

    /** 종일 여부 */
    @Column(nullable = false)
    @Builder.Default
    private boolean allDay = true;


    // [B] edit by smsong - #27 푸시 알림 예약 (1차 / 2차)
    //  값: NONE / SAME_DAY / D1 / D2 / W1  — 매일 오전 9시에 도는 ReminderScheduler 가 읽는다.
    //  둘 다 기본은 NONE(알림 없음).
    @Column(length = 16)
    private String remind1;

    @Column(length = 16)
    private String remind2;
    // [E] edit by smsong

    /** 달력 점 색상 (#RRGGBB). 없으면 프론트 기본색 */
    @Column(length = 16)
    private String color;

    /** 소속 방 — 이 방의 멤버끼리만 공유 */
    @Column(nullable = false)
    private Long roomId;

    /** 휴지통(소프트 삭제) */
    @Column(nullable = false)
    private boolean deleted;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "owner_id")
    @JsonIgnore
    private UserEntity owner;

    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private String lastEditorUid;
    /** 휴지통으로 이동한 시각 (30일 자동 삭제 기준) */
    private LocalDateTime trashedAt;

    @PrePersist
    public void prePersist() {
        if (this.createdAt == null) this.createdAt = LocalDateTime.now();
        if (this.updatedAt == null) this.updatedAt = this.createdAt;
    }
}
// [E] edit by smsong
