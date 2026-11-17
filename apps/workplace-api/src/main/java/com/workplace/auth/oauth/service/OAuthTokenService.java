package com.workplace.auth.oauth.service;

import com.workplace.auth.oauth.dto.TokenResponse;
import com.workplace.auth.oauth.exception.OAuthErrors;
import com.workplace.auth.oauth.exception.OAuthTokenException;
import com.workplace.auth.oauth.repository.OAuthCodeRepository;
import com.workplace.auth.oauth.repository.OAuthCodeRepository.CodeRow;
import com.workplace.auth.oauth.repository.OAuthConnectionRepository;
import com.workplace.auth.oauth.repository.OAuthConnectionRepository.ConnectionRow;
import com.workplace.auth.oauth.repository.OAuthConnectionRepository.ConnectionWithClient;
import com.workplace.auth.oauth.repository.OAuthTokenRepository;
import com.workplace.auth.oauth.repository.OAuthTokenRepository.NewToken;
import com.workplace.auth.oauth.repository.OAuthTokenRepository.RefreshRow;
import com.workplace.auth.service.AuthService;
import com.workplace.global.util.CapabilityTokens;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * OAuth 토큰 발급(WP-1685) — 토큰 엔드포인트의 두 grant.
 *
 * <ul>
 *   <li>{@code authorization_code}: 동의 화면이 만든 1회용 code 를 PKCE(S256)로 확인하고 access({@code swo_},
 *       1시간)·refresh({@code swr_}, 30일)를 준다.
 *   <li>{@code refresh_token}: 쓴 refresh 를 표시하고(엄격 회전 — 유예 없음) 새 access·refresh 를 준다.
 * </ul>
 *
 * <p>재사용 탐지가 핵심이다. 이미 쓴 code·refresh 가 다시 오면(동시 요청의 늦은 쪽 포함) 탈취로 보고 그 연결의 살아 있는 토큰을 모두 폐기하고 감사
 * {@code OAUTH_REFRESH_REUSE_DETECTED}(metadata {@code grant})를 남긴 뒤 {@code invalid_grant} 를 준다. 이
 * 폐기·감사는 오류 응답(예외)에 롤백되지 않도록 발급 트랜잭션과 따로, {@code REQUIRES_NEW} 트랜잭션으로 먼저 커밋한다.
 *
 * <p>사용 표시(원자적 UPDATE)·검증·발급은 한 트랜잭션이다 — 검증이 실패하면 사용 표시도 롤백돼 code 가 타지 않는다(잘못된 요청 하나로 정상 클라이언트의 교환이
 * 재사용으로 몰려 토큰이 폐기되지 않게). 발급 트랜잭션과 재사용 처리 트랜잭션은 모두 첫머리에서 연결 행을 {@code SELECT … FOR UPDATE} 로 잠가 연결
 * 단위로 줄을 선다 — 동시에 온 같은 code·refresh 는 앞선 쪽이 커밋된 뒤 늦은 쪽이 「이미 씀」을 보고 재사용으로 처리되고, 재사용 처리의 폐기는 동시에 발급되던
 * 토큰까지 빠짐없이 잡는다. 재사용 처리는 늘 발급 트랜잭션이 끝나 잠금이 풀린 뒤에 연다.
 *
 * <p>client_id 는 문자열로만 대조한다 — 공개 엔드포인트에서 CIMD 문서를 다시 가져오지 않는다(네트워크 호출·지연 유발 방지).
 */
@Slf4j
@Service
public class OAuthTokenService {

  /** access 토큰 수명. */
  static final Duration ACCESS_TTL = Duration.ofHours(1);

  /** refresh 토큰 수명 — 회전할 때마다 새로 30일. */
  static final Duration REFRESH_TTL = Duration.ofDays(30);

  /** access 토큰 접두사(인증 필터가 이 접두사로 고른다). */
  public static final String ACCESS_PREFIX = "swo_";

  /** refresh 토큰 접두사(인증으로는 받지 않는다). */
  public static final String REFRESH_PREFIX = "swr_";

  /** 표시·로그용으로 남기는 토큰 앞부분 길이. */
  static final int TOKEN_PREFIX_LENGTH = 12;

  /** 재사용 탐지 감사 액션(code 재사용도 같은 이름, metadata grant 로 구분). */
  static final String AUDIT_REUSE_DETECTED = "OAUTH_REFRESH_REUSE_DETECTED";

  /** grant 이름 — 감사 metadata 에 그대로 남긴다. */
  public static final String GRANT_AUTHORIZATION_CODE = "authorization_code";

  public static final String GRANT_REFRESH_TOKEN = "refresh_token";

  private final OAuthCodeRepository codes;
  private final OAuthTokenRepository tokens;
  private final OAuthConnectionRepository connections;
  private final AuthService authService;
  private final OAuthAudit audit;

