package com.example.Daylog.Service;

import com.example.Daylog.DTO.PlaceImageDTO;
import com.example.Daylog.Util.ImageUtil;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.io.InputStream;
import java.net.InetAddress;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

// ==========================================================================
// [B] edit by smsong - #44 장소 사진 자동 첨부
//
//  무엇을 하는가
//   1) searchImages()  : '상호명 + 지역'으로 네이버 이미지 검색 → 후보 목록 반환
//   2) fetchImageJpeg(): 사용자가 고른 이미지를 서버가 대신 내려받아 JPEG 로 재인코딩해 반환
//
//  왜 이 방식인가
//   네이버 '지역검색(local)' API 는 사진을 주지 않는다(상호명/주소/좌표만).
//   네이버 플레이스에 올라온 업체 사진을 가져오는 공개 API 도 없다.
//   → '상호명 + 지역'으로 이미지 검색을 돌려 후보를 뽑고 사용자가 고르게 한다.
//
//  왜 프록시가 필요한가
//   · 검색 결과의 원본 이미지 URL 은 대부분 Referer 검사(핫링크 차단)가 걸려 있어
//     브라우저에서 바로 fetch 하면 403 이 뜨거나 CORS 에 막힌다.
//   · 서버가 받아서 JPEG 로 다시 인코딩하면 형식이 통일되고(webp/png/animated gif 혼입 방지),
//     기존 업로드 파이프라인(GCS 업로드 + thumb_ 생성)을 그대로 태울 수 있다.
//
//  ⚠ 저작권 주의
//   여기서 나오는 이미지는 블로그/카페/뉴스 등 제3자가 올린 사진이다.
//   서버에 영구 복제해 두는 형태이므로, 방(room) 안에서만 보이는 사적 기록 용도로 쓰고
//   외부 공개/상업적 재배포로 확장할 계획이라면 별도 검토가 필요하다.
// ==========================================================================
@Slf4j
@Service
@RequiredArgsConstructor
public class PlaceImageService {

    // ===== 설정 =====
    //  네이버 개발자센터는 '한 애플리케이션'에 로그인 API 와 검색 API 를 같이 켤 수 있고
    //  Client ID / Secret 을 공유한다. 이 프로젝트에는 검색 전용 키가 따로 없고
    //  OAuth2 로그인용 NAVER_ID / NAVER_SECRET_ID 만 있으므로 그 값을 그대로 쓴다.
    //
    //  우선순위
    //   1. daylog.place-image.client-id                    (yml 에 명시하면 이게 이긴다)
    //   2. spring.security.oauth2...naver.client-id         (= ${NAVER_ID}, 현재 설정)
    //   3. 환경변수 NAVER_ID
    //
    //  ⚠ 만약 기존 /api/search/place(지역검색)가 이것과 '다른 키'를 쓰고 있다면
    //     그 키를 daylog.place-image.client-id 로 명시해 주면 된다.
    @Value("${daylog.place-image.client-id:"
         + "${spring.security.oauth2.client.registration.naver.client-id:"
         + "${NAVER_ID:}}}")
    private String clientId;

    @Value("${daylog.place-image.client-secret:"
         + "${spring.security.oauth2.client.registration.naver.client-secret:"
         + "${NAVER_SECRET_ID:}}}")
    private String clientSecret;

    /** 기능 토글 — daylog 하위 다른 기능들과 같은 관례 */
    @Value("${daylog.place-image.enabled:true}")
    private boolean enabled;

    /** 화면에 내려줄 최종 후보 수 */
    @Value("${daylog.place-image.result-max:15}")
    private int resultMax;

    /**
     * 첨부 시 긴 변 기준 축소 크기(px).
     *  spring.servlet.multipart.max-file-size 가 20MB 이므로 1600px JPEG 은 여유가 충분하다.
     */
    @Value("${daylog.place-image.max-edge:1600}")
    private int attachMaxEdge;

    private static final String IMAGE_API = "https://openapi.naver.com/v1/search/image.json";

    private static final int SEARCH_FETCH = 40;                  // 네이버에서 받아올 원시 후보 수
    private static final int MIN_EDGE     = 300;                 // 이보다 작은 이미지는 버린다
    private static final int PER_HOST_MAX = 4;                   // 한 도메인 독점 방지
    private static final int MAX_BYTES    = 12 * 1024 * 1024;    // 프록시 다운로드 상한 12MB
    private static final String UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

    private final ObjectMapper mapper = new ObjectMapper();

    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();

