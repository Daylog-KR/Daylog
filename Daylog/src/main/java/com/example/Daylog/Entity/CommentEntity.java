package com.example.Daylog.Entity;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

@Entity(name = "comments")
@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class CommentEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(length = 1000, nullable = false)
    private String content;

    // 어떤 추억(Memory)에 달린 댓글인지 (가볼곳 댓글이면 null)
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "memory_id")
    @JsonIgnore
    private MemoryEntity memory;

    // 어떤 가볼곳(Checklist)에 달린 댓글인지 (추억 댓글이면 null)
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "checklist_id")
    @JsonIgnore
    private ChecklistEntity checklist;

    // 작성자
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "owner_id")
    @JsonIgnore
    private UserEntity owner;

    // 대댓글: 부모 댓글 (최상위 댓글이면 null)
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "parent_id")
    @JsonIgnore
    private CommentEntity parent;

    // 휴지통(소프트 삭제) 플래그 — true 면 휴지통으로 이동된 상태
    @Column(nullable = false)
    private boolean deleted;

    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    @PrePersist
    public void prePersist() {
        this.createdAt = LocalDateTime.now();
        this.updatedAt = this.createdAt;
    }

    @PreUpdate
    public void preUpdate() {
        this.updatedAt = LocalDateTime.now();
    }
}
