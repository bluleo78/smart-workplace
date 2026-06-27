package com.workplace.issue.outbound;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.outbound.dto.IssueSummaryResult;
import com.workplace.issue.repository.IssueAiSummaryRepository;
import com.workplace.issue.repository.IssueCommentRepository;
import com.workplace.issue.repository.IssueHistoryRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.mock.mockito.MockBean;

/**
 * 이벤트 기반 요약 생성 검증. ai-agent 클라이언트는 목. @Transactional 미사용 — 비동기 경로의 실제 GUC 주입 검증을 위해 cleanupInTenant
 * 로 정리. IssueAiSummaryRepositoryTest 패턴을 미러: TenantContext.set(1L)을 테스트 전 over에 걸쳐 유지하고 finally 에서
 * clear.
 */
class IssueAiSummaryServiceTest extends IntegrationTestBase {

  @Autowired private IssueAiSummaryService service;
  @Autowired private IssueAiSummaryRepository summaryRepo;
  @Autowired private IssueCommentRepository commentRepo;
  @Autowired private IssueHistoryRepository historyRepo;
  @Autowired private IssueRepository issueRepo;
  @Autowired private ProjectService projectService;
  @Autowired private DSLContext dsl;

  @MockBean private AiAgentIssueClient client;

  // ── 게이트 통과: 코멘트 2개 → 요약 저장 ──────────────────────────────────────────

  /**
   * 코멘트가 2개(활동 게이트 MIN_ACTIVITY=2 통과)인 이슈에 대해 regenerate 를 호출하면 AI 요약이 저장되어야 한다.
   *
   * <p>TenantContext.set(1L) 을 테스트 전반에 유지: regenerate 내부의 TransactionTemplate 이 GUC 를 주입하고, find 도
   * 같은 컨텍스트에서 실행되어야 RLS 가 행을 숨기지 않는다.
   */
  @Test
  void regenerate_whenActivityMeetsGate_storesSummary() {
    when(client.summarizeProgress(any())).thenReturn(new IssueSummaryResult("리뷰 대기 중", "리뷰어 지정"));

    long userId = createUser("svc-gate-pass");
    TenantContext.set(1L); // tenant#1 (test DB 시드 테넌트)
    long issueId = -1;
    try {
      long projectId =
          projectService
              .create(userId, new CreateProjectRequest(uniqueKey("GP"), "게이트통과", "x"))
              .id();
      // 이슈 생성 — status 는 기본 TODO
      issueId = issueRepo.insert(projectId, 1, "테스트 이슈", null, "MID", null, userId).id();
      // 코멘트 2개 추가(활동 게이트 MIN_ACTIVITY=2 충족)
      commentRepo.insert(issueId, userId, "첫 번째 코멘트");
      commentRepo.insert(issueId, userId, "두 번째 코멘트");

      // regenerate 직접 호출(프로덕션에서는 AFTER_COMMIT 워커가 TenantContext 전파 후 호출)
      service.regenerate(issueId);

      // TenantContext 가 살아있는 상태에서 find — RLS 가 행을 보여야 한다
      var found = summaryRepo.find(issueId);
      assertThat(found).isPresent();
      assertThat(found.get().summary()).isEqualTo("리뷰 대기 중");
    } finally {
      // 공유 test DB(5435) 누수 방지 — RLS-안전 정리
      if (issueId != -1) {
        long finalIssueId = issueId;
        cleanupInTenant(1L, () -> summaryRepo.deleteByIssue(finalIssueId));
      }
      TenantContext.clear();
    }
  }

  // ── 게이트 미달: 활동 없음 → 요약 생략 ────────────────────────────────────────────

  /** 코멘트/히스토리가 없는(MIN_ACTIVITY 미달) 이슈는 ai-agent 호출 없이 요약 저장을 건너뛰어야 한다. */
  @Test
  void regenerate_whenActivityBelowGate_skips() {
    long userId = createUser("svc-gate-fail");
    TenantContext.set(1L);
    long issueId = -1;
    try {
      long projectId =
          projectService
              .create(userId, new CreateProjectRequest(uniqueKey("GF"), "게이트미달", "x"))
              .id();
      issueId = issueRepo.insert(projectId, 1, "활동없는 이슈", null, "MID", null, userId).id();
      // 코멘트/히스토리 없음 → 활동 0건 < MIN_ACTIVITY(2)

      service.regenerate(issueId);

      assertThat(summaryRepo.find(issueId)).isEmpty();
    } finally {
      TenantContext.clear();
    }
  }

  // ── 빈 가드: 빈 요약 → 저장 생략 ──────────────────────────────────────────────────

  /** ai-agent 가 공백 summary 를 반환하면 issue_ai_summary 에 저장되지 않아야 한다(쓰레기 캐싱 방지). */
  @Test
  void regenerate_whenEmptySummary_doesNotStore() {
    when(client.summarizeProgress(any())).thenReturn(new IssueSummaryResult("  ", ""));

    long userId = createUser("svc-empty");
    TenantContext.set(1L);
    long issueId = -1;
    try {
      long projectId =
          projectService.create(userId, new CreateProjectRequest(uniqueKey("ES"), "빈요약", "x")).id();
      issueId = issueRepo.insert(projectId, 1, "빈요약 이슈", null, "MID", null, userId).id();
      // 게이트 통과를 위해 코멘트 2개 추가
      commentRepo.insert(issueId, userId, "코멘트1");
      commentRepo.insert(issueId, userId, "코멘트2");

      service.regenerate(issueId);

      // 빈 가드 — 저장 없음
      assertThat(summaryRepo.find(issueId)).isEmpty();
    } finally {
      TenantContext.clear();
    }
  }

  // ── 헬퍼 ────────────────────────────────────────────────────────────────────────

  /** 테스트용 USER 직접 삽입 (IssueAiSummaryRepositoryTest 동일 패턴). */
  private long createUser(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    return id;
  }

  /** 프로젝트 key 충돌 방지용 고유 키 생성. */
  private String uniqueKey(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    String key = prefix + suffix;
    return key.substring(0, Math.min(10, key.length()));
  }
}
