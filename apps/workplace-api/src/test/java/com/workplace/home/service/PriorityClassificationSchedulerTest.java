package com.workplace.home.service;

import static com.workplace.jooq.Tables.AI_AGENT_CREDENTIAL;
import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import com.workplace.auth.repository.WorkspaceAssistantRepository;
import com.workplace.auth.service.AiAgentCredentialService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.home.outbound.AiAgentPriorityClient;
import com.workplace.home.outbound.dto.PriorityClassifyResult;
import com.workplace.home.repository.PriorityItemRepository;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * PriorityClassificationScheduler 통합테스트 — RLS 격리(테넌트별 GUC 주입) + 사용자 단위 실패 격리를 검증한다. ai-agent HTTP 는
 * MockitoBean 으로 대체(실제 LLM 호출 없이 결정적 결과 주입).
 *
 * <p>비-@Transactional: 스케줄러 내부 트랜잭션(TenantScopedRunner·TransactionTemplate)이 분리 커밋해야 RLS GUC 가 올바르게
 * 주입된다 — MailSummarySchedulerTest 패턴 미러. 시드 데이터는 auto-commit(세션 GUC=1) → 스케줄러가 별도 커넥션에서 읽는다.
 */
@DisplayName("PriorityClassificationScheduler 통합")
class PriorityClassificationSchedulerTest extends IntegrationTestBase {

  @Autowired private PriorityClassificationScheduler scheduler;
  @Autowired private PriorityItemRepository repo;
  @Autowired private DSLContext dsl;
  @Autowired private ProjectService projectService;
  @Autowired private IssueRepository issueRepository;
  @Autowired private IssueAssigneeRepository issueAssigneeRepository;
  @Autowired private WorkspaceAssistantRepository workspaceAssistantRepo;
  @Autowired private AiAgentCredentialService credentialService;

  @MockitoBean private AiAgentPriorityClient aiClient;

  private final long tenantId = 1L;

  private final List<Long> usersToDelete = new ArrayList<>();
  private final List<Long> projectsToDelete = new ArrayList<>();

