package com.example.Daylog.DTO;

import com.example.Daylog.Entity.RoomEntity;
import com.example.Daylog.Entity.RoomMemberEntity;
import com.example.Daylog.Repository.ChecklistRepository;
import com.example.Daylog.Repository.MemoryRepository;
import com.example.Daylog.Repository.RoomMemberRepository;
import com.example.Daylog.Repository.RoomRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

// [smsong] 최초 1회: 기존(송성민·강미르) 데이터를 기본 방 하나로 이관
//  - 기본 방 "우리의 추억" (초대코드 DAYLOG), 방장=송성민
//  - 멤버: 송성민(3635939452), 강미르(4958158544)
//  - roomId 가 비어있는 기존 추억/가볼곳 → 기본 방으로 귀속
@Component
@Order(1)
@RequiredArgsConstructor
public class RoomBootstrap implements CommandLineRunner {

    private final RoomRepository roomRepository;
    private final RoomMemberRepository roomMemberRepository;
    private final MemoryRepository memoryRepository;
    private final ChecklistRepository checklistRepository;

    private static final String DEFAULT_CODE = "DAYLOG";
    private static final String OWNER_UID = "3635939452";   // 송성민
    private static final String PARTNER_UID = "4958158544"; // 강미르
    private static final String DEFAULT_NAME = "우리의 추억";

    @Override
    @Transactional
    public void run(String... args) {
        // [smsong] 기존(타입 없이 생성됐던) 방들의 null 타입을 COUPLE 로 백필 → NOT NULL/조회 오류 방지
        roomRepository.backfillNullType();

        // 기본 방이 이미 있으면 재사용(멱등)
        RoomEntity room = roomRepository.findByInviteCode(DEFAULT_CODE).orElseGet(() ->
                roomRepository.save(RoomEntity.builder()
                        .name(DEFAULT_NAME)
                        .ownerUid(OWNER_UID)
                        .inviteCode(DEFAULT_CODE)
                        .type("COUPLE")   // [smsong] 송성민·강미르 기본 방은 커플 타입
                        .build())
        );
        // 기존 기본 방의 타입이 비어있으면 COUPLE 로 보정
        if (room.getType() == null) {
            room.setType("COUPLE");
            room = roomRepository.save(room);
        }
        // [smsong] 기본 커플 슬롯: '나'=송성민, '상대방'=강미르 (미설정 시에만)
        boolean touched = false;
        if (room.getCoupleLeftUid() == null)  { room.setCoupleLeftUid(OWNER_UID);   touched = true; }
        if (room.getCoupleRightUid() == null) { room.setCoupleRightUid(PARTNER_UID); touched = true; }
        if (touched) room = roomRepository.save(room);

        // 멤버 보장(중복 방지)
        ensureMember(room.getId(), OWNER_UID);
        ensureMember(room.getId(), PARTNER_UID);

        // roomId 없는 기존 콘텐츠를 기본 방으로 이관 (첫 실행에만 실제 반영)
        int m = memoryRepository.assignNullRoom(room.getId());
        int c = checklistRepository.assignNullRoom(room.getId());
        if (m > 0 || c > 0) {
            System.out.println("[RoomBootstrap] 기본 방(" + room.getId() + ")으로 이관: 추억 " + m + "건, 가볼곳 " + c + "건");
        }
    }

    private void ensureMember(Long roomId, String uid) {
        if (!roomMemberRepository.existsByRoomIdAndUid(roomId, uid)) {
            roomMemberRepository.save(RoomMemberEntity.builder().roomId(roomId).uid(uid).build());
        }
    }
}
