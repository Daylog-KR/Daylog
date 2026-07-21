package com.example.Daylog.Repository;

import com.example.Daylog.Entity.UserSessionEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

// [B] edit by smsong - 로그인 세션(기기) 조회/관리
public interface UserSessionRepository extends JpaRepository<UserSessionEntity, Long> {
    List<UserSessionEntity> findByUid(String uid);
    Optional<UserSessionEntity> findByUidAndDeviceId(String uid, String deviceId);
    Optional<UserSessionEntity> findByToken(String token);
    void deleteByUidAndDeviceId(String uid, String deviceId);
    void deleteByUid(String uid);
    long countByUid(String uid);
}
// [E] edit by smsong
