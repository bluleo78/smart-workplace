package com.workplace.auth.oauth.controller;

import static com.workplace.auth.oauth.exception.OAuthErrors.INVALID_REQUEST;

import com.workplace.auth.oauth.dto.AuthorizeDecisionRequest;
import com.workplace.auth.oauth.dto.AuthorizeParams;
import com.workplace.auth.oauth.dto.AuthorizeRedirectResponse;
import com.workplace.auth.oauth.dto.AuthorizeValidateResponse;
import com.workplace.auth.oauth.dto.OAuthAuthorizeError;
import com.workplace.auth.oauth.exception.OAuthAuthorizeException;
import com.workplace.auth.oauth.service.OAuthAuthorizationService;
import com.workplace.global.security.AuthDetails;
import com.workplace.global.security.RequireWebSession;
import jakarta.servlet.http.HttpServletRequest;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.InvalidMediaTypeException;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.core.JacksonException;
import tools.jackson.core.JsonParser;
import tools.jackson.core.JsonToken;
import tools.jackson.databind.ObjectMapper;

/**
 * OAuth 인가 요청 검증·승인 API(WP-1685) — 동의 화면(웹 {@code /oauth/authorize}, WP-1686)이 로그인한 브라우저 JWT 로 부른다.
 *
 * <ul>
 *   <li>{@code GET /api/v1/oauth/authorize/validate} — 커넥터가 보낸 인가 요청 쿼리를 검증하고 화면에 그릴 앱·워크스페이스 정보를
 *       준다.
 *   <li>{@code POST /api/v1/oauth/authorize} — 사용자의 승인·거부를 받아 클라이언트로 돌려보낼 주소를 준다.
 * </ul>
 *
 * <p>웹 로그인 세션만 받는다 — PAT·OAuth access({@code swo_})·AI 키로 앱 연결을 승인할 수 있으면, 이미 가진 토큰으로 새 자격 증명을 계속
 * 만들어 낼 수 있어 토큰을 폐기해도 끊어지지 않는다(MyApiTokenController 의 PAT 발급과 같은 이유). 오류는 동의 화면이 읽는 camelCase
 * 모양({@link OAuthAuthorizeError})이고, 이 컨트롤러 안의 처리기가 전역 오류 모양보다 먼저 잡는다. 응답에 code 가 실리므로 캐시하지 않는다.
 *
 * <p>웹 세션 판정은 다른 관리 동작과 같은 {@link RequireWebSession}(PermissionInterceptor)이 하고, 세션의 인증
 * 수단(SSO·비밀번호)은 {@link AuthDetails#methodOf} 로 읽어 서비스에 넘긴다 — SSO 세션이면 SSO 를 켠 워크스페이스에만 연결한다(WP-48).
 */
@RestController
@RequiredArgsConstructor
public class OAuthAuthorizeController {

  /** validate 쿼리에서 읽는 인가 요청 파라미터 이름 — 겹침(RFC 6749 §3.1) 검사 대상. scope 는 읽지 않으므로 보지 않는다. */
  private static final List<String> QUERY_PARAMS =
      List.of(
          "response_type",
          "client_id",
          "redirect_uri",
          "code_challenge",
          "code_challenge_method",
          "state",
          "resource");

  /**
   * 승인 본문의 필드 이름(camelCase) → 겹침 검사 결과에 쓰는 이름(인가 요청 쿼리와 같은 snake_case — 서비스가 이 이름으로 겹침을 가른다). 이 밖의
   * 필드는 보지 않는다.
   */
  private static final Map<String, String> BODY_FIELDS =
      Map.of(
          "responseType", "response_type",
          "clientId", "client_id",
          "redirectUri", "redirect_uri",
          "codeChallenge", "code_challenge",
          "codeChallengeMethod", "code_challenge_method",
          "state", "state",
          "resource", "resource",
          "tenantId", "tenant_id",
          "decision", "decision");

  /** 동의 화면만 보내는 승인 필드 — 겹치면 클라이언트로 돌려보내지 않는다(동의 화면의 잘못). */
  private static final Set<String> CONSENT_FIELDS = Set.of("tenant_id", "decision");

  private final OAuthAuthorizationService authorizationService;
  private final ObjectMapper objectMapper;

  /**
   * 인가 요청 검증 — 쿼리 이름은 OAuth 그대로(snake_case). scope 는 받더라도 무시한다. 같은 파라미터가 두 번 오면 쉼표로 합치지 않고 검증이
   * invalid_request 로 거절한다.
   */
  @GetMapping("/api/v1/oauth/authorize/validate")
  @RequireWebSession
  public ResponseEntity<AuthorizeValidateResponse> validate(
      @AuthenticationPrincipal Long callerId,
      Authentication authentication,
      HttpServletRequest request) {
    Set<String> repeated = new HashSet<>();
    for (String name : QUERY_PARAMS) {
      String[] values = request.getParameterValues(name);
      if (values != null && values.length > 1) repeated.add(name);
    }
    // 값은 첫 값(없으면 null) — 겹침은 위에서 따로 걸렀다.
    AuthorizeParams p =
        new AuthorizeParams(
            request.getParameter("response_type"),
            request.getParameter("client_id"),
            request.getParameter("redirect_uri"),
            request.getParameter("code_challenge"),
            request.getParameter("code_challenge_method"),
            request.getParameter("state"),
            request.getParameter("resource"),
            repeated);
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(authorizationService.validate(callerId, AuthDetails.methodOf(authentication), p));
  }

