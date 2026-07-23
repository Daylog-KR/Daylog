package com.example.Daylog.Service;

import com.example.Daylog.Entity.ChecklistEntity;
import com.example.Daylog.Entity.RoomEntity;
import com.example.Daylog.Entity.RoomMemberEntity;
import com.example.Daylog.Repository.ChecklistRepository;
import com.example.Daylog.Repository.RoomMemberRepository;
import com.example.Daylog.Repository.RoomRepository;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

// [B] edit by smsong - #4 '1년 전 오늘 다녀왔어요' 리마인더 스케줄러
//
//  · 가볼곳(체크리스트) 중 '다녀왔어요(visited=true)' 로 표시된 항목의
//    다녀온 날짜(ChecklistEntity.visitedDate — LocalDate)가 정확히 N년 전 오늘(Asia/Seoul)이면,
//    그 방의 모든 멤버에게
//        제목: <방 이름>
//        내용: 1년 전 오늘, 「제목」에 다녀왔어요 ✨
//    푸시 + 알림함 1건을 보낸다.
//  · 휴지통(deleted=true) 항목은 제외된다.
//  · 방 알림을 끈(notifyMuted) 멤버는 NotificationService.notify() 안에서 자동으로 걸러진다.
//  · 하루 1회(기본 오전 10시)만 도는 스케줄이라 중복 발송이 생기지 않는다.
//  · MemoryEntity 에는 '다녀왔어요' 개념이 없어(방문일 필드가 ChecklistEntity 에만 있음)
//    가볼곳 기준으로 동작한다.
//
//  ⚠ ChecklistRepository 에 아래 메서드가 필요하다(첨부한 파일에 이미 추가해 두었다).
//      List<ChecklistEntity> findByVisitedTrueAndDeletedFalseAndVisitedDate(LocalDate visitedDate);
//
//  ┌────────────────────────────────────────────────────────────────────────────┐
//  │ 설정 (application.yml — 재빌드 불필요)                                      │
//  │                                                                            │
//  │   daylog:                                                                  │
//  │     visit-anniversary:                                                     │
//  │       enabled: true                                                        │
//  │       cron: "0 0 10 * * *"   # 매일 오전 10시                               │
//  │       zone: Asia/Seoul                                                     │
//  │       years: 1               # "1,2,3" 으로 두면 2·3주년도 함께 발송         │
//  │       link: main.html                                                      │
//  └────────────────────────────────────────────────────────────────────────────┘
@Configuration
@EnableScheduling
@RequiredArgsConstructor
public class VisitAnniversaryScheduler {

    private static final Logger log = LoggerFactory.getLogger(VisitAnniversaryScheduler.class);

    private final ChecklistRepository checklistRepository;
    private final RoomRepository roomRepository;
    private final RoomMemberRepository roomMemberRepository;
    private final NotificationService notificationService;

    @Value("${daylog.visit-anniversary.enabled:true}")
    private boolean enabled;

    /** 몇 년 전 기록을 알릴지. 쉼표로 여러 개 가능 (예: "1,2,3"). */
    @Value("${daylog.visit-anniversary.years:1}")
    private String yearsSpec;

    @Value("${daylog.visit-anniversary.zone:Asia/Seoul}")
    private String zoneId;

    /** 알림 클릭 시 이동할 프론트 경로. 뒤에 ?room={방}&type=checklist&id={가볼곳} 이 붙는다. */
    @Value("${daylog.visit-anniversary.link:main.html}")
    private String linkPath;

    // ===== 스케줄 진입점: 매일 1회 =====
    @Scheduled(cron = "${daylog.visit-anniversary.cron:0 0 10 * * *}",
               zone = "${daylog.visit-anniversary.zone:Asia/Seoul}")
    public void tick() {
        if (!enabled) return;
        try {
            runAnniversary();
        } catch (Exception e) {
            // 스케줄러 예외는 절대 밖으로 던지지 않는다(다음 회차가 죽지 않도록)
            log.warn("[Daylog] 다녀온 곳 기념일 리마인더 실행 실패: {}", e.toString());
        }
    }

