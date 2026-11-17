package com.workplace.auth.oauth.service;

import com.workplace.audit.service.AuditLogService;
import com.workplace.auth.oauth.repository.OAuthConnectionRepository.ConnectionRow;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * OAuth 연결 감사(WP-1685) — 연결 생성·끊기·토큰 재사용 감지를 그 연결의 워크스페이스·사용자로 남긴다. 세 서비스가 같은 12개 인자 {@code
 * logInTenant} 호출(리소스 {@code oauth_connection}·IP/User-Agent 없음)을 되풀이하던 것을 한 곳에 모은다.
 *
 * <p>IP·User-Agent 는 남기지 않는다 — 토큰 엔드포인트·비밀번호 변경처럼 요청의 주인이 연결 주인이 아닌 경로가 있어 세 감사가 같은 모양이 되게 맞춘다(리뷰
 * D6.2). 호출 측 트랜잭션 안에서 불러야 한다({@code logInTenant} 가 MANDATORY).
 */
@Component
@RequiredArgsConstructor
public class OAuthAudit {

  /** 감사 리소스 종류. */
  static final String RESOURCE = "oauth_connection";

  private final UserRepository users;
  private final AuditLogService auditLogService;

  /** 감사에 남길 사용자 이름 — 사용자가 없으면 null. 한 호출에서 여러 연결을 감사하면 한 번만 읽어 넘긴다. */
  public String usernameOf(long userId) {
    return users.findById(userId).map(UserResponse::username).orElse(null);
  }

  /**
   * 연결 하나에 대한 감사 한 줄 — 연결의 워크스페이스·사용자·id 로 남긴다.
   *
   * @param username 연결 주인의 이름({@link #usernameOf} 또는 이미 가진 값)
   * @param result {@code SUCCESS}·{@code FAILURE}
   */
  public void connectionEvent(
      ConnectionRow conn,
      String username,
      String action,
      String description,
      String result,
      Object metadata) {
    auditLogService.logInTenant(
        conn.tenantId(),
        conn.userId(),
        username,
        action,
        RESOURCE,
        String.valueOf(conn.id()),
        description,
        null,
        null,
        result,
        null,
        metadata);
  }
}
