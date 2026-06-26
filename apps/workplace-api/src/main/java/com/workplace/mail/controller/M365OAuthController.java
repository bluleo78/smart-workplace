package com.workplace.mail.controller;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.config.M365GraphProperties;
import com.workplace.mail.service.M365OAuthService;
import com.workplace.mail.service.OAuthStateStore;
import com.workplace.mail.service.OAuthStateStore.StateData;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Microsoft 365 Graph OAuth2 auth-code 흐름 컨트롤러.
 *
 * <ul>
 *   <li>{@code GET /api/v1/mail/oauth/m365/start} — 인증 필수. AAD 인가 URL을 JSON(200)으로 반환. 프론트가 인증된
 *       axios로 받아 window.location.href로 이동한다(C1: Bearer 헤더 유실 방지).
 *   <li>{@code POST /api/v1/mail/oauth/m365/complete} — 공개 경로(SecurityConfig 등록). 프론트 콜백 라우트가
 *       code/state 를 JSON 으로 중계 → state 검증 → token 교환 → 계정 upsert → JSON 응답(302 없음).
 * </ul>
 */
@Slf4j
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/mail/oauth/m365")
public class M365OAuthController {

  /**
   * /start 200 응답 DTO — 인가 URL을 JSON으로 반환해 프론트가 인증된 axios로 수신 후 이동.
   *
   * <p>top-level window.location.href 이동은 Bearer 헤더를 실을 수 없어 @AuthenticationPrincipal이 null → NPE
   * 500. 대신 axios GET + 응답 URL로 이동하는 방식(C1 버그 수정).
   */
  public record M365AuthorizeUrlResponse(String authorizeUrl) {}

  private final M365GraphProperties props;
  private final OAuthStateStore stateStore;
  private final M365OAuthService oauthService;

  /**
   * M365 OAuth2 인가 흐름을 시작한다.
   *
   * <p>JWT 인증된 axios 요청에서 userId/tenantId 를 추출해 state 에 결속하고, AAD 인가 URL 을 JSON 으로 반환한다. 프론트는 이 URL
   * 로 window.location.href 이동한다(Bearer 헤더 없는 top-level 이동 대신).
   *
   * @param userId JWT 필터가 주입한 현재 사용자 ID (null 이면 인증 미완료 — 401)
   * @return 200 JSON {authorizeUrl} 또는 401 (userId null 방어)
   */
  @GetMapping("/start")
  public ResponseEntity<M365AuthorizeUrlResponse> start(@AuthenticationPrincipal Long userId) {
    // userId null 방어: SecurityConfig 상 /api/v1/** 은 authenticated() 이므로 정상 경로에선 불가하나
    // 방어적 검사로 명시적 401 반환(NPE 500 방지)
    if (userId == null) {
      return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
    }

    // JWT 필터가 이미 TenantContext.set 을 완료 — 현재 테넌트 ID 읽기
    Long tenantId = TenantContext.get();
    String state = stateStore.issue(userId, tenantId);

    // AAD 인가 URL 조립 — M365GraphProperties.SCOPE 단일 출처 참조(openid 포함 → id_token 수신)
    String scope = encode(M365GraphProperties.SCOPE);
    String authorizeUrl =
        "https://login.microsoftonline.com/"
            + props.tenantId()
            + "/oauth2/v2.0/authorize"
            + "?client_id="
            + encode(props.clientId())
            + "&response_type=code"
            + "&redirect_uri="
            + encode(props.redirectUri())
            + "&scope="
            + scope
            + "&state="
            + encode(state);

    // 302 리다이렉트 대신 200 JSON — 프론트가 인증 axios로 받아 window.location.href로 이동(C1 수정)
    return ResponseEntity.ok(new M365AuthorizeUrlResponse(authorizeUrl));
  }

  /** /complete 요청 DTO — 프론트 콜백 페이지가 code/state 를 JSON 으로 전달. */
  public record M365CompleteRequest(
      /** AAD 인가 코드 — 토큰 교환에 사용. */
      String code,
      /** CSRF/replay 방지용 state — 발급 시 userId/tenantId 결속, 1회 소비. */
      String state) {}

  /**
   * /complete 응답 DTO — 연결 성공 여부.
   *
   * <p>{@code @JsonInclude(NON_NULL)}: 성공 시 error 가 null 이므로 직렬화에서 생략 → 계약 {connected:true} 유지.
   */
  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record M365CompleteResponse(
      /** 연결 성공 여부. */
      boolean connected,
      /** 실패 사유 코드(invalid_request/connect_failed) — 성공 시 null 로 직렬화에서 생략. */
      String error) {}

  /**
   * 프론트 콜백 라우트가 중계한 인가 코드를 처리한다(302 대신 JSON).
   *
   * <p>⚠️ 이 엔드포인트는 JWT 없는 공개 경로다 — JwtAuthenticationFilter 가 실행되지 않아 TenantContext 가 비어 있다. {@link
   * M365OAuthService#connect} 는 @Transactional 이므로 TenantAwareTransactionManager.doBegin 이
   * TenantContext 를 읽어 GUC 를 주입한다. 컨텍스트가 비면 GUC 미주입 → FORCE RLS fail-closed(#444/#492 패턴). 따라서
   * stateStore.consume 으로 StateData 를 얻은 후 connect() 호출을 TenantContext.set/finally-clear 로 감싼다.
   *
   * <p>AAD 동의 거부(error 파라미터)는 프론트 콜백 페이지가 백엔드를 호출하지 않고 처리하므로, 이 엔드포인트는 code 경로만 다룬다.
   *
   * @param req code/state JSON 본문
   * @return 성공 200 {connected:true} / 유효하지 않은 state·교환 실패 400 {connected:false, error}
   */
  @PostMapping("/complete")
  public ResponseEntity<M365CompleteResponse> complete(@RequestBody M365CompleteRequest req) {
    // state 1회 소비 — 유효하지 않거나 만료면 거부(CSRF/replay 방어)
    Optional<StateData> stateData =
        req.state() == null ? Optional.empty() : stateStore.consume(req.state());
    if (stateData.isEmpty() || req.code() == null || req.code().isBlank()) {
      log.warn("M365 OAuth complete: 유효하지 않은 state 또는 code 누락");
      return ResponseEntity.badRequest().body(new M365CompleteResponse(false, "invalid_request"));
    }

    StateData sd = stateData.get();
    // ⚠️ 핵심: JWT 없는 공개 경로 → TenantContext 수동 설정 → GUC 주입 → RLS 통과
    TenantContext.set(sd.tenantId());
    try {
      oauthService.connect(req.code(), sd);
      return ResponseEntity.ok(new M365CompleteResponse(true, null));
    } catch (Exception e) {
      log.error("M365 OAuth 계정 연결 실패: userId={}", sd.userId(), e);
      return ResponseEntity.badRequest().body(new M365CompleteResponse(false, "connect_failed"));
    } finally {
      TenantContext.clear(); // 공개 경로이므로 다음 요청에 컨텍스트 누수 방지
    }
  }

  private static String encode(String value) {
    return URLEncoder.encode(value, StandardCharsets.UTF_8);
  }
}
