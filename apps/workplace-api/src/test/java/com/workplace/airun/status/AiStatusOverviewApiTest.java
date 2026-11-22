package com.workplace.airun.status;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.AI_RUN;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.airun.capacity.AiCapacitySample;
import com.workplace.airun.capacity.AiCapacitySampleRepository;
import com.workplace.airun.status.dto.AiStatusAlert;
import com.workplace.airun.status.dto.AiStatusOverview;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.support.IssueSeeds;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.support.WebSessionAuth;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1831 AI 현황 개요 API 통합 테스트 — 지표(현재·직전)·백분위·진행 중 제외·경계 행·처리량 상위5+기타·빈 구간 null·위임 작업 분리·표본 기반
 * 사용률/경고·권한·RLS. 기준 시각이 필요한 케이스는 서비스를 고정 now 로 직접 부르고, HTTP 로는 검증·권한·응답 모양만 본다. 데이터는 모두 now 기준 상대
 * 시각이다.
 */
@Transactional
class AiStatusOverviewApiTest extends AiStatusTestSupport {

  private static final String URL = "/api/v1/admin/ai-status/overview";

  @Autowired AiStatusOverviewService service;
  @Autowired AiCapacitySampleRepository sampleRepo;

  // ------------------------------------------------------------------ 헬퍼

  private AiStatusOverview overview(AiStatusPeriod p) {
    TenantContext.set(1L);
    return service.overview(p, now);
  }

  /** ai_run 한 건 — endedMs 가 null 이면 진행 중(RUNNING 등). */
  private void run(
      String kind, String status, Instant startedAt, Long durationMs, Long inTok, Long outTok) {
    runIn(1L, kind, status, startedAt, durationMs, inTok, outTok, null);
  }

  private void runIn(
      long tenant,
      String kind,
      String status,
      Instant startedAt,
      Long durationMs,
      Long inTok,
      Long outTok,
      String reason) {
    useTenant(tenant);
    baseDsl
        .insertInto(AI_RUN)
        .set(AI_RUN.TENANT_ID, tenant)
        .set(AI_RUN.RUN_ID, UUID.randomUUID())
        .set(AI_RUN.KIND, kind)
        .set(AI_RUN.STATUS, status)
        .set(AI_RUN.STARTED_AT, utc(startedAt))
        .set(AI_RUN.ENDED_AT, durationMs == null ? null : utc(startedAt.plusMillis(durationMs)))
        .set(AI_RUN.INPUT_TOKENS, inTok)
        .set(AI_RUN.OUTPUT_TOKENS, outTok)
        .set(AI_RUN.ERROR_REASON, reason)
        .execute();
    useTenant(1L);
  }

  private void sample(
      Instant at, int used, int limit, int queue, Integer oldest, String accounts, String backlog) {
    sampleRepo.insert(new AiCapacitySample(utc(at), used, limit, queue, oldest, accounts, backlog));
  }

  /** 위임 작업 한 건 — 배정(SUBMITTED) → waitMin 분 뒤 WORKING → 끝났으면 workMin 분 뒤 COMPLETED. */
  private void work(Instant assigned, int waitMin, Integer workMin) {
    String key = "AS" + UUID.randomUUID().toString().replace("-", "").toUpperCase().substring(0, 6);
    long project = projectService.create(admin, new CreateProjectRequest(key, "P-as", "x")).id();
    long issueId =
        IssueSeeds.insert(issueRepository, baseDsl, project, 1, "작업", null, "MID", null, admin)
            .id();
    long agent = createAgentUser("as-agent");
    Instant realStart = assigned.plus(Duration.ofMinutes(waitMin));
    Instant end = workMin == null ? null : realStart.plus(Duration.ofMinutes(workMin));
    long workId =
        baseDsl
            .insertInto(AGENT_WORK)
            .set(AGENT_WORK.TENANT_ID, 1L)
            .set(AGENT_WORK.ISSUE_ID, issueId)
            .set(AGENT_WORK.WORKER_ID, agent)
            .set(AGENT_WORK.STATE, workMin == null ? "WORKING" : "COMPLETED")
            .set(AGENT_WORK.STARTED_AT, utc(assigned))
            .set(AGENT_WORK.ENDED_AT, end == null ? null : utc(end))
            .set(AGENT_WORK.UPDATED_AT, utc(assigned))
            .set(AGENT_WORK.STATE_CHANGED_AT, utc(assigned))
            .returning(AGENT_WORK.ID)
            .fetchOne()
            .getId();
    event(workId, "SUBMITTED", assigned);
    event(workId, "WORKING", realStart);
    if (end != null) {
      event(workId, "COMPLETED", end);
    }
  }

