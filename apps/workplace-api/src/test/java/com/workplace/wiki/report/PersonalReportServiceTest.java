package com.workplace.wiki.report;

import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WIKI_PAGE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.outbound.AiAgentIssueClient;
import com.workplace.issue.report.PersonalReportKind;
import com.workplace.issue.report.PersonalReportPeriod;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.report.PersonalReportRepository.ReportRow;
import com.workplace.wiki.report.PersonalReportRepository.Reservation;
import com.workplace.wiki.report.PersonalReportService.CreateResult;
import com.workplace.wiki.report.dto.CreatePersonalReportRequest;
import com.workplace.wiki.report.dto.PersonalReportConflictResponse;
import com.workplace.wiki.report.dto.PersonalReportLookupResponse;
import com.workplace.wiki.report.dto.PersonalReportStatusResponse;
import com.workplace.wiki.service.WikiSystemPageWriter;
import com.workplace.wiki.service.WikiSystemPageWriter.PersonalReportsHome;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * 개인 보고 수동 만들기·상태·찾기(WP-1486) — 202 PENDING 예약, 같은 회차 GENERATED 가 있으면 409
 * REPORT_EXISTS(pageId·제목)·force 면 새로 예약, 진행 중이면 409 REPORT_IN_PROGRESS(id), 지운 페이지는 없다고 봄, 미래 400,
 * 비서 없음 409, 하루 20번 상한 429, 자동이 건너뛴 날도 수동은 허용, 실행기 거절 → FAILED, 찾기·남의 id 를 고정한다.
 *
 * <p>@Transactional — 예약은 커밋 뒤에만 실행기에 맡기므로 여기서는 생성이 돌지 않는다(AI 호출 없음). 실행기 거절만 트랜잭션 없이 커밋해 확인한다.
 * 「지금」은 2026-11-12(목) 10:00 KST.
 */
@Transactional
class PersonalReportServiceTest extends ExternalClientMockedTestBase {

  private static final OffsetDateTime NOW = OffsetDateTime.parse("2026-11-12T10:00:00+09:00");
  private static final LocalDate DAY = LocalDate.parse("2026-11-11");
  private static final String TITLE = "11월 11일 (수) 일일 보고";

  @Autowired DSLContext dsl;
  @Autowired PersonalReportService service;
  @Autowired PersonalReportRepository reports;
  @Autowired PersonalReportGenerator generator;
  @Autowired WikiSystemPageWriter writer;
  @Autowired AssistantResolver assistantResolver;
  @Autowired AiAgentIssueClient client;

  @BeforeEach
  void mocks() {
    // DB 를 쓰지 않는다 — 트랜잭션 없이 도는 거절 테스트가 커밋된 시드를 남기지 않게.
    when(assistantResolver.resolveOrEmpty(anyLong()))
        .thenReturn(Optional.of(new AssistantSpec(1L, "m", "low", 4, 60_000)));
  }

  private long human() {
    TenantContext.set(1L);
    long id = withMembership(TestFixtures.createHuman(dsl));
    grantUserRole(id);
    return id;
  }

  private static CreatePersonalReportRequest daily(LocalDate date, boolean force) {
    return new CreatePersonalReportRequest("DAILY", date, null, null, force);
  }

  /** 그 날 일일 회차를 페이지까지 만든(GENERATED) 상태로 둔다 — 페이지 id. */
  private long generated(long userId, LocalDate day) {
    PersonalReportsHome home = writer.ensurePersonalReportsHome(userId);
    long pageId = writer.createPage(userId, home.spaceId(), home.reportsPageId(), TITLE).id();
    Reservation r =
        reports.reserve(userId, PersonalReportPeriod.daily(day), "MANUAL", NOW.minusHours(1));
    reports.markGenerated(r.id(), pageId, 1, 0, 0, NOW);
    return pageId;
  }

  private PersonalReportConflictResponse conflict(Runnable call) {
    try {
      call.run();
    } catch (PersonalReportConflictException e) {
      return e.body();
    }
    throw new AssertionError("409 충돌이 나야 한다");
  }

