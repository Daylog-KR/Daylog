package com.example.Daylog.Repository;

import com.example.Daylog.Entity.ChatReadEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

// [B] edit by smsong - 방 채팅 읽음 상태 조회
public interface ChatReadRepository extends JpaRepository<ChatReadEntity, Long> {

    Optional<ChatReadEntity> findByRoomIdAndUid(Long roomId, String uid);

    // 방의 모든 멤버 읽음 상태 (읽은/안읽은 수 계산용)
    List<ChatReadEntity> findByRoomId(Long roomId);

    void deleteByRoomId(Long roomId);
}
// [E] edit by smsong
