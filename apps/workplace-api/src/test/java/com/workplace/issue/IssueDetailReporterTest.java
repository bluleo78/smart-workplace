package com.workplace.issue;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.service.IssueService;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-272: IssueService.get() 이 보고자(이슈를 만든 사람)를 UserSummary 로 내려주는지 검증.
 *
 * <p>상세 화면의 속성 레일·모바일 속성 시트가 reporterId 숫자만으로는 이름을 그릴 수 없어, 상세 응답에 이름·종류까지 싣는다. AI(AGENT)가 MCP 로 만든
 * 이슈는 kind=AGENT 로 내려가 프론트가 AI 배지를 붙일 수 있어야 한다.
 */
@Transactional
class IssueDetailReporterTest extends IntegrationTestBase {

  @Autowired private IssueService issueService;
  @Autowired private IssueRepository issueRepository;
  @Autowired private ProjectService projectService;

  /** 사람이 만든 이슈 — reporter 의 id/username/name/kind(HUMAN) 가 채워진다. */
  @Test
  void get_includesHumanReporter() {
    long userId = createUser("rep-h", "HUMAN");
    TenantContext.set(1L);
    String projKey = uniqueKey("REPH");
    long projectId =
        projectService.create(userId, new CreateProjectRequest(projKey, "Reporter H", "x")).id();
    issueRepository.insert(projectId, 1, "사람이 만든 이슈", null, "MID", null, userId);

    var detail = issueService.get(userId, projKey, 1);

    assertThat(detail.reporter()).isNotNull();
    assertThat(detail.reporter().id()).isEqualTo(userId);
    assertThat(detail.reporter().name()).isEqualTo("rep-h");
    assertThat(detail.reporter().username()).startsWith("rep-h-");
    assertThat(detail.reporter().kind()).isEqualTo("HUMAN");
  }

  /** AI(AGENT) 가 만든 이슈 — 조회자와 다른 보고자라도 kind=AGENT 로 내려간다. */
  @Test
  void get_includesAgentReporter() {
    long viewerId = createUser("rep-v", "HUMAN");
    long agentId = createUser("rep-ai", "AGENT");
    TenantContext.set(1L);
    String projKey = uniqueKey("REPA");
    long projectId =
        projectService.create(viewerId, new CreateProjectRequest(projKey, "Reporter A", "x")).id();
    issueRepository.insert(projectId, 1, "AI 가 만든 이슈", null, "MID", null, agentId);

    var detail = issueService.get(viewerId, projKey, 1);

    assertThat(detail.reporter()).isNotNull();
    assertThat(detail.reporter().id()).isEqualTo(agentId);
    assertThat(detail.reporter().name()).isEqualTo("rep-ai");
    assertThat(detail.reporter().kind()).isEqualTo("AGENT");
  }

  // ── 헬퍼 ────────────────────────────────────────────────────────────────────────

  /** 테스트용 USER(kind 지정) + USER_ROLE("USER") 직접 삽입. */
  private long createUser(String prefix, String kind) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        baseDsl
            .insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .set(USER.KIND, kind)
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = baseDsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    baseDsl
        .insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, id)
        .set(USER_ROLE.ROLE_ID, roleId)
        .execute();
    return id;
  }

  /** 프로젝트 key 충돌 방지용 고유 키 생성. */
  private String uniqueKey(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    String key = prefix + suffix;
    return key.substring(0, Math.min(10, key.length()));
  }
}
