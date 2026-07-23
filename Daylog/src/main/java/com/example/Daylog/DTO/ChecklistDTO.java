package com.example.Daylog.DTO;

import com.example.Daylog.Entity.ChecklistEntity;
import com.example.Daylog.Entity.UserEntity;
import lombok.*;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class ChecklistDTO {
    private Long id;
    private String title;
    private String content;
    private Double lat;   // 필수 위치 데이터
    private Double lng;
    private String placeName; // 큰 영역 (주소)
    private String address;   // 상세 주소
    private String mediaURL;            // 첫 이미지(호환용 · 썸네일)
    private List<String> mediaUrls;     // 전체 이미지(순서)
    private List<String> mediaOrder;    // 입력 전용: 정렬 토큰(기존 URL 또는 "$NEW$")
    private String type;      // 타입 (카페/식당/장소 등)
    private boolean deleted;  // 휴지통 여부
    private boolean visited;  // 다녀왔는지 여부
    private LocalDate visitedDate; // 다녀온 날짜 (선택)
    // [B] edit by smsong - #12
    private LocalDate plannedDate; // 갈 예정일 (달력 표시용)
    private String remind1;        // [B][E] #27 NONE / SAME_DAY / D1 / D2 / W1
    private String remind2;
    private boolean archived;      // 보관함 여부
    private LocalDateTime archivedAt;
    // [E] edit by smsong
    private String ownerUid;
    private LocalDateTime createdAt;
    // [B] edit by smsong - 마지막 수정 시각/수정자 (조회 전용)
    private LocalDateTime updatedAt;
    private String lastEditorUid;
    // 휴지통 관련 (조회 전용): 휴지통 이동 시각 + 자동삭제까지 남은 일수
    private LocalDateTime trashedAt;
    private Integer daysUntilAutoDelete;
    // [E] edit by smsong

    // Entity -> DTO
    public static ChecklistDTO entityToDto(ChecklistEntity e) {
        List<String> urls = (e.getMediaUrls() != null) ? new ArrayList<>(e.getMediaUrls()) : new ArrayList<>();
        if (urls.isEmpty() && e.getMediaURL() != null && !e.getMediaURL().isEmpty()) {
            urls.add(e.getMediaURL());
        }
        String first = !urls.isEmpty() ? urls.get(0) : null;
        String ownerUid = (e.getOwner() != null) ? e.getOwner().getUid() : null;
        return ChecklistDTO.builder()
                .id(e.getId())
                .title(e.getTitle())
                .content(e.getContent())
                .lat(e.getLat())
                .lng(e.getLng())
                .placeName(e.getPlaceName())
                .address(e.getAddress())
                .mediaURL(first)
                .mediaUrls(urls)
                .type(e.getType())
                .deleted(e.isDeleted())
                .visited(e.isVisited())
                .visitedDate(e.getVisitedDate())
                // [B] edit by smsong - #12
                .plannedDate(e.getPlannedDate())
                .remind1(e.getRemind1())
                .remind2(e.getRemind2())
                .archived(e.isArchived())
                .archivedAt(e.getArchivedAt())
                // [E] edit by smsong
                .ownerUid(ownerUid)
                .createdAt(e.getCreatedAt())
                // [B] edit by smsong - 마지막 수정 정보 (없으면 생성 시점/작성자로 폴백 → 기존 레코드 호환)
                .updatedAt(e.getUpdatedAt() != null ? e.getUpdatedAt() : e.getCreatedAt())
                .lastEditorUid(e.getLastEditorUid() != null ? e.getLastEditorUid() : ownerUid)
                .trashedAt(e.getTrashedAt())
                // [E] edit by smsong
                .build();
    }

    // DTO -> Entity
    public ChecklistEntity dtoToEntity(UserEntity owner) {
        return ChecklistEntity.builder()
                .id(id)
                .title(title)
                .content(content)
                .lat(lat)
                .lng(lng)
                .placeName(placeName)
                .address(address)
                .mediaURL(mediaURL)
                .mediaUrls(mediaUrls != null ? new ArrayList<>(mediaUrls) : new ArrayList<>())
                .type(type)
                .deleted(deleted)
                .visited(visited)
                .visitedDate(visitedDate)
                .plannedDate(plannedDate)   // [B][E] edit by smsong - #12
                .remind1(remind1)
                .remind2(remind2)
                .owner(owner)
                .createdAt(createdAt)
                .build();
    }
}
