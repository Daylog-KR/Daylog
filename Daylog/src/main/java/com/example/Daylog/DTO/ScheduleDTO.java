package com.example.Daylog.DTO;

import com.example.Daylog.Entity.ScheduleEntity;
import com.example.Daylog.Entity.UserEntity;
import lombok.*;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;

// [B] edit by smsong - #12 일정 DTO (ChecklistDTO 와 동일 패턴)
@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class ScheduleDTO {
    private Long id;
    private String title;
    private String content;
    private LocalDate scheduleDate;   // 달력 날짜 (필수)
    private LocalTime startTime;      // 종일이면 null
    // [B] edit by smsong - #21 원시 boolean 대신 래퍼로 받는다.
    //  클라이언트가 값을 빼먹거나 null 로 보내도 400 이 나지 않고 기본값으로 처리된다.
    private Boolean allDay;
    private Boolean done;
    private Boolean deleted;
    // [E] edit by smsong
    private String color;
    private String ownerUid;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private String lastEditorUid;
    private LocalDateTime trashedAt;
    private Integer daysUntilAutoDelete;

    public static ScheduleDTO entityToDto(ScheduleEntity e) {
        String ownerUid = (e.getOwner() != null) ? e.getOwner().getUid() : null;
        return ScheduleDTO.builder()
                .id(e.getId())
                .title(e.getTitle())
                .content(e.getContent())
                .scheduleDate(e.getScheduleDate())
                .startTime(e.getStartTime())
                .allDay(e.isAllDay())
                .done(e.isDone())
                .color(e.getColor())
                .deleted(e.isDeleted())
                .ownerUid(ownerUid)
                .createdAt(e.getCreatedAt())
                .updatedAt(e.getUpdatedAt() != null ? e.getUpdatedAt() : e.getCreatedAt())
                .lastEditorUid(e.getLastEditorUid() != null ? e.getLastEditorUid() : ownerUid)
                .trashedAt(e.getTrashedAt())
                .build();
    }

    // null 을 기본값으로 접는다 (allDay 는 안 주면 '종일'로 본다)
    public boolean isAllDayOrDefault() { return allDay == null || allDay; }
    public boolean isDoneOrDefault()   { return done != null && done; }

    public ScheduleEntity dtoToEntity(UserEntity owner) {
        boolean ad = isAllDayOrDefault();
        return ScheduleEntity.builder()
                .id(id)
                .title(title)
                .content(content)
                .scheduleDate(scheduleDate)
                .startTime(ad ? null : startTime)
                .allDay(ad)
                .done(isDoneOrDefault())
                .color(color)
                .deleted(deleted != null && deleted)
                .owner(owner)
                .createdAt(createdAt)
                .build();
    }
}
// [E] edit by smsong
