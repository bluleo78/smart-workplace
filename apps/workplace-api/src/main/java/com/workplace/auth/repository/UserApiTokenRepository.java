package com.workplace.auth.repository;

import static com.workplace.jooq.Tables.USER_API_TOKEN;

import com.workplace.auth.dto.UserApiTokenResponse;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * user_api_token 테이블 jOOQ 리포지토리. agent_api_key(AgentApiKeyRepository) 미러 — 평문 토큰은 절대 저장/조회하지 않으며
 * SHA-256 hex 만 다룬다. revoked_at IS NULL + expires_at 미만료 조건으로 인증 hot path 가 좁혀진다.
 */
@Repository
@RequiredArgsConstructor
public class UserApiTokenRepository {

  /** 발급 잠금의 advisory lock 클래스(WP-818) — 에이전트 키 발급도 같은 클래스·사용자 id 로 잡는다(사람·에이전트 id 는 겹치지 않는다). */
  public static final int ISSUE_LOCK_CLASS = 818;

  private final DSLContext dsl;

  /** Record → API 응답 DTO 변환 (created_at/last_used_at/revoked_at/expires_at 은 Instant 로 변환). */
  private UserApiTokenResponse mapToResponse(Record r) {
    OffsetDateTime expires = r.get(USER_API_TOKEN.EXPIRES_AT);
    OffsetDateTime created = r.get(USER_API_TOKEN.CREATED_AT);
    OffsetDateTime lastUsed = r.get(USER_API_TOKEN.LAST_USED_AT);
    OffsetDateTime revoked = r.get(USER_API_TOKEN.REVOKED_AT);
    return new UserApiTokenResponse(
        r.get(USER_API_TOKEN.ID),
        r.get(USER_API_TOKEN.NAME),
        r.get(USER_API_TOKEN.TOKEN_PREFIX),
        r.get(USER_API_TOKEN.TENANT_ID),
        expires != null ? expires.toInstant() : null,
        created != null ? created.toInstant() : null,
        lastUsed != null ? lastUsed.toInstant() : null,
        revoked != null ? revoked.toInstant() : null);
  }

  /** PAT 삽입. created_at 은 DB default(now()). 반환은 신규 PAT id. */
  public Long insert(
      Long userId,
      Long tenantId,
      String name,
      String tokenPrefix,
      String tokenHash,
      Instant expiresAt) {
    return dsl.insertInto(USER_API_TOKEN)
        .set(USER_API_TOKEN.USER_ID, userId)
        .set(USER_API_TOKEN.TENANT_ID, tenantId)
        .set(USER_API_TOKEN.NAME, name)
        .set(USER_API_TOKEN.TOKEN_PREFIX, tokenPrefix)
        .set(USER_API_TOKEN.TOKEN_HASH, tokenHash)
        .set(
            USER_API_TOKEN.EXPIRES_AT,
            expiresAt != null ? expiresAt.atOffset(java.time.ZoneOffset.UTC) : null)
        .returning(USER_API_TOKEN.ID)
        .fetchOne()
        .getId();
  }

  /**
   * 특정 사용자의 PAT 목록. 최근 생성 순. created_at 이 동일 timestamp 로 밀릴 수 있어(짧은 간격 연속 발급) id desc 를 tie-breaker
   * 로 둔다. 쓸 수 있는 토큰은 전부, 회수·만료된 토큰은 그 시각이 {@code since} 이후인 것만 싣는다(WP-818) — 오래된 것까지 실으면 목록이 끝없이
   * 길어진다. 행은 감사용으로 남는다.
   */
  public List<UserApiTokenResponse> findByUser(Long userId, OffsetDateTime since) {
    OffsetDateTime now = OffsetDateTime.now();
    Condition revoked = USER_API_TOKEN.REVOKED_AT.isNotNull();
    // expires_at 이 NULL(무기한)이면 비교가 NULL 이 돼 쓸 수 있는 토큰이 빠지므로 NULL 을 먼저 거른다.
    Condition expired =
        USER_API_TOKEN.EXPIRES_AT.isNotNull().and(USER_API_TOKEN.EXPIRES_AT.le(now));
    // 회수·만료가 둘 다 있으면 먼저 일어난 쪽이 쓸 수 없게 된 시각이다 — 그 시각이 since 이후면 싣는다.
    Field<OffsetDateTime> endedAt =
        DSL.least(
            DSL.coalesce(USER_API_TOKEN.REVOKED_AT, USER_API_TOKEN.EXPIRES_AT),
            DSL.coalesce(USER_API_TOKEN.EXPIRES_AT, USER_API_TOKEN.REVOKED_AT));
    return dsl.selectFrom(USER_API_TOKEN)
        .where(USER_API_TOKEN.USER_ID.eq(userId))
        .and(revoked.or(expired).not().or(endedAt.gt(since)))
        .orderBy(USER_API_TOKEN.CREATED_AT.desc(), USER_API_TOKEN.ID.desc())
        .fetch(this::mapToResponse);
  }

