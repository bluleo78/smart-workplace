package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.when;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.controller.IssueController;
import com.workplace.issue.dto.IssueDetailResponse;
import com.workplace.issue.outbound.AiAgentIssueClient;
import com.workplace.issue.outbound.dto.IssueSummaryResult;
import com.workplace.issue.repository.IssueAiSummaryRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;

/**
 * Task 5 통합 테스트 — 엔드포인트 오케스트레이션 + 읽기경로 aiContext 항상 반환.
 *
 * <p>컨트롤러 빈을 직접 호출해 각 @Transactional 단계가 프록시를 경유하고 GUC 가 주입됨을 실제 DB 로 검증한다. ai-agent HTTP
 * 는 @MockBean(AiAgentIssueClient), AssistantResolver 도 @MockBean 으로 스텁한다.
 */
class IssueAiSummaryEndpointTest extends IntegrationTestBase {

  @Autowired private IssueController issueController;
  @Autowired private IssueService issueService;
  @Autowired private ProjectService projectService;
  @Autowired private IssueRepository issueRepository;
  @Autowired private IssueAiSummaryRepository summaryRepo;
  @Autowired private DSLContext dsl;

  @MockBean private AiAgentIssueClient client;
  @MockBean private AssistantResolver assistantResolver;

  /** 테스트용 고정 AssistantSpec. */
  private static final AssistantSpec MOCK_SPEC =
      new AssistantSpec(999L, "claude-sonnet-4-6", "NONE", 8, 60_000);

  // ─────────────────────────────────────────────────────────────────────────
  // Case 1: 읽기 경로 — 저장본 없음 + 블로커 없음 → aiContext non-null, summary null, blockers 빈 리스트
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * 저장본 없고 블로커도 없는 신규 이슈에서 GET 의 aiContext 가 non-null 이고 summary=null, blockers=[] 인지 검증. 온디맨드 생성
   * 버튼 렌더를 위해 항상 non-null 이어야 한다.
   */
  @Test
  void get_noStoredSummaryNoblockers_aiContextAlwaysNonNull() {
    long userId = createUser("read-user");
    TenantContext.set(1L);
    long issueId = -1;
    try {
      long projectId =
          projectService
              .create(userId, new CreateProjectRequest(uniqueKey("RD"), "읽기경로테스트", "x"))
              .id();
      // 신규 TODO 이슈 — 마감 없음, 블로킹 없음, 요약 없음
      issueId = issueRepository.insert(projectId, 1, "읽기경로 이슈", null, "MID", null, userId).id();
      String projectKey = projectKeyFor(projectId);

      IssueDetailResponse detail = issueService.get(userId, projectKey, 1);

      // aiContext 는 항상 non-null
      assertThat(detail.aiContext()).isNotNull();
      // 저장본 없음 → summary null
      assertThat(detail.aiContext().summary()).isNull();
      // 신규 이슈 → 블로커 없음
      assertThat(detail.aiContext().blockers()).isEmpty();

    } finally {
      TenantContext.clear();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Case 2: POST ai-summary → 200, aiContext.summary 일치 + 이후 GET 에도 반영
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * generateAiSummary 컨트롤러 메서드: client 스텁 + agent 해석 스텁 → 200, 반환 aiContext.summary 일치. 이후 GET 에서도
   * summary 가 반영된다.
   */
  @Test
  void generateAiSummary_withStubAgent_returns200AndSummaryPersists() {
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.of(MOCK_SPEC));
    when(assistantResolver.resolveOrEmpty(anyLong())).thenReturn(Optional.of(MOCK_SPEC));
    when(client.summarizeProgress(any())).thenReturn(new IssueSummaryResult("테스트 요약", "다음 행동"));

    long userId = createUser("post-user");
    TenantContext.set(1L);
    long issueId = -1;
    try {
      long projectId =
          projectService
              .create(userId, new CreateProjectRequest(uniqueKey("PS"), "포스트테스트", "x"))
              .id();
      issueId = issueRepository.insert(projectId, 1, "포스트 이슈", "본문", "MID", null, userId).id();
      String projectKey = projectKeyFor(projectId);
      Authentication auth = new UsernamePasswordAuthenticationToken(userId, null, List.of());

      // POST 호출 — 컨트롤러 직접 호출(프록시 경유 @Transactional 보장)
      var resp = issueController.generateAiSummary(auth, projectKey, 1);

      assertThat(resp.getStatusCode().value()).isEqualTo(200);
      assertThat(resp.getBody()).isNotNull();
      assertThat(resp.getBody().summary()).isEqualTo("테스트 요약");
      assertThat(resp.getBody().nextAction()).isEqualTo("다음 행동");

      // 이후 GET 에도 반영
      IssueDetailResponse detail = issueService.get(userId, projectKey, 1);
      assertThat(detail.aiContext().summary()).isEqualTo("테스트 요약");

    } finally {
      if (issueId != -1) {
        long fid = issueId;
        cleanupInTenant(1L, () -> summaryRepo.deleteByIssue(fid));
      }
      TenantContext.clear();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Case 3: 멤버 아닌 사용자 → ProjectAccessDeniedException(403 매핑) 전파
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * 멤버가 아닌 사용자로 generateAiSummary 호출 시 ProjectAccessDeniedException 이 전파됨을 검증.
   * (컨트롤러 @RequirePermission + 서비스 accessGuard.assertMember 둘 다 가드.)
   */
  @Test
  void generateAiSummary_nonMember_throwsAccessDenied() {
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.of(MOCK_SPEC));
    when(assistantResolver.resolveOrEmpty(anyLong())).thenReturn(Optional.of(MOCK_SPEC));

    long ownerId = createUser("owner-nm");
    long nonMemberId = createUser("nonmember");
    TenantContext.set(1L);
    try {
      long projectId =
          projectService
              .create(ownerId, new CreateProjectRequest(uniqueKey("NM"), "비멤버테스트", "x"))
              .id();
      issueRepository.insert(projectId, 1, "비멤버 이슈", null, "MID", null, ownerId);
      String projectKey = projectKeyFor(projectId);
      Authentication auth = new UsernamePasswordAuthenticationToken(nonMemberId, null, List.of());

      org.junit.jupiter.api.Assertions.assertThrows(
          com.workplace.project.exception.ProjectAccessDeniedException.class,
          () -> issueController.generateAiSummary(auth, projectKey, 1));

    } finally {
      TenantContext.clear();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 헬퍼
  // ─────────────────────────────────────────────────────────────────────────

  /** 테스트용 사용자 시드. */
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

  /** 프로젝트 key 충돌 방지용 고유 키. */
  private String uniqueKey(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    String key = prefix + suffix;
    return key.substring(0, Math.min(10, key.length()));
  }

  /** projectId 로 프로젝트 key 조회 — IssueService.get 호출 시 필요. */
  private String projectKeyFor(long projectId) {
    return dsl.select(com.workplace.jooq.Tables.PROJECT.KEY)
        .from(com.workplace.jooq.Tables.PROJECT)
        .where(com.workplace.jooq.Tables.PROJECT.ID.eq(projectId))
        .fetchOne(com.workplace.jooq.Tables.PROJECT.KEY);
  }
}
