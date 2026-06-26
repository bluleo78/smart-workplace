package com.workplace.chat.service;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_WATCHER;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * chat 테스트용 데이터 setup. 각 호출마다 unique 프로젝트/이슈/사용자 4명(reporter/assignee/watcher/outsider) 생성. raw
 * USER 인서트를 제외하고 프로젝트/이슈는 production 서비스(ProjectService/IssueRepository)를 통해 만들어 system type 시드 등
 * cross-cutting 셋업 비용을 피한다.
 */
@Component
@RequiredArgsConstructor
public class ChatFixtures {

  private final DSLContext dsl;
  private final ProjectService projectService;
  private final ProjectMemberRepository memberRepository;
  private final IssueRepository issueRepository;
  private final PlatformTransactionManager txManager;

  // 이 fixture 의 시드·정리를 모두 고정 테넌트(1)에서 수행해, 비-Tx 테스트가 만든 RLS 테이블(project/issue)을
  // @AfterEach 에서 동일 테넌트 GUC 로 회수할 수 있게 한다(#512 누수 차단).
  private static final long FIXTURE_TENANT = 1L;

  // 비-Tx(커밋) 테스트가 만든 row 를 @AfterEach 에서 회수하기 위한 추적 목록.
  // issue.project_id 는 CASCADE 가 아니므로 issue(→chat_thread/message/assignee/watcher CASCADE)를
  // 먼저 지우고, project(→member/types CASCADE), 마지막에 user 순으로 삭제한다.
  // (Tx 테스트가 호출해도 롤백된 id 라 no-op)
  private final List<Long> createdProjectIds = new ArrayList<>();
  private final List<Long> createdUserIds = new ArrayList<>();

  /**
   * 비-Tx 테스트의 @AfterEach 에서 호출 — 이 fixture 가 커밋한 project/issue/user row 를 모두 삭제한다. project/issue 는
   * RLS 테이블이므로 고정 테넌트(1) GUC 가 주입된 트랜잭션 안에서 삭제해야 풀 커넥션의 잔여 GUC 에 가려지지 않는다(#512).
   */
  public void cleanupAll() {
    if (createdProjectIds.isEmpty() && createdUserIds.isEmpty()) return;
    inFixtureTenant(
        () -> {
          if (!createdProjectIds.isEmpty()) {
            dsl.deleteFrom(ISSUE).where(ISSUE.PROJECT_ID.in(createdProjectIds)).execute();
            dsl.deleteFrom(PROJECT).where(PROJECT.ID.in(createdProjectIds)).execute();
          }
          if (!createdUserIds.isEmpty()) {
            dsl.deleteFrom(USER).where(USER.ID.in(createdUserIds)).execute();
          }
          return null;
        });
    createdProjectIds.clear();
    createdUserIds.clear();
  }

  /**
   * 고정 테넌트(1) GUC 를 주입한 트랜잭션 안에서 body 실행 후 결과 반환. TenantContext 는 호출 직후 이전 값으로 복원해 ThreadLocal 누수를
   * 막는다 — 비-Tx 테스트에선 시드/정리가 tenant 1 에 일관되게 커밋되고(project/issue 가 같은 GUC 로 생성·삭제), @Transactional
   * 테스트에선 이미 시작된 tx 에 합류해 GUC 영향 없이 롤백된다.
   */
  private <T> T inFixtureTenant(java.util.function.Supplier<T> body) {
    Long prev = TenantContext.get();
    TenantContext.set(FIXTURE_TENANT);
    try {
      return new TransactionTemplate(txManager).execute(status -> body.get());
    } finally {
      if (prev == null) TenantContext.clear();
      else TenantContext.set(prev);
    }
  }

  /** 한 번의 setup 호출에 필요한 모든 row 를 만든다(고정 테넌트 1 에서 일관 시드). */
  public Setup setup() {
    return inFixtureTenant(
        () -> {
          String suffix =
              UUID.randomUUID().toString().replaceAll("-", "").substring(0, 6).toLowerCase();
          long reporter = insertUser("rep" + suffix);
          long assignee = insertUser("asg" + suffix);
          long watcher = insertUser("wat" + suffix);
          long outsider = insertUser("out" + suffix);

          String projectKey = "C" + suffix.substring(0, 4).toUpperCase();
          // reporter 를 owner 로 → 자동으로 project_member(OWNER) + system types 시드.
          ProjectResponse project =
              projectService.create(
                  reporter, new CreateProjectRequest(projectKey, "P-" + suffix, "x"));
          long projectId = project.id();
          createdProjectIds.add(projectId);

          // assignee/watcher 도 project_member 로 등록 (outsider 는 제외).
          memberRepository.insert(projectId, assignee, "MEMBER");
          memberRepository.insert(projectId, watcher, "MEMBER");

          // TASK 타입을 자동 선택하는 7-인자 오버로드 사용.
          var issueRow =
              issueRepository.insert(projectId, 1, "t-" + suffix, null, "MID", null, reporter);
          long issueId = issueRow.id();

          insertAssignee(issueId, assignee, reporter);
          insertWatcher(issueId, watcher);

          return new Setup(
              reporter, assignee, watcher, outsider, projectKey, projectId, issueId, 1);
        });
  }

  /** setup() 후 추가 AGENT 사용자를 만들어 프로젝트 멤버 (수동 추가 대신 직접 INSERT) 로 등록. */
  public AgentSetup setupWithAgent() {
    Setup base = setup();
    return inFixtureTenant(
        () -> {
          String agentUsername = "ai_" + UUID.randomUUID().toString().substring(0, 6);
          long agentId = insertAgentUser(agentUsername);
          // 프로젝트 멤버로 등록 (수동 add 시 ProjectAccessDenied 회피).
          memberRepository.insert(base.projectId(), agentId, "MEMBER");
          return new AgentSetup(base, agentId);
        });
  }

  /** USER 테이블에 최소 컬럼만 INSERT (kind/is_active 는 default). 비밀번호는 더미. */
  private long insertUser(String username) {
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, username)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, username)
            .set(USER.EMAIL, username + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    createdUserIds.add(id);
    return id;
  }

  /** insertUser 와 동일하지만 kind="AGENT" 로 등록. */
  private long insertAgentUser(String username) {
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, username)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, username)
            .set(USER.EMAIL, username + "@example.com")
            .set(USER.KIND, "AGENT")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    createdUserIds.add(id);
    return id;
  }

  private void insertAssignee(long issueId, long userId, long assignedBy) {
    dsl.insertInto(ISSUE_ASSIGNEE)
        .set(ISSUE_ASSIGNEE.ISSUE_ID, issueId)
        .set(ISSUE_ASSIGNEE.USER_ID, userId)
        .set(ISSUE_ASSIGNEE.ASSIGNED_BY, assignedBy)
        .execute();
  }

  private void insertWatcher(long issueId, long userId) {
    dsl.insertInto(ISSUE_WATCHER)
        .set(ISSUE_WATCHER.ISSUE_ID, issueId)
        .set(ISSUE_WATCHER.USER_ID, userId)
        .execute();
  }

  /** setup 결과를 테스트가 의존하는 모든 식별자 묶음으로 노출. */
  public record Setup(
      long reporterId,
      long assigneeId,
      long watcherId,
      long outsiderId,
      String projectKey,
      long projectId,
      long issueId,
      int issueNumber) {}

  /** setupWithAgent() 결과 — base setup + AGENT user id. */
  public record AgentSetup(Setup base, long agentId) {}
}
