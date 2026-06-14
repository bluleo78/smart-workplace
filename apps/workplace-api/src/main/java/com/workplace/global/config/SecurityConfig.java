package com.workplace.global.config;

import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import jakarta.servlet.DispatcherType;
import jakarta.servlet.http.HttpServletResponse;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

@Configuration
@EnableWebSecurity
@EnableConfigurationProperties({JwtProperties.class, CorsProperties.class})
@RequiredArgsConstructor
public class SecurityConfig {

  private final JwtAuthenticationFilter jwtAuthenticationFilter;
  // Phase 5a — AGENT 인증 (Bearer ak_...) 는 JWT 보다 먼저 시도
  private final ApiKeyAuthenticationFilter apiKeyAuthenticationFilter;
  private final CorsProperties corsProperties;

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
                        "/api/v1/auth/signup", "/api/v1/auth/login", "/api/v1/auth/refresh")
                    .permitAll()
                    .requestMatchers("/api/v1/triggers/api/**", "/api/v1/triggers/webhook/**")
                    .permitAll()
                    // firehub-channel → firehub-api Internal 전용 inbound 엔드포인트
                    .requestMatchers("/api/v1/channels/slack/inbound")
                    .permitAll()
                    // OAuth 콜백은 외부 서비스(Kakao/Slack)에서 리다이렉트되므로 Bearer 헤더 없음
                    .requestMatchers("/api/v1/oauth/kakao/callback", "/api/v1/oauth/slack/callback")
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
        // 프론트엔드가 refresh를 시도하지 못하는 문제가 있었다.
        .exceptionHandling(
            ex ->
                ex.authenticationEntryPoint(
                    (request, response, authException) -> {
                      response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
                      response.setContentType("application/json");
                      response
                          .getWriter()
                          .write(
                              "{\"error\":\"Unauthorized\",\"message\":\""
                                  + authException.getMessage()
                                  + "\"}");
                    }))
        .addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class)
        // ak_ 토큰을 JWT 보다 먼저 시도 (둘 다 Bearer 헤더 — prefix 로 분기)
        .addFilterBefore(apiKeyAuthenticationFilter, JwtAuthenticationFilter.class);

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

  @Bean
  public PasswordEncoder passwordEncoder() {
    return new BCryptPasswordEncoder();
  }
}
