package com.workplace.agentruntime.repository;

import static com.workplace.jooq.Tables.AGENT_SCREEN_INPUT;
import static com.workplace.jooq.Tables.AGENT_SCREEN_SESSION;

import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/**
 * AI 작업 화면 기록(agent_screen_session·agent_screen_input) 리포지토리(WP-1277). 테넌트 격리는 RLS + tenant_id GUC
 * DEFAULT 로 보장된다 — 애플리케이션은 tenant_id 를 넣지 않는다. WebSocket 스레드에서 부를 때는 호출자가 세션의 테넌트로 트랜잭션을 연다.
 */
@Repository
@RequiredArgsConstructor
public class AgentScreenRepository {

  /** 세션 한 행 — runner 가 붙을 때 테넌트·위치를 견주고, 닫혔는지 본다. */
  public record SessionRow(
      UUID id,
      long tenantId,
      long agentUserId,
      Long locationId,
      Long openedBy,
      OffsetDateTime closedAt) {}

  private final DSLContext dsl;

  /** 새 세션 행을 넣는다(열린 채). */
  public void insert(UUID id, long agentUserId, long locationId, long openedBy) {
    dsl.insertInto(AGENT_SCREEN_SESSION)
        .set(AGENT_SCREEN_SESSION.ID, id)
        .set(AGENT_SCREEN_SESSION.AGENT_USER_ID, agentUserId)
        .set(AGENT_SCREEN_SESSION.LOCATION_ID, locationId)
        .set(AGENT_SCREEN_SESSION.OPENED_BY, openedBy)
        .execute();
  }

  /** 단건 — 다른 워크스페이스의 세션은 RLS 로 보이지 않는다. */
  public Optional<SessionRow> find(UUID id) {
    return dsl.select(
            AGENT_SCREEN_SESSION.ID,
            AGENT_SCREEN_SESSION.TENANT_ID,
            AGENT_SCREEN_SESSION.AGENT_USER_ID,
            AGENT_SCREEN_SESSION.LOCATION_ID,
            AGENT_SCREEN_SESSION.OPENED_BY,
            AGENT_SCREEN_SESSION.CLOSED_AT)
        .from(AGENT_SCREEN_SESSION)
        .where(AGENT_SCREEN_SESSION.ID.eq(id))
        .fetchOptional(
            r ->
                new SessionRow(
                    r.value1(), r.value2(), r.value3(), r.value4(), r.value5(), r.value6()));
  }

  /** 입력을 허용한 때·사람을 남긴다 — 나중에 입력을 끄더라도 지우지 않는다(허용한 적이 있다는 기록). */
  public void markInputEnabled(UUID id, long enabledBy) {
    dsl.update(AGENT_SCREEN_SESSION)
        .set(AGENT_SCREEN_SESSION.INPUT_ENABLED_AT, OffsetDateTime.now())
        .set(AGENT_SCREEN_SESSION.INPUT_ENABLED_BY, enabledBy)
        .where(AGENT_SCREEN_SESSION.ID.eq(id))
        .execute();
  }

  /** 닫힌 때·까닭을 남긴다 — 이미 닫혔으면 처음 까닭을 지키려고 바꾸지 않는다. */
  public void close(UUID id, String reason) {
    dsl.update(AGENT_SCREEN_SESSION)
        .set(AGENT_SCREEN_SESSION.CLOSED_AT, OffsetDateTime.now())
        .set(AGENT_SCREEN_SESSION.CLOSE_REASON, reason)
        .where(AGENT_SCREEN_SESSION.ID.eq(id))
        .and(AGENT_SCREEN_SESSION.CLOSED_AT.isNull())
        .execute();
  }

  /** 이 워크스페이스에서 cutoff 전에 열린 채 닫히지 않은 세션을 닫는다 — 어느 파드에서도 살아 있을 수 없는(최대 수명이 지난) 옛 행 정리용. */
  public int closeOpenedBefore(OffsetDateTime cutoff, String reason) {
    return dsl.update(AGENT_SCREEN_SESSION)
        .set(AGENT_SCREEN_SESSION.CLOSED_AT, OffsetDateTime.now())
        .set(AGENT_SCREEN_SESSION.CLOSE_REASON, reason)
        .where(AGENT_SCREEN_SESSION.CLOSED_AT.isNull())
        .and(AGENT_SCREEN_SESSION.OPENED_AT.lt(cutoff))
        .execute();
  }

  /** 입력 기록 한 행을 넣는다. */
  public void insertInput(UUID sessionId, String data) {
    dsl.insertInto(AGENT_SCREEN_INPUT)
        .set(AGENT_SCREEN_INPUT.SESSION_ID, sessionId)
        .set(AGENT_SCREEN_INPUT.DATA, data)
        .execute();
  }
}
