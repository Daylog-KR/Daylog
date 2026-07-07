package com.example.Daylog.Repository;

import com.example.Daylog.Entity.PermissionEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

// [smsong] 방별 사용자 권한 저장소
public interface PermissionRepository extends JpaRepository<PermissionEntity, Long> {
    Optional<PermissionEntity> findByRoomIdAndUid(Long roomId, String uid);
    List<PermissionEntity> findByRoomIdOrderByAccessAllowedDescUpdatedAtDesc(Long roomId);
    // [B] edit by smsong - 방 진입 알림용: 대기중(PENDING) 접근 요청만 (오래된 요청 먼저)
    List<PermissionEntity> findByRoomIdAndRequestStatusOrderByRequestedAtAsc(Long roomId, String requestStatus);
    // 방 삭제 시 해당 방의 권한행 일괄 정리 (고아 행 방지)
    void deleteByRoomId(Long roomId);
    // [E] edit by smsong

    // [B] edit by smsong - '요청 대기중인 방' 탭용: 내가 요청(PENDING)/거절(REJECTED)된 방 조회
    List<PermissionEntity> findByUidAndRequestStatusInOrderByRequestedAtDesc(String uid, List<String> statuses);
    // [E] edit by smsong
}
