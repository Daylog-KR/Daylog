package com.example.Daylog.Service;

import com.example.Daylog.Entity.RoomEntity;
import com.example.Daylog.Entity.UserEntity;
import com.example.Daylog.Repository.RoomRepository;
import com.example.Daylog.Repository.UserRepository;
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
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;

// [B] edit by smsong - #11 커플 기념일(100일 단위 / N주년) 푸시
//
//  · 커플 방(type=COUPLE)의 기준일(coupleSince, "YYYY-MM-DD")로 오늘이 기념일인지 판정한다.
//  · 기념일이면 방에 지정된 두 사람(coupleLeftUid / coupleRightUid) '각각에게'
//    상대방 닉네임을 넣은 알림을 보낸다.
//        왼쪽 →  "성민님, 메루님과 함께한 지 100일이에요 🎉"
//        오른쪽 → "메루님, 성민님과 함께한 지 100일이에요 🎉"
//  · 방의 다른 멤버에게는 푸시를 보내지 않는다(앱 안에서는 모두에게 축하 폼이 뜬다 — main.js #11).
//
//  ★ 판정 규칙 (main.js 의 coupleMilestoneToday 와 동일해야 한다)
//     · 기준일 당일이 D+1  (한국식 100일 계산)
//     · D+N 이 100 의 배수 → "N일"
//     · 오늘이 기준일과 같은 월/일이고 해가 1년 이상 지났으면 → "N주년"
//     · 둘이 겹치면 주년이 우선
//
//  ┌────────────────────────────────────────────────────────────────────────┐
//  │ 설정 (application.yml)                                                  │
//  │   daylog:                                                              │
//  │     couple-anniversary:                                                │
//  │       enabled: true                                                    │
//  │       cron: "0 0 9 * * *"    # 매일 오전 9시                             │
//  │       zone: Asia/Seoul                                                 │
//  │       link: main.html                                                  │
//  └────────────────────────────────────────────────────────────────────────┘
@Configuration
@EnableScheduling
@RequiredArgsConstructor
public class CoupleAnniversaryScheduler {

    private static final Logger log = LoggerFactory.getLogger(CoupleAnniversaryScheduler.class);

    private final RoomRepository roomRepository;
    private final UserRepository userRepository;
    private final NotificationService notificationService;

    @Value("${daylog.couple-anniversary.enabled:true}")
    private boolean enabled;

    @Value("${daylog.couple-anniversary.zone:Asia/Seoul}")
    private String zoneId;

    @Value("${daylog.couple-anniversary.link:main.html}")
    private String linkPath;

    @Scheduled(cron = "${daylog.couple-anniversary.cron:0 0 9 * * *}",
               zone = "${daylog.couple-anniversary.zone:Asia/Seoul}")
    public void tick() {
        if (!enabled) return;
        try {
            runAnniversary();
        } catch (Exception e) {
            // 스케줄러 예외는 밖으로 던지지 않는다(다음 회차가 죽지 않도록)
            log.warn("[Daylog] 커플 기념일 알림 실행 실패: {}", e.toString());
        }
    }

    @Transactional(readOnly = true)
    public void runAnniversary() {
        LocalDate today = LocalDate.now(ZoneId.of(zoneId));
        List<RoomEntity> rooms = roomRepository.findAll();
        int sent = 0;

        for (RoomEntity room : rooms) {
            if (room == null || room.getId() == null) continue;
            if (!"COUPLE".equalsIgnoreCase(String.valueOf(room.getType()))) continue;

            LocalDate since = parseDate(room.getCoupleSince());
            if (since == null) continue;

            String label = milestoneLabel(since, today);
            if (label == null) continue;   // 오늘은 기념일이 아님

            String leftUid = room.getCoupleLeftUid();
            String rightUid = room.getCoupleRightUid();
            if (isBlank(leftUid) || isBlank(rightUid)) continue;   // 두 슬롯이 다 지정된 방만

            String leftName = displayName(leftUid);
            String rightName = displayName(rightUid);
            String title = (room.getName() == null || room.getName().isBlank()) ? "우리 방" : room.getName();
            String url = linkPath + "?room=" + room.getId();

            try {
                notificationService.notify(leftUid, room.getId(), "COUPLE_ANNIVERSARY",
                        title, body(leftName, rightName, label), url);
                notificationService.notify(rightUid, room.getId(), "COUPLE_ANNIVERSARY",
                        title, body(rightName, leftName, label), url);
                sent += 2;
            } catch (Exception e) {
                log.warn("[Daylog] 방 {} 기념일 알림 발송 실패: {}", room.getId(), e.toString());
            }
        }
        if (sent > 0) log.info("[Daylog] 커플 기념일 알림 발송: {}건 ({})", sent, today);
    }

    // ===== 판정 =====

    /** 오늘이 기념일이면 "100일" / "1주년" 같은 라벨, 아니면 null */
    String milestoneLabel(LocalDate since, LocalDate today) {
        if (since == null || today == null || today.isBefore(since)) return null;

        // 주년 우선 — 같은 월/일이고 1년 이상 지났을 때
        if (since.getMonthValue() == today.getMonthValue() && since.getDayOfMonth() == today.getDayOfMonth()) {
            int years = today.getYear() - since.getYear();
            if (years >= 1) return years + "주년";
        }
        // 100일 단위 — 기준일 당일이 D+1
        long n = ChronoUnit.DAYS.between(since, today) + 1;
        if (n > 0 && n % 100 == 0) return n + "일";
        return null;
    }

    private String body(String me, String partner, String label) {
        // 예) "성민님, 메루님과 함께한 지 100일이에요 🎉"
        return me + "님, " + partner + "님과 함께한 지 " + label + "이에요 🎉";
    }

    // ===== 내부 유틸 =====

    private String displayName(String uid) {
        try {
            Optional<UserEntity> u = userRepository.findByUid(uid);
            if (u.isPresent()) {
                String nk = u.get().getNickname();
                if (nk != null && !nk.isBlank()) return nk.trim();
                String nm = u.get().getName();
                if (nm != null && !nm.isBlank()) return nm.trim();
            }
        } catch (Exception ignore) { }
        return "우리";
    }

    private LocalDate parseDate(String s) {
        if (isBlank(s)) return null;
        try { return LocalDate.parse(s.trim().substring(0, 10)); } catch (Exception e) { return null; }
    }

    private boolean isBlank(String s) { return s == null || s.trim().isEmpty(); }
}
// [E] edit by smsong
