package com.workplace.issue.profile;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_COMMENT;
import static com.workplace.jooq.Tables.ISSUE_COMPONENT;
import static com.workplace.jooq.Tables.ISSUE_LABEL;
import static com.workplace.jooq.Tables.LABEL;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.PROJECT_COMPONENT;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static com.workplace.jooq.Tables.WORK_PROFILE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.MeOverviewPeriod;
import com.workplace.issue.exception.IssueAiException;
import com.workplace.issue.outbound.AiAgentIssueClient;
import com.workplace.issue.outbound.dto.WorkProfileAiRequest;
import com.workplace.issue.outbound.dto.WorkProfileAiResult;
import com.workplace.issue.outbound.dto.WorkProfileAiResult.Classified;
import com.workplace.issue.profile.WorkProfileAnalyzeResponse.Outcome;
import com.workplace.issue.profile.WorkProfileCalc.Count;
import com.workplace.issue.profile.WorkProfileService.RunResult;
import com.workplace.issue.service.IssueService;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1485 — 업무 프로파일 서비스 통합 테스트. AI 분류로 세기, 지문이 같으면 AI 를 다시 부르지 않기, 100건 상한, 비서 없음·AI 실패 처리, 「다시 분석」
 * 중복·하루 상한을 고정한다.
 *
 * <p>테스트 트랜잭션은 커밋되지 않으므로 커밋 뒤 제출되는 워커는 돌지 않는다 — 워커 본체는 {@code runAnalysis} 를 직접 불러 확인한다. 「지금」은 서비스의
 * 시각을 받는 판(같은 패키지)으로 넘긴다.
 */
@Transactional
class WorkProfileServiceTest extends ExternalClientMockedTestBase {

  /** 「오늘」(서울) — 기간 MONTH 는 2026-11-01 ~ 2026-11-11. */
  private static final LocalDate TODAY = LocalDate.parse("2026-11-11");

  /** 「지금」 — 서울 2026-11-11 12:00. */
  private static final OffsetDateTime NOW = OffsetDateTime.parse("2026-11-11T03:00:00Z");

  @Autowired DSLContext dsl;
  @Autowired IssueService issueService;
  @Autowired ProjectService projectService;
  @Autowired WorkProfileService service;
  @Autowired WorkProfileRepository repository;
  @Autowired AiAgentIssueClient client;
  @Autowired AssistantResolver assistantResolver;
  @Autowired PlatformTransactionManager txManager;

  @BeforeEach
  void assistant() {
    when(assistantResolver.resolveOrEmpty(anyLong()))
        .thenReturn(Optional.of(new AssistantSpec(999L, "m", "NONE", 8, 60_000)));
  }

  // ── 시드 헬퍼(MeOverviewServiceTest 와 같은 방식) ───────────────────────────────

  private static OffsetDateTime t(String iso) {
    return OffsetDateTime.parse(iso);
  }

  private Long user(String prefix) {
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

  private ProjectResponse project(Long ownerId) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    return projectService.create(
        ownerId, new CreateProjectRequest("WF" + suffix, "P-WF" + suffix, "x", "TEAM"));
  }

  /** 담당자·마감 없는 열린 이슈를 만들고 생성 시각을 정한다. */
  private long issue(Long reporter, ProjectResponse p, String title, String body) {
    var created =
        issueService.create(
            reporter,
            p.key(),
            new CreateIssueRequest(title, body, null, null, null, null, null, null));
    dsl.deleteFrom(ISSUE_ASSIGNEE).where(ISSUE_ASSIGNEE.ISSUE_ID.eq(created.id())).execute();
    dsl.update(ISSUE)
        .set(ISSUE.CREATED_AT, t("2026-10-01T00:00:00Z"))
        .where(ISSUE.ID.eq(created.id()))
        .execute();
    return created.id();
  }

  /** DONE 으로 닫고 닫힌 시각·마감일을 정한다. */
  private void close(long issueId, OffsetDateTime closedAt, LocalDate due) {
    dsl.update(ISSUE)
        .set(ISSUE.STATUS, "DONE")
        .set(ISSUE.STATUS_ID, TestFixtures.defaultStatusId(ISSUE.PROJECT_ID, "DONE"))
        .set(ISSUE.CLOSED_AT, closedAt)
        .set(ISSUE.DUE_DATE, due)
        .where(ISSUE.ID.eq(issueId))
        .execute();
  }

