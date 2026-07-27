package com.example.Daylog.Controller;

import com.example.Daylog.DTO.PlaceImageDTO;
import com.example.Daylog.Service.PlaceImageService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;

import java.time.Duration;
import java.util.List;

// [B] edit by smsong - #44 장소 사진 자동 첨부
//  기존 /api/search/place (지역검색 프록시) 와 같은 네임스페이스에 얹는다.
//  ⚠ 컨트롤러가 여러 개여도 @RequestMapping 베이스가 같은 것은 문제되지 않는다(전체 경로만 겹치지 않으면 됨).
@RestController
@RequestMapping("/api/search")
@RequiredArgsConstructor
public class PlaceImageController {

    private final PlaceImageService placeImageService;

    /**
     * 장소 이미지 후보 검색.
     *  GET /api/search/place-images?query=어니언 성수&region=서울특별시 성동구
     */
    @GetMapping("/place-images")
    public ResponseEntity<List<PlaceImageDTO>> placeImages(@RequestParam("query") String query,
                                                           @RequestParam(value = "region", required = false) String region,
                                                           @AuthenticationPrincipal UserDetails userDetails) {
        if (userDetails == null) return ResponseEntity.status(403).build();
        return ResponseEntity.ok(placeImageService.searchImages(query, region));
    }

    /**
     * 선택한 외부 이미지를 서버가 대신 내려받아 JPEG 로 반환.
     *  GET /api/search/image-proxy?url=https://...
     *  프론트는 이 응답을 blob → File 로 만들어 기존 업로드 파이프라인에 그대로 태운다.
     */
    @GetMapping("/image-proxy")
    public ResponseEntity<byte[]> imageProxy(@RequestParam("url") String url,
                                             @AuthenticationPrincipal UserDetails userDetails) {
        if (userDetails == null) return ResponseEntity.status(403).build();
        byte[] jpeg = placeImageService.fetchImageJpeg(url);
        return ResponseEntity.ok()
                .contentType(MediaType.IMAGE_JPEG)
                .cacheControl(CacheControl.maxAge(Duration.ofMinutes(10)).cachePrivate())
                .body(jpeg);
    }
}
// [E] edit by smsong
