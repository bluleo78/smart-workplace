package com.workplace.agentruntime.repository;

import static com.workplace.jooq.Tables.PROJECT;

import com.workplace.agentruntime.dto.AgentRuntimeProjectResponse;
import com.workplace.global.share.ProjectMembership;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/**
 * AI 가 작업 공간에서 맡을 프로젝트 조회(WP-1255). 프로젝트 도메인 패키지를 import 하지 않고(도메인 간 직접 의존 금지) 공용 멤버십 규칙({@link
 * ProjectMembership})으로 project 테이블을 직접 읽는다. 테넌트 격리는 RLS 로 보장된다.
 */
@Repository
@RequiredArgsConstructor
public class AgentRuntimeProjectRepository {

  private final DSLContext dsl;

  /**
   * 그 AI 가 실제 멤버(직접 멤버 또는 멤버로 둔 부서 — ADMIN 우회·OPEN 열람은 치지 않는다)이고 연결된 저장소가 있는 활성 프로젝트 — 프로젝트 키 순.
   * 프로젝트 목록 응답의 viewerRole 이 있는 프로젝트와 같은 판정이다.
   */
  public List<AgentRuntimeProjectResponse> findMemberProjectsWithRepository(long agentUserId) {
    return dsl.select(PROJECT.KEY, PROJECT.NAME, PROJECT.REPOSITORY_URL, PROJECT.REPOSITORY_BRANCH)
        .from(PROJECT)
        .where(PROJECT.DELETED_AT.isNull())
        .and(PROJECT.REPOSITORY_URL.isNotNull())
        .and(ProjectMembership.isMemberOf(PROJECT.ID, agentUserId))
        .orderBy(PROJECT.KEY)
        .fetch(
            r -> new AgentRuntimeProjectResponse(r.value1(), r.value2(), r.value3(), r.value4()));
  }
}
