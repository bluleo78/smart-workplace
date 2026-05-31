package com.workplace.auth.repository;

import static com.workplace.jooq.Tables.ASSISTANT_CONFIG;

import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/** 비서 튜닝(agent 단위) 저장/조회. 모든 값 nullable = 시스템 디폴트. */
@Repository
@RequiredArgsConstructor
public class AssistantConfigRepository {

  private final DSLContext dsl;

  /** assistant_config 한 행(원시값, nullable 보존). */
  public record ConfigRow(
      String model, String thinkingDepth, Integer maxTurns, Integer timeoutMs) {}

  /** agent 의 튜닝 설정. 미설정이면 empty. */
  public Optional<ConfigRow> find(long agentUserId) {
    return dsl.select(
            ASSISTANT_CONFIG.MODEL,
            ASSISTANT_CONFIG.THINKING_DEPTH,
            ASSISTANT_CONFIG.MAX_TURNS,
            ASSISTANT_CONFIG.TIMEOUT_MS)
        .from(ASSISTANT_CONFIG)
        .where(ASSISTANT_CONFIG.AGENT_USER_ID.eq(agentUserId))
        .fetchOptional(
            r ->
                new ConfigRow(
                    r.get(ASSISTANT_CONFIG.MODEL),
                    r.get(ASSISTANT_CONFIG.THINKING_DEPTH),
                    r.get(ASSISTANT_CONFIG.MAX_TURNS),
                    r.get(ASSISTANT_CONFIG.TIMEOUT_MS)));
  }

  /** upsert — null 인자는 그대로 NULL 저장(=디폴트 사용 의미). */
  public void upsert(
      long agentUserId, String model, String thinkingDepth, Integer maxTurns, Integer timeoutMs) {
    dsl.insertInto(ASSISTANT_CONFIG)
        .set(ASSISTANT_CONFIG.AGENT_USER_ID, agentUserId)
        .set(ASSISTANT_CONFIG.MODEL, model)
        .set(ASSISTANT_CONFIG.THINKING_DEPTH, thinkingDepth)
        .set(ASSISTANT_CONFIG.MAX_TURNS, maxTurns)
        .set(ASSISTANT_CONFIG.TIMEOUT_MS, timeoutMs)
        .onConflict(ASSISTANT_CONFIG.AGENT_USER_ID)
        .doUpdate()
        .set(ASSISTANT_CONFIG.MODEL, model)
        .set(ASSISTANT_CONFIG.THINKING_DEPTH, thinkingDepth)
        .set(ASSISTANT_CONFIG.MAX_TURNS, maxTurns)
        .set(ASSISTANT_CONFIG.TIMEOUT_MS, timeoutMs)
        .set(ASSISTANT_CONFIG.UPDATED_AT, DSL.currentOffsetDateTime())
        .execute();
  }
}
