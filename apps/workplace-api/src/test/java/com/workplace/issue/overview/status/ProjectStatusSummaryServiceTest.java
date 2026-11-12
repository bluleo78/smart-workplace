package com.workplace.issue.overview.status;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.exception.IssueAiException;
import com.workplace.issue.outbound.AiAgentIssueClient;
import com.workplace.issue.outbound.dto.ProjectStatusAiRequest;
import com.workplace.issue.outbound.dto.ProjectStatusAiResult;
import com.workplace.issue.overview.ProjectOverviewService;
import com.workplace.issue.overview.status.ProjectStatusSummaryService.Outcome;
import com.workplace.issue.service.IssueService;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 프로젝트 상태 요약 서비스(WP-1479) — 첫 실행 생성, 입력이 그대로면 AI 를 부르지 않음, 이슈가 바뀌면 다시 부름, AI 실패·빈 요약이면 이전 요약 유지, 이슈
 * 없는 프로젝트 건너뜀(옛 요약은 지움), 비서 없으면 건너뜀, 400자 자르기. AI 클라이언트·비서 해석은 목이다.
 *
 * <p>「지금」은 서울 2026-11-11 12:00 으로 고정하고, 두 번째 실행은 기본 간격(2시간) 뒤라 점유가 다시 된다.
 */
@Transactional
class ProjectStatusSummaryServiceTest extends ExternalClientMockedTestBase {

  private static final OffsetDateTime NOW = OffsetDateTime.parse("2026-11-11T12:00:00+09:00");
  private static final OffsetDateTime LATER = NOW.plusHours(2);

  /** 시드 이슈 생성 시각 — 비교 기간(최근 14일) 밖. */
  private static final OffsetDateTime OLD = OffsetDateTime.parse("2026-09-01T12:00:00+09:00");

  @Autowired DSLContext dsl;
  @Autowired ProjectService projectService;
  @Autowired IssueService issueService;
  @Autowired ProjectStatusSummaryService service;
  @Autowired ProjectStatusSummaryRepository repository;
  @Autowired AiAgentIssueClient client;
  @Autowired AssistantResolver assistantResolver;
  @Autowired ProjectOverviewService overviewService;

  private long owner;
  private ProjectResponse project;

  @BeforeEach
  void seed() {
    owner = TestFixtures.createHuman(dsl);
    grantUserRole(owner);
    withMembership(owner);
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    project =
        projectService.create(
            owner, new CreateProjectRequest("PS" + suffix, "상태-" + suffix, "x", "TEAM"));
    when(assistantResolver.resolveWorkspaceOrEmpty())
        .thenReturn(Optional.of(new AssistantSpec(owner, "m", "low", 4, 60_000)));
  }

  /** 담당자 없는 열린 이슈 — 생성 시각을 비교 기간 밖으로 둔다. */
  private long openIssue() {
    var created =
        issueService.create(
            owner,
            project.key(),
            new CreateIssueRequest(
                "이슈-" + UUID.randomUUID().toString().substring(0, 6),
                null,
                null,
                null,
                null,
                null,
                null,
                null));
    dsl.deleteFrom(ISSUE_ASSIGNEE).where(ISSUE_ASSIGNEE.ISSUE_ID.eq(created.id())).execute();
    dsl.deleteFrom(ISSUE_HISTORY).where(ISSUE_HISTORY.ISSUE_ID.eq(created.id())).execute();
    dsl.update(ISSUE)
        .set(ISSUE.CREATED_AT, OLD)
        .set(ISSUE.UPDATED_AT, OLD)
        .where(ISSUE.ID.eq(created.id()))
        .execute();
    return created.id();
  }

  /** 이슈를 지금 닫는다 — 완료 수·열린 수가 바뀐다. */
  private void close(long issueId) {
    dsl.update(ISSUE)
        .set(ISSUE.STATUS, "DONE")
        .set(ISSUE.STATUS_ID, TestFixtures.defaultStatusId(ISSUE.PROJECT_ID, "DONE"))
        .set(ISSUE.CLOSED_AT, NOW.minusHours(1))
        .where(ISSUE.ID.eq(issueId))
        .execute();
  }

