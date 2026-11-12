package com.workplace.wiki.report;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.outbound.AiAgentIssueClient;
import com.workplace.issue.outbound.dto.ProjectReportAiResult;
import com.workplace.issue.service.IssueService;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.report.ProjectReportGenerator.Outcome;
import com.workplace.wiki.report.dto.UpdateProjectReportSettingsRequest;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 프로젝트 리포트 생성기 동시 점유(WP-1483) — 두 실행(여러 파드)이 같은 프로젝트를 동시에 돌려도 실행권(next_run_at 조건부 갱신)은 하나만 잡아 리포트는
 * 한 편이다.
 *
 * <p>두 스레드가 커밋된 데이터를 봐야 해서 비-@Transactional 이다. 테넌트 1 에 커밋하고 끝나면 지운다.
 */
class ProjectReportGeneratorConcurrencyTest extends ExternalClientMockedTestBase {

  private static final OffsetDateTime NOW = OffsetDateTime.parse("2026-11-16T09:00:00+09:00");

  @Autowired DSLContext dsl;
  @Autowired ProjectService projectService;
  @Autowired IssueService issueService;
  @Autowired ProjectReportSettingsService settingsService;
  @Autowired ProjectReportGenerator generator;
  @Autowired AiAgentIssueClient client;
  @Autowired AssistantResolver assistantResolver;

  private long owner;
  private long projectId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    owner = withMembership(TestFixtures.createHuman(dsl));
    grantUserRole(owner);
    String key =
        "RC" + UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    var project =
        projectService.create(owner, new CreateProjectRequest(key, "동시-" + key, null, "TEAM"));
    projectId = project.id();
    when(assistantResolver.resolveWorkspaceOrEmpty())
        .thenReturn(Optional.of(new AssistantSpec(owner, "m", "low", 4, 60_000)));
    when(client.writeProjectReport(any()))
        .thenReturn(new ProjectReportAiResult("## 상태와 한 줄\n\n**순조로움**\n\n잘 됐어요.\n"));
    settingsService.update(
        owner, key, new UpdateProjectReportSettingsRequest(true, "WEEKLY", "MONDAY", "09:00"));
    var issue =
        issueService.create(
            owner, key, new CreateIssueRequest("동시 이슈", null, null, null, null, null, null, null));
    callInTenant(
        1L,
        () -> {
          dsl.update(ISSUE)
              .set(ISSUE.CREATED_AT, OffsetDateTime.parse("2026-11-10T10:00:00+09:00"))
              .where(ISSUE.ID.eq(issue.id()))
              .execute();
          return dsl.update(table(name("project_report_setting")))
              .set(field(name("next_run_at"), OffsetDateTime.class), NOW)
              .where(field(name("project_id"), Long.class).eq(projectId))
              .execute();
        });
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          dsl.deleteFrom(ISSUE).where(ISSUE.PROJECT_ID.eq(projectId)).execute();
          // 노트 공간(「리포트」·템플릿·리포트 페이지)을 먼저 지운다 — 프로젝트 삭제의 연쇄에 기대지 않고 테넌트 1 에 남기지 않게.
          dsl.deleteFrom(WIKI_SPACE).where(WIKI_SPACE.LINKED_PROJECT_ID.eq(projectId)).execute();
          dsl.deleteFrom(PROJECT).where(PROJECT.ID.eq(projectId)).execute();
        });
    cleanupInTenant(
        1L,
        () -> {
          dsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.eq(owner)).execute();
          dsl.deleteFrom(USER).where(USER.ID.eq(owner)).execute();
        });
    TenantContext.clear();
  }

  @Test
  void run_concurrentClaims_onlyOneGenerates() throws Exception {
    ExecutorService pool = Executors.newFixedThreadPool(2);
    CountDownLatch start = new CountDownLatch(1);
    List<Future<Outcome>> futures = new ArrayList<>();
    for (int i = 0; i < 2; i++) {
      futures.add(
          pool.submit(
              () -> {
                TenantContext.set(1L);
                try {
                  start.await();
                  return generator.run(projectId, NOW);
                } finally {
                  TenantContext.clear();
                }
              }));
    }
    start.countDown();
    List<Outcome> outcomes = new ArrayList<>();
    for (Future<Outcome> f : futures) {
      outcomes.add(f.get(60, TimeUnit.SECONDS));
    }
    pool.shutdown();

    assertThat(outcomes).containsExactlyInAnyOrder(Outcome.GENERATED, Outcome.NOT_DUE);
    int rows =
        callInTenant(
            1L,
            () ->
                dsl.fetchCount(
                    table(name("project_report")),
                    field(name("project_id"), Long.class).eq(projectId)));
    assertThat(rows).isEqualTo(1);
  }
}
