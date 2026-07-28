package com.example.Daylog.Service;

import com.google.cloud.storage.BlobId;
import com.google.cloud.storage.BlobInfo;
import com.google.cloud.storage.Storage;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.util.UUID;

// [B] edit by smsong - 채팅 이미지 저장: 추억/방 이미지와 '동일한' GCS 업로드 로직 사용.
//  · MemoryService 와 같은 Storage 빈 + 같은 bucket/header 설정을 그대로 사용한다.
//  · 이 빈이 컨텍스트에 있으면 ChatController 의 @Autowired(required=false) ChatImageStorage 가 자동 연결 → 채팅 이미지 전송 동작.
//  · 채팅 이미지는 상세/라이트박스 용도라 별도 썸네일은 만들지 않는다(프론트가 업로드 전에 1600px/JPEG 로 이미 축소).
@Service
@RequiredArgsConstructor
public class ChatImageStorageImpl implements ChatImageStorage {

    private final Storage storage;

    @Value("${google.cloud.credentials.header}")
    private String googleCloudHeader;
    @Value("${google.cloud.storage.bucket}")
    private String bucket;

    @Override
    public String store(Long roomId, MultipartFile file) throws Exception {
        if (file == null || file.isEmpty()) throw new IllegalArgumentException("빈 파일");

        String original = file.getOriginalFilename();
        String ext = (original != null && original.contains(".")) ? original.substring(original.lastIndexOf(".")) : ".jpg";
        String fileName = "chat_" + UUID.randomUUID() + ext;
        String contentType = (file.getContentType() != null && !file.getContentType().isBlank())
                ? file.getContentType() : "image/jpeg";

        BlobId blobId = BlobId.of(bucket, fileName);
        BlobInfo blobInfo = BlobInfo.newBuilder(blobId)
                .setContentType(contentType)
                .build();
        storage.create(blobInfo, file.getBytes());

        return googleCloudHeader + fileName;
    }
}
// [E] edit by smsong