    // 키가 없으면 조용히 죽는 대신 기동 시 한 번 경고한다(운영 중 원인 추적용).
    @PostConstruct
    void checkConfig() {
        if (!enabled) {
            log.info("[place-image] 비활성화 상태 (daylog.place-image.enabled=false)");
            return;
        }
        if (clientId == null || clientId.isBlank() || clientSecret == null || clientSecret.isBlank()) {
            log.warn("[place-image] 네이버 자격증명이 비어 있습니다. NAVER_ID / NAVER_SECRET_ID 를 확인하세요. "
                   + "장소 사진 검색은 503 을 반환합니다.");
        }
    }

    public boolean isEnabled() {
        return enabled && clientId != null && !clientId.isBlank();
    }

    // ===== 1) 이미지 후보 검색 =====

    /**
     * @param query  상호명 (예: "어니언 성수")
     * @param region 지역 힌트 (예: "서울특별시 성동구") — 없으면 null
     */
    public List<PlaceImageDTO> searchImages(String query, String region) {
        if (!enabled) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "장소 사진 기능이 꺼져 있습니다");
        }
        if (clientId == null || clientId.isBlank() || clientSecret == null || clientSecret.isBlank()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "네이버 오픈API 자격증명이 설정되지 않았습니다");
        }
        if (query == null || query.isBlank()) return List.of();

        String place = query.trim();
        String narrowed = (region != null && !region.isBlank())
                ? (shortRegion(region) + " " + place).trim()
                : place;

        // 1차: 지역명을 붙여 좁게 검색 → 결과가 빈약하면 상호명만으로 재검색
        List<PlaceImageDTO> out = callImageApi(narrowed);
        if (out.size() < 5 && !narrowed.equals(place)) {
            out = mergeDistinct(out, callImageApi(place));
        }
        return out.size() > resultMax ? new ArrayList<>(out.subList(0, resultMax)) : out;
    }

    private List<PlaceImageDTO> callImageApi(String q) {
        try {
            String url = IMAGE_API
                    + "?query=" + URLEncoder.encode(q, StandardCharsets.UTF_8)
                    + "&display=" + SEARCH_FETCH
                    + "&start=1&sort=sim&filter=large";

            HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                    .header("X-Naver-Client-Id", clientId)
                    .header("X-Naver-Client-Secret", clientSecret)
                    .timeout(Duration.ofSeconds(6))
                    .GET().build();

            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (res.statusCode() != 200) {
                // 401/403 이면 이 애플리케이션에 '검색' API 가 안 켜져 있을 가능성이 높다.
                log.warn("[place-image] 네이버 이미지 검색 실패 status={} body={}", res.statusCode(), abbrev(res.body()));
                return List.of();
            }

            JsonNode items = mapper.readTree(res.body()).path("items");
            if (!items.isArray()) return List.of();

            List<PlaceImageDTO> list = new ArrayList<>();
            Set<String> seenUrl = new LinkedHashSet<>();
            Map<String, Integer> perHost = new HashMap<>();

            for (JsonNode it : items) {
                String link = it.path("link").asText(null);
                String thumb = it.path("thumbnail").asText(null);
                if (link == null || link.isBlank()) continue;
                if (!seenUrl.add(link)) continue;

                int w = it.path("sizewidth").asInt(0);
                int h = it.path("sizeheight").asInt(0);
                // 크기 정보가 없는 건(0) 통과시키고, 있는데 너무 작은 건 버린다
                if (w > 0 && h > 0 && (w < MIN_EDGE || h < MIN_EDGE)) continue;

                String host = hostOf(link);
                if (host == null) continue;
                int n = perHost.getOrDefault(host, 0);
                if (n >= PER_HOST_MAX) continue;
                perHost.put(host, n + 1);

                list.add(PlaceImageDTO.builder()
                        .url(link)
                        .thumbnail((thumb == null || thumb.isBlank()) ? link : thumb)
                        .title(stripTags(it.path("title").asText("")))
                        .source(host)
                        .width(w > 0 ? w : null)
                        .height(h > 0 ? h : null)
                        .build());
            }
            return list;
        } catch (Exception e) {
            log.warn("[place-image] 이미지 검색 중 오류: {}", e.toString());
            return List.of();
        }
    }

    private List<PlaceImageDTO> mergeDistinct(List<PlaceImageDTO> a, List<PlaceImageDTO> b) {
        Set<String> seen = new LinkedHashSet<>();
        List<PlaceImageDTO> out = new ArrayList<>();
        for (List<PlaceImageDTO> src : List.of(a, b)) {
            for (PlaceImageDTO d : src) {
                if (d.getUrl() != null && seen.add(d.getUrl())) out.add(d);
            }
        }
        return out;
    }

    // "서울특별시 성동구 성수동2가 …" → "서울 성동구" (검색어가 길면 오히려 결과가 줄어든다)
    private String shortRegion(String region) {
        String[] parts = region.trim().split("\\s+");
        List<String> keep = new ArrayList<>();
        for (String p : parts) {
            if (p.endsWith("시") || p.endsWith("도") || p.endsWith("군") || p.endsWith("구")) {
                keep.add(p.replace("특별자치시", "").replace("특별자치도", "")
                          .replace("특별시", "").replace("광역시", ""));
            }
            if (keep.size() >= 2) break;
        }
        return String.join(" ", keep).trim();
    }

    private String stripTags(String s) {
        if (s == null) return "";
        return s.replaceAll("<[^>]*>", "").replace("&amp;", "&")
                .replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").trim();
    }

    private String hostOf(String url) {
        try { return URI.create(url).getHost(); } catch (Exception e) { return null; }
    }

    private String abbrev(String s) {
        if (s == null) return "";
        return s.length() > 200 ? s.substring(0, 200) + "…" : s;
    }

    // ===== 2) 선택한 이미지를 서버가 대신 내려받아 JPEG 로 반환 =====

    /** 외부 이미지 URL → EXIF 방향 반영 + 축소된 JPEG 바이트. 실패 시 예외. */
    public byte[] fetchImageJpeg(String rawUrl) {
        if (!enabled) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "장소 사진 기능이 꺼져 있습니다");
        }
        URI uri = validateAndResolve(rawUrl);

        byte[] body;
        try {
            HttpRequest req = HttpRequest.newBuilder(uri)
                    .header("User-Agent", UA)
                    .header("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8")
                    // 핫링크 차단 회피용 — 이미지가 놓인 도메인 자신을 Referer 로 준다
                    .header("Referer", uri.getScheme() + "://" + uri.getHost() + "/")
                    .timeout(Duration.ofSeconds(10))
                    .GET().build();

            HttpResponse<InputStream> res = http.send(req, HttpResponse.BodyHandlers.ofInputStream());
            if (res.statusCode() != 200) {
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                        "이미지를 가져오지 못했습니다 (" + res.statusCode() + ")");
            }
            String ct = res.headers().firstValue("content-type").orElse("");
            if (!ct.toLowerCase().startsWith("image/")) {
                throw new ResponseStatusException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "이미지가 아닙니다");
            }
            body = readLimited(res.body(), MAX_BYTES);
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "이미지를 가져오지 못했습니다");
        }

        // JPEG 로 재인코딩(형식 통일 + EXIF 방향 반영 + 용량 축소). ImageUtil 재사용.
        byte[] jpeg = ImageUtil.buildThumbnailJpeg(body, attachMaxEdge);
        if (jpeg == null) {
            // webp/avif 등 ImageIO 가 못 읽는 형식
            throw new ResponseStatusException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "지원하지 않는 이미지 형식입니다");
        }
        return jpeg;
    }

    // SSRF 방어: http(s) 만 허용하고, 사설/루프백/링크로컬 주소로는 나가지 않는다.
    private URI validateAndResolve(String rawUrl) {
        if (rawUrl == null || rawUrl.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "url 이 필요합니다");
        }
        URI uri;
        try { uri = URI.create(rawUrl.trim()); } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "잘못된 url");
        }
        String scheme = uri.getScheme();
        if (scheme == null || !(scheme.equals("http") || scheme.equals("https"))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "http/https 만 허용됩니다");
        }
        String host = uri.getHost();
        if (host == null || host.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "잘못된 host");
        }
        try {
            for (InetAddress a : InetAddress.getAllByName(host)) {
                if (a.isAnyLocalAddress() || a.isLoopbackAddress() || a.isLinkLocalAddress()
                        || a.isSiteLocalAddress() || a.isMulticastAddress()) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "허용되지 않는 주소입니다");
                }
            }
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "host 확인 실패");
        }
        return uri;
    }

    private byte[] readLimited(InputStream in, int limit) throws Exception {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int total = 0, n;
        try (InputStream s = in) {
            while ((n = s.read(buf)) > 0) {
                total += n;
                if (total > limit) {
                    throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "이미지가 너무 큽니다");
                }
                out.write(buf, 0, n);
            }
        }
        return out.toByteArray();
    }
}
// [E] edit by smsong
