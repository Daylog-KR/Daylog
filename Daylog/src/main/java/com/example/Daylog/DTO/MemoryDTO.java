package com.example.Daylog.DTO;

import com.example.Daylog.Entity.MemoryEntity;
import com.example.Daylog.Entity.UserEntity;
import lombok.*;

import java.time.LocalDateTime;

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
    private String mediaURL;
    private String ownerUid;
    private boolean deleted;
    private LocalDateTime createdAt;

    // Entity -> DTO 변환 (BuildingDTO 패턴 오마주)
    public static MemoryDTO entityToDto(MemoryEntity memoryEntity) {
        String ownerUid = (memoryEntity.getOwner() != null) ? memoryEntity.getOwner().getUid() : null;

        return new MemoryDTO(
                memoryEntity.getId(),
                memoryEntity.getTitle(),
                memoryEntity.getContent(),
                memoryEntity.getLat(),
                memoryEntity.getLng(),
                memoryEntity.getPlaceName(),
                memoryEntity.getAddress(),
                memoryEntity.getMediaURL(),
                ownerUid,
                memoryEntity.isDeleted(),
                memoryEntity.getCreatedAt()
        );
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
                .owner(owner)
                .deleted(deleted)
                .build();
    }
}