package com.workplace.global.config;

import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.BcryptLimitPasswordEncoder;
import com.workplace.global.security.DbBusyResponseFilter;
import com.workplace.global.security.JsonAuthenticationEntryPoint;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.UserTokenAuthenticationFilter;
import com.workplace.global.security.ratelimit.PublicRateLimitFilter;
import com.workplace.global.security.ratelimit.RateLimitProperties;
import com.workplace.global.security.ratelimit.TokenBucketLimiter;
import jakarta.servlet.DispatcherType;
import java.time.Clock;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;

@Configuration
@EnableWebSecurity
@EnableConfigurationProperties({
  JwtProperties.class,
  CorsProperties.class,
  RateLimitProperties.class
})
@RequiredArgsConstructor
public class SecurityConfig {

  private final JwtAuthenticationFilter jwtAuthenticationFilter;
  // Phase 5a — AGENT 인증 (Bearer ak_...) 는 JWT 보다 먼저 시도
  private final ApiKeyAuthenticationFilter apiKeyAuthenticationFilter;
  // 사용자 PAT 인증 (Bearer swp_...) 도 JWT 보다 먼저 시도 (ak_/swp_/JWT 는 prefix 로 상호 배타)
  private final UserTokenAuthenticationFilter userTokenAuthenticationFilter;
  private final CorsProperties corsProperties;
  private final RateLimitProperties rateLimitProperties;

  /**
   * 공개 경로 속도 제한 버킷(WP-763) — 인스턴스 메모리에 둔다. 여러 대로 늘릴 때는 docs/ops/rate-limit.md. 빈으로 두는 것은 통합 테스트가 같은
   * 버킷을 미리 채워 한도 경계를 시간과 무관하게 확인하게 하려는 것이다(WP-953).
   */
  @Bean
  public TokenBucketLimiter publicRateLimiter() {
    return new TokenBucketLimiter(Clock.systemUTC());
  }

