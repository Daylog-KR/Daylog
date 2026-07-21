package com.example.Daylog.Config.JWT;

import io.jsonwebtoken.*;
import io.jsonwebtoken.security.Keys;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.security.Key;
import java.util.Date;
import java.util.HashMap;
import java.util.Map;

@Component
public class JwtTokenProvider {

    private static final Logger logger = LoggerFactory.getLogger(JwtTokenProvider.class);

    @Value("${jwt.secret}")
    private String secret;

    @Value("${jwt.expiration}")
    private Long expiration;

    private Key key;

    // [B][E] edit by smsong : activeTokens/invalidTokens 제거 — 기기 세션은 user_sessions 테이블이 관리.

    @PostConstruct
    public void init() {
        byte[] keyBytes = secret.getBytes();
        if (keyBytes.length < 64) {
            throw new IllegalArgumentException("경고 : 비밀 키의 길이는 64자 이상으로 설정할 것");
        }
        this.key = Keys.hmacShaKeyFor(keyBytes);
    }

    // 새로운 JWT 토큰을 생성
    // [B][E] edit by smsong : 기기별 다중 세션 지원 — "uid당 1토큰" 무효화 제거. 세션은 user_sessions 가 관리.
    public String generateToken(String uid) {
        Map<String, Object> claims = new HashMap<>();
        return doGenerateToken(claims, uid);
    }

    // JWT 토큰을 생성
    private String doGenerateToken(Map<String, Object> claims, String subject) {
        return Jwts.builder()
                .setClaims(claims)
                .setSubject(subject)
                .setIssuedAt(new Date(System.currentTimeMillis()))
                .setExpiration(new Date(System.currentTimeMillis() + expiration))
                .signWith(key, SignatureAlgorithm.HS512)
                .compact();
    }

    // JWT 토큰을 생성
    public String getUidFromToken(String token) {
        Claims claims = getAllClaimsFromToken(token);
        return claims != null ? claims.getSubject() : null;
    }

    // JWT 토큰에서 모든 클레임을 추출
    private Claims getAllClaimsFromToken(String token) {
        try {
            return Jwts.parserBuilder()
                    .setSigningKey(key)
                    .build()
                    .parseClaimsJws(token)
                    .getBody();
        } catch (ExpiredJwtException e) {
            logger.error("토큰의 유효기간이 지나 만료되었습니다. 다시 로그인 해주세요");
            throw e;
        } catch (JwtException | IllegalArgumentException e) {
            logger.error("토큰이 유효하지 않습니다");
            throw e;
        }
    }

    // JWT 토큰의 유효성과 만료 여부를 체크
    // [B][E] edit by smsong : 서명·만료·uid 일치만 검사(stateless). 세션 유효성은 JwtAuthenticationFilter 가 담당.
    public Boolean validateToken(String token, String uid) {
        try {
            final String userUid = getUidFromToken(token);
            return (userUid != null && userUid.equals(uid) && !isTokenExpired(token));
        } catch (ExpiredJwtException e) {
            logger.error("토큰의 유효기간이 지나 만료되었습니다. 다시 로그인 해주세요");
            return false;
        } catch (JwtException | IllegalArgumentException e) {
            logger.error("토큰이 유효하지 않습니다");
            return false;
        }
    }

    // JWT 토큰이 만료되었는지 확인
    private Boolean isTokenExpired(String token) {
        final Date expiration = getExpirationDateFromToken(token);
        return expiration.before(new Date());
    }

    // JWT 토큰에서 만료 날짜를 추출
    private Date getExpirationDateFromToken(String token) {
        Claims claims = getAllClaimsFromToken(token);
        return claims != null ? claims.getExpiration() : null;
    }

    // [B][E] edit by smsong : 토큰 무효화/갱신/활성조회 로직은 user_sessions(UserService)로 이관.

    // JWT 토큰의 남은 유효 기간(초)
    public Long getTokenRemainingTime(String token) {
        Claims claims = getAllClaimsFromToken(token);
        if (claims == null || isTokenExpired(token)) {
            throw new IllegalArgumentException("유효기간이 만료된 토큰입니다");
        }
        Date expirationDate = claims.getExpiration();
        return expirationDate != null
                ? (expirationDate.getTime() - System.currentTimeMillis()) / 1000 : null;
    }
}
