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
    private boolean allDay;
    private boolean done;
    private String color;
    private boolean deleted;
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

    public ScheduleEntity dtoToEntity(UserEntity owner) {
        return ScheduleEntity.builder()
                .id(id)
                .title(title)
                .content(content)
                .scheduleDate(scheduleDate)
                .startTime(allDay ? null : startTime)
                .allDay(allDay)
                .done(done)
                .color(color)
                .deleted(deleted)
                .owner(owner)
                .createdAt(createdAt)
                .build();
    }
}
// [E] edit by smsong
