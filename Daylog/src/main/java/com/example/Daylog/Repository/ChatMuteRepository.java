package com.example.Daylog.Repository;

import com.example.Daylog.Entity.ChatMuteEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

// [B] edit by smsong - 채팅 알림 끄기 저장소
public interface ChatMuteRepository extends JpaRepository<ChatMuteEntity, Long> {
    Optional<ChatMuteEntity> findByRoomIdAndUid(Long roomId, String uid);

    // 특정 방에서 채팅 알림을 끈(muted=true) 유저 목록
    List<ChatMuteEntity> findByRoomIdAndMutedTrue(Long roomId);

    void deleteByRoomId(Long roomId);

    // 이 유저가 알림을 끈 방들 (대화목록에서 muted 표시)
    List<ChatMuteEntity> findByUidAndMutedTrue(String uid);
}
// [E] edit by smsong
