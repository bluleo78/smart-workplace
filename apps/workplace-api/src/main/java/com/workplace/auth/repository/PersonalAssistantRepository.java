package com.workplace.auth.repository;

import static com.workplace.jooq.Tables.USER;

import com.workplace.user.dto.AgentUsernames;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
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

  /**
   * 개인 비서의 주인 id(WP-1314 — 남의 개인 비서 일정은 주인만). 결정적 username(WP-638 {@link AgentUsernames} — 연결을 끊은
   * 비서도 주인 전용이다)이 먼저, 아니면 사람의 개인 비서 연결(user.personal_assistant_agent_id, 첫 행). 개인 비서가 아니면 empty.
   */
  public Optional<Long> findOwnerId(long agentId) {
    return Optional.ofNullable(findOwnerIds(List.of(agentId)).get(agentId));
  }

  /** {@link #findOwnerId} 를 여러 AGENT 에 한 번에 — AGENT id → 주인 id(개인 비서가 아닌 AGENT 는 빠진다). */
  public Map<Long, Long> findOwnerIds(Collection<Long> agentIds) {
    if (agentIds.isEmpty()) return Map.of();
    Map<Long, Long> out = new HashMap<>();
    dsl.select(USER.PERSONAL_ASSISTANT_AGENT_ID, USER.ID)
        .from(USER)
        .where(USER.PERSONAL_ASSISTANT_AGENT_ID.in(agentIds))
        .orderBy(USER.ID)
        .forEach(r -> out.putIfAbsent(r.value1(), r.value2()));
    // username 이 주인을 정하면 그것이 먼저다(연결과 어긋나도).
    dsl.select(USER.ID, USER.USERNAME)
        .from(USER)
        .where(USER.ID.in(agentIds))
        .and(USER.USERNAME.startsWith(AgentUsernames.PERSONAL_ASSISTANT_PREFIX))
        .forEach(
            r -> {
              Long byName = AgentUsernames.ownerIdOf(r.value2());
              if (byName != null) out.put(r.value1(), byName);
            });
    return out;
  }

  /** 개인 비서 지정/해제(null). */
  public void setAgentId(long userId, Long agentId) {
    dsl.update(USER)
        .set(USER.PERSONAL_ASSISTANT_AGENT_ID, agentId)
        .where(USER.ID.eq(userId))
        .execute();
  }
}
