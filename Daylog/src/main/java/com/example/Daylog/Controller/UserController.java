package com.example.Daylog.Controller;

import com.example.Daylog.DTO.JWTDTO;
import com.example.Daylog.DTO.OAuth2CodeDTO;
import com.example.Daylog.DTO.UserDTO;
import com.example.Daylog.Service.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.swagger.v3.oas.annotations.Operation;
import lombok.RequiredArgsConstructor;
import lombok.SneakyThrows;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

@RestController
@RequestMapping("/user")
@RequiredArgsConstructor
@CrossOrigin(origins = "http://127.0.0.1:5500") // 프론트 서버 주소
public class UserController {

    private final UserService userService;

    // 회원 가입
    @Operation(summary = "회원 가입")
    @PostMapping
    public ResponseEntity<UserDTO> createUser(@RequestBody UserDTO userDTO) {
        return ResponseEntity.ok(userService.createUser(userDTO));
    }

    // 로그인
    @Operation(summary = "로그인")
    @PostMapping("/login")
    public ResponseEntity<JWTDTO> login(@RequestBody UserDTO userDTO) {
        return ResponseEntity.ok(userService.login(userDTO.getUid(), userDTO.getPassword()));
    }

    // 전체 회원 조회
    @Operation(summary = "전체 회원 조회")
    @GetMapping("/all/{uid}")
    public ResponseEntity<List<UserDTO>> getAllUsers(@PathVariable("uid") String uid, @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(userService.getAllUsers(uid, userDetails));
    }

    // id로 회원조회
    @Operation(summary = "id로 회원조회")
    @GetMapping("/id/{uid}/{id}")
    public ResponseEntity<UserDTO> findById(@PathVariable("id") Long id, @PathVariable("uid") String uid, @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(userService.findById(id, uid, userDetails));
    }

    // 자기 자신 조회 (uid로 조회)
    @Operation(summary = "자기 자신 조회 (uid로 조회)")
    @GetMapping("/uid/{uid}")
    public ResponseEntity<UserDTO> findByUid(@PathVariable("uid") String uid, @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(userService.findByUid(uid, userDetails));
    }

    // 회원 수정
    @SneakyThrows
    @Operation(summary = "회원 수정")
    @PutMapping(consumes = {MediaType.APPLICATION_JSON_VALUE, MediaType.MULTIPART_FORM_DATA_VALUE})
    public ResponseEntity<UserDTO> updateUser(@RequestPart("userData") String userData, @RequestPart(value = "mediaData", required = false) MultipartFile mediaData, @AuthenticationPrincipal UserDetails userDetails) {
        ObjectMapper mapper = new ObjectMapper();
        mapper.configure(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        UserDTO userDTO = mapper.readValue(userData, UserDTO.class);
        return ResponseEntity.ok(userService.updateUser(userDTO, mediaData, userDetails));
    }

    // 회원 삭제
    @Operation(summary = "회원 삭제")
    @DeleteMapping("/delete/{uid}/{id}")
    public ResponseEntity<UserDTO> deleteUser(@PathVariable("id") Long id, @PathVariable("uid") String uid, @RequestBody UserDTO userDTO, @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(userService.deleteUser(id, uid, userDTO, userDetails));
    }

    // 카카오 로그인 성공 시 호출되는 엔드포인트 (GET)
    @Operation(summary = "카카오 로그인 성공 시 호출되는 엔드포인트 (GET)")
    @GetMapping("/oauth2/code/kakao")
    public ResponseEntity<JWTDTO> kakaoCallback(@RequestParam("code") String code) {
        return ResponseEntity.ok(userService.loginWithKakaoOAuth2(code));
    }

    // 카카오 로그인 성공 시 호출되는 엔드포인트 (POST)
    @Operation(summary = "카카오 로그인 성공 시 호출되는 엔드포인트 (POST)")
    @PostMapping("/oauth2/code/kakao")
    public ResponseEntity<JWTDTO> kakaoLoginPost(@RequestBody OAuth2CodeDTO codeDTO) {
        return ResponseEntity.ok(userService.loginWithKakaoOAuth2(codeDTO.getCode()));
    }

    // 네이버 로그인 성공 시 호출되는 엔드포인트 (GET)
    @Operation(summary = "네이버 로그인 성공 시 호출되는 엔드포인트 (GET)")
    @GetMapping("/oauth2/code/naver")
    public ResponseEntity<JWTDTO> naverCallback(@RequestParam("code") String code) {
        return ResponseEntity.ok(userService.loginWithNaverOAuth2(code));
    }

    // 네이버 로그인 성공 시 호출되는 엔드포인트 (POST)
    @Operation(summary = "네이버 로그인 성공 시 호출되는 엔드포인트 (POST)")
    @PostMapping("/oauth2/code/naver")
    public ResponseEntity<JWTDTO> naverLoginPost(@RequestBody OAuth2CodeDTO codeDTO) {
        return ResponseEntity.ok(userService.loginWithNaverOAuth2(codeDTO.getCode()));
    }

    // 구글 로그인 성공 시 호출되는 엔드포인트 (GET)
    @Operation(summary = "구글 로그인 성공 시 호출되는 엔드포인트 (GET)")
    @GetMapping("/oauth2/code/google")
    public ResponseEntity<JWTDTO> googleCallback(@RequestParam("code") String code) {
        return ResponseEntity.ok(userService.loginWithGoogleOAuth2(code));
    }

    // 구글 로그인 성공 시 호출되는 엔드포인트 (POST)
    @Operation(summary = "구글 로그인 성공 시 호출되는 엔드포인트 (POST)")
    @PostMapping("/oauth2/code/google")
    public ResponseEntity<JWTDTO> googleLoginPost(@RequestBody OAuth2CodeDTO codeDTO) {
        return ResponseEntity.ok(userService.loginWithGoogleOAuth2(codeDTO.getCode()));
    }
}