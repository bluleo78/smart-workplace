package com.workplace.auth.repository;

import static com.workplace.jooq.Tables.USER;

import java.util.Objects;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** user.personal_assistant_agent_id 조회/설정. */
@Repository
@RequiredArgsConstructor
public class PersonalAssistantRepository {

  private final DSLContext dsl;

  /** caller 의 개인 비서 AGENT id. 없으면(null FK) empty. */
  public Optional<Long> findAgentId(long userId) {
    return dsl.select(USER.PERSONAL_ASSISTANT_AGENT_ID)
        .from(USER)
        .where(USER.ID.eq(userId))
        .fetchOptional(USER.PERSONAL_ASSISTANT_AGENT_ID)
        .filter(Objects::nonNull);
  }

  /** 개인 비서 지정/해제(null). */
  public void setAgentId(long userId, Long agentId) {
    dsl.update(USER)
        .set(USER.PERSONAL_ASSISTANT_AGENT_ID, agentId)
        .where(USER.ID.eq(userId))
        .execute();
  }
}
