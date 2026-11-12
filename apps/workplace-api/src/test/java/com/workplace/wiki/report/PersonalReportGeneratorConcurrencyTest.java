package com.workplace.wiki.report;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
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
import com.workplace.issue.outbound.dto.PersonalReportAiResult;
import com.workplace.issue.service.IssueService;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.report.PersonalReportGenerator.Outcome;
import java.time.LocalTime;
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
 * 개인 보고 생성기 동시 실행(WP-1486) — 두 실행(여러 파드)이 같은 사람의 자동 일일을 동시에 돌려도 실행권(next_run_at 조건부 갱신)과 회차 예약(부분
 * unique)으로 보고는 한 편이다.
 *
 * <p>두 스레드가 커밋된 데이터를 봐야 해서 비-@Transactional 이다. 테넌트 1 에 커밋하고 끝나면 지운다(회차·설정 행은 사용자 삭제의 연쇄로 지워진다).
 */
class PersonalReportGeneratorConcurrencyTest extends ExternalClientMockedTestBase {

  private static final OffsetDateTime NOW = OffsetDateTime.parse("2026-11-12T09:00:00+09:00");

  @Autowired DSLContext dsl;
  @Autowired ProjectService projectService;
  @Autowired IssueService issueService;
  @Autowired PersonalReportSettingRepository settings;
  @Autowired PersonalReportGenerator generator;
  @Autowired AiAgentIssueClient client;
  @Autowired AssistantResolver assistantResolver;

  private long me;
  private long projectId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    me = withMembership(TestFixtures.createHuman(dsl));
    grantUserRole(me);
    String key =
        "PC" + UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    var project =
        projectService.create(me, new CreateProjectRequest(key, "동시-" + key, null, "TEAM"));
    projectId = project.id();
    when(assistantResolver.resolveOrEmpty(me))
        .thenReturn(Optional.of(new AssistantSpec(me, "m", "low", 4, 60_000)));
    when(client.writePersonalReport(any()))
        .thenReturn(new PersonalReportAiResult("## 한 줄\n\n어제 일을 끝냈습니다.\n"));
    var issue =
        issueService.create(
            me, key, new CreateIssueRequest("동시 이슈", null, null, null, null, null, null, null));
    callInTenant(
        1L,
        () -> {
          // 어제(11/11) 내가 만든 이슈 — 새로 만듦 1 이라 건너뛰지 않는다.
          dsl.deleteFrom(ISSUE_ASSIGNEE).where(ISSUE_ASSIGNEE.ISSUE_ID.eq(issue.id())).execute();
          dsl.deleteFrom(ISSUE_HISTORY).where(ISSUE_HISTORY.ISSUE_ID.eq(issue.id())).execute();
          dsl.update(ISSUE)
              .set(ISSUE.CREATED_AT, OffsetDateTime.parse("2026-11-11T10:00:00+09:00"))
              .where(ISSUE.ID.eq(issue.id()))
              .execute();
          settings.save(me, true, LocalTime.of(9, 0), true, NOW);
          return null;
        });
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          dsl.deleteFrom(ISSUE).where(ISSUE.PROJECT_ID.eq(projectId)).execute();
          dsl.deleteFrom(WIKI_SPACE).where(WIKI_SPACE.LINKED_PROJECT_ID.eq(projectId)).execute();
          dsl.deleteFrom(PROJECT).where(PROJECT.ID.eq(projectId)).execute();
          // 내 노트(「보고」·템플릿·월 폴더·보고 페이지)도 테넌트 1 에 남기지 않는다.
          dsl.deleteFrom(table(name("personal_report")))
              .where(field(name("user_id"), Long.class).eq(me))
              .execute();
          dsl.deleteFrom(table(name("personal_report_setting")))
              .where(field(name("user_id"), Long.class).eq(me))
              .execute();
          dsl.deleteFrom(WIKI_SPACE)
              .where(WIKI_SPACE.OWNER_ID.eq(me))
              .and(WIKI_SPACE.TYPE.eq("PERSONAL"))
              .execute();
        });
    cleanupInTenant(
        1L,
        () -> {
          dsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.eq(me)).execute();
          dsl.deleteFrom(USER).where(USER.ID.eq(me)).execute();
        });
    TenantContext.clear();
  }

  @Test
  void daily_concurrentRuns_oneGenerated() throws Exception {
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
                  return generator.runDaily(me, NOW);
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

    assertThat(outcomes).filteredOn(o -> o == Outcome.GENERATED).hasSize(1);
    int generated =
        callInTenant(
            1L,
            () ->
                dsl.fetchCount(
                    table(name("personal_report")),
                    field(name("user_id"), Long.class)
                        .eq(me)
                        .and(field(name("status"), String.class).eq("GENERATED"))));
    assertThat(generated).isEqualTo(1);
    int rows =
        callInTenant(
            1L,
            () ->
                dsl.fetchCount(
                    table(name("personal_report")), field(name("user_id"), Long.class).eq(me)));
    assertThat(rows).isEqualTo(1);
  }
}