  private static Instant ago(Instant n, Duration d) {
    return n.minus(d);
  }

  // ------------------------------------------------------------------ 지표

  @Test
  void overview_metrics_currentAndPrevious() {
    run("AI_CHAT", "SUCCEEDED", ago(now, Duration.ofHours(1)), 100L, 10L, 5L);
    run("AI_CHAT", "SUCCEEDED", ago(now, Duration.ofHours(2)), 200L, 10L, 5L);
    run("AI_CHAT", "SUCCEEDED", ago(now, Duration.ofHours(3)), 300L, 10L, 5L);
    run("AI_CHAT", "FAILED", ago(now, Duration.ofHours(4)), 400L, 10L, 5L);
    run("AI_CHAT", "SUCCEEDED", ago(now, Duration.ofHours(30)), 100L, 1L, 1L);

    var m = overview(AiStatusPeriod.H24).metrics();

    assertThat(m.runCount().current()).isEqualTo(4);
    assertThat(m.runCount().previous()).isEqualTo(1);
    assertThat(m.failureRate().current()).isEqualTo(0.25);
    assertThat(m.failureRate().previous()).isEqualTo(0.0);
    assertThat(m.responseTime().current().p50()).isEqualTo(250);
    assertThat(m.responseTime().current().p95()).isEqualTo(385);
    assertThat(m.tokens().current().input()).isEqualTo(40);
    assertThat(m.tokens().current().output()).isEqualTo(20);
    assertThat(m.tokens().previous().input()).isEqualTo(1);
  }

  @Test
  void overview_runningExcludedFromLatencyAndRate() {
    run("AI_CHAT", "SUCCEEDED", ago(now, Duration.ofHours(1)), 100L, 1L, 1L);
    run("AI_CHAT", "SUCCEEDED", ago(now, Duration.ofHours(2)), 200L, 1L, 1L);
    run("AI_CHAT", "SUCCEEDED", ago(now, Duration.ofHours(3)), 300L, 1L, 1L);
    run("AI_CHAT", "FAILED", ago(now, Duration.ofHours(4)), 400L, 1L, 1L);
    run("AI_CHAT", "RUNNING", ago(now, Duration.ofMinutes(5)), null, null, null);

    var m = overview(AiStatusPeriod.H24).metrics();

    assertThat(m.runCount().current()).isEqualTo(5);
    assertThat(m.failureRate().current()).isEqualTo(0.25);
    assertThat(m.responseTime().current().p95()).isEqualTo(385);
  }

  @Test
  void overview_boundaryRowCountedOnce() {
    run("AI_CHAT", "SUCCEEDED", ago(now, Duration.ofHours(24)), 100L, 1L, 1L);

    var m = overview(AiStatusPeriod.H24).metrics();

    // 기간은 [now−p, now) 반열린 구간 — 경계 시각 행은 현재 기간에만 들어가고 직전 기간에는 중복되지 않는다.
    assertThat(m.runCount().current()).isEqualTo(1);
    assertThat(m.runCount().previous()).isZero();
  }