  @Test
  void create_reserves_202Pending() {
    long me = human();

    CreateResult res = service.create(me, daily(DAY, false), NOW);

    assertThat(res.status()).isEqualTo("PENDING");
    ReportRow row = reports.find(me, res.id()).orElseThrow();
    assertThat(row.status()).isEqualTo("PENDING");
    assertThat(row.trigger()).isEqualTo("MANUAL");
    assertThat(row.kind()).isEqualTo(PersonalReportKind.DAILY);
    assertThat(row.start()).isEqualTo(DAY);
    // 트랜잭션이 커밋되지 않았으므로 실행기에 맡기지 않았다.
    verify(client, never()).writePersonalReport(any());
  }

  @Test
  void create_weeklyAndMonthly_periods() {
    long me = human();

    CreateResult weekly =
        service.create(
            me,
            new CreatePersonalReportRequest(
                "WEEKLY", null, LocalDate.parse("2026-11-09"), null, false),
            NOW);
    CreateResult monthly =
        service.create(
            me, new CreatePersonalReportRequest("MONTHLY", null, null, "2026-10", false), NOW);

    ReportRow w = reports.find(me, weekly.id()).orElseThrow();
    assertThat(w.start()).isEqualTo(LocalDate.parse("2026-11-09"));
    assertThat(w.end()).isEqualTo(LocalDate.parse("2026-11-15"));
    ReportRow m = reports.find(me, monthly.id()).orElseThrow();
    assertThat(m.start()).isEqualTo(LocalDate.parse("2026-10-01"));
    assertThat(m.end()).isEqualTo(LocalDate.parse("2026-10-31"));
  }

