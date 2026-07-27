package com.example.Daylog.DTO;

import lombok.*;

// [B] edit by smsong - #44 장소 사진 자동 첨부: 검색된 이미지 후보 1건
//  네이버 '이미지 검색' API(openapi.naver.com/v1/search/image) 응답을 화면용으로 정리한 형태.
//  ⚠ 네이버 '지역검색(local)' API 는 사진을 주지 않는다(상호명/주소/좌표만).
//     네이버 플레이스에 올라온 업체 사진을 직접 가져오는 공개 API 는 존재하지 않으므로,
//     '상호명 + 지역'으로 이미지 검색을 돌려 후보를 뽑고 사용자가 고르는 방식을 쓴다.
@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class PlaceImageDTO {
    private String url;        // 원본 이미지 URL (첨부 시 프록시로 받아온다)
    private String thumbnail;  // 검색 썸네일 URL (선택 화면 미리보기용 · 대개 핫링크 허용)
    private String title;      // 이미지 제목 (HTML 태그 제거됨)
    private String source;     // 출처 도메인 (예: blogfiles.pstatic.net)
    private Integer width;
    private Integer height;
}
// [E] edit by smsong
