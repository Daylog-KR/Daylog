package com.example.Daylog.DTO;

import com.example.Daylog.Entity.CommentEntity;
import com.example.Daylog.Entity.UserEntity;
import lombok.*;

import java.util.ArrayList;
import java.util.List;

@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class CommentDTO {
    private Long id;
    private String content;

    private Long memoryId;
    private String memoryTitle;
    private Long checklistId;
    private Long parentId;

    // 작성자 표시용 정보
    private String ownerUid;
    private String ownerName;
    private String ownerNickname;
    private String ownerProfileURL;

    private boolean deleted;

    private String createdAt;
    private String updatedAt;

    // 대댓글 목록 (최상위 댓글에만 채워짐)
    @Builder.Default
    private List<CommentDTO> replies = new ArrayList<>();

    // Entity -> DTO (대댓글 제외 단건 변환)
    public static CommentDTO entityToDto(CommentEntity entity) {
        UserEntity owner = entity.getOwner();
        return CommentDTO.builder()
                .id(entity.getId())
                .content(entity.getContent())
                .memoryId(entity.getMemory() != null ? entity.getMemory().getId() : null)
                .memoryTitle(entity.getMemory() != null ? entity.getMemory().getTitle() : null)
                .checklistId(entity.getChecklist() != null ? entity.getChecklist().getId() : null)
                .parentId(entity.getParent() != null ? entity.getParent().getId() : null)
                .ownerUid(owner != null ? owner.getUid() : null)
                .ownerName(owner != null ? owner.getName() : null)
                .ownerNickname(owner != null ? owner.getNickname() : null)
                .ownerProfileURL(owner != null ? owner.getProfileURL() : null)
                .deleted(entity.isDeleted())
                .createdAt(entity.getCreatedAt() != null ? entity.getCreatedAt().toString() : null)
                .updatedAt(entity.getUpdatedAt() != null ? entity.getUpdatedAt().toString() : null)
                .replies(new ArrayList<>())
                .build();
    }

    // Entity -> DTO (대댓글 포함)
    public static CommentDTO entityToDtoWithReplies(CommentEntity entity, List<CommentEntity> childEntities) {
        CommentDTO dto = entityToDto(entity);
        List<CommentDTO> replyDtos = new ArrayList<>();
        if (childEntities != null) {
            for (CommentEntity child : childEntities) {
                replyDtos.add(entityToDto(child));
            }
        }
        dto.setReplies(replyDtos);
        return dto;
    }
}