  private void aiReturns(String summary) {
    when(client.summarizeProjectStatus(any())).thenReturn(new ProjectStatusAiResult(summary));
  }

  @Test
  void firstRunGeneratesAndSaves() {
    openIssue();
    openIssue();
    aiReturns("  열린 이슈 2건이 있고 일정 위험은 없어요.  ");

    assertThat(service.refresh(project.id(), NOW)).isEqualTo(Outcome.GENERATED);

    ArgumentCaptor<ProjectStatusAiRequest> req =
        ArgumentCaptor.forClass(ProjectStatusAiRequest.class);
    verify(client, times(1)).summarizeProjectStatus(req.capture());
    assertThat(req.getValue().projectName()).isEqualTo(project.name());
    assertThat(req.getValue().badge()).isEqualTo("ON_TRACK");
    assertThat(req.getValue().inputs().openTotal()).isEqualTo(2);
    assertThat(req.getValue().inputs().progressKind()).isEqualTo("TREND");
    assertThat(req.getValue().assistantAgentId()).isEqualTo(owner);

    StatusSummaryRow row = repository.find(project.id()).orElseThrow();
    assertThat(row.badge()).isEqualTo("ON_TRACK");
    assertThat(row.summary()).isEqualTo("열린 이슈 2건이 있고 일정 위험은 없어요.");
    assertThat(row.inputHash()).hasSize(64);
    assertThat(row.generatedAt().toInstant()).isEqualTo(NOW.toInstant());
    assertThat(row.checkedAt().toInstant()).isEqualTo(NOW.toInstant());
    // 기본 간격 2시간.
    assertThat(row.nextRunAt().toInstant()).isEqualTo(LATER.toInstant());
  }

  @Test
  void unchangedInputsSkipAi() {
    openIssue();
    aiReturns("요약");
    service.refresh(project.id(), NOW);

    assertThat(service.refresh(project.id(), LATER)).isEqualTo(Outcome.UNCHANGED);

    verify(client, times(1)).summarizeProjectStatus(any());
    StatusSummaryRow row = repository.find(project.id()).orElseThrow();
    assertThat(row.generatedAt().toInstant()).isEqualTo(NOW.toInstant());
    assertThat(row.checkedAt().toInstant()).isEqualTo(LATER.toInstant());
    assertThat(row.nextRunAt().toInstant()).isEqualTo(LATER.plusHours(2).toInstant());
  }

  @Test
  void notDueIsSkipped() {
    openIssue();
    aiReturns("요약");
    service.refresh(project.id(), NOW);

    // 간격이 지나지 않았으면 점유하지 못한다.
    assertThat(service.refresh(project.id(), NOW.plusMinutes(5))).isEqualTo(Outcome.SKIPPED);
    verify(client, times(1)).summarizeProjectStatus(any());
  }

  @Test
  void issueChangeTriggersAi() {
    long a = openIssue();
    openIssue();
    aiReturns("첫 요약");
    service.refresh(project.id(), NOW);
    String firstHash = repository.find(project.id()).orElseThrow().inputHash();

    close(a);
    aiReturns("두 번째 요약");
    assertThat(service.refresh(project.id(), LATER)).isEqualTo(Outcome.GENERATED);

    verify(client, times(2)).summarizeProjectStatus(any());
    StatusSummaryRow row = repository.find(project.id()).orElseThrow();
    assertThat(row.summary()).isEqualTo("두 번째 요약");
    assertThat(row.inputHash()).isNotEqualTo(firstHash);
    assertThat(row.generatedAt().toInstant()).isEqualTo(LATER.toInstant());
  }