  @Test
  void create_invalidRequest_400() {
    long me = human();

    assertThatThrownBy(() -> service.create(me, daily(null, false), NOW))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () ->
                service.create(
                    me, new CreatePersonalReportRequest("YEARLY", DAY, null, null, false), NOW))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () ->
                service.create(
                    me,
                    new CreatePersonalReportRequest("MONTHLY", null, null, "2026/10", false),
                    NOW))
        .isInstanceOf(IllegalArgumentException.class);
    // 주간은 월요일부터만.
    assertThatThrownBy(
            () ->
                service.create(
                    me,
                    new CreatePersonalReportRequest(
                        "WEEKLY", null, LocalDate.parse("2026-11-10"), null, false),
                    NOW))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void create_existingGenerated_conflictReportExists() {
    long me = human();
    long pageId = generated(me, DAY);

    PersonalReportConflictResponse body =
        conflict(() -> service.create(me, daily(DAY, false), NOW));

    assertThat(body.code()).isEqualTo("REPORT_EXISTS");
    assertThat(body.pageId()).isEqualTo(pageId);
    assertThat(body.title()).isEqualTo(TITLE);
  }

  @Test
  void create_force_reservesNew() {
    long me = human();
    generated(me, DAY);

    CreateResult res = service.create(me, daily(DAY, true), NOW);

    assertThat(res.status()).isEqualTo("PENDING");
    assertThat(reports.find(me, res.id()).orElseThrow().status()).isEqualTo("PENDING");
  }

  @Test
  void create_pending_conflictInProgress() {
    long me = human();
    CreateResult first = service.create(me, daily(DAY, false), NOW);

    PersonalReportConflictResponse body =
        conflict(() -> service.create(me, daily(DAY, true), NOW.plusMinutes(1)));

    assertThat(body.code()).isEqualTo("REPORT_IN_PROGRESS");
    assertThat(body.id()).isEqualTo(first.id());
  }

  @Test
  void create_deletedPage_treatedAsAbsent() {
    long me = human();
    long pageId = generated(me, DAY);
    dsl.deleteFrom(WIKI_PAGE).where(WIKI_PAGE.ID.eq(pageId)).execute();

    CreateResult res = service.create(me, daily(DAY, false), NOW);

    assertThat(res.status()).isEqualTo("PENDING");
  }

  @Test
  void create_future_400() {
    long me = human();

    assertThatThrownBy(() -> service.create(me, daily(LocalDate.parse("2026-11-13"), false), NOW))
        .isInstanceOf(IllegalArgumentException.class);
    // 오늘(진행 중)은 된다.
    assertThat(service.create(me, daily(LocalDate.parse("2026-11-12"), false), NOW).status())
        .isEqualTo("PENDING");
  }

  @Test
  void create_noAssistant_409() {
    long me = human();
    when(assistantResolver.resolveOrEmpty(me)).thenReturn(Optional.empty());

    PersonalReportConflictResponse body =
        conflict(() -> service.create(me, daily(DAY, false), NOW));

    assertThat(body.code()).isEqualTo("NO_ASSISTANT");
    assertThat(body.message()).isEqualTo("AI 비서가 없어 보고를 만들 수 없어요");
    assertThat(reports.latestGenerated(me, PersonalReportPeriod.daily(DAY))).isEmpty();
  }

  @Test
  void create_21stToday_429() {
    long me = human();
    for (int i = 0; i < PersonalReportService.DAILY_MANUAL_LIMIT; i++) {
      service.create(me, daily(DAY.minusDays(i), false), NOW);
    }

    assertThatThrownBy(() -> service.create(me, daily(DAY.minusDays(30), false), NOW))
        .isInstanceOf(PersonalReportDailyLimitException.class);
    // 다음 날(KST)이면 다시 된다.
    assertThat(service.create(me, daily(DAY.minusDays(30), false), NOW.plusDays(1)).status())
        .isEqualTo("PENDING");
    assertThat(PersonalReportService.DAILY_MANUAL_LIMIT).isEqualTo(20);
  }

  /**
   * 하루 상한의 「세기 → 예약」은 사람별 잠금 아래라 동시 요청이 함께 20번째를 넘지 못한다 — 19번 만든 뒤 두 요청을 한꺼번에 보내면 하나만 예약되고 하나는 429.
   * 두 스레드가 커밋된 행을 봐야 해서 트랜잭션 없이 돌리고(실행기는 아무것도 하지 않는다) 직접 정리한다.
   */
  @Test
  @Transactional(propagation = Propagation.NOT_SUPPORTED)
  void create_concurrentAtLimit_onlyOneReserved() throws Exception {
    long me = callInTenant(1L, () -> TestFixtures.createHuman(dsl));
    PersonalReportService noRun =
        new PersonalReportService(
            reports, assistantResolver, generator, writer, r -> {}, txManager);
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      for (int i = 2; i < PersonalReportService.DAILY_MANUAL_LIMIT + 1; i++) {
        LocalDate day = DAY.minusDays(i);
        callInTenant(1L, () -> reports.reserve(me, PersonalReportPeriod.daily(day), "MANUAL", NOW));
      }
      assertThat(callInTenant(1L, () -> reports.countManualSince(me, NOW.minusHours(1))))
          .isEqualTo(PersonalReportService.DAILY_MANUAL_LIMIT - 1);

      CountDownLatch start = new CountDownLatch(1);
      List<Future<String>> results = new ArrayList<>();
      for (int i = 0; i < 2; i++) {
        LocalDate day = DAY.minusDays(i);
        results.add(
            pool.submit(
                () -> {
                  TenantContext.set(1L);
                  try {
                    start.await();
                    return noRun.create(me, daily(day, false), NOW).status();
                  } catch (PersonalReportDailyLimitException e) {
                    return "429";
                  } finally {
                    TenantContext.clear();
                  }
                }));
      }
      start.countDown();
      List<String> statuses = new ArrayList<>();
      for (Future<String> f : results) statuses.add(f.get(30, TimeUnit.SECONDS));

      assertThat(statuses).containsExactlyInAnyOrder("PENDING", "429");
      assertThat(callInTenant(1L, () -> reports.countManualSince(me, NOW.minusHours(1))))
          .isEqualTo(PersonalReportService.DAILY_MANUAL_LIMIT);
    } finally {
      pool.shutdownNow();
      cleanupInTenant(
          1L,
          () -> {
            dsl.deleteFrom(table(name("personal_report")))
                .where(field(name("user_id"), Long.class).eq(me))
                .execute();
            dsl.deleteFrom(USER).where(USER.ID.eq(me)).execute();
          });
      TenantContext.clear();
    }
  }

  @Test
  void create_skippedAutoDay_manualAllowed() {
    long me = human();
    Reservation auto = reports.reserve(me, PersonalReportPeriod.daily(DAY), "AUTO", NOW);
    reports.markSkipped(auto.id(), 0, 0, 0, NOW);

    CreateResult res = service.create(me, daily(DAY, false), NOW);

    assertThat(res.id()).isNotEqualTo(auto.id());
    assertThat(reports.find(me, res.id()).orElseThrow().status()).isEqualTo("PENDING");
  }

  /** 실행기가 꽉 차 거절하면 회차를 FAILED + 안내 문구로 닫는다 — 트랜잭션 없이 불러 바로 제출되게 한다(커밋되므로 직접 정리). */
  @Test
  @Transactional(propagation = Propagation.NOT_SUPPORTED)
  void create_executorRejected_marksFailed() throws Exception {
    long me = callInTenant(1L, () -> TestFixtures.createHuman(dsl));
    ThreadPoolTaskExecutor full = new ThreadPoolTaskExecutor();
    full.setCorePoolSize(1);
    full.setMaxPoolSize(1);
    full.setQueueCapacity(0);
    full.initialize();
    CountDownLatch busy = new CountDownLatch(1);
    full.execute(
        () -> {
          try {
            busy.await(10, TimeUnit.SECONDS);
          } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
          }
        });
    PersonalReportService rejecting =
        new PersonalReportService(reports, assistantResolver, generator, writer, full, txManager);
    try {
      TenantContext.set(1L);
      CreateResult res = rejecting.create(me, daily(DAY, false), NOW);

      ReportRow row = callInTenant(1L, () -> reports.find(me, res.id()).orElseThrow());
      assertThat(row.status()).isEqualTo("FAILED");
      assertThat(row.error()).isEqualTo(PersonalReportService.ERROR_BUSY);
      assertThat(row.error()).isEqualTo("지금은 보고를 만들 수 없어요. 잠시 뒤 다시 시도해 주세요.");
      verify(client, never()).writePersonalReport(any());
    } finally {
      busy.countDown();
      full.shutdown();
      cleanupInTenant(
          1L,
          () -> {
            dsl.deleteFrom(table(name("personal_report")))
                .where(field(name("user_id"), Long.class).eq(me))
                .execute();
            dsl.deleteFrom(USER).where(USER.ID.eq(me)).execute();
          });
      TenantContext.clear();
    }
  }

  @Test
  void lookup_returnsLatestGenerated() {
    long me = human();
    long pageId = generated(me, DAY);

    Optional<PersonalReportLookupResponse> found =
        service.lookup(me, PersonalReportKind.DAILY, DAY);

    assertThat(found).isPresent();
    assertThat(found.get().pageId()).isEqualTo(pageId);
    assertThat(found.get().title()).isEqualTo(TITLE);
    assertThat(found.get().createdAt()).isNotNull();
    assertThat(service.lookup(me, PersonalReportKind.DAILY, DAY.minusDays(1))).isEmpty();
    assertThat(service.lookup(me, PersonalReportKind.WEEKLY, DAY)).isEmpty();
  }

  @Test
  void status_ownReport_showsPageAndTitle() {
    long me = human();
    long pageId = generated(me, DAY);
    long id = reports.latestGenerated(me, PersonalReportPeriod.daily(DAY)).orElseThrow().id();

    PersonalReportStatusResponse res = service.status(me, id).orElseThrow();

    assertThat(res.id()).isEqualTo(id);
    assertThat(res.status()).isEqualTo("GENERATED");
    assertThat(res.pageId()).isEqualTo(pageId);
    assertThat(res.title()).isEqualTo(TITLE);
    assertThat(res.error()).isNull();
  }

  @Test
  void status_otherUser_empty() {
    long me = human();
    long other = human();
    CreateResult res = service.create(me, daily(DAY, false), NOW);

    assertThat(service.status(other, res.id())).isEmpty();
    assertThat(service.status(me, res.id())).isPresent();
  }
}
