package com.workplace.auth.oauth.service;

import static com.workplace.auth.oauth.exception.OAuthErrors.ACCESS_DENIED;
import static com.workplace.auth.oauth.exception.OAuthErrors.INVALID_REDIRECT_URI;
import static com.workplace.auth.oauth.exception.OAuthErrors.INVALID_REQUEST;
import static com.workplace.auth.oauth.exception.OAuthErrors.UNSUPPORTED_RESPONSE_TYPE;

import com.workplace.auth.oauth.dto.AuthorizeParams;
import com.workplace.auth.oauth.dto.AuthorizeRedirectResponse;
import com.workplace.auth.oauth.dto.AuthorizeValidateResponse;
import com.workplace.auth.oauth.dto.AuthorizeValidateResponse.Workspace;
import com.workplace.auth.oauth.exception.OAuthAuthorizeException;
import com.workplace.auth.oauth.exception.OAuthClientException;
import com.workplace.auth.oauth.repository.OAuthCodeRepository;
import com.workplace.auth.oauth.repository.OAuthConnectionRepository;
import com.workplace.auth.oauth.repository.OAuthConnectionRepository.Created;
import com.workplace.auth.oauth.service.OAuthClientService.ResolvedClient;
import com.workplace.auth.service.AuthService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.user.dto.UserKind;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.util.UriComponentsBuilder;

/**
 * OAuth 인가 요청 검증·승인(WP-1685) — 동의 화면(웹, WP-1686)이 브라우저 JWT 로 부르는 두 단계.
 *
 * <p>검증 순서가 보안의 핵심이다. 먼저 client_id 를 풀고 redirect_uri 가 그 클라이언트의 등록 목록과 맞는지 본다 — 여기서 실패하면 redirect
 * 주소를 믿을 수 없으므로 오류를 그 주소로 돌려보내지 않는다(열린 리다이렉터 방지). 그 뒤의 오류(response_type·PKCE·resource)는
 * redirect_uri 로 {@code error}·{@code state}·{@code iss} 를 붙여 돌려보낼 주소({@code errorRedirectUrl})를 함께
 * 준다(RFC 6749 §4.1.2.1, RFC 9207).
 *
 * <p>승인(ALLOW)은 그 워크스페이스의 ACTIVE 멤버·ACTIVE 테넌트이고, SSO 로그인 세션이면 그 워크스페이스가 SSO 를 켰을 때만(WP-48 — 로그인
 * 세션과 같은 {@link AuthService#isTenantUsable}) 연결을 만들거나 다시 쓰고, 1회용 code(10분)를 해시로만 저장한다. 새 연결이면 그 테넌트
 * 감사에 {@code OAUTH_CONNECTION_CREATED} 를 남긴다.
 *
 * <p>클래스에 트랜잭션을 두지 않는다 — CIMD 클라이언트 해석이 외부 문서를 가져오는 동안(최대 5초) DB 커넥션을 잡지 않게. 연결·code·감사 쓰기만 {@link
 * TransactionTemplate} 로 한 트랜잭션에 묶는다(요청 트랜잭션이 이미 있으면 합류).
 */
@Service
public class OAuthAuthorizationService {

  /** 인가 code 수명. */
  static final Duration CODE_TTL = Duration.ofMinutes(10);

  /** 인가 code 평문 바이트 수(base64url 43자). */
  static final int CODE_BYTES = 32;

  /** 결정 값 — 승인. */
  public static final String ALLOW = "ALLOW";

  /** 결정 값 — 거부. */
  public static final String DENY = "DENY";

  /** 새 연결 감사 액션. */
  static final String AUDIT_CONNECTION_CREATED = "OAUTH_CONNECTION_CREATED";

  private final OAuthClientService clientService;
  private final OAuthConnectionRepository connections;
  private final OAuthCodeRepository codes;
  private final OAuthIssuer issuer;
  private final AuthService authService;
  private final UserRepository users;
  private final OAuthAudit audit;
  private final TransactionTemplate tx;