  /**
   * 승인·거부 — 검증을 다시 하고 돌려보낼 주소(code 또는 access_denied)를 준다. 본문은 camelCase 필드의 JSON 객체여야 하고(호출자는 우리 동의
   * 화면뿐이다), 같은 필드가 두 번 오면 Jackson 이 마지막 값을 조용히 고르지 않게 먼저 걸러 invalid_request 로 거절한다.
   */
  @PostMapping("/api/v1/oauth/authorize")
  @RequireWebSession
  public ResponseEntity<AuthorizeRedirectResponse> authorize(
      @AuthenticationPrincipal Long callerId,
      Authentication authentication,
      HttpServletRequest request,
      @RequestBody String body) {
    if (!isJson(request.getContentType())) {
      throw unreadableBody();
    }
    Set<String> repeated = repeatedFields(body);
    if (repeated.stream().anyMatch(CONSENT_FIELDS::contains)) {
      throw new OAuthAuthorizeException(
          400, INVALID_REQUEST, "tenantId·decision 은 한 번만 보내야 합니다.", null);
    }
    AuthorizeDecisionRequest req;
    try {
      req = objectMapper.readValue(body, AuthorizeDecisionRequest.class);
    } catch (JacksonException e) {
      throw unreadableBody();
    }
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(
            authorizationService.decide(
                callerId,
                AuthDetails.methodOf(authentication),
                req.params(repeated),
                req.tenantId(),
                req.decision()));
  }

  /** 검증·승인 실패 → 예외가 정한 상태 + camelCase 오류(믿을 수 있는 redirect 가 있을 때만 errorRedirectUrl). */
  @ExceptionHandler(OAuthAuthorizeException.class)
  public ResponseEntity<OAuthAuthorizeError> handle(OAuthAuthorizeException e) {
    return ResponseEntity.status(e.status())
        .cacheControl(CacheControl.noStore())
        .body(new OAuthAuthorizeError(e.error(), e.description(), e.errorRedirectUrl()));
  }

  /** 본문이 없음 → 400 invalid_request(redirect 없음 — 동의 화면의 잘못이다). */
  @ExceptionHandler({
    HttpMessageNotReadableException.class,
    HttpMediaTypeNotSupportedException.class
  })
  public ResponseEntity<OAuthAuthorizeError> handleUnreadable(Exception e) {
    return handle(unreadableBody());
  }

  /**
   * JSON 본문인지 — {@code application/json}·{@code +json}, charset 등 파라미터는 무시. 형식이 깨진 Content-Type 은
   * 아닌 것으로 본다.
   */
  private static boolean isJson(String contentType) {
    if (contentType == null) return false;
    try {
      MediaType type = MediaType.parseMediaType(contentType);
      return MediaType.APPLICATION_JSON.equalsTypeAndSubtype(type)
          || (type.getSubtype() != null && type.getSubtype().endsWith("+json"));
    } catch (InvalidMediaTypeException e) {
      return false;
    }
  }

  /**
   * 본문의 최상위 필드 중 두 번 이상 온 것(snake_case 이름). JSON 객체가 아니거나 깨졌으면 invalid_request. Jackson 의 엄격한 중복 검사
   * (STRICT_DUPLICATE_DETECTION)는 쓰지 않는다 — 모든 겹침을 같은 오류로 만들어, 클라이언트·redirect_uri 확인 뒤의 겹침(state 등)을
   * 돌려보낼 주소와 함께 주는 규칙을 지키지 못한다.
   */
  private Set<String> repeatedFields(String body) {
    Set<String> seen = new HashSet<>();
    Set<String> repeated = new HashSet<>();
    try (JsonParser parser = objectMapper.createParser(body)) {
      if (parser.nextToken() != JsonToken.START_OBJECT) {
        throw unreadableBody();
      }
      while (parser.nextToken() == JsonToken.PROPERTY_NAME) {
        String field = BODY_FIELDS.get(parser.currentName());
        if (field != null && !seen.add(field)) repeated.add(field);
        parser.nextToken();
        parser.skipChildren();
      }
    } catch (JacksonException e) {
      throw unreadableBody();
    }
    return repeated;
  }

  /** 본문을 읽을 수 없음(JSON 객체가 아님) — redirect 없는 invalid_request. */
  private static OAuthAuthorizeException unreadableBody() {
    return new OAuthAuthorizeException(400, INVALID_REQUEST, "요청 본문은 올바른 JSON 객체여야 합니다.", null);
  }
}
