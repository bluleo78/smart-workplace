package com.workplace.action;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * ConfirmActionDispatcher 의 issue.create actionType 통합 테스트 — 노트→이슈 cross-app 실행기. 멤버 유저가 이슈를 생성할 수
 * 있고, 비멤버는 거부되는지 검증한다.
 */
@Transactional
class ConfirmActionDispatcherIssueCreateTest extends IntegrationTestBase {

  @Autowired ConfirmActionDispatcher dispatcher;
  @Autowired ObjectMapper objectMapper;
  @Autowired ProjectService projectService;
  @Autowired DSLContext dsl;

  private long ownerId;
  private long outsiderId;
  private String projectKey;

  @BeforeEach
  void setUp() {
    TenantContext.set(1L);
    // 프로젝트 소유자 + 외부인(비멤버) 시드
    ownerId = seedHumanUser("issue_dispatch_owner");
    outsiderId = seedHumanUser("issue_dispatch_outsider");

    // 팀 프로젝트 생성 — owner 가 자동으로 OWNER 멤버로 등록됨
    projectKey = uniqueKey("ID");
    projectService.create(ownerId, new CreateProjectRequest(projectKey, "IssueDispatch 테스트", null));
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  /**
   * HUMAN 유저를 생성하고 USER 시스템 역할을 부여한다. calendar:write 등의 기본 권한 세트 포함.
   *
   * <p>기존 ConfirmActionDispatcherTest.seedHumanUser 와 동일 패턴.
   */
  private long seedHumanUser(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "_" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "_" + suffix + "@example.com")
            .set(USER.KIND, "HUMAN")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    return id;
  }

  /** 유니크 프로젝트 키 생성 (대문자 알파벳+숫자, 2~10자). */
  private String uniqueKey(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    return (prefix + suffix).substring(0, Math.min(10, (prefix + suffix).length()));
  }

  /**
   * [정상] 프로젝트 멤버(owner)가 issue.create confirm 을 실행하면 이슈가 생성된다. projectKey 는 params 에서 별도 추출되고, 나머지
   * 필드(title/body/priority)는 CreateIssueRequest 로 매핑된다.
   */
  @Test
  void issueCreate_memberUser_createsIssue() {
    ObjectNode params = objectMapper.createObjectNode();
    params.put("projectKey", projectKey);
    params.put("title", "노트에서 만든 작업");
    params.put("body", "본문 내용");
    params.put("priority", "HIGH");

    Object result = dispatcher.confirm(ownerId, "issue.create", params);

    assertThat(result).isInstanceOf(IssueResponse.class);
    IssueResponse issue = (IssueResponse) result;
    assertThat(issue.title()).isEqualTo("노트에서 만든 작업");
    assertThat(issue.projectKey()).isEqualTo(projectKey);
    assertThat(issue.id()).isNotNull();
  }

  /**
   * [거부] 프로젝트 비멤버가 issue.create confirm 을 실행하면 RuntimeException(ProjectAccessDeniedException 계열)이
   * 발생한다. IssueService.create 내부의 assertMember 가 비멤버를 차단한다.
   */
  @Test
  void issueCreate_nonMember_isDenied() {
    ObjectNode params = objectMapper.createObjectNode();
    params.put("projectKey", projectKey);
    params.put("title", "권한없는 시도");

    assertThatThrownBy(() -> dispatcher.confirm(outsiderId, "issue.create", params))
        .isInstanceOf(RuntimeException.class);
  }
}