  public OAuthAuthorizationService(
      OAuthClientService clientService,
      OAuthConnectionRepository connections,
      OAuthCodeRepository codes,
      OAuthIssuer issuer,
      AuthService authService,
      UserRepository users,
      OAuthAudit audit,
      PlatformTransactionManager txManager) {
    this.clientService = clientService;
    this.connections = connections;
    this.codes = codes;
    this.issuer = issuer;
    this.authService = authService;
    this.users = users;
    this.audit = audit;
    // 기본 전파(REQUIRED) — 요청 트랜잭션이 있으면 합류한다.
    this.tx = new TransactionTemplate(txManager);
  }

  /**
   * 인가 요청을 검증하고 동의 화면에 그릴 값을 돌려준다. 고를 수 있는 워크스페이스는 로그인의 워크스페이스 목록과 같다 — SSO 로그인 세션이면 SSO 를 켠
   * 워크스페이스만(WP-48).
   *
   * @param authMethod 웹 세션의 인증 수단({@code AuthDetails.methodOf})
   * @throws AccessDeniedException AGENT 사용자(사람만 앱을 연결한다)
   * @throws OAuthAuthorizeException 검증 실패(400)
   */
  public AuthorizeValidateResponse validate(
      long userId, String authMethod, AuthorizeParams params) {
    requireHuman(userId);
    AuthorizeParams p = normalize(params);
    ResolvedClient client = check(p);
    List<Workspace> workspaces =
        authService.membershipsOf(userId, authMethod).stream()
            .map(m -> new Workspace(m.tenantId(), m.tenantName(), m.tenantSlug()))
            .toList();
    // 지금 세션의 워크스페이스를 기본 선택으로 — 고를 수 있는 목록에 있을 때만.
    Long current = TenantContext.get();
    Long currentTenantId =
        current != null && workspaces.stream().anyMatch(w -> w.tenantId() == current)
            ? current
            : null;
    return new AuthorizeValidateResponse(
        client.clientName(),
        client.clientUri(),
        RedirectUris.hostOf(p.redirectUri()),
        client.unverified(),
        workspaces,
        currentTenantId);
  }

  /**
   * 사용자의 결정을 처리한다. 검증을 처음부터 다시 하고(실패 응답은 {@link #validate} 와 같다), DENY 면 {@code access_denied} 로,
   * ALLOW 면 code 를 붙여 돌려보낼 주소를 만든다.
   *
   * @param authMethod 웹 세션의 인증 수단({@code AuthDetails.methodOf}) — SSO 세션이면 SSO 를 켠 워크스페이스에만 연결한다
   * @param tenantId 연결할 워크스페이스(ALLOW 때 필수)
   * @param decision {@code ALLOW}·{@code DENY}
   * @throws AccessDeniedException AGENT 사용자
   * @throws OAuthAuthorizeException 검증 실패·결정 값 오류·워크스페이스를 쓸 수 없음(400)
   */
  public AuthorizeRedirectResponse decide(
      long userId, String authMethod, AuthorizeParams params, Long tenantId, String decision) {
    UserResponse user = requireHuman(userId);
    AuthorizeParams p = normalize(params);
    ResolvedClient client = check(p);
    if (DENY.equals(decision)) {
      return new AuthorizeRedirectResponse(redirectWithError(p, ACCESS_DENIED));
    }
    if (!ALLOW.equals(decision)) {
      // 결정 값 오류는 동의 화면의 잘못이라 클라이언트로 돌려보내지 않는다.
      throw noRedirect(INVALID_REQUEST, "decision 은 ALLOW 또는 DENY 여야 합니다.");
    }
    if (tenantId == null) {
      throw noRedirect(INVALID_REQUEST, "연결할 워크스페이스(tenantId)를 골라야 합니다.");
    }
    // 고른 워크스페이스의 ACTIVE 멤버이고 테넌트도 활성이며, SSO 세션이면 SSO 도 켠 곳일 때만(로그인 세션과 같은 술어) — 아니면 화면이
    // 다른 워크스페이스를 고르게 redirect 없이 거절한다. validate 목록에 없는 워크스페이스는 여기서도 같은 오류다.
    if (!authService.isTenantUsable(userId, tenantId, authMethod)) {
      throw noRedirect(INVALID_REQUEST, "이 워크스페이스에는 앱을 연결할 수 없습니다.");
    }

    String code = CapabilityTokens.generateUrlSafe(CODE_BYTES);
    tx.executeWithoutResult(s -> issueCode(user, tenantId, client, p, code));

    Map<String, String> query = new LinkedHashMap<>();
    query.put("code", code);
    if (p.state() != null) query.put("state", p.state());
    query.put("iss", issuer.issuer());
    return new AuthorizeRedirectResponse(appendQuery(p.redirectUri(), query));
  }

