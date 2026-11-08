package com.workplace.auth.repository;

import static com.workplace.jooq.Tables.AI_AGENT_CREDENTIAL;

import com.workplace.auth.dto.ActiveCredentialRef;
import com.workplace.auth.dto.AiAgentCredentialRow;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.HashMap;
import java.util.Map;
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
        r.get(AI_AGENT_CREDENTIAL.PROVIDER),
        r.get(AI_AGENT_CREDENTIAL.ENCRYPTED_TOKEN),
        r.get(AI_AGENT_CREDENTIAL.LABEL),
        r.get(AI_AGENT_CREDENTIAL.CREATED_BY),
        created != null ? created.toInstant() : null,
        lastUsed != null ? lastUsed.toInstant() : null,
        revoked != null ? revoked.toInstant() : null);
  }

  /** 신규 행 삽입. revoked_at NULL, created_at DB default. 반환은 신규 id. */
  public Long insert(
      Long userId, String provider, String encryptedToken, String label, Long createdBy) {
    return dsl.insertInto(AI_AGENT_CREDENTIAL)
        .set(AI_AGENT_CREDENTIAL.USER_ID, userId)
        .set(AI_AGENT_CREDENTIAL.PROVIDER, provider)
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

  /**
   * 여러 AGENT 의 active 행 id·provider 를 한 쿼리로(WP-1253 — runner desired 의 claude 버전, WP-1296·1297 —
   * login 버전·서버 실행 가능 판단) — AGENT id → 참조, 없는 AGENT 는 빠진다. provider 는 저장값 그대로(V119 뒤 NOT NULL).
   */
  public Map<Long, ActiveCredentialRef> findActiveRefsByUsers(Collection<Long> userIds) {
    if (userIds.isEmpty()) return Map.of();
    Map<Long, ActiveCredentialRef> out = new HashMap<>();
    dsl.select(AI_AGENT_CREDENTIAL.USER_ID, AI_AGENT_CREDENTIAL.ID, AI_AGENT_CREDENTIAL.PROVIDER)
        .from(AI_AGENT_CREDENTIAL)
        .where(AI_AGENT_CREDENTIAL.USER_ID.in(userIds))
        .and(AI_AGENT_CREDENTIAL.REVOKED_AT.isNull())
        .forEach(r -> out.put(r.value1(), new ActiveCredentialRef(r.value2(), r.value3())));
    return out;
  }

  /**
   * 여러 AGENT 의 active 행 중 provider 가 같은 것만 한 쿼리로(WP-1410 — runner desired 가 OpenCode 연결의 login 버전을
   * AI 마다 따로 조회하지 않게). AGENT id → 행(암호문 그대로 — 평문은 다루지 않는다). 없는 AGENT 는 빠진다.
   */
  public Map<Long, AiAgentCredentialRow> findActiveByUsersAndProvider(
      Collection<Long> userIds, String provider) {
    if (userIds.isEmpty()) return Map.of();
    Map<Long, AiAgentCredentialRow> out = new HashMap<>();
    dsl.selectFrom(AI_AGENT_CREDENTIAL)
        .where(AI_AGENT_CREDENTIAL.USER_ID.in(userIds))
        .and(AI_AGENT_CREDENTIAL.REVOKED_AT.isNull())
        .and(AI_AGENT_CREDENTIAL.PROVIDER.eq(provider))
        .forEach(r -> out.put(r.get(AI_AGENT_CREDENTIAL.USER_ID), mapRow(r)));
    return out;
  }

  /**
   * 가장 최근에 등록된 행(회수된 행 포함, 없으면 empty) — WP-1322: 등록 시 지금 연결(revokedAt 이 null 이면 active)과 「연결을 끊은 뒤
   * 다른 provider 로 다시 연결」을 한 번의 조회로 함께 판단한다. active 행은 언제나 가장 최근 행이다(등록이 기존 active 를 회수한 뒤 새 행을
   * 넣는다).
   */
  public Optional<AiAgentCredentialRow> findLatest(Long userId) {
    return dsl.selectFrom(AI_AGENT_CREDENTIAL)
        .where(AI_AGENT_CREDENTIAL.USER_ID.eq(userId))
        .orderBy(AI_AGENT_CREDENTIAL.ID.desc())
        .limit(1)
        .fetchOptional(this::mapRow);
  }

  /** active 행 revoke (revoked_at = now()). 영향 row 수 반환 (0 또는 1). */
  public int revokeActive(Long userId) {
    return dsl.update(AI_AGENT_CREDENTIAL)
        .set(AI_AGENT_CREDENTIAL.REVOKED_AT, OffsetDateTime.now())
        .where(AI_AGENT_CREDENTIAL.USER_ID.eq(userId).and(AI_AGENT_CREDENTIAL.REVOKED_AT.isNull()))
        .execute();
  }

  /** 자격증명 암호문만 바꾼다(WP-250 이미지 입력 지정) — 행 id·label·생성/사용 시각은 그대로 둔다. */
  public void updateEncryptedToken(Long id, String encryptedToken) {
    dsl.update(AI_AGENT_CREDENTIAL)
        .set(AI_AGENT_CREDENTIAL.ENCRYPTED_TOKEN, encryptedToken)
        .where(AI_AGENT_CREDENTIAL.ID.eq(id))
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
