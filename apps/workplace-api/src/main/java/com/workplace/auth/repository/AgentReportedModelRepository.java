package com.workplace.auth.repository;

import static com.workplace.jooq.Tables.AGENT_REPORTED_MODEL;

import java.time.OffsetDateTime;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.springframework.stereotype.Repository;

/**
 * AI 가 보고한 로그인 계정 모델 목록(agent_reported_model) 리포지토리(WP-1297). 목록 JSON 은 서비스가 만들고 읽는다 — 여기서는 문자열로만
 * 주고받는다. 테넌트 격리는 RLS + tenant_id GUC DEFAULT 로 보장된다(애플리케이션은 tenant_id 를 넣지 않는다).
 */
@Repository
@RequiredArgsConstructor
public class AgentReportedModelRepository {

  private final DSLContext dsl;

  /** AI 의 보고를 저장한다 — 이미 있으면 연결 행·목록·시각을 덮어쓴다. */
  public void upsert(long agentUserId, long credentialId, String modelsJson) {
    JSONB models = JSONB.valueOf(modelsJson);
    OffsetDateTime now = OffsetDateTime.now();
    dsl.insertInto(AGENT_REPORTED_MODEL)
        .set(AGENT_REPORTED_MODEL.AGENT_USER_ID, agentUserId)
        .set(AGENT_REPORTED_MODEL.CREDENTIAL_ID, credentialId)
        .set(AGENT_REPORTED_MODEL.MODELS, models)
        .set(AGENT_REPORTED_MODEL.REPORTED_AT, now)
        .onConflict(AGENT_REPORTED_MODEL.TENANT_ID, AGENT_REPORTED_MODEL.AGENT_USER_ID)
        .doUpdate()
        .set(AGENT_REPORTED_MODEL.CREDENTIAL_ID, credentialId)
        .set(AGENT_REPORTED_MODEL.MODELS, models)
        .set(AGENT_REPORTED_MODEL.REPORTED_AT, now)
        .execute();
  }

  /**
   * AI 의 보고 목록 JSON — 보고 당시의 연결 행이 {@code credentialId}(지금 활성 행)와 같을 때만 돌려준다(없거나 다른 연결 때의 것이면
   * empty). 비교를 SQL 에서 해 옛 연결의 보고를 읽지 않는다.
   */
  public Optional<String> find(long agentUserId, long credentialId) {
    return dsl.select(AGENT_REPORTED_MODEL.MODELS)
        .from(AGENT_REPORTED_MODEL)
        .where(AGENT_REPORTED_MODEL.AGENT_USER_ID.eq(agentUserId))
        .and(AGENT_REPORTED_MODEL.CREDENTIAL_ID.eq(credentialId))
        .fetchOptional(r -> r.value1().data());
  }
}
