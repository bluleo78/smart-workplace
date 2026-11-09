package com.workplace.agentaccount.repository;

import static com.workplace.jooq.Tables.AGENT_ACCOUNT;

import com.workplace.agentaccount.dto.AgentAccountRow;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * AI 계정 목록(agent_account) jOOQ 리포지토리(WP-1448). 평문 원문은 다루지 않는다 — 서비스가 EncryptionService 로 암호화한 값만
 * 받는다. 테넌트 격리는 RLS + tenant_id GUC DEFAULT 로 보장되므로 애플리케이션은 tenant_id 를 넣지 않는다. 폐기(revoked_at)된 행은
 * 모든 조회에서 빠진다.
 */
@Repository
@RequiredArgsConstructor
public class AgentAccountRepository {

  /** secret_version 을 새로 받는 시퀀스(V274). */
  private static final String VERSION_SEQ = "agent_account_secret_version_seq";

  /**
   * 기존 연결 이관 백필 잠금 classId(WP-1448) — 2-인자 pg_try_advisory_xact_lock(classId, tenantId). 다른
   * 잠금(55·81·358·420 등)과 겹치지 않게 이슈 번호를 쓴다.
   */
  private static final int BACKFILL_LOCK_CLASS = 1448;

  private final DSLContext dsl;

  /** Record → 행 DTO. OffsetDateTime → Instant 변환. */
  private AgentAccountRow mapRow(Record r) {
    return new AgentAccountRow(
        r.get(AGENT_ACCOUNT.ID),
        r.get(AGENT_ACCOUNT.PROVIDER),
        r.get(AGENT_ACCOUNT.LABEL),
        r.get(AGENT_ACCOUNT.ENCRYPTED_SECRET),
        r.get(AGENT_ACCOUNT.SECRET_VERSION),
        r.get(AGENT_ACCOUNT.ACCOUNT_EMAIL),
        toInstant(r.get(AGENT_ACCOUNT.LAST_REFRESHED_AT)),
        r.get(AGENT_ACCOUNT.STATUS),
        r.get(AGENT_ACCOUNT.CREATED_BY),
        toInstant(r.get(AGENT_ACCOUNT.CREATED_AT)),
        toInstant(r.get(AGENT_ACCOUNT.UPDATED_AT)),
        toInstant(r.get(AGENT_ACCOUNT.REVOKED_AT)));
  }

  /** 「살아 있는 이 계정」 조건(id 일치 + 폐기 안 됨) — 단건 조회·잠금·수정·폐기가 같이 쓴다(살아 있음 규칙을 한 곳에). */
  private static Condition activeById(long id) {
    return AGENT_ACCOUNT.ID.eq(id).and(AGENT_ACCOUNT.REVOKED_AT.isNull());
  }

  private static Instant toInstant(OffsetDateTime t) {
    return t == null ? null : t.toInstant();
  }

  private static OffsetDateTime toOffset(Instant t) {
    return t == null ? null : t.atOffset(ZoneOffset.UTC);
  }

  /** 계정을 새로 넣는다. secret_version 은 시퀀스 기본값, 반환은 새 id. */
  public long insert(
      String provider,
      String label,
      String encryptedSecret,
      String accountEmail,
      Instant lastRefreshedAt,
      String status,
      String fingerprint,
      Long createdBy) {
    return dsl.insertInto(AGENT_ACCOUNT)
        .set(AGENT_ACCOUNT.PROVIDER, provider)
        .set(AGENT_ACCOUNT.LABEL, label)
        .set(AGENT_ACCOUNT.ENCRYPTED_SECRET, encryptedSecret)
        .set(AGENT_ACCOUNT.ACCOUNT_EMAIL, accountEmail)
        .set(AGENT_ACCOUNT.LAST_REFRESHED_AT, toOffset(lastRefreshedAt))
        .set(AGENT_ACCOUNT.STATUS, status)
        .set(AGENT_ACCOUNT.FINGERPRINT, fingerprint)
        .set(AGENT_ACCOUNT.CREATED_BY, createdBy)
        .returning(AGENT_ACCOUNT.ID)
        .fetchOne()
        .getId();
  }

  /** 폐기되지 않은 계정 한 건(없거나 폐기·다른 워크스페이스면 empty). */
  public Optional<AgentAccountRow> findActive(long id) {
    return dsl.selectFrom(AGENT_ACCOUNT).where(activeById(id)).fetchOptional(this::mapRow);
  }

  /**
   * 폐기되지 않은 계정 한 건을 행 잠금(FOR UPDATE)과 함께 읽는다 — 묶기와 폐기가 같은 계정 행을 잠가 차례로 서게 한다. 폐기의 「쓰는 AI 있음」 확인과 실제
   * 폐기 사이에 묶기가 끼어들어 폐기된 계정을 가리키는 AI 가 생기지 않게.
   */
  public Optional<AgentAccountRow> findActiveForUpdate(long id) {
    return dsl.selectFrom(AGENT_ACCOUNT)
        .where(activeById(id))
        .forUpdate()
        .fetchOptional(this::mapRow);
  }

