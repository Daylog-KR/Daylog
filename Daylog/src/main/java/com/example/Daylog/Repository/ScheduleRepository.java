package com.example.Daylog.Repository;

import com.example.Daylog.Entity.ScheduleEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

// [B] edit by smsong - #12 일정 조회
public interface ScheduleRepository extends JpaRepository<ScheduleEntity, Long> {

    /** 방의 정상 일정 전체 (달력/목록 공용) */
    List<ScheduleEntity> findByRoomIdAndDeletedFalseOrderByScheduleDateAsc(Long roomId);

    /** 방의 특정 기간 일정 (달력 월 단위 조회용) */
    List<ScheduleEntity> findByRoomIdAndDeletedFalseAndScheduleDateBetweenOrderByScheduleDateAsc(
            Long roomId, LocalDate from, LocalDate to);

    /** 내가 휴지통으로 보낸 일정 */
    List<ScheduleEntity> findByOwnerUidAndRoomIdAndDeletedTrue(String uid, Long roomId);

    /** 휴지통 30일 자동 삭제 대상 */
    List<ScheduleEntity> findByDeletedTrueAndTrashedAtBefore(LocalDateTime cutoff);
}
// [E] edit by smsong
