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

  /**
   * 작업 공간에서 프로젝트 키는 폴더·tmux 칸 이름이 되므로 이 형식만 맡는다 — 플러그인 gw_valid_project_key(gw-lib.sh)와 같은
   * 규칙(WP-1275).
   */
  private static final String WORKSPACE_KEY = "^[A-Za-z0-9_-]+$";

  private final DSLContext dsl;

  /**
   * 그 AI 가 실제 멤버(직접 멤버 또는 멤버로 둔 부서 — ADMIN 우회·OPEN 열람은 치지 않는다)이고 연결된 저장소가 있는 활성 프로젝트 — 프로젝트 키 순.
   * 프로젝트 목록 응답의 viewerRole 이 있는 프로젝트와 같은 판정이다. 키가 작업 공간 이름 형식({@link #WORKSPACE_KEY})이 아니면 뺀다 — 관리자
   * 화면과 AI 가 같은 목록을 보게 한다.
   */
  public List<AgentRuntimeProjectResponse> findMemberProjectsWithRepository(long agentUserId) {
    return dsl.select(PROJECT.KEY, PROJECT.NAME, PROJECT.REPOSITORY_URL, PROJECT.REPOSITORY_BRANCH)
        .from(PROJECT)
        .where(PROJECT.DELETED_AT.isNull())
        .and(PROJECT.REPOSITORY_URL.isNotNull())
        .and(ProjectMembership.isMemberOf(PROJECT.ID, agentUserId))
        .and(PROJECT.KEY.likeRegex(WORKSPACE_KEY))
        .orderBy(PROJECT.KEY)
        .fetch(
            r -> new AgentRuntimeProjectResponse(r.value1(), r.value2(), r.value3(), r.value4()));
  }
}
