package com.example.Daylog.Service;

import com.example.Daylog.Entity.ChecklistEntity;
import com.example.Daylog.Entity.RoomEntity;
import com.example.Daylog.Entity.RoomMemberEntity;
import com.example.Daylog.Entity.ScheduleEntity;
import com.example.Daylog.Repository.ChecklistRepository;
import com.example.Daylog.Repository.RoomMemberRepository;
import com.example.Daylog.Repository.RoomRepository;
import com.example.Daylog.Repository.ScheduleRepository;
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

// [B] edit by smsong - #27 일정 / 체크리스트 예정 알림
//
//  · 일정(ScheduleEntity.scheduleDate)과 체크리스트의 갈 예정일(ChecklistEntity.plannedDate)에 대해
//    사용자가 지정한 시점에 방 멤버 전원에게 푸시 + 알림함 1건을 보낸다.
//  · 알림은 1차 / 2차 두 번까지 각각 따로 지정할 수 있다(remind1 / remind2).
//
//  설정값 (프론트의 select 값과 동일)
//      NONE      알림 없음 (기본)
//      SAME_DAY  당일 오전 9시
//      D1        1일 전 오전 9시
//      D2        2일 전 오전 9시
//      W1        1주 전 오전 9시
//
//  발송 방식
//      매일 오전 9시에 한 번 깨어나, 오늘 기준으로 0/1/2/7일 뒤에 잡힌 항목을 찾아
//      그 항목의 remind1·remind2 가 해당 간격을 가리키면 보낸다.
//      1차와 2차가 같은 날을 가리키면 중복 발송하지 않는다.
//
//  ┌────────────────────────────────────────────────────────────────────┐
//  │ 설정 (application.yml)                                              │
//  │   daylog:                                                          │
//  │     event-reminder:                                                │
//  │       enabled: true                                                │
//  │       cron: "0 0 9 * * *"    # 매일 오전 9시                         │
//  │       zone: Asia/Seoul                                             │
//  │       link: main.html                                              │
//  └────────────────────────────────────────────────────────────────────┘
@Configuration
@EnableScheduling
@RequiredArgsConstructor
public class EventReminderScheduler {

    private static final Logger log = LoggerFactory.getLogger(EventReminderScheduler.class);

    private final ScheduleRepository scheduleRepository;
    private final ChecklistRepository checklistRepository;
    private final RoomRepository roomRepository;
    private final RoomMemberRepository roomMemberRepository;
    private final NotificationService notificationService;

    @Value("${daylog.event-reminder.enabled:true}")
    private boolean enabled;

    @Value("${daylog.event-reminder.zone:Asia/Seoul}")
    private String zoneId;

    @Value("${daylog.event-reminder.link:main.html}")
    private String linkPath;

    /** 설정값 → 며칠 전인지 */
    private static final Map<String, Integer> OFFSET = new HashMap<>();
    static {
        OFFSET.put("SAME_DAY", 0);
        OFFSET.put("D1", 1);
        OFFSET.put("D2", 2);
        OFFSET.put("W1", 7);
    }

    /** 며칠 전인지 → 문구 */
    private static String whenText(int offset) {
        switch (offset) {
            case 0:  return "오늘";
            case 1:  return "내일";
            case 2:  return "모레";
            case 7:  return "일주일 뒤";
            default: return offset + "일 뒤";
        }
    }

    @Scheduled(cron = "${daylog.event-reminder.cron:0 0 9 * * *}",
               zone = "${daylog.event-reminder.zone:Asia/Seoul}")
    public void tick() {
        if (!enabled) return;
        try {
            runReminder();
        } catch (Exception e) {
            log.warn("[Daylog] 예정 알림 실행 실패: {}", e.toString());
        }
    }

    @Transactional(readOnly = true)
    public void runReminder() {
        LocalDate today = LocalDate.now(ZoneId.of(zoneId));
        Map<Long, List<String>> memberCache = new HashMap<>();
        Map<Long, String> roomNameCache = new HashMap<>();
        int sent = 0;

        for (int offset : new int[]{0, 1, 2, 7}) {
            LocalDate target = today.plusDays(offset);

            // ---- 일정 ----
            List<ScheduleEntity> schedules;
            try {
                schedules = scheduleRepository.findByScheduleDateAndDeletedFalse(target);
            } catch (Exception e) {
                log.warn("[Daylog] {} 일정 조회 실패: {}", target, e.toString());
                schedules = List.of();
            }
            for (ScheduleEntity s : schedules) {
                if (s == null || s.getRoomId() == null) continue;
                if (!wants(s.getRemind1(), s.getRemind2(), offset)) continue;
                sent += send(s.getRoomId(), s.getTitle(), offset, "SCHEDULE_REMINDER",
                        "&type=schedule&id=" + s.getId(), memberCache, roomNameCache);
            }

            // ---- 체크리스트(갈 예정일) ----
            List<ChecklistEntity> checklists;
            try {
                checklists = checklistRepository.findByPlannedDateAndDeletedFalseAndArchivedFalse(target);
            } catch (Exception e) {
                log.warn("[Daylog] {} 체크리스트 조회 실패: {}", target, e.toString());
                checklists = List.of();
            }
            for (ChecklistEntity c : checklists) {
                if (c == null || c.getRoomId() == null) continue;
                if (!wants(c.getRemind1(), c.getRemind2(), offset)) continue;
                sent += send(c.getRoomId(), c.getTitle(), offset, "CHECKLIST_REMINDER",
                        "&type=checklist&id=" + c.getId(), memberCache, roomNameCache);
            }
        }
        if (sent > 0) log.info("[Daylog] 예정 알림 발송: {}건 ({})", sent, today);
    }

    /** 1차·2차 중 하나라도 이 간격을 가리키면 true (둘이 같아도 한 번만) */
    private boolean wants(String r1, String r2, int offset) {
        return matches(r1, offset) || matches(r2, offset);
    }

    private boolean matches(String code, int offset) {
        if (code == null || code.isBlank() || "NONE".equalsIgnoreCase(code)) return false;
        Integer o = OFFSET.get(code.trim().toUpperCase());
        return o != null && o == offset;
    }

    private int send(Long roomId, String title, int offset, String type, String linkSuffix,
                     Map<Long, List<String>> memberCache, Map<Long, String> roomNameCache) {
        List<String> uids = memberCache.computeIfAbsent(roomId, this::memberUidsOf);
        if (uids.isEmpty()) return 0;

        String roomName = roomNameCache.computeIfAbsent(roomId, this::roomNameOf);
        String name = (title == null || title.isBlank()) ? "일정" : title.trim();
        String body = whenText(offset) + " 「" + name + "」이 예정되어 있어요 ✨";
        String url = linkPath + "?room=" + roomId + linkSuffix;

        try {
            // 방 알림 OFF(notifyMuted) 멤버는 NotificationService 안에서 자동 제외된다
            notificationService.notifyAll(uids, null, roomId, type, roomName, body, url);
            return uids.size();
        } catch (Exception e) {
            log.warn("[Daylog] 방 {} 예정 알림 발송 실패: {}", roomId, e.toString());
            return 0;
        }
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
