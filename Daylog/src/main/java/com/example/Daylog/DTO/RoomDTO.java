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
    private String coupleLeftUid;  // 커플 '나' 슬롯
    private String coupleRightUid; // 커플 '상대방' 슬롯
    private String coupleSince;    // 커플 디데이 기준일
    private String imageUrl;       // [smsong] 방 대표 이미지 URL (없으면 null)
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
                .coupleLeftUid(r.getCoupleLeftUid())
                .coupleRightUid(r.getCoupleRightUid())
                .coupleSince(r.getCoupleSince())
                .imageUrl(r.getImageUrl()) // [smsong] 방 대표 이미지
                .memberCount(memberCount)
                .owner(isOwner)
                .createdAt(r.getCreatedAt())
                .build();
    }
}