  @Test
  void overview_boundaryRowJustBeforeFrom_belongsToPrevious() {
    run("AI_CHAT", "SUCCEEDED", ago(now, Duration.ofHours(24)).minusMillis(1), 100L, 1L, 1L);

    var m = overview(AiStatusPeriod.H24).metrics();

    assertThat(m.runCount().current()).isZero();
    assertThat(m.runCount().previous()).isEqualTo(1);
  }

  // ------------------------------------------------------------------ 처리량

  @Test
  void overview_throughput_top5PlusOther() {
    Instant t = ago(now, Duration.ofMinutes(30));
    for (int i = 1; i <= 7; i++) {
      run("KIND_" + i, "SUCCEEDED", t, 10L, (long) i, 0L);
    }

    var tp = overview(AiStatusPeriod.H24).throughput();

    assertThat(tp.kinds())
        .containsExactly("KIND_7", "KIND_6", "KIND_5", "KIND_4", "KIND_3", "OTHER");
    assertThat(tp.otherKindCount()).isEqualTo(2);
    var other = tp.values().get("OTHER").stream().filter(c -> c != null).toList();
    assertThat(other).hasSize(1);
    assertThat(other.get(0).tokens()).isEqualTo(3);
    assertThat(other.get(0).count()).isEqualTo(2);
  }

  @Test
  void overview_emptyBucketsAreNull() {
    run("AI_CHAT", "SUCCEEDED", ago(now, Duration.ofMinutes(30)), 10L, 4L, 1L);

    var o = overview(AiStatusPeriod.H24);

    assertThat(o.throughput().buckets().size()).isBetween(24, 25);
    assertThat(o.series().buckets()).hasSameSizeAs(o.throughput().buckets());
    var cells = o.throughput().values().get("AI_CHAT");
    assertThat(cells).hasSameSizeAs(o.throughput().buckets());
    assertThat(cells.stream().filter(c -> c != null).count()).isEqualTo(1);
    assertThat(o.series().failures().stream().filter(c -> c != null).count()).isEqualTo(1);
    assertThat(o.series().failures().stream().filter(c -> c == null).count())
        .isEqualTo(o.series().buckets().size() - 1);
  }

  // ------------------------------------------------------------------ 위임 작업

  @Test
  void overview_delegatedExcludedFromAiMetrics() {
    run("AI_CHAT", "SUCCEEDED", ago(now, Duration.ofHours(1)), 100L, 3L, 3L);
    work(ago(now, Duration.ofHours(3)), 5, 10);
    work(ago(now, Duration.ofHours(5)), 5, 10);

    var o = overview(AiStatusPeriod.H24);

    assertThat(o.metrics().runCount().current()).isEqualTo(1);
    assertThat(o.throughput().kinds()).containsExactly("AI_CHAT");
    var row =
        o.kinds().stream().filter(k -> k.kind().equals("DELEGATED_WORK")).findFirst().orElseThrow();
    assertThat(row.count()).isEqualTo(2);
    assertThat(row.inputTokens()).isNull();
    assertThat(row.outputTokens()).isNull();
    assertThat(row.failureRate()).isEqualTo(0.0);
  }

  @Test
  void overview_waitTime_delegatedP95() {
    work(ago(now, Duration.ofHours(3)), 10, 5);
    work(ago(now, Duration.ofHours(5)), 20, 5);

    var w = overview(AiStatusPeriod.H24).metrics().waitTime();

    assertThat(w.current().p95()).isEqualTo(19L * 60_000 + 30_000);
  }

  // ------------------------------------------------------------------ 표본·경고

