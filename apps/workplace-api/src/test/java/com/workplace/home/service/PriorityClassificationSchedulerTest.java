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
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.auth.repository.WorkspaceAssistantRepository;
import com.workplace.auth.service.AiAgentCredentialService;
import com.workplace.global.outbound.AgentOutageGuard;
import com.workplace.global.tenant.TenantContext;
import com.workplace.home.dto.PriorityItemRow;
import com.workplace.home.exception.PriorityAiException;
import com.workplace.home.outbound.AiAgentPriorityClient;
import com.workplace.home.outbound.dto.PriorityClassifyRequest;
import com.workplace.home.outbound.dto.PriorityClassifyResult;
import com.workplace.home.repository.PriorityItemRepository;
import com.workplace.issue.dto.IssueDueWindow;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.dto.IssueStatuses;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.support.IssueSeeds;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.web.client.ResourceAccessException;

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
  @Autowired private PriorityItemQueryService queryService;
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
    // 시계를 고정한 테스트가 다음 테스트로 새지 않게 되돌린다.
    scheduler.useClock(Clock.systemUTC());
    queryService.useClock(Clock.systemUTC());
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
    var issue = insertOverdueIssue(proj.id(), 1, userId, namePrefix + " 마감 지난 이슈");
    usersToDelete.add(userId);
    projectsToDelete.add(proj.id());
    return issue.id();
  }

  /** 담당자=userId 인 마감 지난(KST 어제) 이슈 하나 — 할 일(TODO) 기본 상태. */
  private IssueRow insertOverdueIssue(long projectId, int number, long userId, String title) {
    return insertDueIssue(projectId, number, userId, title, kstToday().minusDays(1));
  }

  /** 담당자=userId 인 마감 due 이슈 하나 — 할 일(TODO) 기본 상태. */
  private IssueRow insertDueIssue(
      long projectId, int number, long userId, String title, LocalDate due) {
    var issue =
        IssueSeeds.insert(
            issueRepository, baseDsl, projectId, number, title, null, "MID", due, userId);
    issueAssigneeRepository.add(issue.id(), userId, userId);
    return issue;
  }

  /**
   * 제품 코드(IssueDueWindow)와 같은 Asia/Seoul 의 오늘 — JVM 기본 UTC 의 LocalDate.now() 는 KST 00~09시에 전날이다.
   */
  private static LocalDate kstToday() {
    return IssueDueWindow.today(Clock.systemUTC());
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

  @Test
  @DisplayName("마감 지난 이슈 중 완료·취소된 것은 ISSUE_DUE 후보가 아니다 — 열린 이슈만 AI 분류에 넘긴다(WP-1099)")
  void 마감_지난_완료_취소_이슈는_후보에서_빠진다() {
    long openIssueId = seedUserWithOverdueIssue("aaa-closed");
    long userId = userIdOfIssue(openIssueId);
    long projectId =
        dsl.select(ISSUE.PROJECT_ID)
            .from(ISSUE)
            .where(ISSUE.ID.eq(openIssueId))
            .fetchOne(ISSUE.PROJECT_ID);
    // 같은 사용자 담당의 마감 지난 이슈 두 개를 더 만들어 완료·취소로 닫는다 — 운영의 「결함 탐색 #6」(완료) 같은 경우.
    long doneIssueId = seedClosedOverdueIssue(projectId, 2, userId, IssueStatuses.DONE);
    long canceledIssueId = seedClosedOverdueIssue(projectId, 3, userId, IssueStatuses.CANCELED);

    when(aiClient.classify(any())).thenReturn(new PriorityClassifyResult(List.of()));

    scheduler.runOnce();

    // 다른 테스트가 남긴 사용자도 함께 분류되므로, 모든 호출의 ISSUE_DUE 후보를 모아 이 사용자의 이슈만 본다.
    ArgumentCaptor<PriorityClassifyRequest> captor =
        ArgumentCaptor.forClass(PriorityClassifyRequest.class);
    verify(aiClient, atLeastOnce()).classify(captor.capture());
    List<String> issueDueIds =
        captor.getAllValues().stream()
            .flatMap(r -> r.items().stream())
            .filter(c -> c.sourceType().equals("ISSUE_DUE"))
            .map(PriorityClassifyRequest.CandidateLine::sourceId)
            .toList();
    assertThat(issueDueIds)
        .contains(String.valueOf(openIssueId))
        .doesNotContain(String.valueOf(doneIssueId), String.valueOf(canceledIssueId));
  }

  @Test
  @DisplayName("멘션 없는 일반 댓글(COMMENTED) 알림은 MENTION 후보가 아니다 — 코멘트 멘션만 넘긴다(WP-1092)")
  void 일반_댓글_알림은_멘션_후보에서_빠진다() {
    long issueId = seedUserWithOverdueIssue("aaa-commented");
    long userId = userIdOfIssue(issueId);
    // 같은 이슈에 안 읽은 일반 댓글 알림(담당·구독 공통)과 코멘트 멘션 알림을 하나씩 둔다.
    long commentedId = insertNotification(userId, issueId, "COMMENTED");
    long mentionId = insertNotification(userId, issueId, "ISSUE_COMMENT_MENTION");

    when(aiClient.classify(any())).thenReturn(new PriorityClassifyResult(List.of()));

    scheduler.runOnce();

    // 다른 테스트가 남긴 사용자도 함께 분류되므로, 모든 호출의 MENTION 후보를 모아 본다(알림 id 는 전역 시퀀스라 겹치지 않는다).
    ArgumentCaptor<PriorityClassifyRequest> captor =
        ArgumentCaptor.forClass(PriorityClassifyRequest.class);
    verify(aiClient, atLeastOnce()).classify(captor.capture());
    List<String> mentionIds =
        captor.getAllValues().stream()
            .flatMap(r -> r.items().stream())
            .filter(c -> c.sourceType().equals("MENTION"))
            .map(PriorityClassifyRequest.CandidateLine::sourceId)
            .toList();
    assertThat(mentionIds)
        .contains(String.valueOf(mentionId))
        .doesNotContain(String.valueOf(commentedId));
  }

  /** 안 읽은 알림 한 건을 넣고 id 를 돌려준다. */
  private long insertNotification(long userId, long issueId, String type) {
    return dsl.insertInto(com.workplace.jooq.Tables.NOTIFICATION)
        .set(com.workplace.jooq.Tables.NOTIFICATION.RECIPIENT_ID, userId)
        .set(com.workplace.jooq.Tables.NOTIFICATION.TYPE, type)
        .set(com.workplace.jooq.Tables.NOTIFICATION.ISSUE_ID, issueId)
        .returning(com.workplace.jooq.Tables.NOTIFICATION.ID)
        .fetchOne()
        .getId();
  }

  /** 담당자=userId 인 마감 지난 이슈를 만들어 주어진 끝난 범주(DONE·CANCELED)로 닫는다. */
  private long seedClosedOverdueIssue(long projectId, int number, long userId, String status) {
    var issue = insertOverdueIssue(projectId, number, userId, status + " 마감 지난 이슈");
    IssueSeeds.updateAll(
        issueRepository,
        baseDsl,
        issue.id(),
        issue.title(),
        null,
        status,
        "MID",
        issue.dueDate(),
        null,
        null,
        Instant.now());
    return issue.id();
  }

  @Test
  @DisplayName("ai-agent 연결 불가가 연속 3회면 이번 회차를 멈춘다 — 남은 사용자에게 호출을 쌓지 않는다(WP-166)")
  void ai_agent_불가가_연속되면_회차를_중단한다() {
    for (int n = 0; n < 4; n++) {
      seedUserWithOverdueIssue("aaa-down" + n);
    }
    // 재기동 중인 ai-agent — 클라이언트가 연결 실패(ResourceAccessException)를 감싸 던지는 형태
    when(aiClient.classify(any()))
        .thenThrow(
            new PriorityAiException(
                "AI 우선순위 분류 요청에 실패했어요.", new ResourceAccessException("Connection refused")));

    scheduler.runOnce();

    // 후보가 있는 사용자는 4명 이상이지만 연속 3회에서 멈춘다. 후보 없는 사용자(다른 테스트 잔여)는 agent 를 부르지 않아 횟수에 영향이 없다.
    verify(aiClient, times(AgentOutageGuard.MAX_CONSECUTIVE_UNAVAILABLE)).classify(any());
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
        IssueSeeds.insert(
            issueRepository,
            baseDsl,
            proj.id(),
            1,
            "충돌 테스트 이슈",
            null,
            "MID",
            kstToday().minusDays(1),
            userId);
    issueAssigneeRepository.add(issue.id(), userId, userId);
    long issueId = issue.id();

    // MENTION 후보의 sourceId 가 ISSUE_DUE 후보(issueId)와 숫자로 정확히 같아지도록, notification.id 를
    // 명시적으로 issueId 값으로 insert(BIGSERIAL 이지만 명시적 값 지정은 시퀀스를 우회할 뿐 허용된다).
    dsl.insertInto(com.workplace.jooq.Tables.NOTIFICATION)
        .set(com.workplace.jooq.Tables.NOTIFICATION.ID, issueId)
        .set(com.workplace.jooq.Tables.NOTIFICATION.RECIPIENT_ID, userId)
        .set(com.workplace.jooq.Tables.NOTIFICATION.TYPE, "ISSUE_COMMENT_MENTION")
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

  @Test
  @DisplayName("끝난·지워진·담당이 빠진·마감이 미뤄진 이슈는 읽을 때 빠지고, AI 가 빈 결과를 낸 회차에도 후보에서 빠진 행은 지워진다(WP-1104)")
  void 저장된_이슈_마감_행은_읽을_때_지금_상태로_거른다() {
    long openId = seedUserWithOverdueIssue("aaa-stale");
    long userId = userIdOfIssue(openId);
    long projectId =
        dsl.select(ISSUE.PROJECT_ID)
            .from(ISSUE)
            .where(ISSUE.ID.eq(openId))
            .fetchOne(ISSUE.PROJECT_ID);
    IssueRow done = insertOverdueIssue(projectId, 2, userId, "완료할 이슈");
    IssueRow deleted = insertOverdueIssue(projectId, 3, userId, "지울 이슈");
    IssueRow unassigned = insertOverdueIssue(projectId, 4, userId, "담당에서 빠질 이슈");
    IssueRow postponed = insertOverdueIssue(projectId, 5, userId, "마감을 미룰 이슈");

    // 1회차: AI 가 받은 ISSUE_DUE 후보 모두에 점수를 준다 → 다섯 이슈가 저장된다.
    when(aiClient.classify(any()))
        .thenAnswer(
            inv -> {
              PriorityClassifyRequest req = inv.getArgument(0);
              return new PriorityClassifyResult(
                  req.items().stream()
                      .map(
                          c ->
                              new PriorityClassifyResult.ScoreLine(
                                  c.sourceType(), c.sourceId(), 70, 80, "마감 지남"))
                      .toList());
            });
    scheduler.runOnce();
    assertThat(repo.findForUser(userId)).hasSize(5);

    // 배치 뒤 이슈가 바뀐다 — 완료, 삭제, 담당 해제, 마감을 내일로.
    IssueSeeds.updateAll(
        issueRepository,
        baseDsl,
        done.id(),
        done.title(),
        null,
        IssueStatuses.DONE,
        "MID",
        done.dueDate(),
        null,
        null,
        Instant.now());
    baseDsl
        .update(ISSUE)
        .set(ISSUE.DELETED_AT, java.time.OffsetDateTime.now())
        .where(ISSUE.ID.eq(deleted.id()))
        .execute();
    baseDsl.deleteFrom(ISSUE_ASSIGNEE).where(ISSUE_ASSIGNEE.ISSUE_ID.eq(unassigned.id())).execute();
    baseDsl
        .update(ISSUE)
        .set(ISSUE.DUE_DATE, kstToday().plusDays(1))
        .where(ISSUE.ID.eq(postponed.id()))
        .execute();

    // 다음 배치 전(또는 ai-agent 장애로 배치가 멈춘 동안) — 저장된 다섯 행이 그대로지만, 읽는 쪽은 지금 상태로 걸러 열린 이슈 하나만 보인다.
    assertThat(repo.findForUser(userId)).hasSize(5);
    TenantContext.set(tenantId);
    assertThat(queryService.listForUser(userId))
        .extracting(r -> r.sourceId())
        .containsExactly(String.valueOf(openId));

    // 2회차: AI 가 빈 결과를 낸다 → 새 점수는 저장하지 않지만, 이번 후보에 없는 네 행은 지우고 열린 이슈 행은 이전 점수로 남긴다.
    // doReturn — when(classify(any())) 는 스텁을 바꾸는 중에 앞 thenAnswer 를 null 인자로 불러 터진다.
    doReturn(new PriorityClassifyResult(List.of())).when(aiClient).classify(any());
    scheduler.runOnce();
    assertThat(repo.findForUser(userId))
        .singleElement()
        .satisfies(
            r -> {
              assertThat(r.sourceId()).isEqualTo(String.valueOf(openId));
              assertThat(r.importanceScore()).isEqualTo(70);
            });
  }

  @Test
  @DisplayName("KST 이른 아침(UTC 로는 전날)에도 오늘 마감 이슈가 후보·읽기에 남는다(WP-1104 리뷰)")
  void KST_이른_아침에도_오늘_마감_이슈가_남는다() {
    // 2026-10-30 08:30 KST = 2026-10-29 23:30 UTC — JVM 기본(UTC) 날짜로는 아직 29일이다.
    Clock earlyKst = Clock.fixed(Instant.parse("2026-10-29T23:30:00Z"), ZoneId.of("UTC"));
    scheduler.useClock(earlyKst);
    queryService.useClock(earlyKst);
    long anyId = seedUserWithOverdueIssue("aaa-early");
    long userId = userIdOfIssue(anyId);
    long projectId =
        dsl.select(ISSUE.PROJECT_ID)
            .from(ISSUE)
            .where(ISSUE.ID.eq(anyId))
            .fetchOne(ISSUE.PROJECT_ID);
    IssueRow dueToday =
        insertDueIssue(projectId, 2, userId, "KST 오늘 마감", LocalDate.of(2026, 10, 30));

    // 배치 후보에 「오늘 마감」으로 들어간다.
    when(aiClient.classify(any())).thenReturn(new PriorityClassifyResult(List.of()));
    scheduler.runOnce();
    ArgumentCaptor<PriorityClassifyRequest> captor =
        ArgumentCaptor.forClass(PriorityClassifyRequest.class);
    verify(aiClient, atLeastOnce()).classify(captor.capture());
    assertThat(captor.getAllValues())
        .flatExtracting(PriorityClassifyRequest::items)
        .filteredOn(c -> c.sourceId().equals(String.valueOf(dueToday.id())))
        .singleElement()
        .satisfies(c -> assertThat(c.context()).isEqualTo("오늘 마감"));

    // 저장된 행도 읽을 때 빠지지 않는다.
    TenantContext.set(tenantId);
    repo.replaceForUser(
        userId,
        List.of(
            new PriorityItemRow(
                PriorityItemRow.ISSUE_DUE,
                String.valueOf(dueToday.id()),
                "KST 오늘 마감",
                "/x",
                50,
                50,
                "오늘")));
    assertThat(queryService.listForUser(userId))
        .extracting(r -> r.sourceId())
        .containsExactly(String.valueOf(dueToday.id()));
  }

  @Test
  @DisplayName("후보가 상한(소스당 20건)에 닿은 소스는 AI 빈 결과 회차에 후보 밖 저장 행을 지우지 않는다(WP-1104 리뷰)")
  void 상한에_닿은_소스는_정리하지_않는다() {
    long firstId = seedUserWithOverdueIssue("aaa-limit");
    long userId = userIdOfIssue(firstId);
    long projectId =
        dsl.select(ISSUE.PROJECT_ID)
            .from(ISSUE)
            .where(ISSUE.ID.eq(firstId))
            .fetchOne(ISSUE.PROJECT_ID);
    List<Long> ids = new ArrayList<>(List.of(firstId));
    // 모두 21개 — 후보는 20개로 잘리므로 하나는 이번 후보 밖이다(그래도 여전히 마감 지난 내 이슈).
    for (int n = 2; n <= 21; n++) {
      ids.add(insertOverdueIssue(projectId, n, userId, "마감 지난 이슈 " + n).id());
    }
    TenantContext.set(tenantId);
    repo.replaceForUser(
        userId,
        ids.stream()
            .map(
                id ->
                    new PriorityItemRow(
                        PriorityItemRow.ISSUE_DUE,
                        String.valueOf(id),
                        "이슈 " + id,
                        "/x",
                        50,
                        50,
                        "마감 지남"))
            .toList());
    TenantContext.clear();

    when(aiClient.classify(any())).thenReturn(new PriorityClassifyResult(List.of()));
    scheduler.runOnce();
    assertThat(repo.findForUser(userId)).hasSize(21);
  }
}
