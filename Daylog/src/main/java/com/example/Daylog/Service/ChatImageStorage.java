package com.example.Daylog.Service;

import org.springframework.web.multipart.MultipartFile;

// [B] edit by smsong - 채팅 이미지 업로드 저장 '연결점'.
//  · 이 프로젝트엔 이미 이미지 저장 로직(추억/방 이미지 → GCS 등)이 구현돼 있음.
//  · 그 저장 서비스에 아래 인터페이스를 implements 하는 얇은 어댑터 하나만 만들어 붙이면
//    채팅 이미지 전송이 동작한다(저장 후 접근 가능한 URL 을 반환).
//  · 구현 빈이 없으면 ChatController 가 501 을 반환(전송만 비활성, 앱은 정상).
//
//  구현 예시:
//  @Service
//  @RequiredArgsConstructor
//  public class ChatImageStorageImpl implements ChatImageStorage {
//      private final GcsService gcsService; // ← 기존 이미지 저장 서비스(추억/방 이미지 올리는 그거)
//      @Override
//      public String store(Long roomId, MultipartFile file) throws Exception {
//          // 기존 업로드 메서드에 맞춰 호출해서 '공개 접근 가능한 URL' 을 반환하면 됩니다.
//          return gcsService.upload(file, "chat/" + roomId); // 예시
//      }
//  }
public interface ChatImageStorage {
    /**
     * @param roomId 방 id (경로 분류용)
     * @param file   업로드된 이미지 파일
     * @return 저장된 이미지의 접근 가능한 URL
     */
    String store(Long roomId, MultipartFile file) throws Exception;
}
// [E] edit by smsong