  @Test
  void overview_usageAndAlertsFromLatestSample() {
    sample(
        ago(now, Duration.ofMinutes(5)).truncatedTo(ChronoUnit.MINUTES),
        3,
        5,
        2,
        1900,
        "[{\"accountId\":7,\"label\":\"계정A\",\"window\":\"5h\",\"usedPercent\":85.0}]",
        "{}");

    var o = overview(AiStatusPeriod.H24);

    assertThat(o.usage().slotUsed()).isEqualTo(3);
    assertThat(o.usage().slotLimit()).isEqualTo(5);
    assertThat(o.usage().queueWaiting()).isEqualTo(2);
    assertThat(o.usage().accounts()).hasSize(1);
    assertThat(o.usage().accounts().get(0).usedPercent5h()).isEqualTo(85.0);
    assertThat(o.alerts().stream().map(AiStatusAlert::code))
        .containsExactly("QUEUE_WAIT", "ACCOUNT_USAGE");
    assertThat(o.series().account5h()).hasSize(1);
    assertThat(o.metrics().slotUsage().current().used()).isEqualTo(3);
    // 직전 기간 끝 무렵 표본이 없으면 직전 칸은 null — 현재 칸이 없는 경우와 같은 모양.
    assertThat(o.metrics().slotUsage().previous()).isNull();
  }

  /** 같은 구간의 표본 두 개는 칸마다 최댓값이 되고, 표본 없는 구간은 null — 시계열을 DB 에서 묶는다. */
  @Test
  void overview_seriesBucketMaxFromSamples() {
    Instant bucketStart =
        AiStatusOverviewService.binStart(ago(now, Duration.ofHours(3)), Duration.ofHours(1));
    sample(
        bucketStart.plus(Duration.ofMinutes(5)),
        2,
        5,
        1,
        null,
        "[{\"accountId\":7,\"label\":\"A\",\"window\":\"5h\",\"usedPercent\":30.0},"
            + "{\"accountId\":7,\"label\":\"A\",\"window\":\"7d\",\"usedPercent\":99.0}]",
        "{\"MAIL_CLASSIFY\":4}");
    sample(
        bucketStart.plus(Duration.ofMinutes(6)),
        4,
        5,
        3,
        null,
        "[{\"accountId\":7,\"label\":\"A\",\"window\":\"5h\",\"usedPercent\":55.5}]",
        "{\"MAIL_CLASSIFY\":2,\"FILE_SUMMARY\":6}");

    var s = overview(AiStatusPeriod.H24).series();
    int i = s.buckets().indexOf(bucketStart);

    assertThat(i).isNotNegative();
    assertThat(s.slotUsed().get(i)).isEqualTo(4);
    assertThat(s.slotLimit().get(i)).isEqualTo(5);
    assertThat(s.queueWaiting().get(i)).isEqualTo(3);
    assertThat(s.backlog().get("MAIL_CLASSIFY").get(i)).isEqualTo(4);
    assertThat(s.backlog().get("FILE_SUMMARY").get(i)).isEqualTo(6);
    assertThat(s.account5h()).hasSize(1);
    assertThat(s.account5h().get(0).values().get(i)).isEqualTo(55.5);
    assertThat(s.account5h().get(0).label()).isEqualTo("A");
    int other = i == 0 ? 1 : 0;
    assertThat(s.slotUsed().get(other)).isNull();
    assertThat(s.backlog().get("MAIL_CLASSIFY").get(other)).isNull();
  }

  @Test
  void overview_noRecentSample_usageNull() {
    sample(
        ago(now, Duration.ofMinutes(30)).truncatedTo(ChronoUnit.MINUTES),
        3,
        5,
        2,
        1900,
        "[{\"accountId\":7,\"label\":\"계정A\",\"window\":\"5h\",\"usedPercent\":85.0}]",
        "{}");

    var o = overview(AiStatusPeriod.H24);

    assertThat(o.usage().slotUsed()).isNull();
    assertThat(o.usage().accounts()).isEmpty();
    assertThat(o.alerts()).isEmpty();
  }

