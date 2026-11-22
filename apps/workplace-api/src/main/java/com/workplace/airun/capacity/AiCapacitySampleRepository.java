package com.workplace.airun.capacity;

import static com.workplace.jooq.Tables.AI_CAPACITY_SAMPLE;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.springframework.stereotype.Repository;

/**
 * AI 처리 용량 1분 표본(ai_capacity_sample) 리포지토리(WP-1830). 테넌트 격리는 RLS + tenant_id GUC DEFAULT 로
 * 보장된다(애플리케이션은 tenant_id 를 넣지 않는다).
 */
@Repository
@RequiredArgsConstructor
public class AiCapacitySampleRepository {

  private final DSLContext dsl;

  /** 표본을 넣는다. 같은 (테넌트, 표본 시각) 이 이미 있으면 무시한다 — 잠금이 풀린 뒤 같은 분에 두 번 돌아도 한 행만 남기고 먼저 들어온 값을 지킨다. */
  public void insert(AiCapacitySample s) {
    dsl.insertInto(AI_CAPACITY_SAMPLE)
        .set(AI_CAPACITY_SAMPLE.SAMPLED_AT, s.sampledAt())
        .set(AI_CAPACITY_SAMPLE.SLOT_USED, s.slotUsed())
        .set(AI_CAPACITY_SAMPLE.SLOT_LIMIT, s.slotLimit())
        .set(AI_CAPACITY_SAMPLE.QUEUE_WAITING, s.queueWaiting())
        .set(AI_CAPACITY_SAMPLE.QUEUE_OLDEST_WAIT_SEC, s.queueOldestWaitSec())
        .set(AI_CAPACITY_SAMPLE.ACCOUNT_USAGE, JSONB.valueOf(s.accountUsageJson()))
        .set(AI_CAPACITY_SAMPLE.BACKLOG, JSONB.valueOf(s.backlogJson()))
        .onConflictDoNothing()
        .execute();
  }

  /** sampled_at 이 {@code days} 일보다 오래된 행을 지운다(보관 기간 정리). 지운 건수를 돌려준다. */
  public int deleteOlderThan(int days) {
    return dsl.deleteFrom(AI_CAPACITY_SAMPLE)
        .where(AI_CAPACITY_SAMPLE.SAMPLED_AT.lt(OffsetDateTime.now().minusDays(days)))
        .execute();
  }

  /** {@code since} 이후(포함)의 가장 최근 표본. 없으면 비어 있다 — 「최근 10분 표본」 판정에 쓴다. */
  public Optional<AiCapacitySample> findLatestSince(Instant since) {
    return dsl.selectFrom(AI_CAPACITY_SAMPLE)
        .where(AI_CAPACITY_SAMPLE.SAMPLED_AT.ge(utc(since)))
        .orderBy(AI_CAPACITY_SAMPLE.SAMPLED_AT.desc())
        .limit(1)
        .fetchOptional(AiCapacitySampleRepository::toSample);
  }

  /**
   * {@code [from, to)} 구간 표본을 시각 오름차순으로 돌려준다(위쪽은 미포함 — 반열린 구간). 위쪽을 포함하면 기간 경계(`from`)에 정확히 놓인 표본이
   * 직전 기간과 현재 기간에 한 번씩 들어가 두 번 세어진다(WP-1831 리뷰).
   */
  public List<AiCapacitySample> findBetween(Instant from, Instant to) {
    return dsl.selectFrom(AI_CAPACITY_SAMPLE)
        .where(AI_CAPACITY_SAMPLE.SAMPLED_AT.ge(utc(from)))
        .and(AI_CAPACITY_SAMPLE.SAMPLED_AT.lt(utc(to)))
        .orderBy(AI_CAPACITY_SAMPLE.SAMPLED_AT.asc())
        .fetch(AiCapacitySampleRepository::toSample);
  }

  private static OffsetDateTime utc(Instant t) {
    return t.atOffset(ZoneOffset.UTC);
  }

  /** 행을 표본 레코드로 바꾼다(JSON 칸은 문자열 그대로). */
  private static AiCapacitySample toSample(org.jooq.Record r) {
    return new AiCapacitySample(
        r.get(AI_CAPACITY_SAMPLE.SAMPLED_AT),
        r.get(AI_CAPACITY_SAMPLE.SLOT_USED),
        r.get(AI_CAPACITY_SAMPLE.SLOT_LIMIT),
        r.get(AI_CAPACITY_SAMPLE.QUEUE_WAITING),
        r.get(AI_CAPACITY_SAMPLE.QUEUE_OLDEST_WAIT_SEC),
        r.get(AI_CAPACITY_SAMPLE.ACCOUNT_USAGE).data(),
        r.get(AI_CAPACITY_SAMPLE.BACKLOG).data());
  }
}