  @BeforeEach
  void setUp() {
    // 공통 비서 + active 토큰 시드 — resolveOrEmpty(userId) 가 개인 비서 없을 때 공용으로 폴백하도록.
    long admin = TestFixtures.createHuman(dsl);
    long wsAgentId = TestFixtures.createAgentWithToken(dsl, credentialService, admin);
    workspaceAssistantRepo.upsert(wsAgentId, admin);
    usersToDelete.add(admin);
    usersToDelete.add(wsAgentId);
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(tenantId, workspaceAssistantRepo::deleteAssistant);
    cleanupInTenant(
        tenantId,
        () -> {
          for (long id : usersToDelete) {
            dsl.deleteFrom(AI_AGENT_CREDENTIAL)
                .where(AI_AGENT_CREDENTIAL.USER_ID.eq(id).or(AI_AGENT_CREDENTIAL.CREATED_BY.eq(id)))
                .execute();
          }
          for (long id : usersToDelete) {
            dsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.eq(id)).execute();
          }
          // project.owner_id FK 가 user 를 참조 — 이슈(assignee)·프로젝트를 user 보다 먼저 정리.
          for (long pid : projectsToDelete) {
            dsl.deleteFrom(ISSUE_ASSIGNEE)
                .where(
                    ISSUE_ASSIGNEE.ISSUE_ID.in(
                        dsl.select(ISSUE.ID).from(ISSUE).where(ISSUE.PROJECT_ID.eq(pid))))
                .execute();
            dsl.deleteFrom(ISSUE).where(ISSUE.PROJECT_ID.eq(pid)).execute();
            dsl.deleteFrom(PROJECT).where(PROJECT.ID.eq(pid)).execute();
          }
          // membership 은 app_tenant 에서 DELETE 가 revoke 되어 있다(V46 최소권한) — user 삭제 시
          // membership.user_id ON DELETE CASCADE 가 함께 정리하므로 별도 삭제 불필요.
          for (long id : usersToDelete) {
            dsl.deleteFrom(USER).where(USER.ID.eq(id)).execute();
          }
        });
    TenantContext.clear();
  }

  /** 후보 있는 HUMAN 사용자 1명 생성 — 테넌트 멤버십 + 개인 프로젝트 + 오늘까지 마감인(지남) 이슈 하나(assignee=본인). */
  private long seedUserWithOverdueIssue(String namePrefix) {
    long userId = TestFixtures.createHuman(dsl);
    // findByKind 는 MEMBERSHIP 을 조인해 테넌트 스코프 — createHuman 은 멤버십을 만들지 않으므로 직접 부여.
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, userId)
        .set(MEMBERSHIP.TENANT_ID, tenantId)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    // findByKind 는 USER.NAME 오름차순 정렬 — namePrefix 로 처리 순서를 결정적으로 고정한다.
    dsl.update(USER).set(USER.NAME, namePrefix + "-" + userId).where(USER.ID.eq(userId)).execute();
    String key = uniqueKey(namePrefix.toUpperCase());
    ProjectResponse proj =
        projectService.create(userId, new CreateProjectRequest(key, namePrefix + " 프로젝트", "x"));
    var issue =
        issueRepository.insert(
            proj.id(),
            1,
            namePrefix + " 마감 지난 이슈",
            null,
            "MID",
            LocalDate.now().minusDays(1),
            userId);
    issueAssigneeRepository.add(issue.id(), userId, userId);
    usersToDelete.add(userId);
    projectsToDelete.add(proj.id());
    return issue.id();
  }

  private String uniqueKey(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    String key = (prefix.length() > 4 ? prefix.substring(0, 4) : prefix) + suffix;
    return key.substring(0, Math.min(10, key.length()));
  }

  @Test
  @DisplayName("사용자 한명의 ai호출 실패가 다른 사용자 처리를 막지 않는다 — 두번째 사용자 결과가 실제로 저장된다")
  void 사용자_한명의_ai호출_실패가_다른_사용자_처리를_막지_않는다() {
    // "aaa"/"zzz" 접두어로 USER.NAME 오름차순(findByKind 정렬 기준) 처리 순서를 고정 — aaa 가 먼저, zzz 가 나중에 처리된다.
    long firstIssueId = seedUserWithOverdueIssue("aaa-first");
    long secondIssueId = seedUserWithOverdueIssue("zzz-second");

    when(aiClient.classify(any()))
        .thenThrow(new RuntimeException("첫 사용자 실패"))
        .thenReturn(
            new PriorityClassifyResult(
                List.of(
                    new PriorityClassifyResult.ScoreLine(
                        "ISSUE_DUE", String.valueOf(secondIssueId), 77, 88, "테스트 근거"))));

    scheduler.runOnce();

    // 첫 사용자(예외)는 저장 자체를 시도하지 않으므로 이전 결과(없음) 그대로 — 빈 리스트여야 한다.
    var firstUserRows = repo.findForUser(userIdOfIssue(firstIssueId));
    assertThat(firstUserRows).isEmpty();

    // 두번째 사용자는 첫 사용자의 실패에도 불구하고 AI 응답이 실제로 DB 에 영속됐어야 한다 —
    // 실패 격리가 "예외 미전파" 뿐 아니라 "다음 사용자 정상 처리"까지 보장함을 증명.
    var secondUserRows = repo.findForUser(userIdOfIssue(secondIssueId));
    assertThat(secondUserRows).hasSize(1);
    var row = secondUserRows.get(0);
    assertThat(row.sourceType()).isEqualTo("ISSUE_DUE");
    assertThat(row.sourceId()).isEqualTo(String.valueOf(secondIssueId));
    assertThat(row.importanceScore()).isEqualTo(77);
    assertThat(row.urgencyScore()).isEqualTo(88);
    assertThat(row.reason()).isEqualTo("테스트 근거");
  }

  /** 시드한 issue 의 reporter(=담당자=시드 시 지정한 userId) 를 되짚어 찾는다. */
  private long userIdOfIssue(long issueId) {
    return dsl.select(com.workplace.jooq.Tables.ISSUE.REPORTER_ID)
        .from(com.workplace.jooq.Tables.ISSUE)
        .where(com.workplace.jooq.Tables.ISSUE.ID.eq(issueId))
        .fetchOne(com.workplace.jooq.Tables.ISSUE.REPORTER_ID);
  }

  // C1 회귀 테스트 — sourceId 는 이슈/알림 두 개의 독립된 BIGSERIAL 시퀀스에서 온 원시 PK 라 단독으로는
  // 충돌한다. 같은 숫자 id 를 가진 ISSUE_DUE 후보와 MENTION 후보를 동시에 만들어, (sourceType,sourceId)
  // 복합키로만 올바르게 구분·저장되는지 검증한다. sourceId 단독 키로 되돌리면 두 결과 중 하나가 다른 하나를
  // 덮어써 이 테스트가 실패한다(TDD: 수정 전 fail, 수정 후 pass 확인됨).
  @Test
  @DisplayName("같은 숫자 sourceId 를 가진 ISSUE_DUE·MENTION 후보가 (sourceType,sourceId) 복합키로 올바르게 구분·저장된다")
  void sourceId가_소스타입간_충돌해도_복합키로_올바르게_구분된다() {
    long userId = TestFixtures.createHuman(dsl);
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, userId)
        .set(MEMBERSHIP.TENANT_ID, tenantId)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    dsl.update(USER).set(USER.NAME, "collision-" + userId).where(USER.ID.eq(userId)).execute();
    usersToDelete.add(userId);

    String key = uniqueKey("COLL");
    ProjectResponse proj =
        projectService.create(userId, new CreateProjectRequest(key, "충돌 테스트 프로젝트", "x"));
    projectsToDelete.add(proj.id());
    var issue =
        issueRepository.insert(
            proj.id(), 1, "충돌 테스트 이슈", null, "MID", LocalDate.now().minusDays(1), userId);
    issueAssigneeRepository.add(issue.id(), userId, userId);
    long issueId = issue.id();

    // MENTION 후보의 sourceId 가 ISSUE_DUE 후보(issueId)와 숫자로 정확히 같아지도록, notification.id 를
    // 명시적으로 issueId 값으로 insert(BIGSERIAL 이지만 명시적 값 지정은 시퀀스를 우회할 뿐 허용된다).
    dsl.insertInto(com.workplace.jooq.Tables.NOTIFICATION)
        .set(com.workplace.jooq.Tables.NOTIFICATION.ID, issueId)
        .set(com.workplace.jooq.Tables.NOTIFICATION.RECIPIENT_ID, userId)
        .set(com.workplace.jooq.Tables.NOTIFICATION.TYPE, "COMMENTED")
        .set(com.workplace.jooq.Tables.NOTIFICATION.ISSUE_ID, issueId)
        .execute();

    // AI 응답에 동일 sourceId 를 가진 두 소스타입 결과를 각각 다른 점수로 반환.
    when(aiClient.classify(any()))
        .thenReturn(
            new PriorityClassifyResult(
                List.of(
                    new PriorityClassifyResult.ScoreLine(
                        "ISSUE_DUE", String.valueOf(issueId), 90, 95, "마감 임박"),
                    new PriorityClassifyResult.ScoreLine(
                        "MENTION", String.valueOf(issueId), 20, 10, "낮은 우선순위 멘션"))));

    scheduler.runOnce();

    var rows = repo.findForUser(userId);
    assertThat(rows).hasSize(2);

    var issueRow =
        rows.stream().filter(r -> r.sourceType().equals("ISSUE_DUE")).findFirst().orElseThrow();
    assertThat(issueRow.sourceId()).isEqualTo(String.valueOf(issueId));
    assertThat(issueRow.importanceScore()).isEqualTo(90);
    assertThat(issueRow.urgencyScore()).isEqualTo(95);
    assertThat(issueRow.reason()).isEqualTo("마감 임박");

    var mentionRow =
        rows.stream().filter(r -> r.sourceType().equals("MENTION")).findFirst().orElseThrow();
    assertThat(mentionRow.sourceId()).isEqualTo(String.valueOf(issueId));
    assertThat(mentionRow.importanceScore()).isEqualTo(20);
    assertThat(mentionRow.urgencyScore()).isEqualTo(10);
    assertThat(mentionRow.reason()).isEqualTo("낮은 우선순위 멘션");
  }
}
