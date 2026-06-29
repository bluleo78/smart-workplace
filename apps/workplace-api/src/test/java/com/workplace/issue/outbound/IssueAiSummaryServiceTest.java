package com.workplace.issue.outbound;

import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.issue.exception.IssueAiAssistantUnavailableException;
import com.workplace.issue.exception.IssueAiException;
import com.workplace.issue.outbound.dto.IssueSummaryRequest;
import com.workplace.issue.outbound.dto.IssueSummaryResult;
import com.workplace.issue.repository.IssueAiSummaryRepository;
import com.workplace.issue.repository.IssueCommentRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.Optional;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * IssueAiSummaryService 통합 테스트. ai-agent 클라이언트·AssistantResolver 는 목 사용. 비-@Transactional — GUC 주입
 * 경로의 실제 동작을 cleanupInTenant 로 검증. 기존 서비스가 write-time 자동 생성에서 온디맨드(버튼) 생성으로 변경된 것을 검증한다.
 */
class IssueAiSummaryServiceTest extends IntegrationTestBase {

  @Autowired private IssueAiSummaryService service;
  @Autowired private IssueAiSummaryRepository summaryRepo;
  @Autowired private IssueCommentRepository commentRepo;
  @Autowired private IssueRepository issueRepo;
  @Autowired private ProjectService projectService;
  @Autowired private DSLContext dsl;

  @MockBean private AiAgentIssueClient client;
  @MockBean private AssistantResolver assistantResolver;
  /**
   * MailSummaryScheduler 가 @Scheduled(fixedRate=600_000) 로 TenantScopedRunner.forEachActiveTenant
   * 콜백 안에서 resolveWorkspaceOrEmpty() 를 호출해 verify 카운트를 오염시킨다. TenantScopedRunner 를 목으로 교체하면
   * 콜백 자체가 실행되지 않아 오염이 원천 차단된다.
   */
  @MockBean private TenantScopedRunner tenantScopedRunner;

  /** 테스트용 고정 AssistantSpec — agentUserId=999. */
  private static final AssistantSpec MOCK_SPEC =
      new AssistantSpec(999L, "claude-sonnet-4-6", "NONE", 8, 60_000);

