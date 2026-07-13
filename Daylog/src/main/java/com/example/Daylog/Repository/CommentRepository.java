package com.example.Daylog.Repository;

import com.example.Daylog.Entity.CommentEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;

public interface CommentRepository extends JpaRepository<CommentEntity, Long> {

    // 특정 추억의 "최상위" 댓글 (대댓글 제외, 휴지통 제외)
    List<CommentEntity> findByMemory_IdAndParentIsNullAndDeletedFalseOrderByCreatedAtAsc(Long memoryId);

    // 특정 부모 댓글의 대댓글 (휴지통 제외)
    List<CommentEntity> findByParent_IdAndDeletedFalseOrderByCreatedAtAsc(Long parentId);

    // 특정 추억의 모든 댓글 (대댓글 포함 / 휴지통 제외) — 일괄 로딩용
    List<CommentEntity> findByMemory_IdAndDeletedFalseOrderByCreatedAtAsc(Long memoryId);

    // 특정 추억에 달린 모든 댓글 (영구삭제 캐스케이드용 — 휴지통 포함)
    List<CommentEntity> findByMemory_Id(Long memoryId);

    // 특정 부모의 모든 대댓글 (상태 무관)
    List<CommentEntity> findByParent_Id(Long parentId);

    // 내가 휴지통으로 보낸 댓글 목록
    List<CommentEntity> findByOwner_UidAndDeletedTrueOrderByUpdatedAtDesc(String uid);

    // ===== [smsong] 가볼곳(Checklist) 댓글 =====
    // 특정 가볼곳의 "최상위" 댓글 (대댓글 제외, 휴지통 제외)
    List<CommentEntity> findByChecklist_IdAndParentIsNullAndDeletedFalseOrderByCreatedAtAsc(Long checklistId);
    // 특정 가볼곳에 달린 모든 댓글 (영구삭제 캐스케이드용 — 휴지통 포함)
    List<CommentEntity> findByChecklist_Id(Long checklistId);

    // ===== [smsong] 댓글 수 배치 집계 (썸네일 표시용, 휴지통 제외 / 대댓글 포함) =====
    @Query("SELECT c.memory.id, COUNT(c) FROM comments c WHERE c.memory IS NOT NULL AND c.deleted = false GROUP BY c.memory.id")
    List<Object[]> countGroupByMemory();

    @Query("SELECT c.checklist.id, COUNT(c) FROM comments c WHERE c.checklist IS NOT NULL AND c.deleted = false GROUP BY c.checklist.id")
    List<Object[]> countGroupByChecklist();
}
