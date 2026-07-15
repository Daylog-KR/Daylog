package com.example.Daylog.Service;

import com.example.Daylog.Entity.RoomEntity;
import com.example.Daylog.Entity.RoomMemberEntity;
import com.example.Daylog.Repository.MemoryRepository;
import com.example.Daylog.Repository.RoomMemberRepository;
import com.example.Daylog.Repository.RoomRepository;
import com.example.Daylog.Service.NotificationService;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;

// [B] edit by smsong - #2 '오늘의 추억' 리마인더 스케줄러
//
//  · 방마다 오늘(Asia/Seoul) 날짜로 기록된 '추억'이 하나도 없으면
//    그 방의 모든 멤버에게 "<방 이름> / 오늘의 추억을 기록해보세요 ✨" 푸시 + 알림함 1건을 보낸다.
//  · 판정 기준은 MemoryEntity.createdAt (달력/타임라인이 '추억 날짜'로 쓰는 값)이고,
//    휴지통(deleted=true) 추억은 없는 것으로 본다.
//  · 방 알림을 끈(notifyMuted) 멤버는 NotificationService.notify() 안에서 자동으로 걸러진다.
//  · 매 정시에 깨어나 '지금이 발송 시각인지'만 판정하므로, 간격을 바꿔도 cron 을 손댈 필요가 없다.
//
//  ┌────────────────────────────────────────────────────────────────────────────┐
//  │ ★★ 간격(3시간 → 5시간 / 8시간) 변경 지점 ★★                                 │
//  │                                                                            │
//  │  [방법 1 · 권장] application.yml 에서 값만 수정 (재빌드 불필요)              │
//  │                                                                            │
//  │    daylog:                                                                 │
//  │      reminder:                                                             │
//  │        enabled: true                                                       │
//  │        interval-hours: 3     # ← 여기! 3 → 5 또는 8 로만 바꾸면 끝           │
//  │        start-hour: 9         # 하루 중 첫 검증/알림 시각                     │
//  │        end-hour: 21          # 이 시각 이후로는 보내지 않음                   │
//  │                                                                            │
//  │  [방법 2] 이 파일 아래 @Value("${daylog.reminder.interval-hours:3}") 의       │
//  │           기본값 '3' 을 5 또는 8 로 수정                                     │
//  │                                                                            │
//  │  결과 (start-hour=9, end-hour=21 기준)                                      │
//  │    interval-hours: 3 → 09, 12, 15, 18, 21시 (하루 5회)                      │
//  │    interval-hours: 5 → 09, 14, 19시         (하루 3회)                      │
//  │    interval-hours: 8 → 09, 17시             (하루 2회)                      │
//  └────────────────────────────────────────────────────────────────────────────┘
@Configuration
@EnableScheduling
@RequiredArgsConstructor
public class MemoryReminderScheduler {

    private static final Logger log = LoggerFactory.getLogger(MemoryReminderScheduler.class);

    private final RoomRepository roomRepository;
    private final RoomMemberRepository roomMemberRepository;
    private final MemoryRepository memoryRepository;
    private final NotificationService notificationService;

    // ===== 동작 스위치 / 간격 =====
    @Value("${daylog.reminder.enabled:true}")
    private boolean enabled;

    /** ★ 검증·발송 간격(시간). 3 → 5 또는 8 로 바꾸면 됨. */
    @Value("${daylog.reminder.interval-hours:3}")
    private int intervalHours;

    /** 하루 중 첫 검증/알림 시각 (0~23). */
    @Value("${daylog.reminder.start-hour:9}")
    private int startHour;

    /** 이 시각을 넘으면 그날은 더 보내지 않음 (0~23). 밤중 알림 방지. */
    @Value("${daylog.reminder.end-hour:21}")
    private int endHour;

    @Value("${daylog.reminder.zone:Asia/Seoul}")
    private String zoneId;

