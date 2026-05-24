package com.workplace.auth.repository;

import static com.workplace.jooq.Tables.AGENT_API_KEY;

import com.workplace.auth.dto.AgentApiKeyResponse;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.springframework.stereotype.Repository;

/**
 * Phase 5a — agent_api_key 테이블 jOOQ 리포지토리. 평문 키는 절대 저장/조회하지 않으며 SHA-256 hex 만 다룬다. revoked_at IS
 * NULL 조건으로 인증 hot path 가 좁혀진다.
 */
@Repository
@RequiredArgsConstructor
public class AgentApiKeyRepository {

  private final DSLContext dsl;

  /** Record → API 응답 DTO 변환 (created_at/last_used_at/revoked_at 은 Instant 로 변환). */
  private AgentApiKeyResponse mapToResponse(Record r) {
    OffsetDateTime created = r.get(AGENT_API_KEY.CREATED_AT);
    OffsetDateTime lastUsed = r.get(AGENT_API_KEY.LAST_USED_AT);
    OffsetDateTime revoked = r.get(AGENT_API_KEY.REVOKED_AT);
    return new AgentApiKeyResponse(
        r.get(AGENT_API_KEY.ID),
        r.get(AGENT_API_KEY.USER_ID),
        r.get(AGENT_API_KEY.KEY_PREFIX),
        r.get(AGENT_API_KEY.LABEL),
        r.get(AGENT_API_KEY.CREATED_BY),
        created != null ? created.toInstant() : null,
        lastUsed != null ? lastUsed.toInstant() : null,
        revoked != null ? revoked.toInstant() : null);
  }

  /** 키 삽입. created_at 은 DB default(now()). 반환은 신규 키 id. */
  public Long insert(Long userId, String keyPrefix, String keyHash, String label, Long createdBy) {
    return dsl.insertInto(AGENT_API_KEY)
        .set(AGENT_API_KEY.USER_ID, userId)
        .set(AGENT_API_KEY.KEY_PREFIX, keyPrefix)
        .set(AGENT_API_KEY.KEY_HASH, keyHash)
        .set(AGENT_API_KEY.LABEL, label)
        .set(AGENT_API_KEY.CREATED_BY, createdBy)
        .returning(AGENT_API_KEY.ID)
        .fetchOne()
        .getId();
  }

  /** 특정 AGENT 의 키 목록 (회수된 것 포함). 최근 생성 순. */
  public List<AgentApiKeyResponse> findByUser(Long userId) {
    return dsl.selectFrom(AGENT_API_KEY)
        .where(AGENT_API_KEY.USER_ID.eq(userId))
        .orderBy(AGENT_API_KEY.CREATED_AT.desc())
        .fetch(this::mapToResponse);
  }

  /** 인증 hot path — hash 단일 매칭 + revoked_at IS NULL. */
  public Optional<ActiveKey> findActiveByHash(String hash) {
    return dsl.select(AGENT_API_KEY.ID, AGENT_API_KEY.USER_ID)
        .from(AGENT_API_KEY)
        .where(AGENT_API_KEY.KEY_HASH.eq(hash).and(AGENT_API_KEY.REVOKED_AT.isNull()))
        .fetchOptional(r -> new ActiveKey(r.get(AGENT_API_KEY.ID), r.get(AGENT_API_KEY.USER_ID)));
  }

  /** 인증에 성공한 활성 키 정보 (필터에서 user 조회와 last_used_at 갱신에 사용). */
  public record ActiveKey(Long id, Long userId) {}

  /** 인증 성공 시 last_used_at 을 now() 로 갱신. 단순 update — async/throttle 미적용. */
  public void touchLastUsed(Long keyId) {
    dsl.update(AGENT_API_KEY)
        .set(AGENT_API_KEY.LAST_USED_AT, OffsetDateTime.now())
        .where(AGENT_API_KEY.ID.eq(keyId))
        .execute();
  }

  /** 활성 키만 회수 (이미 회수된 키는 영향 없음). 영향 받은 row 수 반환. */
  public int revoke(Long keyId) {
    return dsl.update(AGENT_API_KEY)
        .set(AGENT_API_KEY.REVOKED_AT, OffsetDateTime.now())
        .where(AGENT_API_KEY.ID.eq(keyId).and(AGENT_API_KEY.REVOKED_AT.isNull()))
        .execute();
  }

  /** 단건 조회 (관리 화면용). */
  public Optional<AgentApiKeyResponse> findById(Long id) {
    return dsl.selectFrom(AGENT_API_KEY)
        .where(AGENT_API_KEY.ID.eq(id))
        .fetchOptional(this::mapToResponse);
  }
}
