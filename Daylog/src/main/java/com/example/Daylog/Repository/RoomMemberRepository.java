package com.example.Daylog.Repository;

import com.example.Daylog.Entity.RoomMemberEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface RoomMemberRepository extends JpaRepository<RoomMemberEntity, Long> {
    List<RoomMemberEntity> findByUid(String uid);
    List<RoomMemberEntity> findByRoomId(Long roomId);
    Optional<RoomMemberEntity> findByRoomIdAndUid(Long roomId, String uid);
    boolean existsByRoomIdAndUid(Long roomId, String uid);
    long countByRoomId(Long roomId);
    void deleteByRoomId(Long roomId);
    void deleteByRoomIdAndUid(Long roomId, String uid);
}
