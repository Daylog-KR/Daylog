package com.example.Daylog.DTO;

import com.example.Daylog.Entity.RoomEntity;
import lombok.*;
import java.time.LocalDateTime;
import java.util.List;

// [smsong] 방 정보 응답 DTO
@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class RoomDTO {
    private Long id;
    private String name;
    private String ownerUid;
    private String inviteCode;   // 방장에게만 노출(방장이 아니면 서비스단에서 비움 가능)
    private String type;         // COUPLE / FRIEND / FAMILY
    private long memberCount;
    private boolean owner;        // 요청자가 방장인지
    private LocalDateTime createdAt;
    private List<Member> members; // 선택(멤버 목록 조회 시)

    @NoArgsConstructor
    @AllArgsConstructor
    @Getter
    @Setter
    @Builder
    public static class Member {
        private String uid;
        private String name;
        private String nickname;
        private String profileURL;
        private boolean owner;
    }

    public static RoomDTO from(RoomEntity r, String requesterUid, long memberCount) {
        boolean isOwner = r.getOwnerUid() != null && r.getOwnerUid().equals(requesterUid);
        return RoomDTO.builder()
                .id(r.getId())
                .name(r.getName())
                .ownerUid(r.getOwnerUid())
                .inviteCode(r.getInviteCode()) // 코드 공유용으로 멤버 모두에게 노출(초대 목적)
                .type(r.getType())
                .memberCount(memberCount)
                .owner(isOwner)
                .createdAt(r.getCreatedAt())
                .build();
    }
}
