package com.example.Daylog.Repository;

import com.example.Daylog.Entity.MemoryEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;

public interface MemoryRepository extends JpaRepository<MemoryEntity, Long> {

    // 특정 유저(owner)가 작성한 추억 목록 조회
    List<MemoryEntity> findByOwnerUid(String uid);

    // 휴지통에 없는(정상) 추억만 조회 — 지도/타임라인 노출용
    List<MemoryEntity> findByDeletedFalse();

    // 내가 휴지통으로 보낸 추억 목록
    List<MemoryEntity> findByOwnerUidAndDeletedTrue(String uid);

    // 필요 시 제목이나 내용으로 추억 검색 (부동산 검색 패턴 오마주)
    @Query("SELECT m FROM memories m WHERE " +
            "LOWER(m.title) LIKE LOWER(CONCAT('%', :keyword, '%')) OR " +
            "LOWER(m.content) LIKE LOWER(CONCAT('%', :keyword, '%'))")
    List<MemoryEntity> searchMemories(@Param("keyword") String keyword);
}