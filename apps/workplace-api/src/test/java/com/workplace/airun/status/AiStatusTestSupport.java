package com.workplace.airun.status;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.AGENT_WORK_EVENT;
import static com.workplace.jooq.Tables.AI_RUN;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.support.WebSessionAuth;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * WP-1831 AI 현황 통합 테스트 공용 기반 — 개요·처리 이력 테스트가 각각 복사해 쓰던 시드(관리자·일반 멤버)·테넌트 1 잔여 행 정리·관리자 GET 요청 도구를 한
 * 곳에 둔다. ai_run·위임 작업을 만드는 시드 생성기는 두 테스트가 서로 다르므로 각 클래스에 남는다.
 */
abstract class AiStatusTestSupport extends IntegrationTestBase {

  @Autowired protected MockMvc mvc;
  @Autowired protected ProjectService projectService;
  @Autowired protected IssueRepository issueRepository;

  /** 매 테스트의 기준 시각 — 모든 시드가 이 값 기준 상대 시각이라야 집계 구간이 흔들리지 않는다. */
  protected Instant now;

  protected long admin;
  protected long member;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    clearTenantData();
    now = Instant.now().truncatedTo(ChronoUnit.MILLIS);
    admin = TestFixtures.activeMemberOfCurrentTenant(baseDsl, TestFixtures.createHuman(baseDsl));
    TestFixtures.grantRole(baseDsl, admin, "ADMIN");
    member = TestFixtures.activeMemberOfCurrentTenant(baseDsl, TestFixtures.createHuman(baseDsl));
  }

  /**
   * 테넌트 1 에 다른 테스트가 커밋해 둔 AI 처리·용량 표본·위임 작업 행을 이 테스트 트랜잭션 안에서 지운다 — 집계가 남의 행에 흔들리지 않게. 테스트 트랜잭션이
   * 롤백되므로 지운 행은 테스트가 끝나면 그대로 돌아온다.
   */
  protected void clearTenantData() {
    useTenant(1L);
    baseDsl.deleteFrom(AI_RUN).where(AI_RUN.TENANT_ID.eq(1L)).execute();
    baseDsl.execute("DELETE FROM ai_capacity_sample WHERE tenant_id = 1");
    baseDsl.deleteFrom(AGENT_WORK_EVENT).where(AGENT_WORK_EVENT.TENANT_ID.eq(1L)).execute();
    baseDsl.deleteFrom(AGENT_WORK).where(AGENT_WORK.TENANT_ID.eq(1L)).execute();
  }

  /** 관리자로 GET — 파라미터는 (이름, 값) 쌍을 이어서 준다. */
  protected MockHttpServletRequestBuilder req(String path, String... nameValues) {
    MockHttpServletRequestBuilder b =
        get(path).with(authentication(WebSessionAuth.of(admin, List.of())));
    for (int i = 0; i < nameValues.length; i += 2) {
      b.param(nameValues[i], nameValues[i + 1]);
    }
    return b;
  }

  protected static OffsetDateTime utc(Instant t) {
    return t.atOffset(ZoneOffset.UTC);
  }

  /** agent_work_event 한 건 — 위임 작업 시드가 배정·실제 시작·종료 시각을 잇달아 기록할 때 쓴다. */
  protected void event(long workId, String state, Instant at) {
    baseDsl
        .insertInto(AGENT_WORK_EVENT)
        .set(AGENT_WORK_EVENT.TENANT_ID, 1L)
        .set(AGENT_WORK_EVENT.WORK_ID, workId)
        .set(AGENT_WORK_EVENT.STATE, state)
        .set(AGENT_WORK_EVENT.CREATED_AT, utc(at))
        .execute();
  }
}
