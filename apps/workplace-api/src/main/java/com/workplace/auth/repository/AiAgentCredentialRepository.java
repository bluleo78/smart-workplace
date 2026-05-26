package com.workplace.auth.repository;

import static com.workplace.jooq.Tables.AI_AGENT_CREDENTIAL;

import com.workplace.auth.dto.AiAgentCredentialRow;
import java.time.OffsetDateTime;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.springframework.stereotype.Repository;

/**
 * Phase 5c-2 후속 (#33): ai_agent_credential 의 jOOQ 리포지토리. 평문 토큰은 절대 다루지 않으며 (등록 시 service 가
 * EncryptionService 로 암호화한 후 호출) DB 에는 'iv:ciphertext' 만 저장된다. partial unique index 가 한 AGENT 당
 * active 1개를 DB 레벨에서 보장한다.
 */
@Repository
@RequiredArgsConstructor
public class AiAgentCredentialRepository {

  private final DSLContext dsl;

  /** Record → 도메인 DTO. OffsetDateTime → Instant 변환. */
  private AiAgentCredentialRow mapRow(Record r) {
    OffsetDateTime created = r.get(AI_AGENT_CREDENTIAL.CREATED_AT);
    OffsetDateTime lastUsed = r.get(AI_AGENT_CREDENTIAL.LAST_USED_AT);
    OffsetDateTime revoked = r.get(AI_AGENT_CREDENTIAL.REVOKED_AT);
    return new AiAgentCredentialRow(
        r.get(AI_AGENT_CREDENTIAL.ID),
        r.get(AI_AGENT_CREDENTIAL.USER_ID),
        r.get(AI_AGENT_CREDENTIAL.ENCRYPTED_TOKEN),
        r.get(AI_AGENT_CREDENTIAL.LABEL),
        r.get(AI_AGENT_CREDENTIAL.CREATED_BY),
        created != null ? created.toInstant() : null,
        lastUsed != null ? lastUsed.toInstant() : null,
        revoked != null ? revoked.toInstant() : null);
  }

  /** 신규 행 삽입. revoked_at NULL, created_at DB default. 반환은 신규 id. */
  public Long insert(Long userId, String encryptedToken, String label, Long createdBy) {
    return dsl.insertInto(AI_AGENT_CREDENTIAL)
        .set(AI_AGENT_CREDENTIAL.USER_ID, userId)
        .set(AI_AGENT_CREDENTIAL.ENCRYPTED_TOKEN, encryptedToken)
        .set(AI_AGENT_CREDENTIAL.LABEL, label)
        .set(AI_AGENT_CREDENTIAL.CREATED_BY, createdBy)
        .returning(AI_AGENT_CREDENTIAL.ID)
        .fetchOne()
        .getId();
  }

  /** 특정 AGENT 의 active 행 (없으면 empty). */
  public Optional<AiAgentCredentialRow> findActive(Long userId) {
    return dsl.selectFrom(AI_AGENT_CREDENTIAL)
        .where(AI_AGENT_CREDENTIAL.USER_ID.eq(userId).and(AI_AGENT_CREDENTIAL.REVOKED_AT.isNull()))
        .fetchOptional(this::mapRow);
  }

  /** active 행 revoke (revoked_at = now()). 영향 row 수 반환 (0 또는 1). */
  public int revokeActive(Long userId) {
    return dsl.update(AI_AGENT_CREDENTIAL)
        .set(AI_AGENT_CREDENTIAL.REVOKED_AT, OffsetDateTime.now())
        .where(AI_AGENT_CREDENTIAL.USER_ID.eq(userId).and(AI_AGENT_CREDENTIAL.REVOKED_AT.isNull()))
        .execute();
  }

  /** redeem 후 last_used_at 갱신. throttle/async 없음. */
  public void touchLastUsed(Long id) {
    dsl.update(AI_AGENT_CREDENTIAL)
        .set(AI_AGENT_CREDENTIAL.LAST_USED_AT, OffsetDateTime.now())
        .where(AI_AGENT_CREDENTIAL.ID.eq(id))
        .execute();
  }
}