  @BeforeEach
  void stubAssistant() {
    // 기본: 비서 있음. 케이스별로 empty 로 덮어쓴다.
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.of(MOCK_SPEC));
    when(assistantResolver.resolveOrEmpty(any(Long.class))).thenReturn(Optional.of(MOCK_SPEC));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Case 1: generateOnDemand — TEAM 프로젝트, 코멘트 2개 → 저장 + request 캡처
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * generateOnDemand: TEAM 프로젝트 이슈, 코멘트 2개. client 에 전달된 요청에 body·chat·assistantAgentId 가 채워졌는지
   * ArgumentCaptor 로 검증.
   */
  @Test
  void generateOnDemand_teamProject_storesSummaryAndCapturesRequest() {
    when(client.summarizeProgress(any())).thenReturn(new IssueSummaryResult("리뷰 대기 중", "리뷰어 지정"));

    long userId = createUser("case1-user");
    TenantContext.set(1L);
    long issueId = -1;
    try {
      // TEAM 타입 프로젝트 생성(기본값)
      long projectId =
          projectService
              .create(userId, new CreateProjectRequest(uniqueKey("C1T"), "케이스1팀", "x"))
              .id();
      issueId = issueRepo.insert(projectId, 1, "테스트 이슈", "이슈 본문 내용입니다.", "MID", null, userId).id();
      commentRepo.insert(issueId, userId, "첫 번째 코멘트");
      commentRepo.insert(issueId, userId, "두 번째 코멘트");

      // 온디맨드 생성 호출
      service.generateOnDemand(issueId);

      // 요약 저장 검증
      var found = summaryRepo.find(issueId);
      assertThat(found).isPresent();
      assertThat(found.get().summary()).isEqualTo("리뷰 대기 중");

      // ArgumentCaptor — request 의 body·assistantAgentId 검증
      ArgumentCaptor<IssueSummaryRequest> captor =
          ArgumentCaptor.forClass(IssueSummaryRequest.class);
      verify(client).summarizeProgress(captor.capture());
      IssueSummaryRequest req = captor.getValue();
      assertThat(req.body()).isEqualTo("이슈 본문 내용입니다.");
      assertThat(req.assistantAgentId()).isEqualTo(999L);
      // chat 은 IssueChatExcerptReader 가 실 빈이라 스레드 없으면 빈 리스트
      assertThat(req.chat()).isNotNull();

      // TEAM 프로젝트 → 공용 비서 해석만 사용(개인 비서 resolver 미사용) — 분기 회귀 가드
      verify(assistantResolver).resolveWorkspaceOrEmpty();
      verify(assistantResolver, never()).resolveOrEmpty(anyLong());

    } finally {
      if (issueId != -1) {
        long fid = issueId;
        cleanupInTenant(1L, () -> summaryRepo.deleteByIssue(fid));
      }
      TenantContext.clear();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Case 1b: generateOnDemand — PERSONAL 프로젝트 → 소유자 개인 비서 resolver 사용(공용 미사용)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * PERSONAL 프로젝트는 소유자 개인 비서 resolver(resolveOrEmpty(ownerId))로 해석하고 공용 resolver 는 쓰지 않는다. 분기
   * 스왑/ownerId↔callerId 혼동 회귀 가드(spec 의 "caller 기반 아님" 불변식 검증).
   */
  @Test
  void generateOnDemand_personalProject_usesOwnerResolverNotWorkspace() {
    when(client.summarizeProgress(any())).thenReturn(new IssueSummaryResult("개인 요약", "액션"));

    long ownerId = createUser("case1b-owner");
    TenantContext.set(1L);
    long issueId = -1;
    try {
      long projectId =
          projectService
              .create(ownerId, new CreateProjectRequest(uniqueKey("C1P"), "케이스1b개인", "x"))
              .id();
      // 기본 생성은 TEAM → PERSONAL 로 전환(소유자 명시).
      dsl.update(PROJECT)
          .set(PROJECT.TYPE, "PERSONAL")
          .set(PROJECT.OWNER_ID, ownerId)
          .where(PROJECT.ID.eq(projectId))
          .execute();
      issueId = issueRepo.insert(projectId, 1, "개인 이슈", "본문", "MID", null, ownerId).id();

      service.generateOnDemand(issueId);

      assertThat(summaryRepo.find(issueId)).isPresent();
      // PERSONAL → 소유자(ownerId) 개인 비서 resolver 만 사용, 공용 resolver 미사용
      verify(assistantResolver).resolveOrEmpty(ownerId);
      verify(assistantResolver, never()).resolveWorkspaceOrEmpty();
    } finally {
      if (issueId != -1) {
        long fid = issueId;
        cleanupInTenant(1L, () -> summaryRepo.deleteByIssue(fid));
      }
      TenantContext.clear();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Case 2: generateOnDemand — 활동 0(코멘트·히스토리 없음)이라도 생성됨(활동 게이트 제거)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * 코멘트/히스토리 없어도 온디맨드 생성은 body 만으로도 요약을 생성한다(활동 게이트 없음). 또한 본문이 null 인 이슈는 ai-agent 요청에 body="" 로
   * 변환되어야 한다(zod string 이 null 거부(400)하지 않도록 — 라이브에서 잡힌 회귀).
   */
  @Test
  void generateOnDemand_noActivity_stillGenerates() {
    when(client.summarizeProgress(any())).thenReturn(new IssueSummaryResult("빠른 생성", "대기"));

    long userId = createUser("case2-user");
    TenantContext.set(1L);
    long issueId = -1;
    try {
      long projectId =
          projectService
              .create(userId, new CreateProjectRequest(uniqueKey("C2N"), "케이스2무활동", "x"))
              .id();
      // body=null 이슈
      issueId = issueRepo.insert(projectId, 1, "활동없는 이슈", null, "MID", null, userId).id();
      // 코멘트·히스토리 없음

      service.generateOnDemand(issueId);

      assertThat(summaryRepo.find(issueId)).isPresent();
      // null 본문 → 요청 body 는 빈 문자열(널 아님)
      ArgumentCaptor<IssueSummaryRequest> captor =
          ArgumentCaptor.forClass(IssueSummaryRequest.class);
      verify(client).summarizeProgress(captor.capture());
      assertThat(captor.getValue().body()).isEqualTo("");
    } finally {
      if (issueId != -1) {
        long fid = issueId;
        cleanupInTenant(1L, () -> summaryRepo.deleteByIssue(fid));
      }
      TenantContext.clear();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Case 3: regenerate — 저장본 없음 → client 호출 0, 저장 없음
  // ─────────────────────────────────────────────────────────────────────────

  /** regenerate: 저장본 없는 이슈(미-opt-in) → ai-agent 호출 없이 조기 반환. */
  @Test
  void regenerate_noStoredSummary_skipsClientCall() {
    long userId = createUser("case3-user");
    TenantContext.set(1L);
    long issueId = -1;
    try {
      long projectId =
          projectService
              .create(userId, new CreateProjectRequest(uniqueKey("C3R"), "케이스3미옵인", "x"))
              .id();
      issueId = issueRepo.insert(projectId, 1, "미옵인 이슈", null, "MID", null, userId).id();

      service.regenerate(issueId);

      // client 호출 없어야
      verify(client, never()).summarizeProgress(any());
      assertThat(summaryRepo.find(issueId)).isEmpty();
    } finally {
      TenantContext.clear();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Case 4: regenerate — 저장본 있음 + 코멘트 추가 → 재생성되어 summary 갱신
  // ─────────────────────────────────────────────────────────────────────────

  /** regenerate: 저장본 있는 이슈에 코멘트가 추가됐을 때 요약이 갱신된다. */
  @Test
  void regenerate_storedSummaryExists_updatesOnRegenerate() {
    when(client.summarizeProgress(any()))
        .thenReturn(new IssueSummaryResult("첫 요약", "첫 액션"))
        .thenReturn(new IssueSummaryResult("갱신된 요약", "갱신된 액션"));

    long userId = createUser("case4-user");
    TenantContext.set(1L);
    long issueId = -1;
    try {
      long projectId =
          projectService
              .create(userId, new CreateProjectRequest(uniqueKey("C4U"), "케이스4갱신", "x"))
              .id();
      issueId = issueRepo.insert(projectId, 1, "갱신 이슈", null, "MID", null, userId).id();

      // 1차 온디맨드 생성(저장본 만들기)
      service.generateOnDemand(issueId);
      assertThat(summaryRepo.find(issueId).get().summary()).isEqualTo("첫 요약");

      // 코멘트 추가 후 자동 갱신
      commentRepo.insert(issueId, userId, "새 코멘트");
      service.regenerate(issueId);

      assertThat(summaryRepo.find(issueId).get().summary()).isEqualTo("갱신된 요약");
    } finally {
      if (issueId != -1) {
        long fid = issueId;
        cleanupInTenant(1L, () -> summaryRepo.deleteByIssue(fid));
      }
      TenantContext.clear();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Case 5: agent 없음 → generateOnDemand 예외, regenerate 조용히 skip
  // ─────────────────────────────────────────────────────────────────────────

  /** agent 없음 → generateOnDemand 는 IssueAiAssistantUnavailableException 으로 전파. */
  @Test
  void generateOnDemand_noAgent_throwsUnavailableException() {
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.empty());
    when(assistantResolver.resolveOrEmpty(any(Long.class))).thenReturn(Optional.empty());

    long userId = createUser("case5a-user");
    TenantContext.set(1L);
    long issueId = -1;
    try {
      long projectId =
          projectService
              .create(userId, new CreateProjectRequest(uniqueKey("C5A"), "케이스5에이전트없음", "x"))
              .id();
      issueId = issueRepo.insert(projectId, 1, "에이전트없음 이슈", null, "MID", null, userId).id();
      final long fid = issueId;

      assertThatThrownBy(() -> service.generateOnDemand(fid))
          .isInstanceOf(IssueAiAssistantUnavailableException.class);
    } finally {
      TenantContext.clear();
    }
  }

  /** agent 없음 + 저장본 있을 때 regenerate 는 조용히 skip(기존 저장본 유지). */
  @Test
  void regenerate_noAgent_withStoredSummary_silentlySkips() {
    // 1차 저장은 agent 있을 때
    when(client.summarizeProgress(any())).thenReturn(new IssueSummaryResult("기존 요약", "액션"));
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.of(MOCK_SPEC));
    when(assistantResolver.resolveOrEmpty(any(Long.class))).thenReturn(Optional.of(MOCK_SPEC));

    long userId = createUser("case5b-user");
    TenantContext.set(1L);
    long issueId = -1;
    try {
      long projectId =
          projectService
              .create(userId, new CreateProjectRequest(uniqueKey("C5B"), "케이스5스킵", "x"))
              .id();
      issueId = issueRepo.insert(projectId, 1, "에이전트사라짐 이슈", null, "MID", null, userId).id();

      // 저장본 만들기
      service.generateOnDemand(issueId);
      assertThat(summaryRepo.find(issueId)).isPresent();

      // 이후 agent 사라짐
      when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.empty());
      when(assistantResolver.resolveOrEmpty(any(Long.class))).thenReturn(Optional.empty());

      // regenerate 는 예외 없이 조용히 skip — 기존 요약 유지
      final long fid = issueId;
      org.junit.jupiter.api.Assertions.assertDoesNotThrow(() -> service.regenerate(fid));
      assertThat(summaryRepo.find(issueId).get().summary()).isEqualTo("기존 요약");
    } finally {
      if (issueId != -1) {
        long fid = issueId;
        cleanupInTenant(1L, () -> summaryRepo.deleteByIssue(fid));
      }
      TenantContext.clear();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Case 6: 빈 요약 → generateOnDemand 예외, 저장 안 됨
  // ─────────────────────────────────────────────────────────────────────────

  /** client 가 공백 summary 를 반환하면 generateOnDemand 는 IssueAiException, 저장 안 됨. */
  @Test
  void generateOnDemand_emptySummary_throwsIssueAiException() {
    when(client.summarizeProgress(any())).thenReturn(new IssueSummaryResult("  ", ""));

    long userId = createUser("case6-user");
    TenantContext.set(1L);
    long issueId = -1;
    try {
      long projectId =
          projectService
              .create(userId, new CreateProjectRequest(uniqueKey("C6E"), "케이스6빈요약", "x"))
              .id();
      issueId = issueRepo.insert(projectId, 1, "빈요약 이슈", null, "MID", null, userId).id();
      final long fid = issueId;

      assertThatThrownBy(() -> service.generateOnDemand(fid)).isInstanceOf(IssueAiException.class);
      assertThat(summaryRepo.find(issueId)).isEmpty();
    } finally {
      TenantContext.clear();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PHANTOM: 타 테넌트 격리 assert
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * 테넌트 격리(PHANTOM): 단일 트랜잭션 안에서 GUC 를 전환해 테넌트 #1 이슈의 요약이 타 테넌트 GUC 에서 보이지 않음을 검증.
   *
   * <p>IssueAiSummaryRepositoryTest.issueAiSummary_isIsolatedAcrossTenants 패턴 미러: 롤백 기반이므로 cleanup
   * 불필요.
   */
  @Test
  void phantom_crossTenantIsolation_summaryNotVisibleInOtherTenant() {
    when(client.summarizeProgress(any())).thenReturn(new IssueSummaryResult("격리 요약", "격리 액션"));

    long userId = createUser("phantom-user");
    TenantContext.set(1L);
    long issueId = -1;
    try {
      long projectId =
          projectService
              .create(userId, new CreateProjectRequest(uniqueKey("PH"), "PHANTOM프로젝트", "x"))
              .id();
      issueId = issueRepo.insert(projectId, 1, "PHANTOM 이슈", null, "MID", null, userId).id();
      service.generateOnDemand(issueId);
      // 테넌트#1 에서 요약이 보임
      assertThat(summaryRepo.find(issueId)).isPresent();
    } finally {
      TenantContext.clear();
    }

    // 타 테넌트 GUC 로 전환 후 트랜잭션 안에서 조회 — RLS 가 행을 숨겨야 한다
    final long fid = issueId;
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            status -> {
              // GUC 직접 전환(트랜잭션 범위 안, 세션 전체 변경 아님)
              baseDsl.execute("SELECT set_config('app.tenant_id', '999999', true)");
              assertThat(summaryRepo.find(fid))
                  .as("타 테넌트 GUC → issue_ai_summary 행 격리(RLS FORCE)")
                  .isEmpty();
              status.setRollbackOnly(); // 이 트랜잭션은 롤백
            });

    // 정리(테넌트#1 의 실제 행)
    if (issueId != -1) {
      long f = issueId;
      cleanupInTenant(1L, () -> summaryRepo.deleteByIssue(f));
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 헬퍼
  // ─────────────────────────────────────────────────────────────────────────

  /** 테스트용 USER 직접 삽입. */
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
