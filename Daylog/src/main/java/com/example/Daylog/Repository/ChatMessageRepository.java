package com.example.Daylog.Repository;

import com.example.Daylog.Entity.ChatMessageEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

// [B] edit by smsong - 방 채팅 메시지 조회/페이징
public interface ChatMessageRepository extends JpaRepository<ChatMessageEntity, Long> {

    // 최신 N개 (내림차순 → 프론트에서 뒤집어 오름차순 표시)
    List<ChatMessageEntity> findTop30ByRoomIdOrderByIdDesc(Long roomId);

    // beforeId 이전의 N개 (위로 스크롤해 과거 더 불러오기)
    List<ChatMessageEntity> findTop30ByRoomIdAndIdLessThanOrderByIdDesc(Long roomId, Long beforeId);

    // 방의 가장 최근 메시지 (배지/미리보기용)
    Optional<ChatMessageEntity> findTopByRoomIdOrderByIdDesc(Long roomId);

    // 내가 마지막으로 읽은 이후, 내가 보내지 않은 안 읽은 메시지 수 (배지)
    long countByRoomIdAndIdGreaterThanAndSenderUidNot(Long roomId, Long lastReadMessageId, String senderUid);

    // 방 삭제 시 정리
    void deleteByRoomId(Long roomId);
}
// [E] edit by smsong
