package com.example.Daylog.Service;

import com.example.Daylog.DTO.CommentDTO;
import com.example.Daylog.Entity.CommentEntity;
import com.example.Daylog.Entity.ChecklistEntity;
import com.example.Daylog.Entity.MemoryEntity;
import com.example.Daylog.Entity.UserEntity;
import com.example.Daylog.Repository.ChecklistRepository;
import com.example.Daylog.Repository.CommentRepository;
import com.example.Daylog.Repository.MemoryRepository;
import com.example.Daylog.Repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class CommentService {

    private final CommentRepository commentRepository;
    private final MemoryRepository memoryRepository;
    private final ChecklistRepository checklistRepository;
    private final UserRepository userRepository;
    private final WebPushService webPushService; // [B] edit by smsong - 댓글/답글 푸시알림

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

    // 댓글 / 대댓글 작성 (memoryId 또는 checklistId 중 하나 대상)
    @Transactional
    public CommentDTO createComment(Long memoryId, Long checklistId, Long parentId, String content, UserDetails userDetails) {
        UserEntity owner = getLoginUser(userDetails);

        if (memoryId == null && checklistId == null) {
            throw new IllegalArgumentException("대상 정보(추억/가볼곳)가 필요합니다");
        }
        if (content == null || content.trim().isEmpty()) {
            throw new IllegalArgumentException("댓글 내용을 입력해주세요");
        }

        CommentEntity.CommentEntityBuilder builder = CommentEntity.builder()
                .content(content.trim())
                .owner(owner)
                .deleted(false);

        if (memoryId != null) {
            MemoryEntity memory = memoryRepository.findById(memoryId)
                    .orElseThrow(() -> new IllegalArgumentException("추억을 찾을 수 없습니다"));
            builder.memory(memory);
        } else {
            ChecklistEntity checklist = checklistRepository.findById(checklistId)
                    .orElseThrow(() -> new IllegalArgumentException("가볼곳을 찾을 수 없습니다"));
            builder.checklist(checklist);
        }

        // 대댓글이면 부모 연결 (대댓글의 대댓글은 부모를 최상위로 평탄화)
        if (parentId != null) {
            CommentEntity parent = commentRepository.findById(parentId)
                    .orElseThrow(() -> new IllegalArgumentException("부모 댓글을 찾을 수 없습니다"));
            CommentEntity topParent = (parent.getParent() != null) ? parent.getParent() : parent;
            builder.parent(topParent);
        }

        CommentEntity saved = commentRepository.save(builder.build());
        // [B] edit by smsong - 푸시알림: (답글) 부모 댓글 작성자에게 / (댓글) 추억·가볼곳 생성자에게
        try { notifyOnComment(saved, owner, memoryId, checklistId, parentId); } catch (Exception ignore) {}
        return CommentDTO.entityToDto(saved);
    }

    // [B] edit by smsong - 댓글/답글 푸시알림 대상 결정 후 발송 (본인에겐 발송 안 함)
    private void notifyOnComment(CommentEntity saved, UserEntity commenter, Long memoryId, Long checklistId, Long parentId) {
        String commenterName = displayName(commenter);
        String content = saved.getContent();
        String targetUid;
        String title;
        if (parentId != null) {
            CommentEntity parent = saved.getParent(); // 최상위 부모로 평탄화되어 저장됨
            targetUid = (parent != null && parent.getOwner() != null) ? parent.getOwner().getUid() : null;
            title = commenterName + "님이 답글을 남겼어요";
        } else if (memoryId != null) {
            targetUid = (saved.getMemory() != null && saved.getMemory().getOwner() != null)
                    ? saved.getMemory().getOwner().getUid() : null;
            title = commenterName + "님이 추억에 댓글을 남겼어요";
        } else {
            targetUid = (saved.getChecklist() != null && saved.getChecklist().getOwner() != null)
                    ? saved.getChecklist().getOwner().getUid() : null;
            title = commenterName + "님이 가볼곳에 댓글을 남겼어요";
        }
        if (targetUid == null || targetUid.equals(commenter.getUid())) return; // 본인에겐 알림 안 보냄
        webPushService.sendToUid(targetUid, title, content, "/");
    }

    private String displayName(UserEntity u) {
        if (u == null) return "누군가";
        if (u.getNickname() != null && !u.getNickname().isBlank()) return u.getNickname();
        if (u.getName() != null && !u.getName().isBlank()) return u.getName();
        return "누군가";
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

    // ===== [smsong] 가볼곳(Checklist) 댓글 =====
    // 특정 가볼곳의 댓글 목록 (최상위 + 대댓글 트리)
    @Transactional(readOnly = true)
    public List<CommentDTO> getCommentsByChecklist(Long checklistId) {
        List<CommentEntity> roots =
                commentRepository.findByChecklist_IdAndParentIsNullAndDeletedFalseOrderByCreatedAtAsc(checklistId);
        List<CommentDTO> result = new ArrayList<>();
        for (CommentEntity root : roots) {
            List<CommentEntity> replies =
                    commentRepository.findByParent_IdAndDeletedFalseOrderByCreatedAtAsc(root.getId());
            result.add(CommentDTO.entityToDtoWithReplies(root, replies));
        }
        return result;
    }

    // 가볼곳 영구삭제 시 연관 댓글 일괄 제거 (ChecklistService에서 호출)
    @Transactional
    public void deleteAllByChecklist(Long checklistId) {
        List<CommentEntity> all = commentRepository.findByChecklist_Id(checklistId);
        if (!all.isEmpty()) {
            commentRepository.deleteAll(all);
        }
    }

    // ===== [smsong] 댓글 수 배치 집계 (썸네일 표시용) =====
    @Transactional(readOnly = true)
    public Map<Long, Long> countsByMemory() {
        Map<Long, Long> m = new HashMap<>();
        for (Object[] row : commentRepository.countGroupByMemory()) {
            if (row[0] != null) m.put(((Number) row[0]).longValue(), ((Number) row[1]).longValue());
        }
        return m;
    }

    @Transactional(readOnly = true)
    public Map<Long, Long> countsByChecklist() {
        Map<Long, Long> m = new HashMap<>();
        for (Object[] row : commentRepository.countGroupByChecklist()) {
            if (row[0] != null) m.put(((Number) row[0]).longValue(), ((Number) row[1]).longValue());
        }
        return m;
    }
}