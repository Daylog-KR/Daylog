package com.example.Daylog.Repository;

import com.example.Daylog.Entity.PushSubscriptionEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

// [B] edit by smsong - 웹푸시 구독 저장소
public interface PushSubscriptionRepository extends JpaRepository<PushSubscriptionEntity, Long> {
    List<PushSubscriptionEntity> findByUid(String uid);
    List<PushSubscriptionEntity> findByUidIn(List<String> uids);
    Optional<PushSubscriptionEntity> findByEndpoint(String endpoint);
    boolean existsByEndpoint(String endpoint);
    void deleteByEndpoint(String endpoint);
}