  /** 쓸 수 있는(회수·만료되지 않은) PAT 수 — 발급 상한 판정용(WP-818). */
  public int countActive(Long userId) {
    return dsl.fetchCount(
        USER_API_TOKEN,
        USER_API_TOKEN
            .USER_ID
            .eq(userId)
            .and(USER_API_TOKEN.REVOKED_AT.isNull())
            .and(
                USER_API_TOKEN
                    .EXPIRES_AT
                    .isNull()
                    .or(USER_API_TOKEN.EXPIRES_AT.gt(OffsetDateTime.now()))));
  }

  /** 사용자 단위 발급 잠금(트랜잭션 끝까지) — 동시 발급이 서로의 커밋 전 개수를 보고 상한을 함께 넘기지 않게 센 뒤 넣기까지를 차례로 세운다(WP-818). */
  public void lockIssue(Long userId) {
    dsl.execute("SELECT pg_advisory_xact_lock(?, ?)", ISSUE_LOCK_CLASS, userId.intValue());
  }

  /** 인증 hot path — hash 매칭 + 미회수 + 미만료. */
  public Optional<ActiveToken> findActiveByHash(String hash) {
    return dsl.select(USER_API_TOKEN.ID, USER_API_TOKEN.USER_ID, USER_API_TOKEN.TENANT_ID)
        .from(USER_API_TOKEN)
        .where(
            USER_API_TOKEN
                .TOKEN_HASH
                .eq(hash)
                .and(USER_API_TOKEN.REVOKED_AT.isNull())
                .and(
                    USER_API_TOKEN
                        .EXPIRES_AT
                        .isNull()
                        .or(USER_API_TOKEN.EXPIRES_AT.gt(OffsetDateTime.now()))))
        .fetchOptional(r -> new ActiveToken(r.value1(), r.value2(), r.value3()));
  }

  /** 인증에 성공한 활성 PAT 정보 (필터에서 user/tenant 조회와 last_used_at 갱신에 사용). */
  public record ActiveToken(Long id, Long userId, Long tenantId) {}

  /** 인증 성공 시 last_used_at 을 now() 로 갱신. 단순 update — async/throttle 미적용. */
  public void touchLastUsed(Long id) {
    dsl.update(USER_API_TOKEN)
        .set(USER_API_TOKEN.LAST_USED_AT, OffsetDateTime.now())
        .where(USER_API_TOKEN.ID.eq(id))
        .execute();
  }

  /** 활성 PAT 만 회수 (이미 회수된 PAT 는 영향 없음). 영향 받은 row 수 반환. */
  public int revoke(Long id) {
    return dsl.update(USER_API_TOKEN)
        .set(USER_API_TOKEN.REVOKED_AT, OffsetDateTime.now())
        .where(USER_API_TOKEN.ID.eq(id).and(USER_API_TOKEN.REVOKED_AT.isNull()))
        .execute();
  }

  /** 단건 조회 (관리 화면용). */
  public Optional<UserApiTokenResponse> findById(Long id) {
    return dsl.selectFrom(USER_API_TOKEN)
        .where(USER_API_TOKEN.ID.eq(id))
        .fetchOptional(this::mapToResponse);
  }

  /** 소유자 검증용 — user_id 만 조회 (UserApiTokenResponse 는 응답 DTO 라 userId 를 노출하지 않는다). */
  public Optional<Long> findUserId(Long id) {
    return dsl.select(USER_API_TOKEN.USER_ID)
        .from(USER_API_TOKEN)
        .where(USER_API_TOKEN.ID.eq(id))
        .fetchOptional(r -> r.value1());
  }
}
