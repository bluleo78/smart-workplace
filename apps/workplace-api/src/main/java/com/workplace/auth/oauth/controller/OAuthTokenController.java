package com.workplace.auth.oauth.controller;

import com.workplace.auth.oauth.dto.OAuthErrorResponse;
import com.workplace.auth.oauth.dto.TokenResponse;
import com.workplace.auth.oauth.exception.OAuthErrors;
import com.workplace.auth.oauth.exception.OAuthTokenException;
import com.workplace.auth.oauth.service.OAuthTokenService;
import com.workplace.global.security.ratelimit.PublicRateLimitFilter;
import jakarta.servlet.http.HttpServletRequest;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.InvalidMediaTypeException;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * OAuth 토큰 엔드포인트(RFC 6749 §3.2, WP-1685) — {@code POST /api/v1/oauth/token}. 로그인 없이
 * 열리고(SecurityConfig permitAll) IP 당 속도 제한(OAUTH_TOKEN, 기본 분당 60)과 공개 CORS 를 받는다. 공개 클라이언트(PKCE)만
 * 다루므로 클라이언트 인증은 없다.
 *
 * <p>본문은 {@code application/x-www-form-urlencoded} 여야 한다. {@code consumes} 로 막으면 스프링이 415 를 내므로 막지
 * 않고 직접 확인해 400 {@code invalid_request} 로 답한다. 성공·오류 모두 {@code Cache-Control: no-store}·{@code
 * Pragma: no-cache}(RFC 6749 §5.1), 오류는 §5.2 모양({@code {"error","error_description"}} snake_case)이고
 * 이 컨트롤러 안의 처리기가 전역 오류 모양보다 먼저 잡는다.
 */
@RestController
@RequiredArgsConstructor
public class OAuthTokenController {

  /** 쿼리 문자열로 받지 않는 grant 파라미터 — 폼 본문으로만 받는다. */
  private static final Set<String> GRANT_PARAMS =
      Set.of("grant_type", "code", "code_verifier", "redirect_uri", "client_id", "refresh_token");

  private final OAuthTokenService tokenService;

  /** grant_type 별로 code 교환·refresh 회전을 부른다. */
  @PostMapping(PublicRateLimitFilter.OAUTH_TOKEN_PATH)
  public ResponseEntity<TokenResponse> token(HttpServletRequest request) {
    if (!isForm(request.getContentType())) {
      throw invalidRequest("본문은 application/x-www-form-urlencoded 여야 합니다.");
    }
    rejectGrantParamsInQuery(request.getQueryString());
    String grantType = param(request, "grant_type");
    if (grantType == null) {
      throw invalidRequest("grant_type 이 없습니다.");
    }
    TokenResponse body =
        switch (grantType) {
          case OAuthTokenService.GRANT_AUTHORIZATION_CODE ->
              tokenService.exchangeCode(
                  required(request, "code"),
                  required(request, "redirect_uri"),
                  required(request, "client_id"),
                  required(request, "code_verifier"));
          case OAuthTokenService.GRANT_REFRESH_TOKEN ->
              tokenService.refresh(
                  required(request, "refresh_token"), required(request, "client_id"));
          default ->
              throw new OAuthTokenException(
                  OAuthErrors.UNSUPPORTED_GRANT_TYPE,
                  "grant_type 은 authorization_code·refresh_token 만 지원합니다.");
        };
    return ResponseEntity.ok().headers(noStore()).body(body);
  }

  /** 토큰 엔드포인트 오류 → 400 + RFC 6749 §5.2 본문. */
  @ExceptionHandler(OAuthTokenException.class)
  public ResponseEntity<OAuthErrorResponse> handle(OAuthTokenException e) {
    return ResponseEntity.badRequest()
        .headers(noStore())
        .body(new OAuthErrorResponse(e.error(), e.description()));
  }

  /** 폼 본문인지 — charset 등 파라미터가 붙어도 된다. 형식이 깨진 Content-Type 은 폼이 아닌 것으로 본다. */
  private static boolean isForm(String contentType) {
    if (contentType == null) return false;
    try {
      return MediaType.APPLICATION_FORM_URLENCODED.equalsTypeAndSubtype(
          MediaType.parseMediaType(contentType));
    } catch (InvalidMediaTypeException e) {
      return false;
    }
  }

  /**
   * 파라미터 하나 — 없거나 빈 값이면 null. RFC 6749 §3.2 는 같은 파라미터를 두 번 보내면 안 된다고 정하므로, 두 번 이상이면 어느 값을 쓸지 고르지 않고
   * invalid_request.
   */
  private static String param(HttpServletRequest request, String name) {
    String[] values = request.getParameterValues(name);
    if (values == null || values.length == 0) return null;
    if (values.length > 1) {
      throw invalidRequest(name + " 파라미터가 여러 번 왔습니다.");
    }
    return values[0].isEmpty() ? null : values[0];
  }

  /**
   * grant 파라미터를 쿼리 문자열로 보낸 요청은 거절한다(리뷰 D5.3) — {@code getParameter} 는 쿼리와 폼 본문을 합쳐 읽어, 막지 않으면
   * code·verifier· refresh 토큰이 주소(접근 로그·프록시 로그·Referer)에 실려 오는 요청도 받아들이게 된다. RFC 6749 §3.2 의 토큰 요청은
   * 폼 본문이다.
   */
  private static void rejectGrantParamsInQuery(String query) {
    if (query == null || query.isEmpty()) return;
    for (String pair : query.split("&")) {
      int eq = pair.indexOf('=');
      String raw = eq < 0 ? pair : pair.substring(0, eq);
      String name;
      try {
        name = URLDecoder.decode(raw, StandardCharsets.UTF_8);
      } catch (IllegalArgumentException e) {
        throw invalidRequest("쿼리 문자열 형식이 올바르지 않습니다.");
      }
      if (GRANT_PARAMS.contains(name)) {
        throw invalidRequest(name + " 파라미터는 쿼리 문자열이 아니라 폼 본문으로 보내야 합니다.");
      }
    }
  }

  /** 필수 파라미터 — 없으면 invalid_request. */
  private static String required(HttpServletRequest request, String name) {
    String value = param(request, name);
    if (value == null) {
      throw invalidRequest(name + " 파라미터가 없습니다.");
    }
    return value;
  }

  private static OAuthTokenException invalidRequest(String description) {
    return new OAuthTokenException(OAuthErrors.INVALID_REQUEST, description);
  }

  /** 토큰 응답·오류는 캐시하지 않는다(RFC 6749 §5.1). */
  private static HttpHeaders noStore() {
    HttpHeaders headers = new HttpHeaders();
    headers.setCacheControl(CacheControl.noStore());
    headers.setPragma("no-cache");
    return headers;
  }
}
