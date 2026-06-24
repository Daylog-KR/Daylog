package com.example.Daylog.Service;

import com.example.Daylog.DTO.CommentDTO;
import com.example.Daylog.Entity.CommentEntity;
import com.example.Daylog.Entity.MemoryEntity;
import com.example.Daylog.Entity.UserEntity;
import com.example.Daylog.Repository.CommentRepository;
import com.example.Daylog.Repository.MemoryRepository;
import com.example.Daylog.Repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;

@Service
@RequiredArgsConstructor
public class CommentService {

    private final CommentRepository commentRepository;
    private final MemoryRepository memoryRepository;
    private final UserRepository userRepository;

    private UserEntity getLoginUser(UserDetails userDetails) {
        if (userDetails == null) {
            throw new RuntimeException("로그인이 필요합니다");
        }
        return userRepository.findByUid(userDetails.getUsername())
                .orElseThrow(() -> new IllegalArgumentException("사용자를 찾을 수 없습니다"));
    }

    // 소유자 검증 (본인 댓글만 수정/삭제 가능)
    private CommentEntity getOwnedComment(Long commentId, UserDetails userDetails) {
        CommentEntity comment = commentRepository.findById(commentId)
                .orElseThrow(() -> new IllegalArgumentException("댓글을 찾을 수 없습니다"));
        String ownerUid = (comment.getOwner() != null) ? comment.getOwner().getUid() : null;
        if (userDetails == null || ownerUid == null || !ownerUid.equals(userDetails.getUsername())) {
            throw new RuntimeException("권한이 없습니다");
        }
        return comment;
    }

    // 댓글 / 대댓글 작성
    @Transactional
    public CommentDTO createComment(Long memoryId, Long parentId, String content, UserDetails userDetails) {
        UserEntity owner = getLoginUser(userDetails);

        if (memoryId == null) {
            throw new IllegalArgumentException("추억 정보가 필요합니다");
        }
        if (content == null || content.trim().isEmpty()) {
            throw new IllegalArgumentException("댓글 내용을 입력해주세요");
        }

        MemoryEntity memory = memoryRepository.findById(memoryId)
                .orElseThrow(() -> new IllegalArgumentException("추억을 찾을 수 없습니다"));

        CommentEntity.CommentEntityBuilder builder = CommentEntity.builder()
                .content(content.trim())
                .memory(memory)
                .owner(owner)
                .deleted(false);

        // 대댓글이면 부모 연결 (대댓글의 대댓글은 부모를 최상위로 평탄화)
        if (parentId != null) {
            CommentEntity parent = commentRepository.findById(parentId)
                    .orElseThrow(() -> new IllegalArgumentException("부모 댓글을 찾을 수 없습니다"));
            CommentEntity topParent = (parent.getParent() != null) ? parent.getParent() : parent;
            builder.parent(topParent);
        }

        CommentEntity saved = commentRepository.save(builder.build());
        return CommentDTO.entityToDto(saved);
    }

    // 특정 추억의 댓글 목록 (최상위 + 대댓글 트리)
    @Transactional(readOnly = true)
    public List<CommentDTO> getCommentsByMemory(Long memoryId) {
        List<CommentEntity> roots =
                commentRepository.findByMemory_IdAndParentIsNullAndDeletedFalseOrderByCreatedAtAsc(memoryId);

        List<CommentDTO> result = new ArrayList<>();
        for (CommentEntity root : roots) {
            List<CommentEntity> replies =
                    commentRepository.findByParent_IdAndDeletedFalseOrderByCreatedAtAsc(root.getId());
            result.add(CommentDTO.entityToDtoWithReplies(root, replies));
        }
        return result;
    }

    // 본인 댓글 내용 수정
    @Transactional
    public CommentDTO updateComment(Long commentId, String content, UserDetails userDetails) {
        CommentEntity comment = getOwnedComment(commentId, userDetails);
        if (content != null && !content.trim().isEmpty()) {
            comment.setContent(content.trim());
        }
        return CommentDTO.entityToDto(commentRepository.save(comment));
    }

    // 휴지통으로 이동 (소프트 삭제)
    @Transactional
    public void moveToTrash(Long commentId, UserDetails userDetails) {
        CommentEntity comment = getOwnedComment(commentId, userDetails);
        comment.setDeleted(true);
        commentRepository.save(comment);
    }

    // 휴지통에서 복원
    @Transactional
    public CommentDTO restore(Long commentId, UserDetails userDetails) {
        CommentEntity comment = getOwnedComment(commentId, userDetails);
        comment.setDeleted(false);
        return CommentDTO.entityToDto(commentRepository.save(comment));
    }

    // 영구 삭제 (최상위 댓글이면 대댓글까지 함께 삭제)
    @Transactional
    public void permanentDelete(Long commentId, UserDetails userDetails) {
        CommentEntity comment = getOwnedComment(commentId, userDetails);
        if (comment.getParent() == null) {
            List<CommentEntity> children = commentRepository.findByParent_Id(comment.getId());
            if (!children.isEmpty()) {
                commentRepository.deleteAll(children);
            }
        }
        commentRepository.delete(comment);
    }

    // 내가 휴지통으로 보낸 댓글 목록
    @Transactional(readOnly = true)
    public List<CommentDTO> getTrash(UserDetails userDetails) {
        UserEntity user = getLoginUser(userDetails);
        return commentRepository.findByOwner_UidAndDeletedTrueOrderByUpdatedAtDesc(user.getUid())
                .stream()
                .map(CommentDTO::entityToDto)
                .toList();
    }

    // 추억 영구삭제 시 연관 댓글 일괄 제거 (MemoryService에서 호출)
    @Transactional
    public void deleteAllByMemory(Long memoryId) {
        List<CommentEntity> all = commentRepository.findByMemory_Id(memoryId);
        if (!all.isEmpty()) {
            commentRepository.deleteAll(all);
        }
    }
}