package com.workplace.mail.controller;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.config.M365GraphProperties;
import com.workplace.mail.service.M365OAuthService;
import com.workplace.mail.service.OAuthStateStore;
import com.workplace.mail.service.OAuthStateStore.StateData;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Microsoft 365 Graph OAuth2 auth-code 흐름 컨트롤러.
 *
 * <ul>
 *   <li>{@code GET /api/v1/mail/oauth/m365/start} — 인증 필수. AAD 인가 URL을 JSON(200)으로 반환. 프론트가 인증된
 *       axios로 받아 window.location.href로 이동한다(C1: Bearer 헤더 유실 방지).
 *   <li>{@code GET /api/v1/mail/oauth/m365/callback} — 공개 경로(SecurityConfig 등록). AAD 브라우저 리다이렉트 수신
 *       → state 검증 → token 교환 → 계정 upsert → 웹 앱 리다이렉트.
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

  /**
   * AAD 인가 콜백을 처리한다.
   *
   * <p>⚠️ 이 엔드포인트는 JWT 없는 공개 경로다 — JwtAuthenticationFilter 가 실행되지 않아 TenantContext 가 비어 있다. {@link
   * #oauthService#connect} 는 @Transactional 이므로 TenantAwareTransactionManager.doBegin 이
   * TenantContext 를 읽어 GUC 를 주입한다. 컨텍스트가 비면 GUC 미주입 → FORCE RLS fail-closed(#444/#492 패턴). 따라서
   * stateStore.consume 으로 StateData 를 얻은 후 connect() 호출을 TenantContext.set/finally-clear 로 감싼다(스케줄러
   * forEachActiveTenant 와 동일 패턴).
   *
   * <p>AAD 동의 거부 시 code 없이 error 파라미터로 리다이렉트됨 — graceful 복귀를 위해 code 는 optional 처리.
   *
   * @param code AAD 인가 코드 (동의 거부 시 null)
   * @param error AAD 에러 코드 (동의 거부 시 access_denied 등, 정상 시 null)
   * @param state CSRF 방지용 state 문자열
   * @return 302 → 웹 프론트엔드 (성공: ?mail_connected=1, 실패: ?mail_connected=error)
   */
  @GetMapping("/callback")
  public ResponseEntity<Void> callback(
      @RequestParam(required = false) String code,
      @RequestParam(required = false) String error,
      @RequestParam(required = false) String state) {
    // AAD 동의 거부 시 graceful 복귀: code 없거나 error 파라미터가 있으면 토큰 교환 없이 에러 페이지로.
    // state 가 있으면 consume 해 누수를 방지(만료/불일치이면 empty 반환 — 무해).
    if (code == null || error != null) {
      log.warn("M365 OAuth 콜백: 동의 거부 또는 에러 수신 (error={})", error);
      if (state != null) {
        stateStore.consume(state); // state 누수 방지 — 결과는 사용하지 않음
      }
      // 실제 settings/profile 라우트로 직접 리다이렉트(쿼리 유실 방지 — App.tsx /profile→/settings/profile
      // Navigate는 정적 to라 쿼리스트링을 보존하지 않으므로 백엔드에서 직접 정합)
      return redirect(props.webBaseUrl() + "/settings/profile?mail_connected=error");
    }

    Optional<StateData> stateData = stateStore.consume(state);
    if (stateData.isEmpty()) {
      // 알 수 없거나 만료된 state — CSRF 거부 또는 만료
      log.warn("M365 OAuth 콜백: 유효하지 않은 state 거부");
      // 실제 settings/profile 라우트로 직접 리다이렉트(쿼리 유실 방지)
      return redirect(props.webBaseUrl() + "/settings/profile?mail_connected=error");
    }

    StateData sd = stateData.get();
    // ⚠️ 핵심: JWT 없는 공개 경로 → TenantContext 수동 설정 → GUC 주입 → RLS 통과
    TenantContext.set(sd.tenantId());
    try {
      oauthService.connect(code, sd);
    } catch (Exception e) {
      log.error("M365 OAuth 계정 연결 실패: userId={}", sd.userId(), e);
      // 실제 settings/profile 라우트로 직접 리다이렉트(쿼리 유실 방지)
      return redirect(props.webBaseUrl() + "/settings/profile?mail_connected=error");
    } finally {
      TenantContext.clear(); // 공개 경로이므로 다음 요청에 컨텍스트 누수 방지
    }

    // 실제 settings/profile 라우트로 직접 리다이렉트(쿼리 유실 방지)
    return redirect(props.webBaseUrl() + "/settings/profile?mail_connected=1");
  }

  private ResponseEntity<Void> redirect(String url) {
    return ResponseEntity.status(HttpStatus.FOUND).location(URI.create(url)).build();
  }

  private static String encode(String value) {
    return URLEncoder.encode(value, StandardCharsets.UTF_8);
  }
}
