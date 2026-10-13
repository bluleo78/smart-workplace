package com.workplace.chat.service;

import static com.workplace.jooq.Tables.USER;

import com.workplace.global.dto.UserSummary;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Component;

/** mention userIds → UserSummary[] hydration. USER 테이블 일괄 조회. */
@Component
@RequiredArgsConstructor
public class ChatUserHydrator {

  private final DSLContext dsl;

  /** 단건 UserSummary 조회. */
  public UserSummary summaryOf(long userId) {
    return dsl.select(USER.ID, USER.USERNAME, USER.NAME, USER.KIND)
        .from(USER)
        .where(USER.ID.eq(userId))
        .fetchOptional(
            r ->
                new UserSummary(
                    r.get(USER.ID), r.get(USER.USERNAME), r.get(USER.NAME), r.get(USER.KIND)))
        .orElseThrow(() -> new IllegalStateException("사용자를 찾을 수 없습니다 (id: " + userId + ")"));
  }

  /**
   * 주어진 사용자 중 서버(ai-agent)가 대신 실행하는 에이전트(kind=AGENT, runtime=INTERNAL)의 id 집합 (WP-371). 이벤트 발행 시점(원
   * 트랜잭션 안)에 호출해 AFTER_COMMIT dispatcher 가 외부 에이전트를 거를 수 있게 한다. AGENT 가 없으면 쿼리하지 않는다.
   */
  public java.util.Set<Long> internalAgentIdsAmong(List<UserSummary> users) {
    List<Long> agentIds =
        users.stream().filter(u -> "AGENT".equals(u.kind())).map(UserSummary::id).toList();
    if (agentIds.isEmpty()) return java.util.Set.of();
    return new java.util.LinkedHashSet<>(
        dsl.select(USER.ID)
            .from(USER)
            .where(USER.ID.in(agentIds))
            .and(USER.AGENT_RUNTIME.eq("INTERNAL"))
            .fetch(USER.ID));
  }

  /** 다건 UserSummary 조회. 입력 순서는 보존하지 않음. */
  public List<UserSummary> summariesOf(List<Long> userIds) {
    if (userIds == null || userIds.isEmpty()) return List.of();
    return dsl.select(USER.ID, USER.USERNAME, USER.NAME, USER.KIND)
        .from(USER)
        .where(USER.ID.in(userIds))
        .fetch(
            r ->
                new UserSummary(
                    r.get(USER.ID), r.get(USER.USERNAME), r.get(USER.NAME), r.get(USER.KIND)));
  }
}