  private void assign(long issueId, long userId) {
    dsl.insertInto(ISSUE_ASSIGNEE)
        .set(ISSUE_ASSIGNEE.ISSUE_ID, issueId)
        .set(ISSUE_ASSIGNEE.USER_ID, userId)
        .set(ISSUE_ASSIGNEE.ASSIGNED_BY, userId)
        .execute();
  }

  /** 내가 담당으로 끝낸 이슈 하나. */
  private long done(Long me, ProjectResponse p, String title, OffsetDateTime closedAt) {
    long id = issue(me, p, title, "본문 " + title);
    close(id, closedAt, null);
    assign(id, me);
    return id;
  }

  /** 이슈 키(PROJECT.KEY-NUMBER). */
  private String keyOf(long issueId) {
    var r =
        dsl.select(PROJECT.KEY, ISSUE.NUMBER)
            .from(ISSUE)
            .join(PROJECT)
            .on(PROJECT.ID.eq(ISSUE.PROJECT_ID))
            .where(ISSUE.ID.eq(issueId))
            .fetchOne();
    return r.value1() + "-" + r.value2();
  }

  private void touch(long issueId, OffsetDateTime at) {
    dsl.update(ISSUE).set(ISSUE.UPDATED_AT, at).where(ISSUE.ID.eq(issueId)).execute();
  }

  private static WorkProfileAiResult result(String summary, Classified... items) {
    return new WorkProfileAiResult(summary, List.of("Java", "React"), List.of(items));
  }

  /**
   * 워커 한 회 — 실제 흐름처럼 NOW 로 점유한 뒤 그 점유 토큰(NOW)으로 분석한다. 워커는 자기 점유일 때만 저장하므로 매 회 점유가 필요하다(READY 행은 다시
   * 점유된다).
   */
  private WorkProfileService.RunResult run(Long me) {
    repository.claimPending(me, MeOverviewPeriod.MONTH, NOW, NOW.minusMinutes(10));
    return service.runAnalysis(me, MeOverviewPeriod.MONTH, TODAY, NOW);
  }

  private WorkProfileRow row(Long me) {
    return repository.find(me, MeOverviewPeriod.MONTH).orElseThrow();
  }

  // ── runAnalysis ────────────────────────────────────────────────────────────

