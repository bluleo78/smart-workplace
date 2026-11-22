package com.workplace.messaging.repository;

import static com.workplace.jooq.Tables.MESSAGING_AGENT_RUN;

import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.JSONB;
import org.jooq.Record;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/** 메시징 AI 대화별 실행 임대 행(WP-1979) 접근. 행 잠금은 호출하는 서비스 트랜잭션 안에서 유지된다. */
@Repository
@RequiredArgsConstructor
public class MessagingAgentRunRepository {

  private final DSLContext dsl;

  /** 키 행이 없으면 만든다(있으면 그대로). 이어지는 lockRow 가 항상 행을 잡게 하려는 것. */
  public void ensureRow(long channelId, long parentMessageId, long agentId) {
    dsl.insertInto(MESSAGING_AGENT_RUN)
        .set(MESSAGING_AGENT_RUN.CHANNEL_ID, channelId)
        .set(MESSAGING_AGENT_RUN.PARENT_MESSAGE_ID, parentMessageId)
        .set(MESSAGING_AGENT_RUN.AGENT_ID, agentId)
        .onConflictDoNothing()
        .execute();
  }

  /** 임대가 비었는가(소유자 없음 또는 만료) — 만료 판정을 DB 시계로 해 api 파드 간 시계 차를 없앤다. */
  public static final Field<Boolean> LEASE_FREE =
      DSL.field(
          MESSAGING_AGENT_RUN
              .OWNER_TOKEN
              .isNull()
              .or(MESSAGING_AGENT_RUN.LEASE_UNTIL.isNull())
              .or(MESSAGING_AGENT_RUN.LEASE_UNTIL.lt(DSL.currentOffsetDateTime())));

  /** 키 행을 FOR UPDATE 로 잠가 읽는다(LEASE_FREE 열 포함) — 같은 대화의 동시 acquire·release 를 줄 세운다. */
  public Record lockRow(long channelId, long parentMessageId, long agentId) {
    return dsl.select(MESSAGING_AGENT_RUN.fields())
        .select(LEASE_FREE)
        .from(MESSAGING_AGENT_RUN)
        .where(keyCondition(channelId, parentMessageId, agentId))
        .forUpdate()
        .fetchOne();
  }

  /** 지금(DB 시계) + leaseMs 밀리초 — 임대 만료 시각. */
  private static Field<OffsetDateTime> leaseUntil(long leaseMs) {
    return DSL.field("now() + (? * interval '1 millisecond')", OffsetDateTime.class, leaseMs);
  }

  /** 실행을 시작한다: 소유 토큰·만료 시각을 쓰고 last_started 를 올리며, 남은 pending(더 오래된 것)을 비운다. */
  public void markAcquired(
      long channelId,
      long parentMessageId,
      long agentId,
      UUID token,
      long leaseMs,
      long messageId) {
    dsl.update(MESSAGING_AGENT_RUN)
        .set(MESSAGING_AGENT_RUN.OWNER_TOKEN, token)
        .set(MESSAGING_AGENT_RUN.LEASE_UNTIL, leaseUntil(leaseMs))
        .set(MESSAGING_AGENT_RUN.LAST_STARTED_MESSAGE_ID, messageId)
        // acquire 가 행 잠금 아래에서 messageId 이하 pending 을 이미 DUPLICATE 로 걸렀으므로 남은 pending 은 모두 더 오래된 것이다
        // — 그냥 비운다.
        .setNull(MESSAGING_AGENT_RUN.PENDING_MESSAGE_ID)
        .setNull(MESSAGING_AGENT_RUN.PENDING_EVENT)
        .set(MESSAGING_AGENT_RUN.UPDATED_AT, DSL.currentOffsetDateTime())
        .where(keyCondition(channelId, parentMessageId, agentId))
        .execute();
  }

  /** 실행 중에 온 더 새 메시지를 대기 한 칸에 둔다(이전 대기는 덮어쓴다). */
  public void setPending(
      long channelId, long parentMessageId, long agentId, long messageId, JSONB event) {
    dsl.update(MESSAGING_AGENT_RUN)
        .set(MESSAGING_AGENT_RUN.PENDING_MESSAGE_ID, messageId)
        .set(MESSAGING_AGENT_RUN.PENDING_EVENT, event)
        .set(MESSAGING_AGENT_RUN.UPDATED_AT, DSL.currentOffsetDateTime())
        .where(keyCondition(channelId, parentMessageId, agentId))
        .execute();
  }

  /** 대기 이벤트를 이어서 돌린다: last_started 를 대기 id 로 올리고 대기를 비우며 임대를 갱신한다(소유 토큰 유지). */
  public void promotePending(
      long channelId, long parentMessageId, long agentId, long startedMessageId, long leaseMs) {
    dsl.update(MESSAGING_AGENT_RUN)
        .set(MESSAGING_AGENT_RUN.LAST_STARTED_MESSAGE_ID, startedMessageId)
        .set(MESSAGING_AGENT_RUN.PENDING_MESSAGE_ID, (Long) null)
        .set(MESSAGING_AGENT_RUN.PENDING_EVENT, (JSONB) null)
        .set(MESSAGING_AGENT_RUN.LEASE_UNTIL, leaseUntil(leaseMs))
        .set(MESSAGING_AGENT_RUN.UPDATED_AT, DSL.currentOffsetDateTime())
        .where(keyCondition(channelId, parentMessageId, agentId))
        .execute();
  }

  /** 소유와 임대를 비운다(실행 끝, 대기 없음). last_started 는 남겨 중복 재전달을 막는다. */
  public void clearOwner(long channelId, long parentMessageId, long agentId) {
    dsl.update(MESSAGING_AGENT_RUN)
        .set(MESSAGING_AGENT_RUN.OWNER_TOKEN, (UUID) null)
        .set(MESSAGING_AGENT_RUN.LEASE_UNTIL, (OffsetDateTime) null)
        .set(MESSAGING_AGENT_RUN.UPDATED_AT, DSL.currentOffsetDateTime())
        .where(keyCondition(channelId, parentMessageId, agentId))
        .execute();
  }

  /** 대화 키 (channel_id, parent_message_id, agent_id) 조건 — 모든 조회·갱신이 같은 한 행만 건드리게 한다. */
  private org.jooq.Condition keyCondition(long channelId, long parentMessageId, long agentId) {
    return MESSAGING_AGENT_RUN
        .CHANNEL_ID
        .eq(channelId)
        .and(MESSAGING_AGENT_RUN.PARENT_MESSAGE_ID.eq(parentMessageId))
        .and(MESSAGING_AGENT_RUN.AGENT_ID.eq(agentId));
  }
}