  /** 이 워크스페이스의 폐기되지 않은 계정 전부(id 오름차순). */
  public List<AgentAccountRow> findAllActive() {
    return dsl.selectFrom(AGENT_ACCOUNT)
        .where(AGENT_ACCOUNT.REVOKED_AT.isNull())
        .orderBy(AGENT_ACCOUNT.ID)
        .fetch(this::mapRow);
  }

  /** 여러 계정을 한 쿼리로 — 계정 id → 행. 없거나 폐기된 id 는 빠진다. */
  public Map<Long, AgentAccountRow> findActiveByIds(Collection<Long> ids) {
    if (ids.isEmpty()) return Map.of();
    Map<Long, AgentAccountRow> out = new LinkedHashMap<>();
    dsl.selectFrom(AGENT_ACCOUNT)
        .where(AGENT_ACCOUNT.ID.in(ids).and(AGENT_ACCOUNT.REVOKED_AT.isNull()))
        .orderBy(AGENT_ACCOUNT.ID)
        .forEach(r -> out.put(r.getId(), mapRow(r)));
    return out;
  }

  /** 종류·원문 정체성(fingerprint)이 같은 살아 있는 계정 — 이관 백필이 같은 계정을 다시 만들지 않도록 찾는다. */
  public Optional<AgentAccountRow> findActiveByFingerprint(String provider, String fingerprint) {
    return dsl.selectFrom(AGENT_ACCOUNT)
        .where(
            AGENT_ACCOUNT
                .PROVIDER
                .eq(provider)
                .and(AGENT_ACCOUNT.FINGERPRINT.eq(fingerprint))
                .and(AGENT_ACCOUNT.REVOKED_AT.isNull()))
        .fetchOptional(this::mapRow);
  }

  /** 라벨만 바꾼다. 원문이 그대로이므로 secret_version 은 건드리지 않는다. */
  public void updateLabel(long id, String label) {
    dsl.update(AGENT_ACCOUNT)
        .set(AGENT_ACCOUNT.LABEL, label)
        .set(AGENT_ACCOUNT.UPDATED_AT, OffsetDateTime.now())
        .where(activeById(id))
        .execute();
  }

  /**
   * 원문을 교체한다 — secret_version 을 시퀀스에서 새로 받아 이 계정을 쓰는 AI 의 Pod 가 바뀐 것을 알게 한다. 이메일·갱신 시각·상태·정체성도 함께
   * 갱신한다.
   */
  public void replaceSecret(
      long id,
      String encryptedSecret,
      String accountEmail,
      Instant lastRefreshedAt,
      String status,
      String fingerprint) {
    dsl.update(AGENT_ACCOUNT)
        .set(AGENT_ACCOUNT.ENCRYPTED_SECRET, encryptedSecret)
        .set(AGENT_ACCOUNT.SECRET_VERSION, DSL.field("nextval('" + VERSION_SEQ + "')", Long.class))
        .set(AGENT_ACCOUNT.ACCOUNT_EMAIL, accountEmail)
        .set(AGENT_ACCOUNT.LAST_REFRESHED_AT, toOffset(lastRefreshedAt))
        .set(AGENT_ACCOUNT.STATUS, status)
        .set(AGENT_ACCOUNT.FINGERPRINT, fingerprint)
        .set(AGENT_ACCOUNT.UPDATED_AT, OffsetDateTime.now())
        .where(activeById(id))
        .execute();
  }

  /**
   * 상태만 바꾼다(원문이 그대로라 secret_version 은 건드리지 않는다) — 기존 연결 등록 다리가 「확인 필요」 계정에 사람이 방금 같은 원문을 넣었을 때
   * 「정상」으로 되돌린다.
   */
  public void updateStatus(long id, String status) {
    dsl.update(AGENT_ACCOUNT)
        .set(AGENT_ACCOUNT.STATUS, status)
        .set(AGENT_ACCOUNT.UPDATED_AT, OffsetDateTime.now())
        .where(activeById(id))
        .execute();
  }

  /**
   * 이 테넌트의 이관 백필 잠금을 시도한다 — 트랜잭션이 끝나면 풀린다. 여러 대가 동시에 기동하면 한 대만 잡아 처리하고, 못 잡은 대는 그 테넌트를 건너뛴다(잡은 대가
   * 처리하고, 남은 것은 다음 기동이 처리한다).
   *
   * @return 잡았으면 true
   */
  public boolean tryLockBackfill(long tenantId) {
    return Boolean.TRUE.equals(
        dsl.fetchValue(
            DSL.field(
                "pg_try_advisory_xact_lock({0}, {1})",
                Boolean.class, DSL.val(BACKFILL_LOCK_CLASS), DSL.val((int) tenantId))));
  }

  /** 계정을 폐기한다(revoked_at 표시). 이미 폐기됐거나 없으면 0. */
  public int revoke(long id) {
    OffsetDateTime now = OffsetDateTime.now();
    return dsl.update(AGENT_ACCOUNT)
        .set(AGENT_ACCOUNT.REVOKED_AT, now)
        .set(AGENT_ACCOUNT.UPDATED_AT, now)
        .where(activeById(id))
        .execute();
  }
}
