package com.example.Daylog.Config.JWT;

import com.example.Daylog.Repository.UserSessionRepository;
import com.example.Daylog.Service.UserDetailsServiceImpl;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    @Autowired
    private JwtTokenProvider jwtTokenProvider;

    @Autowired
    private UserDetailsServiceImpl userDetailsService;

    // [B][E] edit by smsong : 기기 세션 검증용
    @Autowired
    private UserSessionRepository userSessionRepository;

    // [B] edit by smsong : 세션 검증을 건너뛸 경로(로그인/갱신/기기등록/OAuth)
    private boolean skipSessionCheck(HttpServletRequest req) {
        String p = req.getRequestURI();
        return p != null && (p.endsWith("/user/refresh") || p.endsWith("/user/login")
                || p.endsWith("/user/register-device") || p.contains("/user/oauth2/"));
    }
    // [E] edit by smsong

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {

        String header = request.getHeader("Authorization");
        String token = null;
        String uid = null;

        if (header != null) {
            token = header.startsWith("Bearer ") ? header.substring(7) : header;
            // [B][E] edit by smsong : 만료/손상 토큰이면 예외 대신 uid=null 로 두고 통과(500 방지)
            try {
                uid = jwtTokenProvider.getUidFromToken(token);
            } catch (Exception e) {
                uid = null;
            }
        }

        if (uid != null && SecurityContextHolder.getContext().getAuthentication() == null) {
            boolean signatureOk = jwtTokenProvider.validateToken(token, uid);
            // [B] edit by smsong : 서명·만료가 유효해도, 이 토큰이 살아있는 기기 세션인지 확인.
            //   다른 기기가 강제 로그인해 세션이 지워졌다면 인증을 거부한다(자동 로그아웃).
            boolean sessionOk = true;
            if (signatureOk && !skipSessionCheck(request)) {
                try {
                    final String tk = token;
                    sessionOk = userSessionRepository.findByToken(tk).isPresent()
                            || userSessionRepository.countByUid(uid) == 0;   // 세션 없는 구버전 통과(하위호환)
                } catch (Exception e) {
                    sessionOk = true;   // 조회 실패 시 막지 않음(가용성 우선)
                }
            }
            // [E] edit by smsong

            if (signatureOk && sessionOk) {
                UserDetails userDetails = userDetailsService.loadUserByUsername(uid);
                if (userDetails != null) {
                    UsernamePasswordAuthenticationToken authentication = new UsernamePasswordAuthenticationToken(
                            userDetails, null, userDetails.getAuthorities());
                    authentication.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
                    SecurityContextHolder.getContext().setAuthentication(authentication);
                }
            } else {
                logger.error("유효기간이 만료됐거나 세션이 종료된 토큰입니다");
            }
        }

        filterChain.doFilter(request, response);
    }
}