  /** 사용 표시·검증·발급 트랜잭션(요청 트랜잭션이 있으면 합류). */
  private final TransactionTemplate tx;

  /** 재사용 처리(폐기·감사) 트랜잭션 — 늘 새로 열어 오류 응답 전에 커밋한다. */
  private final TransactionTemplate requiresNew;

  public OAuthTokenService(
      OAuthCodeRepository codes,
      OAuthTokenRepository tokens,
      OAuthConnectionRepository connections,
      AuthService authService,
      OAuthAudit audit,
      PlatformTransactionManager txManager) {
    this.codes = codes;
    this.tokens = tokens;
    this.connections = connections;
    this.authService = authService;
    this.audit = audit;
    // 기본 전파(REQUIRED) — 요청 트랜잭션이 있으면 합류한다(토큰 엔드포인트는 트랜잭션 없이 부른다).
    this.tx = new TransactionTemplate(txManager);
    this.requiresNew = new TransactionTemplate(txManager);
    this.requiresNew.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
  }

  /**
   * code 교환. 순서: 해시로 찾기 → 이미 쓴 code 면 재사용 처리 → (트랜잭션) 연결 잠금 → 사용 표시(동시 패배도 재사용 처리) → 만료 →
   * client_id·redirect_uri·PKCE → 연결·멤버십·테넌트 → 발급. resource 는 code 에 저장된 값(인가 요청 때 받은 것)을 쓴다.
   *
   * @param redirectUri 인가 요청 때와 글자 그대로 같아야 한다(루프백 포트 규칙은 인가 단계에서 이미 적용했다)
   * @throws OAuthTokenException {@code invalid_grant}
   */
  public TokenResponse exchangeCode(
      String code, String redirectUri, String clientId, String codeVerifier) {
    requireNoOuterTransaction();
    CodeRow row =
        codes
            .findByHash(CapabilityTokens.sha256Hex(code))
            .orElseThrow(() -> invalidGrant("알 수 없는 인가 code 입니다."));
    if (row.usedAt() != null) {
      throw reuseDetected(row.connectionId(), GRANT_AUTHORIZATION_CODE);
    }
    try {
      return tx.execute(s -> exchangeCodeInTx(row, redirectUri, clientId, codeVerifier));
    } catch (ReuseSignal e) {
      // 발급 트랜잭션이 롤백돼 연결 잠금이 풀린 뒤에 재사용 처리(새 트랜잭션, 같은 잠금)를 한다 — 안에서 하면 제 잠금을 기다려 멈춘다.
      throw reuseDetected(row.connectionId(), GRANT_AUTHORIZATION_CODE);
    }
  }

  /** 연결 잠금·code 사용 표시·검증·발급(한 트랜잭션 — 검증 실패면 사용 표시도 롤백). */
  private TokenResponse exchangeCodeInTx(
      CodeRow row, String redirectUri, String clientId, String codeVerifier) {
    // 연결 단위로 줄을 세운다(D5.1) — 재사용 처리·연결 끊기와 겹쳐도 폐기에서 빠지는 토큰이 생기지 않게.
    ConnectionWithClient c = lockConnection(row.connectionId());
    if (!codes.markUsed(row.id())) {
      // 앞선 요청이 먼저 썼다 — 트랜잭션을 롤백하고 밖에서 재사용 처리한다.
      throw new ReuseSignal();
    }
    if (!row.expiresAt().isAfter(OffsetDateTime.now())) {
      throw invalidGrant("만료된 인가 code 입니다.");
    }
    if (!c.clientId().equals(clientId)) {
      throw invalidGrant("client_id 가 인가 요청과 다릅니다.");
    }
    if (!row.redirectUri().equals(redirectUri)) {
      throw invalidGrant("redirect_uri 가 인가 요청과 다릅니다.");
    }
    if (!Pkce.verifyS256(codeVerifier, row.codeChallenge())) {
      throw invalidGrant("code_verifier 가 code_challenge 와 맞지 않습니다.");
    }
    requireUsableConnection(c);
    return issue(c.row(), row.resource());
  }

