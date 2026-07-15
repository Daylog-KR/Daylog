package com.example.Daylog.Repository;

import com.example.Daylog.Entity.MemoryEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.time.LocalDateTime;
import java.util.List;

public interface MemoryRepository extends JpaRepository<MemoryEntity, Long> {

    // 특정 유저(owner)가 작성한 추억 목록 조회
    List<MemoryEntity> findByOwnerUid(String uid);

    // 휴지통에 없는(정상) 추억만 조회 — 지도/타임라인 노출용
    List<MemoryEntity> findByDeletedFalse();

    // [smsong] 방 스코프: 해당 방의 정상 추억만
    List<MemoryEntity> findByRoomIdAndDeletedFalse(Long roomId);

    // [B] edit by smsong - #2 '오늘의 추억' 리마인더용
    //  해당 방에 지정 기간(= 오늘 00:00:00 ~ 23:59:59.999999999) 으로 기록된 '정상(휴지통 아님)' 추억이 하나라도 있는지.
    //  기준 필드는 createdAt — 달력/타임라인이 '추억 날짜'로 쓰는 값과 동일하다
    //  (realCreatedAt 은 DB 실제 저장 시각이라 사진 촬영일로 덮인 경우 달력과 어긋난다).
    boolean existsByRoomIdAndDeletedFalseAndCreatedAtBetween(Long roomId, LocalDateTime start, LocalDateTime end);
    // [E] edit by smsong

    // [smsong] 방 스코프 휴지통: 내가 이 방에서 휴지통으로 보낸 추억
    List<MemoryEntity> findByOwnerUidAndRoomIdAndDeletedTrue(String uid, Long roomId);

    // [smsong] 마이그레이션: roomId 가 비어있는 기존 추억을 기본 방으로 이관
    @org.springframework.data.jpa.repository.Modifying
    @Query("UPDATE memories m SET m.roomId = :roomId WHERE m.roomId IS NULL")
    int assignNullRoom(@Param("roomId") Long roomId);

    // 내가 휴지통으로 보낸 추억 목록
    List<MemoryEntity> findByOwnerUidAndDeletedTrue(String uid);

    // [B] edit by smsong - 휴지통 30일 자동 삭제: 이동(trashedAt)된 지 기준시각 이전인 추억
    List<MemoryEntity> findByDeletedTrueAndTrashedAtBefore(LocalDateTime cutoff);
    // [E] edit by smsong

    // 필요 시 제목이나 내용으로 추억 검색 (부동산 검색 패턴 오마주)
    @Query("SELECT m FROM memories m WHERE " +
            "LOWER(m.title) LIKE LOWER(CONCAT('%', :keyword, '%')) OR " +
            "LOWER(m.content) LIKE LOWER(CONCAT('%', :keyword, '%'))")
    List<MemoryEntity> searchMemories(@Param("keyword") String keyword);
}