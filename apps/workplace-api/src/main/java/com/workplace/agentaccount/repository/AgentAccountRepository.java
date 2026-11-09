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
        toInstant(r.get(AGENT_ACCOUNT.REVOKED_AT)),
        r.get(AGENT_ACCOUNT.LOGIN_REVISION),
        r.get(AGENT_ACCOUNT.SERVER_REFRESH_READY));
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

  /**
   * 계정을 새로 넣는다. secret_version 은 시퀀스 기본값, 반환은 새 id. {@code serverRefreshReady} 는 사람이 방금 넣은 원문이면
   * true(서버가 갱신을 맡아도 된다), 이관 백필이면 false.
   */
  public long insert(
      String provider,
      String label,
      String encryptedSecret,
      String accountEmail,
      Instant lastRefreshedAt,
      String status,
      String fingerprint,
      Long createdBy,
      boolean serverRefreshReady) {
    return dsl.insertInto(AGENT_ACCOUNT)
        .set(AGENT_ACCOUNT.PROVIDER, provider)
        .set(AGENT_ACCOUNT.LABEL, label)
        .set(AGENT_ACCOUNT.ENCRYPTED_SECRET, encryptedSecret)
        .set(AGENT_ACCOUNT.ACCOUNT_EMAIL, accountEmail)
        .set(AGENT_ACCOUNT.LAST_REFRESHED_AT, toOffset(lastRefreshedAt))
        .set(AGENT_ACCOUNT.STATUS, status)
        .set(AGENT_ACCOUNT.FINGERPRINT, fingerprint)
        .set(AGENT_ACCOUNT.CREATED_BY, createdBy)
        .set(AGENT_ACCOUNT.SERVER_REFRESH_READY, serverRefreshReady)
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

  /** 이 워크스페이스의 폐기되지 않은 계정 중 주어진 종류만(id 오름차순) — 서버 로그인 갱신(WP-1450)이 갱신할 종류만 SQL 에서 고른다. */
  public List<AgentAccountRow> findAllActiveByProviders(Collection<String> providers) {
    if (providers.isEmpty()) return List.of();
    return dsl.selectFrom(AGENT_ACCOUNT)
        .where(AGENT_ACCOUNT.REVOKED_AT.isNull().and(AGENT_ACCOUNT.PROVIDER.in(providers)))
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
   * 갱신한다. 사람이 방금 넣은 새 원문이라 서버 갱신 준비(server_refresh_ready)도 true 로 둔다.
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
        .set(AGENT_ACCOUNT.SERVER_REFRESH_READY, true)
        .set(AGENT_ACCOUNT.UPDATED_AT, OffsetDateTime.now())
        .where(activeById(id))
        .execute();
  }

  /** 서버 보관본이 신선하다고 확인된 계정으로 표시한다(Pod 가 더 새 로그인을 올렸을 때) — 이후 서버가 갱신을 맡는다. */
  public void markServerRefreshReady(long id) {
    dsl.update(AGENT_ACCOUNT)
        .set(AGENT_ACCOUNT.SERVER_REFRESH_READY, true)
        .where(activeById(id))
        .execute();
  }

  /**
   * 서버 갱신이 영구 실패했음을 표시한다(WP-1450) — 같은 UPDATE 한 번으로 상태를 {@code status}(다시 로그인 필요)로 두고 서버 갱신 준비
   * (server_refresh_ready)를 내린다. 사용량 조회 성공 등 다른 코드가 상태를 ACTIVE 로 되돌려도 서버가 죽은 갱신 토큰으로 다시 호출하지 않게 하기
   * 위해서다. 준비 표시는 사람이 원문을 교체하거나({@link #replaceSecret}) Pod 가 더 새 로그인을 올릴 때({@link
   * #updateLoginContentConfirmed})만 다시 선다.
   */
  public void markRefreshFailedPermanently(long id, String status) {
    dsl.update(AGENT_ACCOUNT)
        .set(AGENT_ACCOUNT.STATUS, status)
        .set(AGENT_ACCOUNT.SERVER_REFRESH_READY, false)
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
   * 로그인 내용만 바꾼다(WP-1450) — 서버 갱신·Pod 되가져오기용. secret_version 이 expected 와 같을 때만 원문·갱신 시각을 바꾸고
   * login_revision 을 1 올린다. secret_version 은 그대로라 이 계정을 쓰는 AI 의 Pod 는 갈리지 않는다(Pod 가 login_revision
   * 으로 내용 변경만 안다). 그 사이 사람이 원문을 교체했거나(secret_version 변경) 폐기됐으면 바꾸지 않는다.
   *
   * @return 바꿨으면 true, 바뀐 행이 없으면 false
   */
  public boolean updateLoginContent(
      long accountId,
      long expectedSecretVersion,
      String encryptedSecret,
      OffsetDateTime lastRefreshedAt) {
    return updateLoginContent(
        accountId, expectedSecretVersion, encryptedSecret, lastRefreshedAt, null);
  }

  /**
   * Pod 가 올린 더 새 로그인으로 내용을 바꾼다(WP-1450) — {@link #updateLoginContent(long, long, String,
   * OffsetDateTime)} 와 같은 조건·변경에 더해, 같은 UPDATE 한 번으로 서버 갱신 준비(server_refresh_ready)를 true 로, 상태를
   * {@code status}(정상)로 둔다. Pod 가 직접 되가져온 로그인은 서버 보관본보다 새롭고 살아 있다고 확인된 것이라서다.
   *
   * @return 바꿨으면 true, 바뀐 행이 없으면 false
   */
  public boolean updateLoginContentConfirmed(
      long accountId,
      long expectedSecretVersion,
      String encryptedSecret,
      OffsetDateTime lastRefreshedAt,
      String status) {
    return updateLoginContent(
        accountId, expectedSecretVersion, encryptedSecret, lastRefreshedAt, status);
  }

  /** 로그인 내용 변경 UPDATE 한 곳 — {@code confirmedStatus} 가 있으면 서버 갱신 준비·상태도 함께 바꾼다. */
  private boolean updateLoginContent(
      long accountId,
      long expectedSecretVersion,
      String encryptedSecret,
      OffsetDateTime lastRefreshedAt,
      String confirmedStatus) {
    var update =
        dsl.update(AGENT_ACCOUNT)
            .set(AGENT_ACCOUNT.ENCRYPTED_SECRET, encryptedSecret)
            .set(AGENT_ACCOUNT.LAST_REFRESHED_AT, lastRefreshedAt)
            .set(AGENT_ACCOUNT.LOGIN_REVISION, AGENT_ACCOUNT.LOGIN_REVISION.plus(1L))
            .set(AGENT_ACCOUNT.UPDATED_AT, OffsetDateTime.now());
    if (confirmedStatus != null) {
      update =
          update
              .set(AGENT_ACCOUNT.SERVER_REFRESH_READY, true)
              .set(AGENT_ACCOUNT.STATUS, confirmedStatus);
    }
    return update
            .where(
                activeById(accountId).and(AGENT_ACCOUNT.SECRET_VERSION.eq(expectedSecretVersion)))
            .execute()
        > 0;
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