  /** 연결을 만들거나 다시 쓰고(새 연결이면 감사), code 해시를 저장한다 — 한 트랜잭션. */
  private void issueCode(
      UserResponse user, long tenantId, ResolvedClient client, AuthorizeParams p, String code) {
    Created c = connections.findOrCreateActive(user.id(), tenantId, client.id());
    long connectionId = c.row().id();
    if (c.created()) {
      audit.connectionEvent(
          c.row(),
          user.username(),
          AUDIT_CONNECTION_CREATED,
          "OAuth 앱 연결: " + client.clientName(),
          "SUCCESS",
          Map.of(
              "clientId", client.clientId(),
              "clientName", client.clientName(),
              "clientKind", client.kind()));
    }
    codes.insert(
        CapabilityTokens.sha256Hex(code),
        connectionId,
        p.redirectUri(),
        p.codeChallenge(),
        p.resource(),
        OffsetDateTime.now().plus(CODE_TTL));
  }

  /**
   * 빈 resource 는 없는 것으로 본다 — 동의 화면이 쿼리에 없는 값을 빈 문자열로 실어 보내도 형식 오류가 되지 않게. state 는 손대지 않는다(클라이언트에 받은
   * 그대로 돌려줘야 한다).
   */
  private static AuthorizeParams normalize(AuthorizeParams p) {
    if (p.resource() == null || !p.resource().isEmpty()) return p;
    return p.withResource(null);
  }

  /** 사람(비 AGENT) 사용자만 — AI 계정은 OAuth 로 앱을 연결하지 않는다(설계 밖). */
  private UserResponse requireHuman(long userId) {
    return users
        .findById(userId)
        .filter(u -> !UserKind.isAgent(u.kind()))
        .orElseThrow(() -> new AccessDeniedException("AI 계정은 앱을 연결할 수 없습니다."));
  }

