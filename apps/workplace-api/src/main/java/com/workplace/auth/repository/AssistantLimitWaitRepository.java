package com.workplace.auth.repository;

import static com.workplace.jooq.Tables.ASSISTANT_LIMIT_WAIT;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 비서 자격별 사용 한도 대기(assistant_limit_wait) 리포지토리(WP-2108). 현재 테넌트 기준이며 RLS 가 다른 테넌트 행을 가린다(tenant_id 는
 * GUC DEFAULT 로 채워진다).
 */
@Repository
@RequiredArgsConstructor
public class AssistantLimitWaitRepository {

  private final DSLContext dsl;

  /** upsert 결과 — 저장된 대기 끝 시각과 「이 호출이 새 대기를 시작했는가」. */
  public record MarkResult(Instant untilAt, boolean started) {}

  /**
   * 대기를 건다. 「새 대기」는 now() 비교로 가르지 않고 SQL 결과로 가른다(트랜잭션 안에서 now() 가 고정이라도 두 번째 호출이 새 대기로 오판되지 않게). ①
   * 아직 유효한 행이 있으면 더 늦은 쪽으로 늘리고 started=false ② 없으면 INSERT(만료된 행이면 덮어씀) — 행이 오면 started=true ③ 그래도
   * 없으면 동시에 다른 쓰는 쪽이 이긴 것이라 ①을 한 번 더 하고 started=false.
   *
   * <p>{@code continuationUntil} 이 있으면(풀리는 시각을 몰라 기본 +1h 로 건 대기) 「만료된 지 2시간 안이고 24시간 안에 알린」 행을 같은
   * 한도의 연장으로 본다 — 크레딧 소진·월 한도처럼 시각 없이 계속 걸리는 한도가 1시간마다 새 대기로 알림을 쏟지 않게. 연장이면 {@code
   * continuationUntil} 까지 쉬고 알리지 않는다(started=false).
   */
  public MarkResult upsert(
      long credentialId, long agentUserId, Instant until, Instant continuationUntil) {
    OffsetDateTime untilAt = until.atOffset(ZoneOffset.UTC);
    OffsetDateTime extended = extend(credentialId, untilAt);
    if (extended != null) return new MarkResult(extended.toInstant(), false);

    if (continuationUntil != null) {
      var cont =
          dsl.update(ASSISTANT_LIMIT_WAIT)
              .set(ASSISTANT_LIMIT_WAIT.UNTIL_AT, continuationUntil.atOffset(ZoneOffset.UTC))
              .set(ASSISTANT_LIMIT_WAIT.AGENT_USER_ID, agentUserId)
              .where(ASSISTANT_LIMIT_WAIT.CREDENTIAL_ID.eq(credentialId))
              .and(ASSISTANT_LIMIT_WAIT.UNTIL_AT.le(DSL.currentOffsetDateTime()))
              .and(DSL.condition("{0} > now() - interval '2 hours'", ASSISTANT_LIMIT_WAIT.UNTIL_AT))
              .and(
                  DSL.condition(
                      "{0} > now() - interval '24 hours'", ASSISTANT_LIMIT_WAIT.NOTIFIED_AT))
              .returning(ASSISTANT_LIMIT_WAIT.UNTIL_AT)
              .fetchOne();
      if (cont != null) return new MarkResult(cont.getUntilAt().toInstant(), false);
    }

    var inserted =
        dsl.insertInto(ASSISTANT_LIMIT_WAIT)
            .set(ASSISTANT_LIMIT_WAIT.CREDENTIAL_ID, credentialId)
            .set(ASSISTANT_LIMIT_WAIT.AGENT_USER_ID, agentUserId)
            .set(ASSISTANT_LIMIT_WAIT.UNTIL_AT, untilAt)
            .onConflict(ASSISTANT_LIMIT_WAIT.TENANT_ID, ASSISTANT_LIMIT_WAIT.CREDENTIAL_ID)
            .doUpdate()
            .set(ASSISTANT_LIMIT_WAIT.UNTIL_AT, untilAt)
            .set(ASSISTANT_LIMIT_WAIT.NOTIFIED_AT, DSL.currentOffsetDateTime())
            .set(ASSISTANT_LIMIT_WAIT.AGENT_USER_ID, agentUserId)
            .where(ASSISTANT_LIMIT_WAIT.UNTIL_AT.le(DSL.currentOffsetDateTime()))
            .returning(ASSISTANT_LIMIT_WAIT.UNTIL_AT)
            .fetchOne();
    if (inserted != null) return new MarkResult(inserted.getUntilAt().toInstant(), true);

    OffsetDateTime again = extend(credentialId, untilAt);
    return new MarkResult((again != null ? again : untilAt).toInstant(), false);
  }

  /** 유효한 대기가 있으면 {@code until} 과 큰 쪽으로 늘리고 그 값을 돌려준다. 없으면 null. */
  private OffsetDateTime extend(long credentialId, OffsetDateTime until) {
    var rec =
        dsl.update(ASSISTANT_LIMIT_WAIT)
            .set(
                ASSISTANT_LIMIT_WAIT.UNTIL_AT,
                DSL.greatest(ASSISTANT_LIMIT_WAIT.UNTIL_AT, DSL.val(until)))
            .where(ASSISTANT_LIMIT_WAIT.CREDENTIAL_ID.eq(credentialId))
            .and(ASSISTANT_LIMIT_WAIT.UNTIL_AT.gt(DSL.currentOffsetDateTime()))
            .returning(ASSISTANT_LIMIT_WAIT.UNTIL_AT)
            .fetchOne();
    return rec == null ? null : rec.getUntilAt();
  }

  /** 지금 유효한(until_at 이 미래인) 대기의 끝 시각. 없거나 지났으면 empty. */
  public Optional<Instant> findActiveUntil(long credentialId) {
    return dsl.select(ASSISTANT_LIMIT_WAIT.UNTIL_AT)
        .from(ASSISTANT_LIMIT_WAIT)
        .where(ASSISTANT_LIMIT_WAIT.CREDENTIAL_ID.eq(credentialId))
        .and(ASSISTANT_LIMIT_WAIT.UNTIL_AT.gt(DSL.currentOffsetDateTime()))
        .fetchOptional(ASSISTANT_LIMIT_WAIT.UNTIL_AT)
        .map(OffsetDateTime::toInstant);
  }

  /** 자격의 대기를 푼다 — 모델을 바꾸면 새 모델은 한도에 걸리지 않았을 수 있다. */
  public void delete(long credentialId) {
    dsl.deleteFrom(ASSISTANT_LIMIT_WAIT)
        .where(ASSISTANT_LIMIT_WAIT.CREDENTIAL_ID.eq(credentialId))
        .execute();
  }
}
