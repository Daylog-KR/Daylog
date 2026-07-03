package com.example.Daylog.Repository;

import com.example.Daylog.Entity.RoomEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface RoomRepository extends JpaRepository<RoomEntity, Long> {
    Optional<RoomEntity> findByInviteCode(String inviteCode);
    boolean existsByInviteCode(String inviteCode);
    List<RoomEntity> findByOwnerUid(String ownerUid);
}