  /**
   * 인가 요청 검증. 클라이언트·redirect_uri 를 먼저 보고(실패는 redirect 없음), 그 뒤 겹친 파라미터·response_type·PKCE·resource
   * 를 본다(실패는 errorRedirectUrl 포함).
   *
   * <p>같은 파라미터가 두 번 오면(RFC 6749 §3.1 위반) {@code invalid_request} 다. client_id·redirect_uri 가 겹쳤으면
   * 어느 주소를 믿을지 모르므로 redirect 없이, 그 밖의 파라미터가 겹쳤으면 클라이언트·redirect_uri 를 확인한 뒤 돌려보낼 주소와 함께 준다(state 가
   * 겹쳤으면 어느 값을 돌려줄지 모르므로 state 없이).
   *
   * @return 해석된 클라이언트
   */
  private ResolvedClient check(AuthorizeParams p) {
    if (p.repeated().contains("client_id") || p.repeated().contains("redirect_uri")) {
      throw noRedirect(INVALID_REQUEST, "client_id·redirect_uri 는 한 번만 보내야 합니다.");
    }
    ResolvedClient client;
    try {
      client = clientService.resolve(p.clientId());
    } catch (OAuthClientException e) {
      throw noRedirect(e.error(), e.description());
    }
    String redirectUri = p.redirectUri();
    if (redirectUri == null || redirectUri.isEmpty()) {
      // OAuth 2.1 은 redirect_uri 를 늘 요구한다 — 등록 목록 중 하나로 짐작하지 않는다.
      throw noRedirect(INVALID_REDIRECT_URI, "redirect_uri 가 없습니다.");
    }
    if (client.redirectUris().stream().noneMatch(r -> RedirectUris.matches(r, redirectUri))) {
      throw noRedirect(INVALID_REDIRECT_URI, "등록되지 않은 redirect_uri 입니다.");
    }

    // 여기부터는 redirect_uri 를 믿을 수 있다 — 오류를 클라이언트로 돌려보낼 주소를 함께 준다.
    if (!p.repeated().isEmpty()) {
      // 겹친 state 는 어느 값을 돌려줄지 모르므로 오류 redirect 에 싣지 않는다.
      AuthorizeParams forError = p.repeated().contains("state") ? p.withState(null) : p;
      throw withRedirect(
          forError,
          INVALID_REQUEST,
          String.join(", ", new TreeSet<>(p.repeated())) + " 파라미터가 여러 번 왔습니다.");
    }
    if (p.responseType() == null || p.responseType().isEmpty()) {
      throw withRedirect(p, INVALID_REQUEST, "response_type 이 없습니다.");
    }
    if (!"code".equals(p.responseType())) {
      throw withRedirect(p, UNSUPPORTED_RESPONSE_TYPE, "response_type 은 code 만 지원합니다.");
    }
    if (p.codeChallenge() == null || p.codeChallenge().isEmpty()) {
      throw withRedirect(p, INVALID_REQUEST, "PKCE code_challenge 가 필요합니다.");
    }
    if (!"S256".equals(p.codeChallengeMethod())) {
      throw withRedirect(p, INVALID_REQUEST, "code_challenge_method 는 S256 만 지원합니다.");
    }
    if (!Pkce.isValidShape(p.codeChallenge())) {
      throw withRedirect(p, INVALID_REQUEST, "code_challenge 형식이 올바르지 않습니다.");
    }
    if (p.resource() != null && !RedirectUris.isValidResource(p.resource())) {
      throw withRedirect(p, INVALID_REQUEST, "resource 는 프래그먼트 없는 https(또는 루프백 http) 절대 주소여야 합니다.");
    }
    return client;
  }

  /** 클라이언트로 돌려보내지 않는 400. */
  private static OAuthAuthorizeException noRedirect(String error, String description) {
    return new OAuthAuthorizeException(400, error, description, null);
  }

  /** 클라이언트로 돌려보낼 주소를 함께 주는 400. */
  private OAuthAuthorizeException withRedirect(
      AuthorizeParams p, String error, String description) {
    return new OAuthAuthorizeException(400, error, description, redirectWithError(p, error));
  }

  /** redirect_uri + error·state(있을 때)·iss(RFC 9207 — 오류 응답에도 붙인다). */
  private String redirectWithError(AuthorizeParams p, String error) {
    Map<String, String> params = new LinkedHashMap<>();
    params.put("error", error);
    if (p.state() != null) params.put("state", p.state());
    params.put("iss", issuer.issuer());
    return appendQuery(p.redirectUri(), params);
  }

  /**
   * redirect_uri 에 쿼리 파라미터를 붙인다 — 기존 쿼리가 있으면 {@code &} 로 잇는다. 등록된 redirect_uri 부분은 글자 그대로 두고(이미
   * 인코딩된 값을 다시 인코딩하면 클라이언트가 받는 주소가 달라진다) 붙이는 값만 form 인코딩한다. 그래서 인코딩 전 빌드({@code build()})에 미리 인코딩한
   * 값을 넣고 {@code toUriString()} 으로 이어 붙인다.
   */
  static String appendQuery(String redirectUri, Map<String, String> params) {
    UriComponentsBuilder b = UriComponentsBuilder.fromUriString(redirectUri);
    params.forEach((k, v) -> b.queryParam(k, URLEncoder.encode(v, StandardCharsets.UTF_8)));
    return b.build().toUriString();
  }
}
