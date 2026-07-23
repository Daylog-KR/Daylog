package com.example.Daylog.Repository;

import com.example.Daylog.Entity.ChecklistEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

public interface ChecklistRepository extends JpaRepository<ChecklistEntity, Long> {

    // 특정 유저(owner)가 작성한 가볼곳 목록
    List<ChecklistEntity> findByOwnerUid(String uid);

    // 휴지통에 없는(정상) 가볼곳만 조회 — 지도/목록 노출용
    List<ChecklistEntity> findByDeletedFalse();

    // [smsong] 방 스코프: 해당 방의 정상 가볼곳만
    List<ChecklistEntity> findByRoomIdAndDeletedFalse(Long roomId);

    // [B] edit by smsong - #12 일반 화면(지도/목록/달력)에 노출할 목록 — 보관함 제외
    List<ChecklistEntity> findByRoomIdAndDeletedFalseAndArchivedFalse(Long roomId);

    // [B] edit by smsong - #12 보관함 목록 — 방 전체 공유(작성자 제한 없음)
    List<ChecklistEntity> findByRoomIdAndArchivedTrueAndDeletedFalseOrderByVisitedDateDesc(Long roomId);
    // [E] edit by smsong

    // [smsong] 방 스코프 휴지통
    List<ChecklistEntity> findByOwnerUidAndRoomIdAndDeletedTrue(String uid, Long roomId);

    // [smsong] 마이그레이션: roomId 가 비어있는 기존 가볼곳을 기본 방으로 이관
    @Modifying
    @Query("UPDATE checklists c SET c.roomId = :roomId WHERE c.roomId IS NULL")
    int assignNullRoom(@Param("roomId") Long roomId);

    // 내가 휴지통으로 보낸 가볼곳 목록
    List<ChecklistEntity> findByOwnerUidAndDeletedTrue(String uid);

    // [B] edit by smsong - 휴지통 30일 자동 삭제: 이동(trashedAt)된 지 기준시각 이전인 가볼곳
    List<ChecklistEntity> findByDeletedTrueAndTrashedAtBefore(LocalDateTime cutoff);
    // [E] edit by smsong

    // [B][E] edit by smsong - #27 알림 스케줄러용: 그 날짜에 갈 예정인 체크리스트
    //  (휴지통/보관함 제외 — 이미 다녀온 곳에 예정 알림을 보내지 않는다)
    List<ChecklistEntity> findByPlannedDateAndDeletedFalseAndArchivedFalse(LocalDate plannedDate);

    // [B] edit by smsong - #4 '1년 전 오늘 다녀왔어요' 리마인더용.
    //  '다녀왔어요' 로 표시되고 휴지통이 아닌 가볼곳 중, 다녀온 날짜가 지정일(= N년 전 오늘)인 것.
    //  VisitAnniversaryScheduler 가 하루 1회 호출한다.
    List<ChecklistEntity> findByVisitedTrueAndDeletedFalseAndVisitedDate(LocalDate visitedDate);
    // [E] edit by smsong
}