    /** 알림 클릭 시 이동할 프론트 경로. 뒤에 ?room={id} 가 붙는다(main.html 의 딥링크 처리와 동일). */
    @Value("${daylog.reminder.link:main.html}")
    private String linkPath;

    // ===== 스케줄 진입점: 매 정시(hh:00:00)에 깨어남 =====
    //  cron 은 건드릴 필요 없음. 실제 발송 여부는 interval-hours 로 판정한다.
    @Scheduled(cron = "${daylog.reminder.cron:0 0 * * * *}", zone = "${daylog.reminder.zone:Asia/Seoul}")
    public void tick() {
        if (!enabled) return;
        int hour = LocalDateTime.now(ZoneId.of(zoneId)).getHour();
        if (!isSendHour(hour)) return;
        try {
            runReminder();
        } catch (Exception e) {
            // 스케줄러 예외는 절대 밖으로 던지지 않는다(다음 회차가 죽지 않도록)
            log.warn("[Daylog] 오늘의 추억 리마인더 실행 실패: {}", e.toString());
        }
    }

    /** start-hour 부터 interval-hours 간격으로, end-hour 까지만 발송. */
    private boolean isSendHour(int hour) {
        int iv = Math.max(1, intervalHours);
        if (hour < startHour || hour > endHour) return false;
        return ((hour - startHour) % iv) == 0;
    }

    // ===== 실제 검증 + 발송 =====
    @Transactional(readOnly = true)
    public void runReminder() {
        ZoneId zone = ZoneId.of(zoneId);
        LocalDate today = LocalDate.now(zone);
        // 오늘 00:00:00.000000000 ~ 23:59:59.999999999 (Between 은 양끝 포함)
        LocalDateTime dayStart = today.atStartOfDay();
        LocalDateTime dayEnd = today.atTime(LocalTime.MAX);

        List<RoomEntity> rooms = roomRepository.findAll();
        int sentRooms = 0;

        for (RoomEntity room : rooms) {
            if (room == null || room.getId() == null) continue;
            Long roomId = room.getId();

            // 오늘 날짜로 기록된 정상 추억이 하나라도 있으면 이 방은 건너뜀
            boolean hasToday;
            try {
                hasToday = memoryRepository.existsByRoomIdAndDeletedFalseAndCreatedAtBetween(roomId, dayStart, dayEnd);
            } catch (Exception e) {
                // 조회 실패 시엔 '있다'로 간주해 잘못된 알림을 보내지 않는다
                log.warn("[Daylog] 방 {} 오늘 추억 조회 실패: {}", roomId, e.toString());
                continue;
            }
            if (hasToday) continue;

            List<RoomMemberEntity> members = roomMemberRepository.findByRoomId(roomId);
            if (members == null || members.isEmpty()) continue;

            List<String> uids = new ArrayList<>();
            for (RoomMemberEntity m : members) {
                if (m != null && m.getUid() != null) uids.add(m.getUid());
            }
            if (uids.isEmpty()) continue;

            String roomName = (room.getName() == null || room.getName().isBlank()) ? "우리 방" : room.getName();
            String title = roomName;                        // 방 이름을 제목으로
            String body = "오늘의 추억을 기록해보세요 ✨";    // 본문
            String url = linkPath + "?room=" + roomId;      // 클릭 시 그 방으로 진입

            try {
                // excludeUid = null (방 전원). 방 알림 OFF(notifyMuted) 인 멤버는 내부에서 자동 제외.
                notificationService.notifyAll(uids, null, roomId, "MEMORY_REMINDER", title, body, url);
                sentRooms++;
            } catch (Exception e) {
                log.warn("[Daylog] 방 {} 리마인더 발송 실패: {}", roomId, e.toString());
            }
        }
        if (sentRooms > 0) log.info("[Daylog] 오늘의 추억 리마인더 발송: {}개 방 ({})", sentRooms, today);
    }
}
// [E] edit by smsong
