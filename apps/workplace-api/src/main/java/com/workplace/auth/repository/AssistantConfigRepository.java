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

  /** assistant_config 한 행(원시값, nullable 보존). suggestionModel — 추천 질문 전용 모델(WP-139, null=자동). */
  public record ConfigRow(
      String model,
      String thinkingDepth,
      Integer maxTurns,
      Integer timeoutMs,
      String suggestionModel) {

    /** 추천 모델이 없던 시절의 4인자 생성(기존 호출부 호환) — 추천 모델은 자동(null). */
    public ConfigRow(String model, String thinkingDepth, Integer maxTurns, Integer timeoutMs) {
      this(model, thinkingDepth, maxTurns, timeoutMs, null);
    }
  }

  /** agent 의 튜닝 설정. 미설정이면 empty. */
  public Optional<ConfigRow> find(long agentUserId) {
    return dsl.select(
            ASSISTANT_CONFIG.MODEL,
            ASSISTANT_CONFIG.THINKING_DEPTH,
            ASSISTANT_CONFIG.MAX_TURNS,
            ASSISTANT_CONFIG.TIMEOUT_MS,
            ASSISTANT_CONFIG.SUGGESTION_MODEL)
        .from(ASSISTANT_CONFIG)
        .where(ASSISTANT_CONFIG.AGENT_USER_ID.eq(agentUserId))
        .fetchOptional(
            r ->
                new ConfigRow(
                    r.get(ASSISTANT_CONFIG.MODEL),
                    r.get(ASSISTANT_CONFIG.THINKING_DEPTH),
                    r.get(ASSISTANT_CONFIG.MAX_TURNS),
                    r.get(ASSISTANT_CONFIG.TIMEOUT_MS),
                    r.get(ASSISTANT_CONFIG.SUGGESTION_MODEL)));
  }

  /** upsert — null 인자는 그대로 NULL 저장(=디폴트 사용 의미). suggestion_model 은 건드리지 않는다(전용 setter 사용). */
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

  /** 추천 질문 모델만 저장(WP-139) — null 이면 자동. 다른 튜닝 값은 그대로 둔다. */
  public void updateSuggestionModel(long agentUserId, String suggestionModel) {
    dsl.insertInto(ASSISTANT_CONFIG)
        .set(ASSISTANT_CONFIG.AGENT_USER_ID, agentUserId)
        .set(ASSISTANT_CONFIG.SUGGESTION_MODEL, suggestionModel)
        .onConflict(ASSISTANT_CONFIG.AGENT_USER_ID)
        .doUpdate()
        .set(ASSISTANT_CONFIG.SUGGESTION_MODEL, suggestionModel)
        .set(ASSISTANT_CONFIG.UPDATED_AT, DSL.currentOffsetDateTime())
        .execute();
  }
}
