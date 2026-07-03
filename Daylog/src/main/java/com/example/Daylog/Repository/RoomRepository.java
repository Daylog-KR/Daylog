package com.example.Daylog.Repository;

import com.example.Daylog.Entity.RoomEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import java.util.List;
import java.util.Optional;

public interface RoomRepository extends JpaRepository<RoomEntity, Long> {
    Optional<RoomEntity> findByInviteCode(String inviteCode);
    boolean existsByInviteCode(String inviteCode);
    List<RoomEntity> findByOwnerUid(String ownerUid);

    // [smsong] 타입 없이 생성됐던 기존 방들의 type 을 COUPLE 로 채움(마이그레이션)
    @Modifying
    @Query("UPDATE rooms r SET r.type = 'COUPLE' WHERE r.type IS NULL")
    int backfillNullType();
}