  @Test
  void overview_kindFailureAlert() {
    for (int i = 0; i < 10; i++) {
      run("MAIL_CLASSIFY", "FAILED", ago(now, Duration.ofMinutes(10 + i)), 10L, 1L, 1L);
      run("MAIL_CLASSIFY", "SUCCEEDED", ago(now, Duration.ofHours(30).plusMinutes(i)), 10L, 1L, 1L);
    }

    var o = overview(AiStatusPeriod.H24);

    assertThat(o.alerts()).hasSize(1);
    assertThat(o.alerts().get(0).code()).isEqualTo("KIND_FAILURE");
    assertThat(o.alerts().get(0).kind()).isEqualTo("MAIL_CLASSIFY");
    assertThat(o.kinds().get(0).lastFailure()).isNotNull();
  }

  /**
   * 계정 표본의 accountId 가 소수·큰 수여도 개요가 실패하지 않는다 — 형식에 맞지 않는 항목은 건너뛰고 정상 항목만 남는다(WP-1831 리뷰 ④). 형식 검사가
   * 없으면 `::bigint` 오류로 이 쿼리 전체가 실패해 응답이 500 이 된다.
   */
  @Test
  void overview_malformedAccountIdSample_skippedInsteadOf500() {
    Instant at = ago(now, Duration.ofMinutes(5)).truncatedTo(ChronoUnit.MINUTES);
    sample(
        at,
        3,
        5,
        2,
        null,
        "[{\"accountId\":1.5,\"label\":\"소수\",\"window\":\"5h\",\"usedPercent\":50.0}]",
        "{}");
    sample(
        at.plusSeconds(1),
        4,
        5,
        3,
        null,
        "[{\"accountId\":99999999999999999999999999,\"label\":\"큰수\",\"window\":\"5h\","
            + "\"usedPercent\":60.0}]",
        "{}");
    sample(
        at.plusSeconds(2),
        5,
        5,
        4,
        null,
        "[{\"accountId\":7,\"label\":\"정상\",\"window\":\"5h\",\"usedPercent\":70.0}]",
        "{}");

    var o = overview(AiStatusPeriod.H24);

    assertThat(o.series().account5h()).hasSize(1);
    assertThat(o.series().account5h().get(0).accountId()).isEqualTo(7L);
    assertThat(o.series().account5h().get(0).label()).isEqualTo("정상");
  }

  /** 기간 경계(`from`)에 정확히 놓인 용량 표본은 한 번만 센다 — 직전 기간 마지막 표본으로도, 현재 기간 구간 표본으로도(WP-1831 리뷰 ⑤ 반열림). */
  @Test
  void overview_sampleExactlyAtFrom_countedOnlyInCurrentPeriod() {
    Instant from = now.minus(Duration.ofHours(24));
    sample(
        from,
        3,
        5,
        2,
        1900,
        "[{\"accountId\":7,\"label\":\"A\",\"window\":\"5h\",\"usedPercent\":40.0}]",
        "{\"MAIL_CLASSIFY\":4}");

    var o = overview(AiStatusPeriod.H24);

    // 직전 기간 끝 표본으로는 쓰이지 않는다(이전에는 경계 포함이라 여기에도 잡혔다).
    assertThat(o.metrics().slotUsage().previous()).isNull();
    int i =
        o.series().buckets().indexOf(AiStatusOverviewService.binStart(from, Duration.ofHours(1)));
    assertThat(i).isNotNegative();
    assertThat(o.series().slotUsed().get(i)).isEqualTo(3);
    assertThat(o.series().queueWaiting().get(i)).isEqualTo(2);
    assertThat(o.series().backlog().get("MAIL_CLASSIFY").get(i)).isEqualTo(4);
    assertThat(o.series().account5h()).hasSize(1);
    assertThat(o.series().account5h().get(0).values().get(i)).isEqualTo(40.0);
  }

