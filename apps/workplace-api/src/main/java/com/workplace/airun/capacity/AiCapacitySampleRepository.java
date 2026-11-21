package com.workplace.airun.capacity;

import static com.workplace.jooq.Tables.AI_CAPACITY_SAMPLE;

import java.time.OffsetDateTime;
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
}
