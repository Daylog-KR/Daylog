package com.example.Daylog.Repository;

import com.example.Daylog.Entity.NotificationEntity;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

// [B] edit by smsong - 알림함 저장소
public interface NotificationRepository extends JpaRepository<NotificationEntity, Long> {

    List<NotificationEntity> findByRecipientUidOrderByCreatedAtDesc(String recipientUid, Pageable pageable);

    long countByRecipientUidAndIsReadFalse(String recipientUid);

    @Modifying
    @Query("update notifications n set n.isRead = true where n.recipientUid = :uid and n.isRead = false")
    int markAllRead(@Param("uid") String uid);

    // [B] edit by smsong - #1 방별 알림 (roomId 없는 기존 알림도 함께 노출 → 배지/목록 누락 방지)
    @Query("select n from notifications n where n.recipientUid = :uid and (n.roomId = :roomId or n.roomId is null) order by n.createdAt desc")
    List<NotificationEntity> findByRecipientUidAndRoomIdOrderByCreatedAtDesc(@Param("uid") String recipientUid, @Param("roomId") Long roomId, Pageable pageable);

    @Query("select count(n) from notifications n where n.recipientUid = :uid and n.isRead = false and (n.roomId = :roomId or n.roomId is null)")
    long countByRecipientUidAndRoomIdAndIsReadFalse(@Param("uid") String recipientUid, @Param("roomId") Long roomId);

    @Modifying
    @Query("update notifications n set n.isRead = true where n.recipientUid = :uid and (n.roomId = :roomId or n.roomId is null) and n.isRead = false")
    int markRoomRead(@Param("uid") String uid, @Param("roomId") Long roomId);
}
