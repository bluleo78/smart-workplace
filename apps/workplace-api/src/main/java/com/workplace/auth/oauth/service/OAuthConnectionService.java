package com.workplace.auth.oauth.service;

import com.workplace.auth.oauth.dto.OAuthConnectionResponse;
import com.workplace.auth.oauth.exception.OAuthConnectionNotFoundException;
import com.workplace.auth.oauth.repository.OAuthConnectionRepository;
import com.workplace.auth.oauth.repository.OAuthConnectionRepository.ConnectionWithClient;
import com.workplace.auth.oauth.repository.OAuthConnectionRepository.ListedConnection;
import com.workplace.auth.oauth.repository.OAuthTokenRepository;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 「내 OAuth 연결」 목록·끊기(WP-1685) — PAT 목록({@code UserApiTokenService})과 같은 자리의 본인 리소스 관리.
 *
 * <p>연결은 사람 한 명의 것이라 모든 워크스페이스의 연결을 함께 보여 준다. 끊기는 연결 폐기·그 연결 토큰 모두 폐기·감사를 한 트랜잭션에 묶어, 감사 없이 끊기거나
 * 연결만 끊기고 토큰이 남는 중간 상태가 생기지 않게 한다. 감사는 연결이 속한 워크스페이스에 남긴다(지금 요청의 워크스페이스와 다를 수 있다).
 */
@Service
@RequiredArgsConstructor
public class OAuthConnectionService {

  /** 연결 끊기 감사 액션. */
  static final String AUDIT_CONNECTION_REVOKED = "OAUTH_CONNECTION_REVOKED";

  /** 비밀번호 변경으로 끊었을 때의 감사 metadata reason. */
  static final String REASON_PASSWORD_CHANGE = "password_change";

  private final OAuthConnectionRepository connections;
  private final OAuthTokenRepository tokens;
  private final OAuthAudit audit;

  /** 내 살아 있는 연결 목록(최근 연결 순, 모든 워크스페이스). */
  @Transactional(readOnly = true)
  public List<OAuthConnectionResponse> list(long userId) {
    return connections.listActiveByUser(userId).stream()
        .map(OAuthConnectionService::toResponse)
        .toList();
  }

  /**
   * 내 연결을 끊는다 — 연결 revoked_at, 그 연결의 살아 있는 토큰 모두 폐기, 연결 워크스페이스에 감사. 남의 것·없는 것·이미 끊긴 것은 모두 404.
   *
   * @throws OAuthConnectionNotFoundException 끊을 수 있는 내 연결이 아님
   */
  @Transactional
  public void revoke(long userId, long connectionId) {
    ConnectionWithClient c =
        connections
            .findWithClientId(connectionId)
            .filter(found -> found.row().userId() == userId && found.row().revokedAt() == null)
            .orElseThrow(OAuthConnectionNotFoundException::new);
    // 원자적 UPDATE(미폐기·본인 조건) — 동시 끊기 중 늦은 쪽은 여기서 404 가 되어 감사가 두 번 남지 않는다.
    if (!connections.revoke(connectionId, userId)) {
      throw new OAuthConnectionNotFoundException();
    }
    int revokedTokens = tokens.revokeAllForConnection(connectionId);
    auditRevoked(c, audit.usernameOf(userId), revokedTokens, null);
  }

  /**
   * 비밀번호를 바꾼 사용자의 살아 있는 연결을 모두 끊는다(WP-1685 리뷰 F5). 연결은 30일씩 굴러가는 refresh 를 가진 세션과 같은 것이라, 비밀번호가 새어
   * 바꾼 경우 침입자가 걸어 둔 앱 연결도 함께 끊어야 한다(웹 refresh 세션을 모두 끊는 WP-566 과 같은 이유). 연결마다 토큰을 모두 폐기하고 그 연결의
   * 워크스페이스에 {@code OAUTH_CONNECTION_REVOKED}(metadata {@code reason=password_change})를 남긴다. PAT 는
   * 건드리지 않는다.
   *
   * <p>연결 행을 먼저 잠가(발급 트랜잭션과 같은 잠금) 그 사이 발급되던 토큰도 폐기에서 빠지지 않게 한다. 잠근 행은 이 트랜잭션 끝까지 다른 쪽이 폐기할 수 없으므로
   * 폐기 UPDATE 는 늘 성공한다(결과를 보지 않는다). 감사의 사용자 이름은 모든 연결이 같은 사용자라 한 번만 읽는다. 호출 측 트랜잭션에 합류한다.
   *
   * @return 끊은 연결 수
   */
  @Transactional
  public int revokeAllAfterPasswordChange(long userId) {
    List<ConnectionWithClient> live = connections.lockActiveByUser(userId);
    if (live.isEmpty()) return 0;
    String username = audit.usernameOf(userId);
    for (ConnectionWithClient c : live) {
      long connectionId = c.row().id();
      connections.revoke(connectionId, userId);
      auditRevoked(
          c, username, tokens.revokeAllForConnection(connectionId), REASON_PASSWORD_CHANGE);
    }
    return live.size();
  }

  /**
   * 끊기 감사 — 연결의 워크스페이스·사용자로 남긴다. 클라이언트 이름은 연결과 함께 읽어 둔 값을 쓴다(다시 조회하지 않는다).
   *
   * <p>IP·User-Agent 는 남기지 않는다 — 연결을 만들 때의 감사({@code OAUTH_CONNECTION_CREATED})도 남기지 않으므로 두 감사가 같은
   * 모양이 되게 맞춘 것이다(리뷰 D6.2).
   *
   * @param username 연결 주인의 이름(호출 측이 한 번 읽어 넘긴다)
   * @param reason 사용자가 직접 끊은 것이 아닐 때의 사유(metadata {@code reason}), 직접 끊었으면 null
   */
  private void auditRevoked(
      ConnectionWithClient c, String username, int revokedTokens, String reason) {
    String clientName = c.clientName();
    Map<String, Object> metadata = new LinkedHashMap<>();
    metadata.put("clientId", c.clientId());
    if (clientName != null) metadata.put("clientName", clientName);
    metadata.put("revokedTokens", revokedTokens);
    if (reason != null) metadata.put("reason", reason);
    audit.connectionEvent(
        c.row(),
        username,
        AUDIT_CONNECTION_REVOKED,
        "OAuth 앱 연결 끊기" + (clientName != null ? ": " + clientName : ""),
        "SUCCESS",
        metadata);
  }

  /** 목록 행 → 응답. unverified 는 DCR(앱이 스스로 등록) 여부, redirectHost 는 첫 redirect_uri 의 호스트. */
  private static OAuthConnectionResponse toResponse(ListedConnection l) {
    String redirectHost =
        l.redirectUris().isEmpty() ? null : RedirectUris.hostOf(l.redirectUris().get(0));
    return new OAuthConnectionResponse(
        l.id(),
        l.clientName(),
        l.unverified(),
        redirectHost,
        l.tenantId(),
        l.tenantName(),
        l.createdAt(),
        l.lastUsedAt());
  }
}