    // ===== 실제 검증 + 발송 =====
    @Transactional(readOnly = true)
    public void runAnniversary() {
        LocalDate today = LocalDate.now(ZoneId.of(zoneId));

        // 같은 방을 여러 번 조회하지 않도록 캐시
        Map<Long, List<String>> memberCache = new HashMap<>();
        Map<Long, String> roomNameCache = new HashMap<>();
        int sent = 0;

        for (int years : parseYears()) {
            // 2월 29일처럼 존재하지 않는 날짜는 minusYears 가 알아서 보정한다(2/28)
            LocalDate target = today.minusYears(years);

            List<ChecklistEntity> list;
            try {
                list = checklistRepository.findByVisitedTrueAndDeletedFalseAndVisitedDate(target);
            } catch (Exception e) {
                log.warn("[Daylog] {} 다녀온 가볼곳 조회 실패: {}", target, e.toString());
                continue;
            }
            if (list == null || list.isEmpty()) continue;

            for (ChecklistEntity c : list) {
                if (c == null || c.getId() == null || c.getRoomId() == null) continue;

                Long roomId = c.getRoomId();
                List<String> uids = memberCache.computeIfAbsent(roomId, this::memberUidsOf);
                if (uids.isEmpty()) continue;

                String roomName = roomNameCache.computeIfAbsent(roomId, this::roomNameOf);
                String title = (c.getTitle() == null || c.getTitle().isBlank()) ? "그곳" : c.getTitle().trim();

                String pushTitle = roomName;                                            // 방 이름
                String pushBody = years + "년 전 오늘, 「" + title + "」에 다녀왔어요 ✨";
                //  ↑ 문구를 바꾸려면 이 줄만 수정. 예) String pushBody = title + "에 다녀왔어요 ✨";
                String url = linkPath + "?room=" + roomId + "&type=checklist&id=" + c.getId();

                try {
                    // excludeUid = null (방 전원). 방 알림 OFF(notifyMuted) 멤버는 내부에서 자동 제외.
                    notificationService.notifyAll(uids, null, roomId, "VISIT_ANNIVERSARY", pushTitle, pushBody, url);
                    sent++;
                } catch (Exception e) {
                    log.warn("[Daylog] 가볼곳 {} 기념일 발송 실패: {}", c.getId(), e.toString());
                }
            }
        }
        if (sent > 0) log.info("[Daylog] 다녀온 곳 기념일 알림 발송: {}건 ({})", sent, today);
    }

    // ===== 내부 유틸 =====

    private List<Integer> parseYears() {
        List<Integer> out = new ArrayList<>();
        if (yearsSpec == null) return out;
        for (String part : yearsSpec.split(",")) {
            try {
                int n = Integer.parseInt(part.trim());
                if (n >= 1 && n <= 50) out.add(n);
            } catch (Exception ignore) { }
        }
        return out;
    }

    private List<String> memberUidsOf(Long roomId) {
        try {
            List<RoomMemberEntity> members = roomMemberRepository.findByRoomId(roomId);
            if (members == null) return List.of();
            Set<String> uids = new LinkedHashSet<>();
            for (RoomMemberEntity m : members) {
                if (m != null && m.getUid() != null) uids.add(m.getUid());
            }
            return new ArrayList<>(uids);
        } catch (Exception e) {
            log.warn("[Daylog] 방 {} 멤버 조회 실패: {}", roomId, e.toString());
            return List.of();
        }
    }

    private String roomNameOf(Long roomId) {
        try {
            Optional<RoomEntity> r = roomRepository.findById(roomId);
            if (r.isPresent() && r.get().getName() != null && !r.get().getName().isBlank()) {
                return r.get().getName();
            }
        } catch (Exception ignore) { }
        return "우리 방";
    }
}
// [E] edit by smsong