  /** 기간 끝(`now`)에 정확히 놓인 용량 표본은 구간 시계열에 들어가지 않는다 — 반열린 구간의 끝 쪽(WP-1831 리뷰 ⑤). */
  @Test
  void overview_sampleExactlyAtNow_excludedFromSeries() {
    sample(
        now,
        4,
        6,
        3,
        1800,
        "[{\"accountId\":8,\"label\":\"B\",\"window\":\"5h\",\"usedPercent\":66.0}]",
        "{\"MAIL_CLASSIFY\":7}");

    var o = overview(AiStatusPeriod.H24);

    // 시계열 구간 조회는 [from, to) — 구간 끝 표본은 어느 칸에도 들어가지 않는다(이전에는 경계 포함이라 들어갔다).
    assertThat(o.series().slotUsed()).containsOnly((Integer) null);
    assertThat(o.series().queueWaiting()).containsOnly((Integer) null);
    assertThat(o.series().backlog()).isEmpty();
    assertThat(o.series().account5h()).isEmpty();
    // 반면 「최근 표본」으로 보는 현재 사용률에는 그대로 나온다 — 그 쪽은 상한이 없다.
    assertThat(o.usage().slotUsed()).isEqualTo(4);
    assertThat(o.usage().accounts()).hasSize(1);
    assertThat(o.usage().accounts().get(0).usedPercent5h()).isEqualTo(66.0);
  }

  /** 기준 시각이 구간 경계에 놓으면 축 끝에 데이터 없는 빈 칸이 하나 더 붙지 않는다(WP-1831 리뷰 ⑥). */
  @Test
  void overview_noEmptyTrailingBucketWhenNowOnBoundary() {
    Instant boundary = Instant.parse("2026-11-22T12:00:00Z");
    TenantContext.set(1L);
    var o = service.overview(AiStatusPeriod.H24, boundary);

    assertThat(o.throughput().buckets()).hasSize(24);
    assertThat(o.series().buckets()).hasSameSizeAs(o.throughput().buckets());
    assertThat(o.throughput().buckets().get(23)).isBefore(boundary);
    assertThat(o.throughput().buckets().get(0))
        .isEqualTo(
            AiStatusOverviewService.binStart(
                boundary.minus(Duration.ofHours(24)), Duration.ofHours(1)));
  }

  // ------------------------------------------------------------------ HTTP·권한·RLS

  @Test
  void overview_http_okForAdmin_defaultPeriod24h() throws Exception {
    run("AI_CHAT", "SUCCEEDED", ago(Instant.now(), Duration.ofMinutes(10)), 10L, 1L, 1L);
    TenantContext.set(1L);
    mvc.perform(req(URL))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.period").value("24h"))
        .andExpect(jsonPath("$.bucketSeconds").value(3600))
        .andExpect(jsonPath("$.metrics.runCount.current").value(1));
  }

  @Test
  void overview_invalidPeriod_400() throws Exception {
    TenantContext.set(1L);
    mvc.perform(req(URL, "period", "2h")).andExpect(status().isBadRequest());
  }

  @Test
  void overview_nonAdmin_403() throws Exception {
    TenantContext.set(1L);
    mvc.perform(get(URL).with(authentication(WebSessionAuth.of(member, List.of()))))
        .andExpect(status().isForbidden());
  }

  @Test
  void overview_otherTenantInvisible() {
    long tid2 =
        baseDsl
            .fetchOne(
                "INSERT INTO tenant (slug, name, status) VALUES (?, 'RLS-AS', 'ACTIVE') RETURNING id",
                "rls-as-" + System.nanoTime())
            .get("id", Long.class);
    run("AI_CHAT", "SUCCEEDED", ago(now, Duration.ofHours(1)), 100L, 1L, 1L);
    runIn(tid2, "OTHER_KIND", "FAILED", ago(now, Duration.ofHours(1)), 100L, 9L, 9L, "x");

    var o = overview(AiStatusPeriod.H24);

    assertThat(o.metrics().runCount().current()).isEqualTo(1);
    assertThat(o.kinds()).extracting(k -> k.kind()).containsExactly("AI_CHAT");
  }
}
