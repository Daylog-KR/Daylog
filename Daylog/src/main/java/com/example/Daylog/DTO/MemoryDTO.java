package com.example.Daylog.DTO;

import com.example.Daylog.Entity.MemoryEntity;
import com.example.Daylog.Entity.RoomEntity;
import com.example.Daylog.Entity.UserEntity;
import lombok.*;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class MemoryDTO {
    private Long id;
    private String title;
    private String content;
    private Double lat; // 필수 위치 데이터
    private Double lng;
    private String placeName; // 장소 이름 (선택)
    private String address;   // 상세 주소 (선택)
    private String mediaURL;            // 첫 이미지(호환용 · 썸네일)
    private List<String> mediaUrls;     // 전체 이미지(순서)
    private List<String> mediaOrder;    // 입력 전용: 정렬 토큰(기존 URL 또는 "$NEW$")
    private String ownerUid;
    private boolean deleted;
    private LocalDateTime createdAt;
    // [B] edit by smsong - 마지막 수정 시각/수정자 (조회 전용)
    private LocalDateTime updatedAt;
    private String lastEditorUid;
    // 휴지통 관련 (조회 전용): 휴지통 이동 시각 + 자동삭제까지 남은 일수
    private LocalDateTime trashedAt;
    private Integer daysUntilAutoDelete;
    // [E] edit by smsong

    // Entity -> DTO 변환
    public static MemoryDTO entityToDto(MemoryEntity e) {
        List<String> urls = (e.getMediaUrls() != null) ? new ArrayList<>(e.getMediaUrls()) : new ArrayList<>();
        // 레거시(단일 mediaURL만 있는) 레코드 호환: 리스트가 비면 단일 값을 1장으로 노출
        if (urls.isEmpty() && e.getMediaURL() != null && !e.getMediaURL().isEmpty()) {
            urls.add(e.getMediaURL());
        }
        String first = !urls.isEmpty() ? urls.get(0) : null;
        String ownerUid = (e.getOwner() != null) ? e.getOwner().getUid() : null;
        return MemoryDTO.builder()
                .id(e.getId())
                .title(e.getTitle())
                .content(e.getContent())
                .lat(e.getLat())
                .lng(e.getLng())
                .placeName(e.getPlaceName())
                .address(e.getAddress())
                .mediaURL(first)
                .mediaUrls(urls)
                .ownerUid(ownerUid)
                .deleted(e.isDeleted())
                .createdAt(e.getCreatedAt())
                // [B] edit by smsong - 마지막 수정 정보 (없으면 생성 시점/작성자로 폴백 → 기존 레코드 호환)
                .updatedAt(e.getUpdatedAt() != null ? e.getUpdatedAt() : e.getCreatedAt())
                .lastEditorUid(e.getLastEditorUid() != null ? e.getLastEditorUid() : ownerUid)
                .trashedAt(e.getTrashedAt())
                // [E] edit by smsong
                .build();
    }

    // DTO -> Entity 변환
    public MemoryEntity dtoToEntity(UserEntity owner) {
        return MemoryEntity.builder()
                .id(id)
                .title(title)
                .content(content)
                .lat(lat)
                .lng(lng)
                .placeName(placeName)
                .address(address)
                .mediaURL(mediaURL)
                .mediaUrls(mediaUrls != null ? new ArrayList<>(mediaUrls) : new ArrayList<>())
                .owner(owner)
                .deleted(deleted)
                .createdAt(createdAt)
                .build();
    }

    // [smsong] 방 정보 응답 DTO
    @NoArgsConstructor
    @AllArgsConstructor
    @Getter
    @Setter
    @Builder
    public static class RoomDTO {
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
        // [B] edit by smsong - 요청자의 이 방에 대한 상태: OWNER / MEMBER / PENDING / REJECTED / NONE
        private String myStatus;
        private String rejectReason;  // 거절됨(REJECTED)일 때 방장이 남긴 사유(강퇴 사유 포함)
        private Boolean rejectSeen;   // 거절/강퇴 안내를 이미 봤는지(rooms 페이지 1회 안내용)
        private Boolean kicked;       // 강퇴로 인한 REJECTED 인지(=true) 아니면 입장요청 거절(=false)
        private Boolean acceptSeen;   // [smsong] 입장 수락 안내를 이미 봤는지(false=수락됨 최초 안내 대상). '내가 속한 방' 목록용
        // [E] edit by smsong
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
                    .myStatus(isOwner ? "OWNER" : "MEMBER") // [smsong] 기본: 멤버 목록에서 온 방
                    .createdAt(r.getCreatedAt())
                    .build();
        }

        // [B] edit by smsong - 미리보기/요청 대기 목록용: 멤버가 아닌 방(초대 코드 미리보기, 요청/거절 상태)
        //  초대 코드는 노출하지 않는다(아직 이 방의 멤버가 아니므로).
        public static RoomDTO preview(RoomEntity r, String requesterUid, long memberCount,
                                      String myStatus, String rejectReason, Boolean rejectSeen) {
            return preview(r, requesterUid, memberCount, myStatus, rejectReason, rejectSeen, null);
        }

        // [smsong] kicked 포함 오버로드 — 강퇴로 인한 REJECTED 를 구분(rooms 안내 문구용)
        public static RoomDTO preview(RoomEntity r, String requesterUid, long memberCount,
                                      String myStatus, String rejectReason, Boolean rejectSeen, Boolean kicked) {
            boolean isOwner = r.getOwnerUid() != null && r.getOwnerUid().equals(requesterUid);
            return RoomDTO.builder()
                    .id(r.getId())
                    .name(r.getName())
                    .ownerUid(r.getOwnerUid())
                    .type(r.getType())
                    .imageUrl(r.getImageUrl())
                    .memberCount(memberCount)
                    .owner(isOwner)
                    .myStatus(myStatus)
                    .rejectReason(rejectReason)
                    .rejectSeen(rejectSeen)
                    .kicked(kicked)
                    .createdAt(r.getCreatedAt())
                    .build();
        }
        // [E] edit by smsong
    }
}
