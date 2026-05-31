package com.workplace.auth.repository;

import static com.workplace.jooq.Tables.WORKSPACE_ASSISTANT;

import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** 공용 비서(싱글톤 id=1) 지정 저장/조회. */
@Repository
@RequiredArgsConstructor
public class WorkspaceAssistantRepository {

  private final DSLContext dsl;

  /** 공용 비서로 지정된 AGENT user id. 미지정이면 empty. */
  public Optional<Long> findAgentId() {
    return dsl.select(WORKSPACE_ASSISTANT.AGENT_USER_ID)
        .from(WORKSPACE_ASSISTANT)
        .where(WORKSPACE_ASSISTANT.ID.eq((short) 1))
        .fetchOptional(WORKSPACE_ASSISTANT.AGENT_USER_ID);
  }

  /** 싱글톤 upsert — 항상 id=1 한 행만 유지. */
  public void upsert(long agentUserId, long updatedBy) {
    dsl.insertInto(WORKSPACE_ASSISTANT)
        .set(WORKSPACE_ASSISTANT.ID, (short) 1)
        .set(WORKSPACE_ASSISTANT.AGENT_USER_ID, agentUserId)
        .set(WORKSPACE_ASSISTANT.UPDATED_BY, updatedBy)
        .onConflict(WORKSPACE_ASSISTANT.ID)
        .doUpdate()
        .set(WORKSPACE_ASSISTANT.AGENT_USER_ID, agentUserId)
        .set(WORKSPACE_ASSISTANT.UPDATED_BY, updatedBy)
        .set(WORKSPACE_ASSISTANT.UPDATED_AT, org.jooq.impl.DSL.currentOffsetDateTime())
        .execute();
  }
}