  @Test
  void runAnalysis_countsFromAiClassifications() {
    Long me = user("wf-me");
    var p = project(me);
    long i1 = issue(me, p, "첫째", "가".repeat(1000));
    close(i1, t("2026-11-03T01:00:00Z"), null);
    assign(i1, me);
    long i2 = issue(me, p, "둘째", "본문");
    // 마감(11-02)을 지나 11-05 에 닫음 → 늦음 3일
    close(i2, t("2026-11-05T01:00:00Z"), LocalDate.parse("2026-11-02"));
    assign(i2, me);
    long i3 = done(me, p, "셋째", t("2026-11-07T01:00:00Z"));
    // 라벨·구성요소·코멘트
    Long labelId =
        dsl.insertInto(LABEL)
            .set(LABEL.PROJECT_ID, p.id())
            .set(LABEL.NAME, "백엔드")
            .set(LABEL.COLOR_TOKEN, "blue")
            .returning(LABEL.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(ISSUE_LABEL)
        .set(ISSUE_LABEL.ISSUE_ID, i3)
        .set(ISSUE_LABEL.LABEL_ID, labelId)
        .execute();
    Long compId =
        dsl.insertInto(PROJECT_COMPONENT)
            .set(PROJECT_COMPONENT.PROJECT_ID, p.id())
            .set(PROJECT_COMPONENT.NAME, "이슈 트래커")
            .returning(PROJECT_COMPONENT.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(ISSUE_COMPONENT)
        .set(ISSUE_COMPONENT.ISSUE_ID, i3)
        .set(ISSUE_COMPONENT.COMPONENT_ID, compId)
        .execute();
    dsl.insertInto(ISSUE_COMMENT)
        .set(ISSUE_COMMENT.ISSUE_ID, i3)
        .set(ISSUE_COMMENT.AUTHOR_ID, me)
        .set(ISSUE_COMMENT.BODY, "옛 코멘트")
        .set(ISSUE_COMMENT.CREATED_AT, t("2026-11-01T00:00:00Z"))
        .execute();
    dsl.insertInto(ISSUE_COMMENT)
        .set(ISSUE_COMMENT.ISSUE_ID, i3)
        .set(ISSUE_COMMENT.AUTHOR_ID, me)
        .set(ISSUE_COMMENT.BODY, "나".repeat(500))
        .set(ISSUE_COMMENT.CREATED_AT, t("2026-11-06T00:00:00Z"))
        .execute();
    String k1 = keyOf(i1);
    String k2 = keyOf(i2);
    String k3 = keyOf(i3);
    when(client.analyzeWorkProfile(any()))
        .thenReturn(
            result(
                "기능을 많이 만들었어요.",
                new Classified(k1, "기능 개발", "이슈"),
                new Classified(k2, "기능 개발", "이슈"),
                new Classified(k3, "춤추기", "채팅"),
                new Classified("ZZ-9", "설계·기획", "x")));

    run(me);

    WorkProfileRow row = row(me);
    assertThat(row.status()).isEqualTo(WorkProfileStatus.READY);
    assertThat(row.totalCount()).isEqualTo(3);
    assertThat(row.analyzedCount()).isEqualTo(3);
    assertThat(row.summary()).isEqualTo("기능을 많이 만들었어요.");
    assertThat(row.tasks()).containsExactly(new Count("기능 개발", 2), new Count("기타", 1));
    assertThat(row.areas()).containsExactly(new Count("이슈", 2), new Count("채팅", 1));
    assertThat(row.skills()).containsExactly("Java", "React");
    assertThat(row.periodFrom()).isEqualTo(LocalDate.parse("2026-11-01"));
    assertThat(row.periodTo()).isEqualTo(TODAY);

    ArgumentCaptor<WorkProfileAiRequest> captor =
        ArgumentCaptor.forClass(WorkProfileAiRequest.class);
    verify(client).analyzeWorkProfile(captor.capture());
    WorkProfileAiRequest req = captor.getValue();
    assertThat(req.periodLabel()).isEqualTo("이번 달");
    assertThat(req.assistantAgentId()).isEqualTo(999L);
    assertThat(req.timeoutMs()).isEqualTo(60_000L);
    assertThat(req.issues()).extracting(WorkProfileAiRequest.Item::key).containsExactly(k3, k2, k1);
    assertThat(req.issues())
        .allSatisfy(it -> assertThat(it.body().length()).isLessThanOrEqualTo(300));
    WorkProfileAiRequest.Item it3 = req.issues().get(0);
    assertThat(it3.labels()).containsExactly("백엔드");
    assertThat(it3.components()).containsExactly("이슈 트래커");
    assertThat(it3.lastComment()).startsWith("나").hasSizeLessThanOrEqualTo(200);
    assertThat(it3.project()).isEqualTo(p.name());
    assertThat(it3.dueResult()).isEqualTo("마감 없음");
    assertThat(req.issues().get(1).dueResult()).isEqualTo("늦음 3일");
    assertThat(req.issues().get(2).labels()).isEmpty();
    assertThat(req.issues().get(2).lastComment()).isNull();
  }

  @Test
  void runAnalysis_skipsAiWhenFingerprintUnchanged_reRunsAfterEdit() {
    Long me = user("wf-me");
    var p = project(me);
    long i1 = done(me, p, "첫째", t("2026-11-03T01:00:00Z"));
    long i2 = done(me, p, "둘째", t("2026-11-04T01:00:00Z"));
    when(client.analyzeWorkProfile(any())).thenReturn(result("요약이에요."));

    run(me);
    OffsetDateTime first = row(me).analyzedAt();
    run(me);
    verify(client, times(1)).analyzeWorkProfile(any());
    assertThat(row(me).analyzedAt()).isEqualTo(first);
    assertThat(row(me).status()).isEqualTo(WorkProfileStatus.READY);

    touch(i1, t("2026-11-10T00:00:00Z"));
    run(me);
    verify(client, times(2)).analyzeWorkProfile(any());

    dsl.update(ISSUE).set(ISSUE.DELETED_AT, NOW).where(ISSUE.ID.eq(i2)).execute();
    run(me);
    verify(client, times(3)).analyzeWorkProfile(any());
    assertThat(row(me).totalCount()).isEqualTo(1);
  }

  @Test
  void runAnalysis_capsAt100MostRecent() {
    Long me = user("wf-me");
    var p = project(me);
    List<Long> ids = new ArrayList<>();
    OffsetDateTime base = t("2026-11-05T00:00:00Z");
    for (int i = 0; i < 101; i++) {
      ids.add(done(me, p, "일" + i, base.plusMinutes(i)));
    }
    when(client.analyzeWorkProfile(any())).thenReturn(result("많이 했어요."));

    run(me);

    ArgumentCaptor<WorkProfileAiRequest> captor =
        ArgumentCaptor.forClass(WorkProfileAiRequest.class);
    verify(client).analyzeWorkProfile(captor.capture());
    List<String> keys =
        captor.getValue().issues().stream().map(WorkProfileAiRequest.Item::key).toList();
    assertThat(keys).hasSize(100).doesNotContain(keyOf(ids.get(0)));
    assertThat(keys.get(0)).isEqualTo(keyOf(ids.get(100)));
    WorkProfileRow row = row(me);
    assertThat(row.totalCount()).isEqualTo(101);
    assertThat(row.analyzedCount()).isEqualTo(100);
  }

  @Test
  void runAnalysis_noAssistant_marksFailedWithoutCallingAi() {
    Long me = user("wf-me");
    var p = project(me);
    done(me, p, "첫째", t("2026-11-03T01:00:00Z"));
    when(assistantResolver.resolveOrEmpty(anyLong())).thenReturn(Optional.empty());

    run(me);

    WorkProfileRow row = row(me);
    assertThat(row.status()).isEqualTo(WorkProfileStatus.FAILED);
    assertThat(row.error()).isEqualTo("AI 비서가 설정되지 않아 분석할 수 없어요");
    assertThat(row.pendingSince()).isNull();
    verify(client, never()).analyzeWorkProfile(any());
  }

  @Test
  void runAnalysis_aiFailure_keepsPreviousContent() {
    Long me = user("wf-me");
    var p = project(me);
    long i1 = done(me, p, "첫째", t("2026-11-03T01:00:00Z"));
    when(client.analyzeWorkProfile(any())).thenReturn(result("처음 요약이에요."));
    run(me);

    touch(i1, t("2026-11-10T00:00:00Z"));
    when(client.analyzeWorkProfile(any()))
        .thenThrow(new IssueAiException("AI 업무 프로파일 요청에 실패했어요.", null));
    run(me);

    WorkProfileRow row = row(me);
    assertThat(row.status()).isEqualTo(WorkProfileStatus.FAILED);
    assertThat(row.error()).isEqualTo("분석하지 못했어요. 잠시 후 다시 분석해 주세요");
    assertThat(row.summary()).isEqualTo("처음 요약이에요.");
    assertThat(row.pendingSince()).isNull();
  }

  @Test
  void runAnalysis_nonAiStepFailure_marksFailedAndKeepsPreviousContent() {
    Long me = user("wf-me");
    var p = project(me);
    long i1 = done(me, p, "첫째", t("2026-11-03T01:00:00Z"));
    when(client.analyzeWorkProfile(any())).thenReturn(result("처음 요약이에요."));
    run(me);

    // AI 호출 전 단계(비서 해석)가 터지면 — 워커 스레드로 예외가 새지 않고 FAILED 로 남아야 한다.
    touch(i1, t("2026-11-10T00:00:00Z"));
    when(assistantResolver.resolveOrEmpty(anyLong()))
        .thenThrow(new IllegalStateException("비서 조회 실패"));
    run(me);

    WorkProfileRow row = row(me);
    assertThat(row.status()).isEqualTo(WorkProfileStatus.FAILED);
    assertThat(row.error()).isEqualTo("분석하지 못했어요. 잠시 후 다시 분석해 주세요");
    assertThat(row.summary()).isEqualTo("처음 요약이에요.");
    assertThat(row.pendingSince()).isNull();
    verify(client, times(1)).analyzeWorkProfile(any());
  }

  @Test
  void runAnalysis_blankSummary_isFailure() {
    Long me = user("wf-me");
    var p = project(me);
    done(me, p, "첫째", t("2026-11-03T01:00:00Z"));
    when(client.analyzeWorkProfile(any())).thenReturn(result("   "));

    run(me);

    assertThat(row(me).status()).isEqualTo(WorkProfileStatus.FAILED);
  }

  @Test
  void runAnalysis_zeroFinished_savesEmptyWithoutAi() {
    Long me = user("wf-me");

    run(me);

    WorkProfileRow row = row(me);
    assertThat(row.status()).isEqualTo(WorkProfileStatus.READY);
    assertThat(row.totalCount()).isZero();
    assertThat(row.summary()).isNull();
    assertThat(row.tasks()).isEmpty();
    verify(client, never()).analyzeWorkProfile(any());
  }

  // ── 점유 토큰 ──────────────────────────────────────────────────────────────

  @Test
  void runAnalysis_lostClaim_doesNotOverwriteNewClaim() {
    Long me = user("wf-me");
    var p = project(me);
    done(me, p, "첫째", t("2026-11-03T01:00:00Z"));
    when(client.analyzeWorkProfile(any())).thenReturn(result("옛 워커 요약이에요."));
    // 첫 점유(NOW) 뒤 10분이 지나 다른 요청이 다시 점유했다(NOW+11분).
    repository.claimPending(me, MeOverviewPeriod.MONTH, NOW, NOW.minusMinutes(10));
    OffsetDateTime second = NOW.plusMinutes(11);
    assertThat(repository.claimPending(me, MeOverviewPeriod.MONTH, second, NOW.plusMinutes(1)))
        .isTrue();

    // 첫 점유의 워커가 늦게 끝나도 두 번째 점유의 행을 덮지 않는다.
    assertThat(service.runAnalysis(me, MeOverviewPeriod.MONTH, TODAY, NOW))
        .isEqualTo(RunResult.SUPERSEDED);
    WorkProfileRow row = row(me);
    assertThat(row.status()).isEqualTo(WorkProfileStatus.PENDING);
    assertThat(row.pendingSince()).isEqualTo(second);
    assertThat(row.summary()).isNull();

    // 늦은 실패도 마찬가지 — 새 점유를 FAILED 로 가리지 않는다.
    when(client.analyzeWorkProfile(any()))
        .thenThrow(new IssueAiException("AI 업무 프로파일 요청에 실패했어요.", null));
    assertThat(service.runAnalysis(me, MeOverviewPeriod.MONTH, TODAY, NOW))
        .isEqualTo(RunResult.SUPERSEDED);
    assertThat(row(me).status()).isEqualTo(WorkProfileStatus.PENDING);
    assertThat(row(me).error()).isNull();

    // 두 번째 점유의 워커는 정상으로 저장한다(앞에서 예외로 스텁해 doReturn 으로 바꾼다).
    doReturn(result("새 요약이에요.")).when(client).analyzeWorkProfile(any());
    assertThat(service.runAnalysis(me, MeOverviewPeriod.MONTH, TODAY, second))
        .isEqualTo(RunResult.REFRESHED);
    assertThat(row(me).summary()).isEqualTo("새 요약이에요.");
  }

  @Test
  void runAnalysis_unchanged_refreshesTotalCount() {
    Long me = user("wf-me");
    var p = project(me);
    done(me, p, "첫째", t("2026-11-03T01:00:00Z"));
    when(client.analyzeWorkProfile(any())).thenReturn(result("요약이에요."));
    run(me);
    // 저장된 전체 건수가 실제와 어긋나 있어도(상한 밖 변화 등) 그대로 판정 때 새 건수로 맞춘다.
    dsl.update(WORK_PROFILE)
        .set(WORK_PROFILE.TOTAL_COUNT, 99)
        .where(WORK_PROFILE.USER_ID.eq(me))
        .execute();

    assertThat(run(me)).isEqualTo(RunResult.UNCHANGED);

    assertThat(row(me).totalCount()).isEqualTo(1);
    verify(client, times(1)).analyzeWorkProfile(any());
  }

  /** 커밋 뒤 제출이 거절되고 FAILED 기록마저 터져도 예외가 호출자(HTTP)로 새지 않는다 — 점유는 이미 커밋됐다. */
  @Test
  void submit_rejectedAndMarkFailedThrows_doesNotPropagate() {
    WorkProfileRepository brokenRepo = mock(WorkProfileRepository.class);
    when(brokenRepo.markFailed(anyLong(), any(), any(), any(), anyString()))
        .thenThrow(new IllegalStateException("DB 끊김"));
    WorkProfileService rejecting =
        new WorkProfileService(
            null,
            brokenRepo,
            null,
            null,
            null,
            null,
            task -> {
              throw new TaskRejectedException("가득 참");
            },
            txManager);

    rejecting.submit(1L, MeOverviewPeriod.MONTH, TODAY, NOW);

    verify(brokenRepo)
        .markFailed(
            eq(1L),
            eq(MeOverviewPeriod.MONTH),
            eq(NOW),
            eq(MeOverviewPeriod.MONTH.resolve(TODAY)),
            eq(WorkProfileService.ERROR_BUSY));
  }

  // ── get ────────────────────────────────────────────────────────────────────

  @Test
  void get_noRowNoFinished_returnsNoneAndCreatesNoRow() {
    Long me = user("wf-me");

    WorkProfileResponse res = service.get(me, MeOverviewPeriod.MONTH, NOW);

    assertThat(res.status()).isEqualTo("NONE");
    assertThat(res.totalCount()).isZero();
    assertThat(res.periodFrom()).isEqualTo(LocalDate.parse("2026-11-01"));
    assertThat(res.periodTo()).isEqualTo(TODAY);
    assertThat(res.tasks()).isEmpty();
    assertThat(repository.find(me, MeOverviewPeriod.MONTH)).isEmpty();
  }

  @Test
  void get_stalePendingRow_isReclaimed_freshPendingReturnedAsIs() {
    Long me = user("wf-me");
    var p = project(me);
    done(me, p, "첫째", t("2026-11-03T01:00:00Z"));
    // 10분 안의 PENDING — 그대로 돌려준다(다시 점유하지 않음).
    OffsetDateTime fresh = NOW.minusMinutes(5);
    repository.claimPending(me, MeOverviewPeriod.MONTH, fresh, fresh.minusMinutes(10));

    WorkProfileResponse first = service.get(me, MeOverviewPeriod.MONTH, NOW);

    assertThat(first.status()).isEqualTo("PENDING");
    assertThat(row(me).pendingSince()).isEqualTo(fresh);

    // 재기동 등으로 버려진 PENDING(11분 전) — get 이 다시 점유해 새 분석을 시작한다(하루 계수는 세지 않음).
    dsl.update(WORK_PROFILE)
        .set(WORK_PROFILE.PENDING_SINCE, NOW.minusMinutes(11))
        .where(WORK_PROFILE.USER_ID.eq(me))
        .execute();

    WorkProfileResponse second = service.get(me, MeOverviewPeriod.MONTH, NOW);

    assertThat(second.status()).isEqualTo("PENDING");
    assertThat(row(me).pendingSince()).isEqualTo(NOW);
    assertThat(row(me).manualCount()).isZero();
  }

  @Test
  void get_rowOfPreviousPeriod_isReclaimed_samePeriodReturnedAsIs() {
    Long me = user("wf-me");
    var p = project(me);
    done(me, p, "첫째", t("2026-11-03T01:00:00Z"));
    when(client.analyzeWorkProfile(any())).thenReturn(result("요약이에요."));
    run(me);
    // 기간 끝만 다른(같은 달, 어제까지) 행은 그대로 돌려준다 — 끝은 날마다 움직인다.
    dsl.update(WORK_PROFILE)
        .set(WORK_PROFILE.PERIOD_TO, LocalDate.parse("2026-11-10"))
        .where(WORK_PROFILE.USER_ID.eq(me))
        .execute();
    assertThat(service.get(me, MeOverviewPeriod.MONTH, NOW).status()).isEqualTo("READY");

    // 지난달을 담은 행(08:00 갱신 전 달이 바뀜) — 다시 점유해 이번 달을 분석한다(하루 계수는 세지 않음).
    dsl.update(WORK_PROFILE)
        .set(WORK_PROFILE.PERIOD_FROM, LocalDate.parse("2026-10-01"))
        .set(WORK_PROFILE.PERIOD_TO, LocalDate.parse("2026-10-31"))
        .where(WORK_PROFILE.USER_ID.eq(me))
        .execute();

    WorkProfileResponse res = service.get(me, MeOverviewPeriod.MONTH, NOW.plusMinutes(1));

    assertThat(res.status()).isEqualTo("PENDING");
    assertThat(row(me).pendingSince()).isEqualTo(NOW.plusMinutes(1));
    assertThat(row(me).manualCount()).isZero();
  }

  /**
   * 달이 바뀐 READY 행을 다시 점유한 분석이 실패하면 FAILED 행에 이번 기간이 적혀, 다음 조회는 다시 점유하지 않고 그대로 돌려준다 — 실패가 지난 기간을 남기면
   * 카드를 열 때마다 하루 상한 밖에서 AI 를 다시 부르게 된다.
   */
  @Test
  void get_rolledOverRowWhoseAnalysisFails_isNotReclaimedAgain() {
    Long me = user("wf-me");
    var p = project(me);
    long i1 = done(me, p, "첫째", t("2026-11-03T01:00:00Z"));
    when(client.analyzeWorkProfile(any())).thenReturn(result("지난달 요약이에요."));
    run(me);
    // 지난달을 담은 READY 행으로 만든다(08:00 갱신 전에 달이 바뀜).
    dsl.update(WORK_PROFILE)
        .set(WORK_PROFILE.PERIOD_FROM, LocalDate.parse("2026-10-01"))
        .set(WORK_PROFILE.PERIOD_TO, LocalDate.parse("2026-10-31"))
        .where(WORK_PROFILE.USER_ID.eq(me))
        .execute();
    // 지문이 달라 AI 를 부르게 이슈를 고치고, 이번에는 AI 가 실패한다.
    touch(i1, t("2026-11-10T00:00:00Z"));
    when(client.analyzeWorkProfile(any()))
        .thenThrow(new IssueAiException("AI 업무 프로파일 요청에 실패했어요.", null));

    OffsetDateTime claim = NOW.plusMinutes(1);
    assertThat(service.get(me, MeOverviewPeriod.MONTH, claim).status()).isEqualTo("PENDING");
    // 테스트 트랜잭션은 커밋되지 않아 워커가 돌지 않으므로 그 점유 토큰으로 직접 돌린다.
    assertThat(service.runAnalysis(me, MeOverviewPeriod.MONTH, TODAY, claim))
        .isEqualTo(RunResult.FAILED);

    WorkProfileRow failed = row(me);
    assertThat(failed.status()).isEqualTo(WorkProfileStatus.FAILED);
    assertThat(failed.periodFrom()).isEqualTo(LocalDate.parse("2026-11-01"));
    assertThat(failed.summary()).isEqualTo("지난달 요약이에요.");

    // 다음 조회 — 다시 점유하지 않고 FAILED 그대로. AI 는 처음 성공 1회 + 실패 1회뿐.
    WorkProfileResponse next = service.get(me, MeOverviewPeriod.MONTH, NOW.plusMinutes(2));
    assertThat(next.status()).isEqualTo("FAILED");
    assertThat(row(me).pendingSince()).isNull();
    verify(client, times(2)).analyzeWorkProfile(any());
  }

  @Test
  void get_firstAnalysisFailed_isReturnedAsIs() {
    Long me = user("wf-me");
    var p = project(me);
    done(me, p, "첫째", t("2026-11-03T01:00:00Z"));
    when(assistantResolver.resolveOrEmpty(anyLong())).thenReturn(Optional.empty());
    run(me);
    // 첫 분석이 실패한 FAILED 도 점유한 이번 기간을 적으므로 기간이 바뀐 것으로 보지 않는다 — 카드를 열 때마다 다시 분석하지 않게.
    assertThat(row(me).periodFrom()).isEqualTo(LocalDate.parse("2026-11-01"));

    assertThat(service.get(me, MeOverviewPeriod.MONTH, NOW.plusMinutes(1)).status())
        .isEqualTo("FAILED");
  }

  @Test
  void get_noRowWithFinished_startsPending() {
    Long me = user("wf-me");
    var p = project(me);
    done(me, p, "첫째", t("2026-11-03T01:00:00Z"));

    WorkProfileResponse res = service.get(me, MeOverviewPeriod.MONTH, NOW);

    assertThat(res.status()).isEqualTo("PENDING");
    assertThat(row(me).status()).isEqualTo(WorkProfileStatus.PENDING);
    assertThat(row(me).pendingSince()).isNotNull();
    // 테스트 트랜잭션은 커밋되지 않아 워커가 돌지 않는다.
    verify(client, never()).analyzeWorkProfile(any());
  }

  // ── analyze ────────────────────────────────────────────────────────────────

  @Test
  void analyze_secondWhilePending_isAlreadyRunning() {
    Long me = user("wf-me");
    var p = project(me);
    done(me, p, "첫째", t("2026-11-03T01:00:00Z"));

    assertThat(service.analyze(me, MeOverviewPeriod.MONTH, NOW).outcome())
        .isEqualTo(Outcome.STARTED);
    WorkProfileAnalyzeResponse second = service.analyze(me, MeOverviewPeriod.MONTH, NOW);
    assertThat(second.outcome()).isEqualTo(Outcome.ALREADY_RUNNING);
    assertThat(second.profile().status()).isEqualTo("PENDING");

    dsl.update(WORK_PROFILE)
        .set(WORK_PROFILE.PENDING_SINCE, NOW.minusMinutes(11))
        .where(WORK_PROFILE.USER_ID.eq(me))
        .execute();
    assertThat(service.analyze(me, MeOverviewPeriod.MONTH, NOW).outcome())
        .isEqualTo(Outcome.STARTED);
    assertThat(row(me).manualCount()).isEqualTo(3);
  }

  @Test
  void analyze_noRowNoFinished_returnsNoneWithoutRowOrCount() {
    Long me = user("wf-me");

    WorkProfileAnalyzeResponse res = service.analyze(me, MeOverviewPeriod.MONTH, NOW);

    assertThat(res.outcome()).isEqualTo(Outcome.UNCHANGED);
    assertThat(res.profile().status()).isEqualTo("NONE");
    assertThat(repository.find(me, MeOverviewPeriod.MONTH)).isEmpty();
  }

  @Test
  void analyze_unchangedFingerprint_returnsUnchanged() {
    Long me = user("wf-me");
    var p = project(me);
    done(me, p, "첫째", t("2026-11-03T01:00:00Z"));
    when(client.analyzeWorkProfile(any())).thenReturn(result("요약이에요."));
    run(me);
    OffsetDateTime analyzedAt = row(me).analyzedAt();

    WorkProfileAnalyzeResponse res = service.analyze(me, MeOverviewPeriod.MONTH, NOW);

    assertThat(res.outcome()).isEqualTo(Outcome.UNCHANGED);
    assertThat(res.profile().status()).isEqualTo("READY");
    assertThat(res.profile().analyzedAt()).isEqualTo(analyzedAt);
    assertThat(res.profile().summary()).isEqualTo("요약이에요.");
  }

  @Test
  void analyze_dailyLimit10_thenNextDayAllowed() {
    Long me = user("wf-me");
    var p = project(me);
    done(me, p, "첫째", t("2026-11-03T01:00:00Z"));
    when(client.analyzeWorkProfile(any())).thenReturn(result("요약이에요."));
    run(me);

    for (int i = 0; i < 10; i++) {
      assertThat(service.analyze(me, MeOverviewPeriod.MONTH, NOW).outcome())
          .isEqualTo(Outcome.UNCHANGED);
    }
    assertThatThrownBy(() -> service.analyze(me, MeOverviewPeriod.MONTH, NOW))
        .isInstanceOf(WorkProfileDailyLimitException.class)
        .hasMessage("오늘은 더 분석할 수 없어요");

    // 서울 날짜로 하루 뒤(2026-11-12 09:00 KST)면 다시 된다.
    assertThat(service.analyze(me, MeOverviewPeriod.MONTH, t("2026-11-12T00:00:00Z")).outcome())
        .isEqualTo(Outcome.UNCHANGED);
    assertThat(row(me).manualCount()).isEqualTo(1);
  }
}
