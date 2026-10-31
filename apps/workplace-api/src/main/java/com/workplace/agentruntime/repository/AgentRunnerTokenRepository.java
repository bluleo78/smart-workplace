package com.workplace.agentruntime.repository;

import static com.workplace.jooq.Tables.AGENT_RUNNER_TOKEN;

import com.workplace.agentruntime.dto.RunnerPrincipal;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/**
 * runner 토큰(agent_runner_token) 리포지토리(WP-1248). RLS 없는 전역 테이블 — runner 요청은 토큰 확인 전에는 테넌트를 몰라서 테넌트
 * 컨텍스트 없이 해시로 조회·갱신해야 한다(agent_api_key 와 같은 이유). 평문은 다루지 않고 SHA-256 hex 만 쓴다.
 */
@Repository
@RequiredArgsConstructor
public class AgentRunnerTokenRepository {

  private final DSLContext dsl;

  /** 토큰 해시 저장. tenant_id 는 전역 테이블이라 기본값이 없어 호출자가 명시한다. */
  public void insert(long locationId, long tenantId, String prefix, String hash, Long createdBy) {
    dsl.insertInto(AGENT_RUNNER_TOKEN)
        .set(AGENT_RUNNER_TOKEN.LOCATION_ID, locationId)
        .set(AGENT_RUNNER_TOKEN.TENANT_ID, tenantId)
        .set(AGENT_RUNNER_TOKEN.TOKEN_PREFIX, prefix)
        .set(AGENT_RUNNER_TOKEN.TOKEN_HASH, hash)
        .set(AGENT_RUNNER_TOKEN.CREATED_BY, createdBy)
        .execute();
  }

  /** 그 위치의 쓸 수 있는 토큰을 회수한다(재발급 직전). 위치당 활성 토큰은 1개라 영향 행은 0 또는 1. */
  public int revokeActive(long locationId) {
    return dsl.update(AGENT_RUNNER_TOKEN)
        .set(AGENT_RUNNER_TOKEN.REVOKED_AT, OffsetDateTime.now())
        .where(
            AGENT_RUNNER_TOKEN
                .LOCATION_ID
                .eq(locationId)
                .and(AGENT_RUNNER_TOKEN.REVOKED_AT.isNull()))
        .execute();
  }

  /** 인증 hot path — 해시 단일 매칭 + 회수 안 됨. 결과의 id 는 마지막 사용 시각 갱신에 쓴다. */
  public Optional<ActiveToken> findActiveByHash(String hash) {
    return dsl.select(
            AGENT_RUNNER_TOKEN.ID, AGENT_RUNNER_TOKEN.TENANT_ID, AGENT_RUNNER_TOKEN.LOCATION_ID)
        .from(AGENT_RUNNER_TOKEN)
        .where(AGENT_RUNNER_TOKEN.TOKEN_HASH.eq(hash).and(AGENT_RUNNER_TOKEN.REVOKED_AT.isNull()))
        .fetchOptional(
            r ->
                new ActiveToken(
                    r.get(AGENT_RUNNER_TOKEN.ID),
                    new RunnerPrincipal(
                        r.get(AGENT_RUNNER_TOKEN.TENANT_ID),
                        r.get(AGENT_RUNNER_TOKEN.LOCATION_ID))));
  }

  /** 인증에 성공한 활성 토큰 — id(갱신용)와 묶인 테넌트·위치. */
  public record ActiveToken(long id, RunnerPrincipal principal) {}

  /** 마지막 사용 시각을 다시 쓰는 최소 간격 — runner 가 자주 불러도 요청마다 쓰기가 일어나지 않게(연결 판단 2분보다 충분히 짧게). */
  static final Duration TOUCH_INTERVAL = Duration.ofSeconds(30);

  /**
   * 마지막 사용 시각을 지금으로 — 연결 상태(CONNECTED) 판단의 근거. 비어 있거나 {@link #TOUCH_INTERVAL} 보다 오래됐을 때만 고친다(조건은
   * SQL WHERE 에 두어 읽고 쓰는 사이 경합 없이 거른다).
   */
  public void touchLastUsed(long tokenId) {
    OffsetDateTime now = OffsetDateTime.now();
    dsl.update(AGENT_RUNNER_TOKEN)
        .set(AGENT_RUNNER_TOKEN.LAST_USED_AT, now)
        .where(AGENT_RUNNER_TOKEN.ID.eq(tokenId))
        .and(
            AGENT_RUNNER_TOKEN
                .LAST_USED_AT
                .isNull()
                .or(AGENT_RUNNER_TOKEN.LAST_USED_AT.lt(now.minus(TOUCH_INTERVAL))))
        .execute();
  }
}
