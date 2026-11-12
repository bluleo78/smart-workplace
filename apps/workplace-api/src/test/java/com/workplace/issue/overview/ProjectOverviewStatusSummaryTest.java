package com.workplace.issue.overview;

import static com.workplace.jooq.Tables.CYCLE;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_CYCLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.overview.ProjectOverviewResponse.StatusSummary;
import com.workplace.issue.overview.status.ProjectStatusSummaryRepository;
import com.workplace.issue.service.IssueService;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * 개요 응답의 「프로젝트 상태」 AI 요약(WP-1479) — 워크스페이스가 AI 를 쓸 수 있고 저장된 요약 글이 있을 때만 statusSummary 를 싣고, AI 를 못
 * 쓰거나 아직 요약이 없으면(행이 없거나 실행권만 잡힌 행) null 이다. 배지는 저장값이 아니라 이번 응답의 진행 중 위젯으로 다시 정한다. 비서 해석은 목이다.
 */
@Transactional
class ProjectOverviewStatusSummaryTest extends ExternalClientMockedTestBase {

  /** 기본 「지금」 — 서울 2026-11-11(수) 14:00. */
  private static final OffsetDateTime NOW = OffsetDateTime.parse("2026-11-11T14:00:00+09:00");

  @Autowired DSLContext dsl;
  @Autowired ProjectService projectService;
  @Autowired IssueService issueService;
  @Autowired ProjectOverviewService service;
  @Autowired ProjectStatusSummaryRepository summaryRepository;
  @Autowired AssistantResolver assistantResolver;
  @Autowired MockMvc mvc;
  @Autowired JwtTokenProvider jwtTokenProvider;

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
            owner, new CreateProjectRequest("OS" + suffix, "개요상태-" + suffix, "x", "TEAM"));
  }

  /** 워크스페이스 공통 비서가 있다(AI 를 쓸 수 있다). */
  private void aiAvailable() {
    when(assistantResolver.resolveWorkspaceOrEmpty())
        .thenReturn(Optional.of(new AssistantSpec(owner, "m", "low", 4, 60_000)));
  }

  /** 요약 한 번을 만든 상태 — 실행권(다음 16:00)을 잡고 요약 글을 저장한다. */
  private void savedSummary() {
    summaryRepository.claim(project.id(), NOW, NOW.plusHours(2));
    summaryRepository.saveGenerated(project.id(), "WARN", "마감이 이틀 늦을 조짐이에요.", "h", NOW);
  }

  @Test
  void overviewIncludesStatusSummary() throws Exception {
    aiAvailable();
    // 아직 한 번도 만들지 않았으면 없다.
    assertThat(service.overview(owner, project.key(), NOW).statusSummary()).isNull();
    // 실행권만 잡혀 요약 글이 없는 행도 없다.
    summaryRepository.claim(project.id(), NOW, NOW.plusHours(2));
    assertThat(service.overview(owner, project.key(), NOW).statusSummary()).isNull();

    savedSummary();
    StatusSummary s = service.overview(owner, project.key(), NOW).statusSummary();
    assertThat(s).isNotNull();
    // 저장 배지는 WARN 이지만 이슈가 없는 프로젝트(전체 추이)라 지금 계산한 배지는 순조로움 — 화면은 실시간 값이다.
    assertThat(s.badge()).isEqualTo("ON_TRACK");
    assertThat(s.summary()).isEqualTo("마감이 이틀 늦을 조짐이에요.");
    assertThat(s.checkedAt()).isEqualTo(NOW);
    assertThat(s.nextRunAt()).isEqualTo(NOW.plusHours(2));

    // 응답 JSON 모양 — 웹 타입(statusSummary.badge·summary·checkedAt·nextRunAt)과 같다.
    mvc.perform(
            get("/api/v1/projects/" + project.key() + "/overview")
                .header(
                    "Authorization",
                    "Bearer " + jwtTokenProvider.generateAccessToken(owner, "user-" + owner)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.statusSummary.badge").value("ON_TRACK"))
        .andExpect(jsonPath("$.statusSummary.summary").value("마감이 이틀 늦을 조짐이에요."))
        .andExpect(jsonPath("$.statusSummary.checkedAt").isString())
        .andExpect(jsonPath("$.statusSummary.nextRunAt").isString());
  }

  @Test
  void noSummaryRowSkipsAssistantLookup() {
    aiAvailable();
    // 요약 행이 없으면 비서 해석(설정 조회)을 하지 않는다 — 개요 조회마다 드는 비용을 줄인다.
    assertThat(service.overview(owner, project.key(), NOW).statusSummary()).isNull();
    verify(assistantResolver, never()).resolveWorkspaceOrEmpty();
  }

  @Test
  void overviewHidesSummaryWhenAiUnavailable() {
    savedSummary();
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.empty());

    assertThat(service.overview(owner, project.key(), NOW).statusSummary()).isNull();
  }

  /** 이 프로젝트에 이슈를 만들고 상태·생성 시각·닫힌 시각을 정한다(DONE 이면 closedAt 을 닫힌 시각으로). */
  private long issue(String status, OffsetDateTime closedAt) {
    var created =
        issueService.create(
            owner,
            project.key(),
            new CreateIssueRequest(
                "상태-" + UUID.randomUUID().toString().substring(0, 6),
                null,
                null,
                null,
                null,
                null,
                null,
                null));
    dsl.update(ISSUE)
        .set(ISSUE.STATUS, status)
        .set(ISSUE.STATUS_ID, TestFixtures.defaultStatusId(ISSUE.PROJECT_ID, status))
        .set(ISSUE.CLOSED_AT, closedAt)
        .where(ISSUE.ID.eq(created.id()))
        .execute();
    return created.id();
  }

  @Test
  void badgeIsComputedFromCurrentProgressNotStoredValue() {
    aiAvailable();
    // ACTIVE 사이클 11/06 ~ 11/12, 범위 2건 중 1건이 11/10 에 끝남.
    long cycleId =
        dsl.insertInto(CYCLE)
            .set(CYCLE.PROJECT_ID, project.id())
            .set(CYCLE.NAME, "11월 2주")
            .set(CYCLE.STATUS, "ACTIVE")
            .set(CYCLE.START_DATE, LocalDate.parse("2026-11-06"))
            .set(CYCLE.END_DATE, LocalDate.parse("2026-11-12"))
            .returning(CYCLE.ID)
            .fetchOne()
            .getId();
    long done = issue("DONE", OffsetDateTime.parse("2026-11-10T10:00:00+09:00"));
    long todo = issue("TODO", null);
    for (long id : new long[] {done, todo}) {
      dsl.insertInto(ISSUE_CYCLE)
          .set(ISSUE_CYCLE.ISSUE_ID, id)
          .set(ISSUE_CYCLE.CYCLE_ID, cycleId)
          .set(ISSUE_CYCLE.CREATED_AT, OffsetDateTime.parse("2026-11-06T09:00:00+09:00"))
          .execute();
    }
    // AI 가 글을 쓸 때는 순조로움이었다 — 그 뒤 AI 호출이 실패해 저장 배지가 그대로 남은 상황.
    summaryRepository.claim(project.id(), NOW, NOW.plusHours(2));
    summaryRepository.saveGenerated(project.id(), "ON_TRACK", "예정대로 끝날 것 같아요.", "h", NOW);

    ProjectOverviewResponse o = service.overview(owner, project.key(), NOW);

    // 남은 1, 속도 = 1건 ÷ 6일(11/06~11/11) → 11/17, 종료일보다 5일 늦음 → 위험. 진행 위젯과 배지가 같은 값을 본다.
    assertThat(o.progress().lateDays()).isEqualTo(5);
    assertThat(o.statusSummary().badge()).isEqualTo("RISK");
    assertThat(o.statusSummary().summary()).isEqualTo("예정대로 끝날 것 같아요.");
  }
}