  @Test
  void aiFailureKeepsPreviousSummary() {
    long a = openIssue();
    aiReturns("이전 요약");
    service.refresh(project.id(), NOW);
    String firstHash = repository.find(project.id()).orElseThrow().inputHash();

    close(a);
    openIssue();
    when(client.summarizeProjectStatus(any()))
        .thenThrow(new IssueAiException("AI 실패", new RuntimeException("boom")));
    assertThat(service.refresh(project.id(), LATER)).isEqualTo(Outcome.FAILED);

    StatusSummaryRow row = repository.find(project.id()).orElseThrow();
    assertThat(row.summary()).isEqualTo("이전 요약");
    assertThat(row.inputHash()).isEqualTo(firstHash);
    assertThat(row.checkedAt().toInstant()).isEqualTo(NOW.toInstant());
    // 점유가 이미 다음 회차로 밀어 두었다 — 간격 뒤 다시 시도한다.
    assertThat(row.nextRunAt().toInstant()).isEqualTo(LATER.plusHours(2).toInstant());
  }

  @Test
  void emptyProjectSkipsAi() {
    assertThat(service.refresh(project.id(), NOW)).isEqualTo(Outcome.SKIPPED_EMPTY);

    verify(client, never()).summarizeProjectStatus(any());
    StatusSummaryRow row = repository.find(project.id()).orElseThrow();
    assertThat(row.summary()).isNull();
    assertThat(row.badge()).isNull();
  }

  @Test
  void blankAiSummaryNotSaved() {
    openIssue();
    aiReturns("   ");

    assertThat(service.refresh(project.id(), NOW)).isEqualTo(Outcome.FAILED);

    StatusSummaryRow row = repository.find(project.id()).orElseThrow();
    assertThat(row.summary()).isNull();
    assertThat(row.inputHash()).isNull();
  }

  @Test
  void longSummaryTruncatedTo400() {
    openIssue();
    aiReturns("가".repeat(450));

    assertThat(service.refresh(project.id(), NOW)).isEqualTo(Outcome.GENERATED);

    assertThat(repository.find(project.id()).orElseThrow().summary()).hasSize(400);
  }

  @Test
  void noWorkspaceAssistantSkipsWithoutAi() {
    openIssue();
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.empty());

    // 비서가 없는 것은 실패가 아니라 건너뜀 — 회차 로그의 「실패」를 부풀리지 않는다.
    assertThat(service.refresh(project.id(), NOW)).isEqualTo(Outcome.SKIPPED);
    verify(client, never()).summarizeProjectStatus(any());
  }

  @Test
  void projectGoneQuietClearsOldSummary() {
    long a = openIssue();
    aiReturns("열린 이슈 1건이 있어요.");
    assertThat(service.refresh(project.id(), NOW)).isEqualTo(Outcome.GENERATED);
    assertThat(overviewService.overview(owner, project.key()).statusSummary()).isNotNull();

    // 남은 이슈가 오래전에 닫혀 요약할 것이 없어졌다(열린 0, 최근 14일 완료·생성 0).
    dsl.update(ISSUE)
        .set(ISSUE.STATUS, "DONE")
        .set(ISSUE.STATUS_ID, TestFixtures.defaultStatusId(ISSUE.PROJECT_ID, "DONE"))
        .set(ISSUE.CLOSED_AT, OLD)
        .where(ISSUE.ID.eq(a))
        .execute();
    assertThat(service.refresh(project.id(), LATER)).isEqualTo(Outcome.SKIPPED_EMPTY);

    // 옛 요약을 지워 카드가 숨는다 — 점검 시각만 남는다.
    StatusSummaryRow row = repository.find(project.id()).orElseThrow();
    assertThat(row.summary()).isNull();
    assertThat(row.badge()).isNull();
    assertThat(row.inputHash()).isNull();
    assertThat(row.checkedAt().toInstant()).isEqualTo(LATER.toInstant());
    assertThat(overviewService.overview(owner, project.key()).statusSummary()).isNull();
    verify(client, times(1)).summarizeProjectStatus(any());
  }
}
