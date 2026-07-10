package com.example.Daylog.Service;

import com.example.Daylog.Entity.NotificationEntity;
import com.example.Daylog.Repository.NotificationRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.List;

// [B] edit by smsong - 알림 공통 진입점. 이벤트 발생 시 (1) 알림함(DB)에 1건 저장 + (2) 웹푸시 발송.
//  댓글/답글/입장요청/입장수락/입장/강퇴 등 모든 알림이 이걸 통해 나간다.
@Service
@RequiredArgsConstructor
public class NotificationService {

    private final NotificationRepository notificationRepository;
    private final WebPushService webPushService;

    public void notify(String recipientUid, String type, String title, String body, String url) {
        if (recipientUid == null || recipientUid.isBlank()) return;
        try {
            notificationRepository.save(NotificationEntity.builder()
                    .recipientUid(recipientUid)
                    .type(type)
                    .title(title)
                    .body(body)
                    .url(url)
                    .isRead(false)
                    .build());
        } catch (Exception ignore) { }
        try { webPushService.sendToUid(recipientUid, title, body, url); } catch (Exception ignore) { }
    }

    // 여러 명에게 (excludeUid 는 제외 — 보통 행위자 본인)
    public void notifyAll(Collection<String> uids, String excludeUid, String type, String title, String body, String url) {
        if (uids == null) return;
        for (String u : uids) {
            if (u == null) continue;
            if (excludeUid != null && excludeUid.equals(u)) continue;
            notify(u, type, title, body, url);
        }
    }

    @Transactional(readOnly = true)
    public List<NotificationEntity> list(String uid, int limit) {
        int size = (limit <= 0 || limit > 100) ? 50 : limit;
        return notificationRepository.findByRecipientUidOrderByCreatedAtDesc(uid, PageRequest.of(0, size));
    }

    @Transactional(readOnly = true)
    public long unreadCount(String uid) {
        return notificationRepository.countByRecipientUidAndIsReadFalse(uid);
    }

    @Transactional
    public void markAllRead(String uid) {
        try { notificationRepository.markAllRead(uid); } catch (Exception ignore) { }
    }
}