  @Bean
  public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
    http.cors(Customizer.withDefaults())
        .csrf(csrf -> csrf.disable())
        .headers(
            headers ->
                headers
                    .contentTypeOptions(Customizer.withDefaults())
                    .frameOptions(frame -> frame.deny())
                    .httpStrictTransportSecurity(
                        hsts -> hsts.includeSubDomains(true).maxAgeInSeconds(31536000)))
        .sessionManagement(
            session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .authorizeHttpRequests(
            auth ->
                auth.dispatcherTypeMatchers(DispatcherType.ASYNC)
                    .permitAll()
                    .requestMatchers(
                        "/api/v1/auth/signup",
                        "/api/v1/auth/signup-available",
                        "/api/v1/auth/login",
                        "/api/v1/auth/refresh")
                    .permitAll()
                    // WP-48 SSO 로그인 — 로그인 전 브라우저 전체 이동으로 호출되므로 인증 없음(GET 만).
                    .requestMatchers(
                        org.springframework.http.HttpMethod.GET,
                        "/api/v1/auth/sso/status",
                        "/api/v1/auth/sso/start",
                        "/api/v1/auth/sso/callback")
                    .permitAll()
                    // 헬스(WP-749) — 외부 LB·모니터가 로그인 없이 가볍게 부르는 경로. 응답은 {"status":"ok"} 뿐이라 읽기만 연다 —
                    // 헬스
                    // 체크가 HEAD 로 부르기도 해 GET 과 HEAD 를 연다(Spring 은 HEAD 를 같은 GET 핸들러로 보내 본문 없이 응답).
                    .requestMatchers(org.springframework.http.HttpMethod.GET, "/api/v1/health")
                    .permitAll()
                    .requestMatchers(org.springframework.http.HttpMethod.HEAD, "/api/v1/health")
                    .permitAll()
                    // M365 메일 연결 — 프론트 콜백 라우트가 state 와 함께 POST /complete 로 중계 — JWT 없이 state 로 식별.
                    // (다른 앱에서 옮겨 온 triggers·slack inbound·kakao/slack 콜백 허용은 이 앱에 없는 경로라 걷어냈다 — 같은
                    // 경로로 API 를 추가하면 인증 없이 공개될 수 있었다(WP-673). 공개 경로는 실제 있는 것만 둔다.)
                    .requestMatchers("/api/v1/mail/oauth/m365/complete")
                    .permitAll()
                    // 공유 링크 공개 다운로드 — 인증 없이 토큰으로 접근(capability URL)
                    .requestMatchers("/api/v1/public/drive/share/**")
                    .permitAll()
                    // 노트 외부 공유 보기(WP-579) — 로그인 없이 토큰으로 페이지·본문 이미지를 연다(capability URL). 판정은 서비스가 매번
                    // DB 로.
                    .requestMatchers("/api/v1/public/wiki/shares/**")
                    .permitAll()
                    // 드라이브 전송 링크(WP-369) — 외부 MCP 클라이언트가 curl·브라우저로 쓰는 10분짜리 일회용 서명 링크.
                    // 토큰이 곧 권한이며 쓸 때 발급자 권한을 다시 확인한다.
                    .requestMatchers("/api/v1/public/drive/transfer/**")
                    .permitAll()
                    // 스테이징 업로드 링크(WP-421) — 외부 MCP 클라이언트가 curl 로 임시 첨부를 올리는 10분짜리 일회용 PUT 링크.
                    // 토큰이 곧 권한이며 쓸 때 발급자 멤버십을 다시 확인한다.
                    .requestMatchers("/api/v1/public/staged-files/**")
                    .permitAll()
                    // 캘린더 태그 구독 주소(WP-715) — 사내 시스템이 로그인 없이 주 단위로 가져가는 .ics. 토큰이 곧 권한이고
                    // 재발급·폐기로 막는다. 읽기 전용이라 GET 과 HEAD 만 연다 — 구독 클라이언트·프록시가 HEAD 로 먼저 확인하기도 하고,
                    // Spring 은 HEAD 를 같은 GET 핸들러로 보내 본문 없이 응답한다.
                    .requestMatchers(
                        org.springframework.http.HttpMethod.GET, "/api/v1/public/calendar/feeds/**")
                    .permitAll()
                    .requestMatchers(
                        org.springframework.http.HttpMethod.HEAD,
                        "/api/v1/public/calendar/feeds/**")
                    .permitAll()
                    // 운영자 콘솔(workplace-admin) 전용 평면. 로그인/리프레시만 공개, 그 외는 플랫폼 토큰(ROLE_PLATFORM) 필수.
                    // 일반 테넌트/에이전트 토큰으로는 접근 불가(권한상승 차단). 매칭 안 된 /api/platform 경로가
                    // anyRequest().permitAll() 로 새지 않도록 와일드카드로 전부 덮는다.
                    .requestMatchers("/api/platform/auth/login", "/api/platform/auth/refresh")
                    .permitAll()
                    .requestMatchers("/api/platform/**")
                    .hasRole("PLATFORM")
                    .requestMatchers("/api/v1/**")
                    .authenticated()
                    .anyRequest()
                    .permitAll())
        // 인증 실패 시 403 대신 401을 반환하여 프론트엔드의 토큰 갱신 인터셉터가 동작하도록 한다.
        // Spring Security 기본 EntryPoint는 403을 반환하여, 만료된 JWT로 접근 시
        // 프론트엔드가 refresh를 시도하지 못하는 문제가 있었다. 본문은 다른 오류와 같은 모양·한국어(WP-824).
        .exceptionHandling(ex -> ex.authenticationEntryPoint(new JsonAuthenticationEntryPoint()))
        // 인증 필터의 DB 조회가 커넥션을 못 얻으면 기본 500 대신 503 재시도 안내(WP-751). CORS 헤더가 붙은 뒤에 둔다.
        .addFilterAfter(new DbBusyResponseFilter(), CorsFilter.class)
        // 인증 없는 공개 경로의 해시 계산 요청을 IP 단위로 제한(WP-763). CORS 뒤라 429 를 브라우저가 읽는다 — 인증 필터보다 먼저 거른다.
        .addFilterAfter(
            new PublicRateLimitFilter(publicRateLimiter(), rateLimitProperties), CorsFilter.class)
        .addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class)
        // ak_ 토큰을 JWT 보다 먼저 시도 (둘 다 Bearer 헤더 — prefix 로 분기)
        .addFilterBefore(apiKeyAuthenticationFilter, JwtAuthenticationFilter.class)
        // swp_ 토큰도 JWT 보다 먼저 시도 (ak_/swp_/JWT 상호 배타)
        .addFilterBefore(userTokenAuthenticationFilter, JwtAuthenticationFilter.class);

    return http.build();
  }

  @Bean
  public CorsConfigurationSource corsConfigurationSource() {
    CorsConfiguration config = new CorsConfiguration();
    List<String> origins = corsProperties.allowedOrigins();
    if (origins != null) {
      List<String> filtered = origins.stream().filter(o -> o != null && !o.isBlank()).toList();
      if (!filtered.isEmpty()) {
        config.setAllowedOrigins(filtered);
      }
    }
    config.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
    config.setAllowedHeaders(List.of("*"));
    config.setAllowCredentials(true);
    config.setMaxAge(3600L);
    UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
    source.registerCorsConfiguration("/api/**", config);
    return source;
  }

  /** bcrypt 72바이트 한도를 한국어 400 으로 안내하는 인코더(WP-497) — 해시 형식은 기존 BCrypt 와 같다. */
  @Bean
  public PasswordEncoder passwordEncoder() {
    return new BcryptLimitPasswordEncoder();
  }
}
