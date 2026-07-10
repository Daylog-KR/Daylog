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
}