  /**
   * refresh 회전. 순서: 해시로 찾기(없음 → invalid_grant) → (트랜잭션) 연결 잠금 → 잠근 뒤 다시 읽은 토큰으로 폐기·만료 → 연결의
   * client_id 와 다르면 invalid_grant(다른 클라이언트의 시도로는 회전·폐기를 일으키지 않는다) → 이미 썼거나 사용 표시가 실패하면 재사용 처리 →
   * 연결·멤버십·테넌트 → 새 access·refresh(resource 는 이전 값 유지).
   *
   * <p>폐기·사용 판정은 연결 잠금을 잡은 뒤 다시 읽은 행으로 한다 — 잠금을 기다리는 사이 앞선 회전이 쓰거나 재사용 처리가 폐기했을 수 있다.
   *
   * @throws OAuthTokenException {@code invalid_grant}
   */
  public TokenResponse refresh(String refreshToken, String clientId) {
    requireNoOuterTransaction();
    String hash = CapabilityTokens.sha256Hex(refreshToken);
    RefreshRow row =
        tokens.findRefresh(hash).orElseThrow(() -> invalidGrant("알 수 없는 refresh 토큰입니다."));
    try {
      return tx.execute(s -> refreshInTx(hash, row.connectionId(), clientId));
    } catch (ReuseSignal e) {
      // 발급 트랜잭션이 롤백돼 연결 잠금이 풀린 뒤에 재사용 처리를 한다(exchangeCode 와 같은 이유).
      throw reuseDetected(row.connectionId(), GRANT_REFRESH_TOKEN);
    }
  }

  /** 연결 잠금·refresh 재확인·사용 표시·연결 확인·발급(한 트랜잭션). */
  private TokenResponse refreshInTx(String hash, long connectionId, String clientId) {
    ConnectionWithClient c = lockConnection(connectionId);
    RefreshRow row =
        tokens.findRefresh(hash).orElseThrow(() -> invalidGrant("알 수 없는 refresh 토큰입니다."));
    if (row.revokedAt() != null) {
      throw invalidGrant("폐기된 refresh 토큰입니다.");
    }
    if (!row.expiresAt().isAfter(OffsetDateTime.now())) {
      throw invalidGrant("만료된 refresh 토큰입니다.");
    }
    if (!c.clientId().equals(clientId)) {
      throw invalidGrant("client_id 가 토큰을 받은 클라이언트와 다릅니다.");
    }
    if (row.usedAt() != null) {
      // 이미 회전에 쓴 refresh — 엄격 회전이라 재사용(탈취 의심)으로 본다.
      throw new ReuseSignal();
    }
    if (!tokens.markRefreshUsed(row.id())) {
      // 잠금 아래라 드물지만, 실패했다면 이유를 다시 읽어 가른다(D5.2): 폐기돼서면 평범한 invalid_grant(재사용 처리·감사 없음),
      // 누가 먼저 썼으면 재사용.
      boolean revoked = tokens.findRefresh(hash).map(r -> r.revokedAt() != null).orElse(true);
      if (revoked) {
        throw invalidGrant("폐기된 refresh 토큰입니다.");
      }
      throw new ReuseSignal();
    }
    requireUsableConnection(c);
    return issue(c.row(), row.resource());
  }

  /** 연결을 잠가 읽는다(클라이언트 id·이름 포함). 없으면(사용자·테넌트 삭제로 CASCADE) invalid_grant. */
  private ConnectionWithClient lockConnection(long connectionId) {
    return connections
        .lockWithClientId(connectionId)
        .orElseThrow(() -> invalidGrant("앱 연결을 찾을 수 없습니다. 다시 연결해 주세요."));
  }

  /**
   * 토큰을 줄 수 있는 연결인지 — 잠가 읽은 연결이 살아 있고, 사용자가 그 워크스페이스의 ACTIVE 멤버이며 테넌트도 ACTIVE 여야 한다(발급 시점에 다시 본다 —
   * 해지된 사람이 refresh 로 계속 새 access 를 받지 못하게). 판정은 로그인 세션과 같은 {@link AuthService#isTenantUsable} 한 곳에
   * 두고, PAT 와 같은 기준이라 SSO 규칙은 보지 않는다(인증 수단 null — SSO 규칙은 연결을 승인할 때 지킨다).
   */
  private void requireUsableConnection(ConnectionWithClient c) {
    ConnectionRow conn = c.row();
    if (conn.revokedAt() != null) {
      throw invalidGrant("앱 연결이 끊겼습니다. 다시 연결해 주세요.");
    }
    if (!authService.isTenantUsable(conn.userId(), conn.tenantId(), null)) {
      throw invalidGrant("이 워크스페이스를 더 이상 쓸 수 없습니다.");
    }
  }

  /**
   * 발급·재사용 처리는 바깥 트랜잭션 없이 불러야 한다. 바깥 트랜잭션에 합류하면 발급이 잡은 연결 잠금이 그 트랜잭션 끝까지 남아, 이어서 새
   * 트랜잭션(REQUIRES_NEW)으로 여는 재사용 처리가 제 잠금을 기다리며 멈춘다. 토큰 엔드포인트(컨트롤러)는 트랜잭션 없이 부르므로 실제로는 걸리지 않는다 — 잘못된
   * 호출을 바로 드러내려는 안전장치다.
   */
  private static void requireNoOuterTransaction() {
    if (TransactionSynchronizationManager.isActualTransactionActive()) {
      throw new IllegalStateException("OAuth 토큰 발급은 트랜잭션 밖에서 불러야 합니다(연결 잠금 교착 방지).");
    }
  }

