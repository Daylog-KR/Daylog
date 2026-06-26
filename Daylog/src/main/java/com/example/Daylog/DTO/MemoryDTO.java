package com.example.Daylog.DTO;

import com.example.Daylog.Entity.MemoryEntity;
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
}
