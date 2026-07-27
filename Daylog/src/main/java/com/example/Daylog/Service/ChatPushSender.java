package com.example.Daylog.Service;

import java.util.List;

// [B] edit by smsong - 채팅 새 메시지 → 웹푸시 발송 '연결점'.
//  · 이 프로젝트에는 이미 웹푸시 발송 로직(구독 저장 + VAPID 전송)이 구현되어 있음.
//  · 그 서비스에 아래 인터페이스를 implements 하는 얇은 어댑터 하나만 만들어 붙이면
//    ChatService 가 새 메시지가 저장될 때마다 자동으로 푸시를 보낸다.
//  · 구현 빈이 없으면(ChatService 는 @Autowired(required=false)) 그냥 푸시만 생략된다(컴파일/실행 OK).
//
//  구현 예시:
//  @Service
//  @RequiredArgsConstructor
//  public class ChatPushSenderImpl implements ChatPushSender {
//      private final PushService pushService; // ← 기존 푸시 발송 서비스
//      @Override
//      public void sendChatPush(List<String> targetUids, Long roomId, String title, String body, String url) {
//          for (String uid : targetUids) {
//              // 기존 발송 메서드에 맞춰 호출 (예시)
//              pushService.sendToUser(uid, title, body, url);
//          }
//      }
//  }
public interface ChatPushSender {

    /**
     * @param targetUids 알림을 받을 유저 uid 목록 (발신자/음소거/접속중 유저는 이미 제외됨)
     * @param roomId     방 id
     * @param title      알림 제목 (예: 방 이름)
     * @param body       알림 본문 (예: "보낸사람: 내용")
     * @param url        클릭 시 열 URL (예: "/main.html?room={roomId}")
     */
    void sendChatPush(List<String> targetUids, Long roomId, String title, String body, String url);
}
// [E] edit by smsong