  /**
   * access·refresh 한 벌을 만들어 해시로 저장하고(한 INSERT) 평문을 돌려준다. 연결의 마지막 사용 시각은 잠가 읽은 행의 값이 비었거나 1분보다 오래됐을
   * 때만 갱신한다 — 인증 필터와 같은 간격이라 그 안이면 UPDATE 를 보내도 바뀌는 것이 없다.
   */
  private TokenResponse issue(ConnectionRow conn, String resource) {
    OffsetDateTime now = OffsetDateTime.now();
    String access = CapabilityTokens.generate(ACCESS_PREFIX);
    String refresh = CapabilityTokens.generate(REFRESH_PREFIX);
    tokens.insertAll(
        conn.id(),
        resource,
        List.of(
            newToken(OAuthTokenRepository.KIND_ACCESS, access, now.plus(ACCESS_TTL)),
            newToken(OAuthTokenRepository.KIND_REFRESH, refresh, now.plus(REFRESH_TTL))));
    if (OAuthConnectionRepository.isLastUsedTouchDue(conn.lastUsedAt(), now)) {
      connections.touchLastUsed(conn.id());
    }
    return new TokenResponse(access, "Bearer", ACCESS_TTL.toSeconds(), refresh);
  }

  /** 평문 토큰 → 저장할 행(해시·표시용 앞부분). */
  private static NewToken newToken(String kind, String plaintext, OffsetDateTime expiresAt) {
    return new NewToken(
        kind,
        CapabilityTokens.sha256Hex(plaintext),
        plaintext.substring(0, TOKEN_PREFIX_LENGTH),
        expiresAt);
  }

  /**
   * 재사용 처리 — 그 연결의 살아 있는 토큰을 모두 폐기하고 연결의 테넌트에 감사를 남긴다. 새 트랜잭션으로 바로 커밋해, 뒤이어 던지는 {@code
   * invalid_grant} 가 이 폐기를 되돌리지 못하게 한다. 연결 자체는 남긴다(사용자가 다시 허용하면 이어 쓴다).
   *
   * @return 호출 측이 던질 {@code invalid_grant}
   */
  private OAuthTokenException reuseDetected(long connectionId, String grant) {
    requiresNew.executeWithoutResult(
        s ->
            // 발급과 같은 연결 잠금을 먼저 잡는다(D5.1) — 동시에 발급 중인 트랜잭션이 있으면 그 커밋을 기다린 뒤 폐기해, 그 토큰도 빠짐없이 폐기한다.
            // 이 트랜잭션은 늘 발급 트랜잭션이 끝난(잠금이 풀린) 뒤에만 연다. 연결이 없으면(CASCADE 로 지워짐) 토큰도 함께 지워져 할 일이 없다.
            connections
                .lockWithClientId(connectionId)
                .ifPresent(c -> auditReuse(c, grant, tokens.revokeAllForConnection(connectionId))));
    log.warn("OAuth 토큰 재사용 감지 — connectionId={} grant={}, 연결 토큰을 모두 폐기했다", connectionId, grant);
    return invalidGrant(
        GRANT_AUTHORIZATION_CODE.equals(grant)
            ? "이미 사용한 인가 code 입니다. 이 연결의 토큰을 모두 폐기했습니다."
            : "이미 사용한 refresh 토큰입니다. 이 연결의 토큰을 모두 폐기했습니다.");
  }

  /** 재사용 감사 — 연결의 테넌트·사용자로 남긴다(요청에는 로그인 사용자가 없다). */
  private void auditReuse(ConnectionWithClient c, String grant, int revoked) {
    audit.connectionEvent(
        c.row(),
        audit.usernameOf(c.row().userId()),
        AUDIT_REUSE_DETECTED,
        "OAuth 토큰 재사용 감지 — 연결 토큰 폐기",
        "FAILURE",
        Map.of("grant", grant, "clientId", c.clientId(), "revokedTokens", revoked));
  }

  private static OAuthTokenException invalidGrant(String description) {
    return new OAuthTokenException(OAuthErrors.INVALID_GRANT, description);
  }

  /**
   * 사용 표시(원자적 UPDATE)에 진 신호 — 발급 트랜잭션을 롤백시키고 밖에서 재사용 처리로 바꾼다. 재사용 처리를 트랜잭션 안에서 하면 커밋 순서가 꼬이므로(바깥이
   * 롤백돼도 남아야 한다) 신호만 던진다.
   */
  private static final class ReuseSignal extends RuntimeException {
    ReuseSignal() {
      super(null, null, false, false);
    }
  }
}
