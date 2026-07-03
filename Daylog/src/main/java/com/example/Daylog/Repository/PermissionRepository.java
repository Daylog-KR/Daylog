package com.example.Daylog.Repository;

import com.example.Daylog.Entity.PermissionEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

// [smsong] 방별 사용자 권한 저장소
public interface PermissionRepository extends JpaRepository<PermissionEntity, Long> {
    Optional<PermissionEntity> findByRoomIdAndUid(Long roomId, String uid);
    List<PermissionEntity> findByRoomIdOrderByAccessAllowedDescUpdatedAtDesc(Long roomId);
}
