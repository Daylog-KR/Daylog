package com.example.Daylog.Entity;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Entity(name = "checklists")
@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class ChecklistEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String title;

    @Column(length = 2000)
    private String content;

    @Column(nullable = false)
    private Double lat;

    @Column(nullable = false)
    private Double lng;

    // 큰 영역(시/도 + 시·군·구) — MemoryEntity 와 동일하게 placeName 에 보관
    private String placeName;

    // 상세 주소
    @Column(length = 500)
    private String address;

    // 이미지(선택) — 첫 번째 이미지(호환용 · 썸네일)
    private String mediaURL;

    // 여러 장 이미지(순서 보존). 첫 번째가 대표 이미지.
    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "checklist_media", joinColumns = @JoinColumn(name = "checklist_id"))
    @OrderColumn(name = "sort_order")
    @Column(name = "media_url", length = 1000)
    @Builder.Default
    private List<String> mediaUrls = new ArrayList<>();

    // 타입 (CAFE / FOOD / SPOT / SHOPPING / ETC 등)
    private String type;

    // 휴지통(소프트 삭제) 플래그 — true 면 휴지통으로 이동된 상태
    @Column(nullable = false)
    private boolean deleted;

    // 다녀왔는지 여부
    @Column(nullable = false)
    private boolean visited;

    // 다녀온 날짜 (visited=true 일 때만 의미 있음)
    private LocalDate visitedDate;

    // [B] edit by smsong - #12 갈 예정일 — 체크리스트 달력에 이 날짜로 표시된다
    private LocalDate plannedDate;

    // [B] edit by smsong - #27 푸시 알림 예약 (1차 / 2차)
    //  값: NONE / SAME_DAY / D1 / D2 / W1  — 매일 오전 9시에 도는 ReminderScheduler 가 읽는다.
    //  둘 다 기본은 NONE(알림 없음).
    @Column(length = 16)
    private String remind1;

    @Column(length = 16)
    private String remind2;
    // [E] edit by smsong


    // [B] edit by smsong - #12 보관함 플래그
    //  '다녀왔습니다' 로 추억이 만들어진 뒤 원본을 휴지통이 아니라 보관함으로 옮긴다.
    //  · archived=true 는 일반 화면(지도/목록)에 절대 노출되지 않는다.
    //  · deleted(휴지통)와는 별개 축이다. 보관함 → 휴지통으로 다시 옮길 수 있다.
    //
    //  ⚠ columnDefinition 의 default 는 반드시 필요하다.
    //     ddl-auto=update 로 '이미 데이터가 있는 테이블'에 NOT NULL 컬럼을 기본값 없이 추가하면
    //     PostgreSQL 이 거부하고, Hibernate 는 그 실패를 로그만 남기고 넘어간다.
    //     → 컬럼이 안 생긴 채 앱이 뜨고, 조회할 때 "column archived does not exist" 로 터진다.
    @Column(nullable = false, columnDefinition = "boolean default false")
    private boolean archived;

    private LocalDateTime archivedAt;
    // [E] edit by smsong

    // [smsong] 소속 방(공유 공간) — 이 방의 멤버끼리만 공유
    private Long roomId;

    // 작성자(= 체크리스트를 만든 사람) 연관관계 (MemoryEntity 패턴 동일)
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "owner_id")
    @JsonIgnore
    private UserEntity owner;

    private LocalDateTime createdAt;

    // [B] edit by smsong - 마지막 수정 시각 / 마지막 수정자(uid) 추적
    private LocalDateTime updatedAt;
    private String lastEditorUid;
    // 실제 생성 시각(DB 최초 저장 시점) — 화면 비노출, DB 보관용
    private LocalDateTime realCreatedAt;
    // 휴지통으로 이동한 시각 (30일 자동 삭제 기준)
    private LocalDateTime trashedAt;
    // [E] edit by smsong

    @PrePersist
    public void prePersist() {
        if (this.createdAt == null) {
            this.createdAt = LocalDateTime.now();
        }
        // [B] edit by smsong - 최초 저장 시 updatedAt 을 createdAt 과 동일하게 초기화
        if (this.updatedAt == null) {
            this.updatedAt = this.createdAt;
        }
        // 실제 생성 시각은 항상 현재 시각으로 고정
        if (this.realCreatedAt == null) {
            this.realCreatedAt = LocalDateTime.now();
        }
        // [E] edit by smsong
    }
}
