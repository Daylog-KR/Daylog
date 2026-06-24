package com.example.Daylog.Service;

import com.example.Daylog.Config.JWT.JwtTokenProvider;
import com.example.Daylog.Config.OAuthProperties.*;
import com.example.Daylog.Config.OAuthProperties.GoogleOAuthProperties;
import com.example.Daylog.Config.OAuthProperties.KakaoOAuthProperties;
import com.example.Daylog.Config.OAuthProperties.NaverOAuthProperties;
import com.example.Daylog.DTO.JWTDTO;
import com.example.Daylog.DTO.UserDTO;
import com.example.Daylog.Entity.*;
import com.example.Daylog.Repository.*;
import com.example.Daylog.Repository.UserRepository;
import com.google.cloud.storage.BlobId;
import com.google.cloud.storage.BlobInfo;
import com.google.cloud.storage.Storage;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class UserService {

    private static final Logger logger = LoggerFactory.getLogger(UserService.class);
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtTokenProvider jwtTokenProvider;
    private final RestTemplate restTemplate;
    private final KakaoOAuthProperties kakaoOAuthProperties;
    private final NaverOAuthProperties naverOAuthProperties;
    private final GoogleOAuthProperties googleOAuthProperties;
    private final Storage storage;
    @Value("${google.cloud.credentials.header}")
    private String googleCouldHeader;
    @Value("${google.cloud.storage.bucket}")
    private String bucket;

    // uid 중복 확인
    public boolean isUidDuplication(String uid) {
        return userRepository.existsByUid(uid);
    }

    // nickname 중복 확인
    public boolean isNicknameDuplication(String nickname) {
        return userRepository.existsByNickname(nickname);
    }

    // email 중복 확인
    public boolean isEmailDuplication(String email) {
        return userRepository.existsByEmail(email);
    }

    // phone 중복 확인
    public boolean isPhoneDuplication(String phone) {
        return userRepository.existsByPhone(phone);
    }

    // 회원 가입
    public UserDTO createUser(UserDTO userDTO) {
        if (isUidDuplication(userDTO.getUid())) {
            throw new IllegalArgumentException("중복된 아이디가 존재합니다");
        } else if (isNicknameDuplication(userDTO.getNickname())) {
            throw new IllegalArgumentException("중복된 닉네임이 존재합니다");
        } else if (isEmailDuplication(userDTO.getEmail())) {
            throw new IllegalArgumentException("중복된 이메일이 존재합니다");
        } else if (isPhoneDuplication(userDTO.getPhone())) {
            throw new IllegalArgumentException("중복된 휴대폰 번호가 존재합니다");
        }
        UserEntity userEntity = userDTO.dtoToEntity();
        userEntity.setPassword(passwordEncoder.encode(userDTO.getPassword()));
        userEntity.setProvider("normal");
        UserEntity savedUser = userRepository.save(userEntity);
        logger.info("회원가입 완료!");
        return UserDTO.entityToDto(savedUser);
    }

    // 로그인
    public JWTDTO login(String uid, String password) {
        UserEntity userEntity = userRepository.findByUid(uid)
                .orElseThrow(() -> new IllegalArgumentException("사용자를 찾을 수 없습니다"));
        if (!passwordEncoder.matches(password, userEntity.getPassword())) {
            throw new IllegalArgumentException("비밀번호가 일치하지 않습니다");
        }
        String token = jwtTokenProvider.generateToken(uid);
        logger.info("로그인 성공! 새로운 토큰이 발급되었습니다");
        return new JWTDTO(token, UserDTO.entityToDto(userEntity));
    }

    // 전체 회원 조회
    public List<UserDTO> getAllUsers(String uid, UserDetails userDetails) {
        if (!userDetails.getUsername().equals(uid)) {
            throw new RuntimeException("권한이 없습니다");
        }
        List<UserDTO> userDTO = userRepository.findAll().stream()
                .map(UserDTO::entityToDto)
                .collect(Collectors.toList());
        logger.info(userDTO.size() + "명 사용자 전체 조회 완료!");
        return userDTO;
    }

    // id로 회원 조회
    public UserDTO findById(Long id, String uid, UserDetails userDetails) {
        if (!userDetails.getUsername().equals(uid)) {
            throw new RuntimeException("권한이 없습니다");
        }
        UserEntity userEntity = userRepository.findById(id).orElseThrow();
        logger.info(id + "번 유저 조회 완료!");
        return UserDTO.entityToDto(userEntity);
    }

    // 자기 자신 조회
    public UserDTO findByUid(String uid, UserDetails userDetails) {
        if (!userDetails.getUsername().equals(uid)) {
            throw new RuntimeException("권한이 없습니다");
        }
        UserEntity userEntity = userRepository.findByUid(uid).orElseThrow(() -> new IllegalArgumentException("사용자를 찾을 수 없습니다"));
        logger.info(uid + " 유저 조회 완료!");
        return UserDTO.entityToDto(userEntity);
    }

    // 회원 수정 (닉네임/프로필 등 부분 업데이트, 이미지 없으면 기존 유지)
    public UserDTO updateUser(UserDTO userDTO, MultipartFile mediaFile, UserDetails userDetails) {
        if (userDetails == null || !userDetails.getUsername().equals(userDTO.getUid())) {
            throw new RuntimeException("권한이 없습니다");
        }
        UserEntity userEntity = userRepository.findByUid(userDTO.getUid())
                .orElseThrow(() -> new IllegalArgumentException("사용자를 찾을 수 없습니다"));

        // 전달된 값만 갱신 (null 이면 기존 값 유지 → 닉네임만 수정해도 다른 정보가 지워지지 않음)
        if (userDTO.getName() != null) userEntity.setName(userDTO.getName());
        if (userDTO.getNickname() != null) userEntity.setNickname(userDTO.getNickname());
        if (userDTO.getEmail() != null) userEntity.setEmail(userDTO.getEmail());
        if (userDTO.getPhone() != null) userEntity.setPhone(userDTO.getPhone());
        if (userDTO.getAddress() != null) userEntity.setAddress(userDTO.getAddress());
        if (userDTO.getAge() != null) userEntity.setAge(userDTO.getAge());
        if (userDTO.getGender() != null) userEntity.setGender(userDTO.getGender());

        // 새 이미지가 있으면 교체, 새 이미지가 없고 profileURL 이 빈 문자열("")로 명시되면 제거
        if (mediaFile != null && !mediaFile.isEmpty()) {
            userEntity.setProfileURL(uploadProfileImage(mediaFile));
        } else if (userDTO.getProfileURL() != null && userDTO.getProfileURL().isEmpty()) {
            // 명시적 비움 처리 — 기존 GCS 파일은 best-effort 로 정리 (실패해도 무시)
            deleteProfileImageQuietly(userEntity.getProfileURL());
            userEntity.setProfileURL(null);
        }
        // (그 외: profileURL == null 이고 새 이미지도 없으면 기존 프로필 그대로 유지)

        UserEntity updatedUser = userRepository.save(userEntity);
        logger.info(userEntity.getId() + "번 사용자 정보 업데이트 완료!");
        return UserDTO.entityToDto(updatedUser);
    }

    // 프로필 이미지 GCS 업로드 (설정된 버킷 사용)
    private String uploadProfileImage(MultipartFile mediaFile) {
        try {
            // UUID 로 파일명 충돌 방지
            UUID uuid = UUID.randomUUID();
            String original = mediaFile.getOriginalFilename();
            String ext = (original != null && original.contains(".")) ? original.substring(original.lastIndexOf(".")) : "";
            String fileName = uuid.toString() + ext;

            String contentType;
            switch (ext.toLowerCase()) {
                case ".jpg":
                case ".jpeg": contentType = "image/jpeg"; break;
                case ".png": contentType = "image/png"; break;
                case ".bmp": contentType = "image/bmp"; break;
                case ".gif": contentType = "image/gif"; break;
                case ".webp": contentType = "image/webp"; break;
                default: contentType = "application/octet-stream";
            }

            BlobId blobId = BlobId.of(bucket, fileName);
            BlobInfo blobInfo = BlobInfo.newBuilder(blobId)
                    .setContentType(contentType)
                    .build();
            storage.create(blobInfo, mediaFile.getBytes());
            return googleCouldHeader + fileName;
        } catch (IOException e) {
            throw new RuntimeException("미디어 파일 업로드 중 오류가 발생했습니다.", e);
        }
    }

    // 프로필 이미지 GCS 파일 삭제 (best-effort, 실패해도 흐름 막지 않음)
    private void deleteProfileImageQuietly(String profileURL) {
        try {
            if (profileURL == null || profileURL.isEmpty()) return;
            if (googleCouldHeader == null || !profileURL.startsWith(googleCouldHeader)) return;
            String fileName = profileURL.substring(googleCouldHeader.length());
            if (!fileName.isEmpty()) {
                storage.delete(BlobId.of(bucket, fileName));
            }
        } catch (Exception e) {
            logger.warn("기존 프로필 이미지 삭제 실패(무시): {}", e.getMessage());
        }
    }

    // 회원 탈퇴 (삭제)
    public UserDTO deleteUser(Long id, String uid, UserDTO userDTO, UserDetails userDetails) {
        if (!userDetails.getUsername().equals(uid)) {
            throw new RuntimeException("권한이 없습니다");
        }
        UserEntity userEntity = userRepository.findById(id).orElseThrow();
        userRepository.delete(userEntity);
        logger.info(id + "번 사용자 탈퇴 완료!");
        return UserDTO.entityToDto(userEntity);
    }

    // 카카오 로그인 URL 값 확인
    @PostConstruct
    public void logKakaoOAuthSettings() {
        logger.info("카카오 로그인 설정 값 - clientId : {}, clientSecret : {}, redirectUri : {}",
                kakaoOAuthProperties.getClientId(),
                kakaoOAuthProperties.getClientSecret(),
                kakaoOAuthProperties.getRedirectUri());

        String authorizationUrl = String.format(
                "https://kauth.kakao.com/oauth/authorize?client_id=%s&redirect_uri=%s&response_type=code",
                kakaoOAuthProperties.getClientId(),
                kakaoOAuthProperties.getRedirectUri());
        logger.info("카카오 로그인 URL : {}", authorizationUrl);
    }

    // 네이버 로그인 URL 값 확인
    @PostConstruct
    public void logNaverOAuthSettings() {
        logger.info("네이버 로그인 설정 값 - clientId : {}, clientSecret : {}, redirectUri : {}",
                naverOAuthProperties.getClientId(),
                naverOAuthProperties.getClientSecret(),
                naverOAuthProperties.getRedirectUri());

        String authorizationUrl = String.format(
                "https://nid.naver.com/oauth2.0/authorize?client_id=%s&redirect_uri=%s&response_type=code",
                naverOAuthProperties.getClientId(),
                naverOAuthProperties.getRedirectUri());
        logger.info("네이버 로그인 URL : {}", authorizationUrl);
    }

    // 구글 로그인 URL 값 확인
    @PostConstruct
    public void logGoogleOAuthSettings() {
        logger.info("구글 로그인 설정 값 - clientId : {}, clientSecret : {}, redirectUri : {}",
                googleOAuthProperties.getClientId(),
                googleOAuthProperties.getClientSecret(),
                googleOAuthProperties.getRedirectUri());

        String authorizationUrl = String.format(
                "https://accounts.google.com/o/oauth2/v2/auth?client_id=%s&redirect_uri=%s&response_type=code&scope=email%%20profile",
                googleOAuthProperties.getClientId(),
                googleOAuthProperties.getRedirectUri());
        logger.info("구글 로그인 URL : {}", authorizationUrl);
    }

    // 카카오 인가 코드로 액세스 토큰 요청
    public String getKakaoAccessToken(String code) {
        String url = "https://kauth.kakao.com/oauth/token";
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);
        MultiValueMap<String, String> params = new LinkedMultiValueMap<>();
        params.add("grant_type", "authorization_code");
        params.add("client_id", kakaoOAuthProperties.getClientId());
        params.add("redirect_uri", kakaoOAuthProperties.getRedirectUri());
        params.add("code", code);
        params.add("client_secret", kakaoOAuthProperties.getClientSecret());

        logger.info("액세스 토큰 요청 URL : {}", url);
        logger.info("액세스 토큰 요청 헤더 : {}", headers);
        logger.info("액세스 토큰 요청 파라미터 : {}", params);

        HttpEntity<MultiValueMap<String, String>> request = new HttpEntity<>(params, headers);
        try {
            ResponseEntity<Map> response = restTemplate.postForEntity(url, request, Map.class);
            Map<String, Object> responseBody = response.getBody();
            if (responseBody != null) {
                String accessToken = (String) responseBody.get("access_token");
                logger.info("액세스 토큰을 성공적으로 가져왔습니다 : {}", accessToken);
                return accessToken;
            } else {
                logger.error("액세스 토큰을 가져오는데 실패했습니다. 응답 본문이 비어있습니다.");
                return null;
            }
        } catch (HttpClientErrorException e) {
            logger.error("액세스 토큰을 가져오는 중 오류가 발생하였습니다. (위치: getAccessToken ) : {}", e.getMessage());
            logger.error("응답 본문 (위치: getAccessToken) : {}", e.getResponseBodyAsString());
            throw e;
        }
    }

    // 액세스 토큰으로 사용자 정보 요청
    public Map<String, Object> getKakaoUserInfo(String accessToken) {
        String url = "https://kapi.kakao.com/v2/user/me";
        HttpHeaders headers = new HttpHeaders();
        headers.set("Authorization", "Bearer " + accessToken);
        HttpEntity<String> entity = new HttpEntity<>(headers);
        try {
            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.GET, entity, Map.class);
            Map<String, Object> responseBody = response.getBody();
            if (responseBody != null) {
                logger.info("사용자 정보를 성공적으로 가져왔습니다 : {}", responseBody);
                return responseBody;
            } else {
                logger.error("사용자 정보를 가져오는데 실패했습니다. 응답 본문이 비어있습니다.");
                return null;
            }
        } catch (HttpClientErrorException e) {
            logger.error("사용자 정보를 가져오는 중 오류가 발생했습니다. (위치: getUserInfo) : {}", e.getMessage());
            logger.error("응답 본문 (위치 : getUserInfo) : {}", e.getResponseBodyAsString());
            throw e;
        }
    }

    // 카카오 로그인 처리
    public JWTDTO loginWithKakaoOAuth2(String code) {
        try {
            String accessToken = getKakaoAccessToken(code);
            Map<String, Object> userInfo = getKakaoUserInfo(accessToken);

            String uid = String.valueOf(userInfo.get("id"));
            if (uid == null) {
                throw new RuntimeException("사용자 ID를 가져올 수 없습니다.");
            }

            @SuppressWarnings("unchecked")
            Map<String, Object> properties = (Map<String, Object>) userInfo.get("properties");
            @SuppressWarnings("unchecked")
            Map<String, Object> kakaoAccount = (Map<String, Object>) userInfo.get("kakao_account");

            String name = null;
            if (properties != null) {
                name = (String) properties.get("nickname");
            }
            if (name == null) {
                name = "카카오사용자";
            }

            String email = null;
            if (kakaoAccount != null) {
                email = (String) kakaoAccount.get("email");
            }
            if (email == null) {
                throw new RuntimeException("사용자 이메일을 가져올 수 없습니다.");
            }

            UserEntity userEntity = userRepository.findByUid(uid).orElse(null);

            boolean isNewUser = false;
            if (userEntity == null) {
                userEntity = UserEntity.builder()
                        .uid(uid)
                        .name(name)
                        .email(email)
                        .password(passwordEncoder.encode("oauth2user"))
                        .provider("kakao")
                        .build();
                userRepository.save(userEntity);
                isNewUser = true;
            } else {
                userEntity.setName(name);
                userEntity.setEmail(email);
                userRepository.save(userEntity);
            }

            String token = jwtTokenProvider.generateToken(uid);
            logger.info("카카오 로그인 성공! 새로운 토큰이 발급되었습니다");
            return new JWTDTO(token, UserDTO.entityToDto(userEntity));
        } catch (HttpClientErrorException e) {
            logger.error("카카오 API 호출 중 오류가 발생했습니다 : {}", e.getMessage());
            logger.error("응답 본문: {}", e.getResponseBodyAsString());
            throw new RuntimeException("카카오 API 호출 중 오류가 발생했습니다.", e);
        } catch (Exception e) {
            logger.error("카카오 로그인 중 오류가 발생했습니다 (위치 : loginWithOAuth2) : {}", e.getMessage());
            throw new RuntimeException("카카오 로그인 중 오류가 발생했습니다. (위치 : loginWithOAuth2)", e);
        }
    }

    // 네이버 인가 코드로 액세스 토큰 요청
    public String getNaverAccessToken(String code) {
        String url = "https://nid.naver.com/oauth2.0/token";
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);
        MultiValueMap<String, String> params = new LinkedMultiValueMap<>();
        params.add("grant_type", "authorization_code");
        params.add("client_id", naverOAuthProperties.getClientId());
        params.add("client_secret", naverOAuthProperties.getClientSecret());
        params.add("redirect_uri", naverOAuthProperties.getRedirectUri());
        params.add("code", code);

        logger.info("액세스 토큰 요청 URL : {}", url);
        logger.info("액세스 토큰 요청 헤더 : {}", headers);
        logger.info("액세스 토큰 요청 파라미터 : {}", params);

        HttpEntity<MultiValueMap<String, String>> request = new HttpEntity<>(params, headers);
        try {
            ResponseEntity<Map> response = restTemplate.postForEntity(url, request, Map.class);
            Map<String, Object> responseBody = response.getBody();
            if (responseBody != null) {
                String accessToken = (String) responseBody.get("access_token");
                logger.info("액세스 토큰을 성공적으로 가져왔습니다 : {}", accessToken);
                return accessToken;
            } else {
                logger.error("액세스 토큰을 가져오는데 실패했습니다. 응답 본문이 비어있습니다.");
                return null;
            }
        } catch (HttpClientErrorException e) {
            logger.error("액세스 토큰을 가져오는 중 오류가 발생하였습니다. (위치: getNaverAccessToken) : {}", e.getMessage());
            logger.error("응답 본문 (위치: getNaverAccessToken) : {}", e.getResponseBodyAsString());
            throw e;
        }
    }

    // 액세스 토큰으로 사용자 정보 요청
    public Map<String, Object> getNaverUserInfo(String accessToken) {
        String url = "https://openapi.naver.com/v1/nid/me";
        HttpHeaders headers = new HttpHeaders();
        headers.set("Authorization", "Bearer " + accessToken);
        HttpEntity<String> entity = new HttpEntity<>(headers);

        logger.info("사용자 정보 요청 URL : {}", url);
        logger.info("사용자 정보 요청 헤더 : {}", headers);

        try {
            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.GET, entity, Map.class);
            Map<String, Object> responseBody = response.getBody();
            if (responseBody != null) {
                logger.info("사용자 정보를 성공적으로 가져왔습니다 : {}", responseBody);
                return responseBody;
            } else {
                logger.error("사용자 정보를 가져오는데 실패했습니다. 응답 본문이 비어있습니다.");
                return null;
            }
        } catch (HttpClientErrorException e) {
            logger.error("사용자 정보를 가져오는 중 오류가 발생했습니다. (위치: getNaverUserInfo) : {}", e.getMessage());
            logger.error("응답 본문 (위치: getNaverUserInfo) : {}", e.getResponseBodyAsString());
            throw e;
        }
    }

    // 네이버 로그인 처리
    public JWTDTO loginWithNaverOAuth2(String code) {
        try {
            String accessToken = getNaverAccessToken(code);
            Map<String, Object> userInfo = getNaverUserInfo(accessToken);

            Map<String, Object> response = (Map<String, Object>) userInfo.get("response");
            String uid = (String) response.get("id");
            String name = (String) response.get("name");
            String email = (String) response.get("email");

            if (uid == null || name == null || email == null) {
                throw new RuntimeException("필수 사용자 정보를 가져올 수 없습니다.");
            }

            Optional<UserEntity> userEntityOptional = userRepository.findByUid(uid);
            UserEntity userEntity;
            if (userEntityOptional.isPresent()) {
                userEntity = userEntityOptional.get();
                userEntity.setName(name);
                userEntity.setEmail(email);
            } else {
                userEntity = UserEntity.builder()
                        .uid(uid)
                        .name(name)
                        .email(email)
                        .password(passwordEncoder.encode("OAuth2_User_Password"))
                        .provider("naver")
                        .build();
                userRepository.save(userEntity);
            }
            String token = jwtTokenProvider.generateToken(uid);
            logger.info("네이버 로그인 성공! 새로운 토큰이 발급되었습니다");
            return new JWTDTO(token, UserDTO.entityToDto(userEntity));
        } catch (HttpClientErrorException e) {
            logger.error("네이버 API 호출 중 오류가 발생했습니다 : {}", e.getMessage());
            logger.error("응답 본문 : {}", e.getResponseBodyAsString());
            throw new RuntimeException("네이버 API 호출 중 오류가 발생했습니다.", e);
        } catch (Exception e) {
            logger.error("네이버 로그인 중 오류가 발생했습니다 (위치 : loginWithNaverOAuth2) : {}", e.getMessage());
            throw new RuntimeException("네이버 로그인 중 오류가 발생했습니다. (위치 : loginWithNaverOAuth2)", e);
        }
    }

    // 구글 인가 코드로 액세스 토큰 요청
    public String getGoogleAccessToken(String code) {
        String url = "https://oauth2.googleapis.com/token";
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);
        MultiValueMap<String, String> params = new LinkedMultiValueMap<>();
        params.add("grant_type", "authorization_code");
        params.add("client_id", googleOAuthProperties.getClientId());
        params.add("client_secret", googleOAuthProperties.getClientSecret());
        params.add("redirect_uri", googleOAuthProperties.getRedirectUri());
        params.add("code", code);

        logger.info("액세스 토큰 요청 URL : {}", url);
        logger.info("액세스 토큰 요청 헤더 : {}", headers);
        logger.info("액세스 토큰 요청 파라미터 : {}", params);

        HttpEntity<MultiValueMap<String, String>> request = new HttpEntity<>(params, headers);
        try {
            ResponseEntity<Map> response = restTemplate.postForEntity(url, request, Map.class);
            Map<String, Object> responseBody = response.getBody();
            if (responseBody != null) {
                String accessToken = (String) responseBody.get("access_token");
                logger.info("액세스 토큰을 성공적으로 가져왔습니다 : {}", accessToken);
                return accessToken;
            } else {
                logger.error("액세스 토큰을 가져오는데 실패했습니다. 응답 본문이 비어있습니다.");
                return null;
            }
        } catch (HttpClientErrorException e) {
            logger.error("액세스 토큰을 가져오는 중 오류가 발생하였습니다. (위치: getGoogleAccessToken) : {}", e.getMessage());
            logger.error("응답 본문 (위치: getGoogleAccessToken) : {}", e.getResponseBodyAsString());
            throw e;
        }
    }

    // 액세스 토큰으로 사용자 정보 요청
    public Map<String, Object> getGoogleUserInfo(String accessToken) {
        String url = "https://www.googleapis.com/oauth2/v3/userinfo";
        HttpHeaders headers = new HttpHeaders();
        headers.set("Authorization", "Bearer " + accessToken);
        HttpEntity<String> entity = new HttpEntity<>(headers);

        logger.info("사용자 정보 요청 URL : {}", url);
        logger.info("사용자 정보 요청 헤더 : {}", headers);

        try {
            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.GET, entity, Map.class);
            Map<String, Object> responseBody = response.getBody();
            if (responseBody != null) {
                logger.info("사용자 정보를 성공적으로 가져왔습니다 : {}", responseBody);
                return responseBody;
            } else {
                logger.error("사용자 정보를 가져오는데 실패했습니다. 응답 본문이 비어있습니다.");
                return null;
            }
        } catch (HttpClientErrorException e) {
            logger.error("사용자 정보를 가져오는 중 오류가 발생했습니다. (위치: getGoogleUserInfo) : {}", e.getMessage());
            logger.error("응답 본문 (위치: getGoogleUserInfo) : {}", e.getResponseBodyAsString());
            throw e;
        }
    }

    // 구글 로그인 처리
    public JWTDTO loginWithGoogleOAuth2(String code) {
        try {
            String accessToken = getGoogleAccessToken(code);
            Map<String, Object> userInfo = getGoogleUserInfo(accessToken);

            String uid = (String) userInfo.get("sub");
            String name = (String) userInfo.get("name");
            String email = (String) userInfo.get("email");

            if (uid == null || name == null || email == null) {
                throw new RuntimeException("필수 사용자 정보를 가져올 수 없습니다.");
            }

            Optional<UserEntity> userEntityOptional = userRepository.findByUid(uid);
            UserEntity userEntity;
            if (userEntityOptional.isPresent()) {
                userEntity = userEntityOptional.get();
                userEntity.setName(name);
                userEntity.setEmail(email);
            } else {
                userEntity = UserEntity.builder()
                        .uid(uid)
                        .name(name)
                        .email(email)
                        .password(passwordEncoder.encode("OAuth2_User_Password"))
                        .provider("google")
                        .build();
                userRepository.save(userEntity);
            }

            String token = jwtTokenProvider.generateToken(uid);
            logger.info("구글 로그인 성공! 새로운 토큰이 발급되었습니다");
            return new JWTDTO(token, UserDTO.entityToDto(userEntity));
        } catch (HttpClientErrorException e) {
            logger.error("구글 API 호출 중 오류가 발생했습니다 : {}", e.getMessage());
            logger.error("응답 본문: {}", e.getResponseBodyAsString());
            throw new RuntimeException("구글 API 호출 중 오류가 발생했습니다.", e);
        } catch (Exception e) {
            logger.error("구글 로그인 중 오류가 발생했습니다 (위치 : loginWithGoogleOAuth2) : {}", e.getMessage());
            throw new RuntimeException("구글 로그인 중 오류가 발생했습니다. (위치 : loginWithGoogleOAuth2)", e);
        }
    }
}