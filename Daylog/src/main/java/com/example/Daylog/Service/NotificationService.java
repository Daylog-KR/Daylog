package com.example.Daylog.Service;

import com.example.Daylog.Entity.NotificationEntity;
import com.example.Daylog.Repository.NotificationRepository;
import com.example.Daylog.Repository.PermissionRepository; // [B] edit by smsong - #3 방 알림 음소거 체크
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
    private final PermissionRepository permissionRepository; // [B] edit by smsong - #3

    public void notify(String recipientUid, String type, String title, String body, String url) {
        notify(recipientUid, null, type, title, body, url);
    }

    // [B] edit by smsong - #1 방별 알림: roomId 포함 저장
    public void notify(String recipientUid, Long roomId, String type, String title, String body, String url) {
        if (recipientUid == null || recipientUid.isBlank()) return;
        // [B] edit by smsong - #3 수신자가 이 방 알림을 껐으면(muted) 저장·발송 모두 생략
        if (roomId != null) {
            try {
                boolean muted = permissionRepository.findByRoomIdAndUid(roomId, recipientUid)
                        .map(com.example.Daylog.Entity.PermissionEntity::isNotifyMuted).orElse(false);
                if (muted) return;
            } catch (Exception ignore) {}
        }
        try {
            notificationRepository.save(NotificationEntity.builder()
                    .recipientUid(recipientUid)
                    .roomId(roomId)
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
        notifyAll(uids, excludeUid, null, type, title, body, url);
    }

    public void notifyAll(Collection<String> uids, String excludeUid, Long roomId, String type, String title, String body, String url) {
        if (uids == null) return;
        for (String u : uids) {
            if (u == null) continue;
            if (excludeUid != null && excludeUid.equals(u)) continue;
            notify(u, roomId, type, title, body, url);
        }
    }

    @Transactional(readOnly = true)
    public List<NotificationEntity> list(String uid, int limit) {
        int size = (limit <= 0 || limit > 100) ? 50 : limit;
        return notificationRepository.findByRecipientUidOrderByCreatedAtDesc(uid, PageRequest.of(0, size));
    }

    // [B] edit by smsong - #1 방별 목록
    @Transactional(readOnly = true)
    public List<NotificationEntity> listByRoom(String uid, Long roomId, int limit) {
        int size = (limit <= 0 || limit > 100) ? 50 : limit;
        return notificationRepository.findByRecipientUidAndRoomIdOrderByCreatedAtDesc(uid, roomId, PageRequest.of(0, size));
    }

    @Transactional(readOnly = true)
    public long unreadCount(String uid) {
        return notificationRepository.countByRecipientUidAndIsReadFalse(uid);
    }

    @Transactional(readOnly = true)
    public long unreadCountByRoom(String uid, Long roomId) {
        return notificationRepository.countByRecipientUidAndRoomIdAndIsReadFalse(uid, roomId);
    }

    @Transactional
    public void markAllRead(String uid) {
        try { notificationRepository.markAllRead(uid); } catch (Exception ignore) { }
    }

    @Transactional
    public void markRoomRead(String uid, Long roomId) {
        try { notificationRepository.markRoomRead(uid, roomId); } catch (Exception ignore) { }
    }
}
