package com.workplace.auth.repository;

import static com.workplace.jooq.Tables.USER_API_TOKEN;

import com.workplace.auth.dto.UserApiTokenResponse;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.springframework.stereotype.Repository;

/**
 * user_api_token 테이블 jOOQ 리포지토리. agent_api_key(AgentApiKeyRepository) 미러 — 평문 토큰은 절대 저장/조회하지 않으며
 * SHA-256 hex 만 다룬다. revoked_at IS NULL + expires_at 미만료 조건으로 인증 hot path 가 좁혀진다.
 */
@Repository
@RequiredArgsConstructor
public class UserApiTokenRepository {

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
   * 특정 사용자의 PAT 목록 (회수된 것 포함). 최근 생성 순. created_at 이 동일 timestamp 로 밀릴 수 있어(짧은 간격 연속 발급) id desc 를
   * tie-breaker 로 둔다.
   */
  public List<UserApiTokenResponse> findByUser(Long userId) {
    return dsl.selectFrom(USER_API_TOKEN)
        .where(USER_API_TOKEN.USER_ID.eq(userId))
        .orderBy(USER_API_TOKEN.CREATED_AT.desc(), USER_API_TOKEN.ID.desc())
        .fetch(this::mapToResponse);
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
