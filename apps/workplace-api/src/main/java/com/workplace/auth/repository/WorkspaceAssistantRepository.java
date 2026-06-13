package com.workplace.auth.repository;

import static com.workplace.jooq.Tables.WORKSPACE_ASSISTANT;

import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** 공용 비서(테넌트당 1행) 지정 저장/조회. */
@Repository
@RequiredArgsConstructor
public class WorkspaceAssistantRepository {

  private final DSLContext dsl;

  /**
   * 공용 비서로 지정된 AGENT user id. 미지정이면 empty.
   *
   * <p>V65 에서 workspace_assistant 가 싱글톤(id=1) → 테넌트당 1행(PK=tenant_id)으로 전환되었으므로, RLS 가 현재 테넌트의 단일
   * 행만 반환한다. 따라서 더 이상 {@code WHERE id=1} 로 필터하지 않는다.
   */
  public Optional<Long> findAgentId() {
    return dsl.select(WORKSPACE_ASSISTANT.AGENT_USER_ID)
        .from(WORKSPACE_ASSISTANT)
        .fetchOptional(WORKSPACE_ASSISTANT.AGENT_USER_ID);
  }

  /**
   * 테넌트당 1행 upsert — 충돌 대상은 tenant_id.
   *
   * <p>raw SQL 인 이유: 충돌 대상이 새 PK 인 tenant_id 인데, baseline 생성 jOOQ 에는 WORKSPACE_ASSISTANT.TENANT_ID
   * 필드가 없어(재생성 회피) 참조할 수 없다. tenant_id 는 컬럼 GUC-DEFAULT 로 채워지므로 INSERT 컬럼 목록에서 생략한다. id 는 DEFAULT 1
   * 로 채워지며(싱글톤 잔재), tenant_id 가 PK 이므로 무해하다.
   */
  public void upsert(long agentUserId, long updatedBy) {
    dsl.execute(
        "INSERT INTO workspace_assistant (agent_user_id, updated_by, updated_at)"
            + " VALUES (?, ?, now())"
            + " ON CONFLICT (tenant_id) DO UPDATE SET"
            + " agent_user_id = excluded.agent_user_id,"
            + " updated_by = excluded.updated_by,"
            + " updated_at = now()",
        agentUserId,
        updatedBy);
  }
}
