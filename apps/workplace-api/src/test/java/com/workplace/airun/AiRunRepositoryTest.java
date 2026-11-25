package com.workplace.airun;

import static com.workplace.jooq.Tables.AI_RUN;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.airun.dto.AiRunRecord;
import com.workplace.airun.repository.AiRunRepository;
import com.workplace.support.IntegrationTestBase;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Set;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** WP-1827 ai_run 리포지토리 통합 테스트 — 같은 처리 ID 보고를 한 행으로 합치는 규칙, 길이 자르기, 테넌트 격리. */
@Transactional
class AiRunRepositoryTest extends IntegrationTestBase {

  private static final OffsetDateTime T0 =
      OffsetDateTime.of(2026, 11, 20, 10, 0, 0, 0, ZoneOffset.UTC);

  @Autowired AiRunRepository repo;
  @Autowired DSLContext dsl;

  @BeforeEach
  void tenant1() {
    useTenant(1L);
  }

  /** 기본값을 채운 레코드 — 테스트마다 필요한 칸만 바꿔 쓴다. */
  private static AiRunRecord rec(
      UUID id, String status, OffsetDateTime started, OffsetDateTime ended) {
    return new AiRunRecord(
        id, null, "AI_CHAT", null, null, null, null, null, null, started, ended, null, null, null,
        null, null, null, status, null, null, null);
  }

  private com.workplace.jooq.tables.records.AiRunRecord row(UUID id) {
    return dsl.selectFrom(AI_RUN).where(AI_RUN.RUN_ID.eq(id)).fetchOne();
  }

  private int count(UUID id) {
    return dsl.fetchCount(AI_RUN, AI_RUN.RUN_ID.eq(id));
  }

  @Test
  void upsert_newRow_insertsAllFields() {
    UUID id = UUID.randomUUID();
    repo.upsert(
        new AiRunRecord(
            id,
            null,
            "MAIL_SUMMARY",
            "MAIL",
            "m-1",
            "제목",
            "USER",
            7L,
            T0.minusMinutes(1),
            T0,
            T0.plusSeconds(5),
            10L,
            20L,
            30L,
            40L,
            "claude-x",
            "cred-a",
            "SUCCEEDED",
            "r",
            "d",
            2));
    var r = row(id);
    assertThat(r.getTenantId()).isEqualTo(1L);
    assertThat(r.getKind()).isEqualTo("MAIL_SUMMARY");
    assertThat(r.getTargetType()).isEqualTo("MAIL");
    assertThat(r.getTargetId()).isEqualTo("m-1");
    assertThat(r.getTargetLabel()).isEqualTo("제목");
    assertThat(r.getActorType()).isEqualTo("USER");
    assertThat(r.getActorId()).isEqualTo(7L);
    assertThat(r.getSourceAt().toInstant()).isEqualTo(T0.minusMinutes(1).toInstant());
    assertThat(r.getStartedAt().toInstant()).isEqualTo(T0.toInstant());
    assertThat(r.getEndedAt().toInstant()).isEqualTo(T0.plusSeconds(5).toInstant());
    assertThat(r.getInputTokens()).isEqualTo(10L);
    assertThat(r.getOutputTokens()).isEqualTo(20L);
    assertThat(r.getCacheReadTokens()).isEqualTo(30L);
    assertThat(r.getCacheWriteTokens()).isEqualTo(40L);
    assertThat(r.getModel()).isEqualTo("claude-x");
    assertThat(r.getCredentialLabel()).isEqualTo("cred-a");
    assertThat(r.getStatus()).isEqualTo("SUCCEEDED");
    assertThat(r.getErrorReason()).isEqualTo("r");
    assertThat(r.getErrorDetail()).isEqualTo("d");
    assertThat(r.getAttempt()).isEqualTo((short) 2);
  }

  @Test
  void upsert_runningThenSucceeded_becomesSucceededWithEndedAt() {
    UUID id = UUID.randomUUID();
    repo.upsert(rec(id, "RUNNING", T0, null));
    repo.upsert(rec(id, "SUCCEEDED", T0, T0.plusSeconds(3)));
    var r = row(id);
    assertThat(count(id)).isEqualTo(1);
    assertThat(r.getStatus()).isEqualTo("SUCCEEDED");
    assertThat(r.getEndedAt().toInstant()).isEqualTo(T0.plusSeconds(3).toInstant());
  }

  /** Review Focus 1 — 순서가 뒤바뀌어 RUNNING 이 늦게 와도 SUCCEEDED·ended_at 을 지키고 started_at 은 더 이른 값. */
  @Test
  void upsert_succeededThenRunning_staysSucceeded_startedAtTakesEarlier() {
    UUID id = UUID.randomUUID();
    repo.upsert(rec(id, "SUCCEEDED", T0.plusSeconds(1), T0.plusSeconds(3)));
    repo.upsert(rec(id, "RUNNING", T0, null));
    var r = row(id);
    assertThat(r.getStatus()).isEqualTo("SUCCEEDED");
    assertThat(r.getEndedAt().toInstant()).isEqualTo(T0.plusSeconds(3).toInstant());
    assertThat(r.getStartedAt().toInstant()).isEqualTo(T0.toInstant());
  }

  @Test
  void upsert_failedWinsOverSucceeded_bothOrders() {
    UUID a = UUID.randomUUID();
    repo.upsert(rec(a, "SUCCEEDED", T0, T0.plusSeconds(1)));
    repo.upsert(rec(a, "FAILED", T0, T0.plusSeconds(2)));
    assertThat(row(a).getStatus()).isEqualTo("FAILED");

    UUID b = UUID.randomUUID();
    repo.upsert(rec(b, "FAILED", T0, T0.plusSeconds(2)));
    repo.upsert(rec(b, "SUCCEEDED", T0, T0.plusSeconds(1)));
    assertThat(row(b).getStatus()).isEqualTo("FAILED");
  }

  @Test
  void upsert_tokensFromLaterNonNull_keepExistingWhenIncomingNull() {
    UUID id = UUID.randomUUID();
    // API 가 먼저 토큰 없이 보고, 뒤에 Agent 가 토큰을 채워 보고
    repo.upsert(rec(id, "RUNNING", T0, null));
    repo.upsert(
        new AiRunRecord(
            id,
            null,
            "AI_CHAT",
            null,
            null,
            null,
            null,
            null,
            null,
            T0,
            T0.plusSeconds(1),
            11L,
            22L,
            33L,
            44L,
            "m1",
            "c1",
            "SUCCEEDED",
            null,
            null,
            null));
    // 토큰 없는 재전송은 기존 값을 지우지 않는다
    repo.upsert(rec(id, "SUCCEEDED", T0, T0.plusSeconds(1)));
    var r = row(id);
    assertThat(r.getInputTokens()).isEqualTo(11L);
    assertThat(r.getOutputTokens()).isEqualTo(22L);
    assertThat(r.getCacheReadTokens()).isEqualTo(33L);
    assertThat(r.getCacheWriteTokens()).isEqualTo(44L);
    assertThat(r.getModel()).isEqualTo("m1");
    assertThat(r.getCredentialLabel()).isEqualTo("c1");
  }

  @Test
  void upsert_targetAndActor_firstNonNullKept() {
    UUID id = UUID.randomUUID();
    repo.upsert(
        new AiRunRecord(
            id, null, "AI_CHAT", "ISSUE", "WP-1", "첫", "USER", 5L, T0, T0, null, null, null, null,
            null, null, null, "RUNNING", null, null, null));
    repo.upsert(
        new AiRunRecord(
            id,
            null,
            "AI_CHAT",
            "MAIL",
            "x",
            "둘",
            "AGENT",
            9L,
            T0.plusHours(1),
            T0,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            "SUCCEEDED",
            null,
            null,
            null));
    var r = row(id);
    assertThat(r.getTargetType()).isEqualTo("ISSUE");
    assertThat(r.getTargetId()).isEqualTo("WP-1");
    assertThat(r.getTargetLabel()).isEqualTo("첫");
    assertThat(r.getActorType()).isEqualTo("USER");
    assertThat(r.getActorId()).isEqualTo(5L);
    assertThat(r.getSourceAt().toInstant()).isEqualTo(T0.toInstant());
  }

  @Test
  void upsert_attempt_takesGreatest() {
    UUID id = UUID.randomUUID();
    repo.upsert(withAttempt(id, 3));
    repo.upsert(withAttempt(id, 1));
    assertThat(row(id).getAttempt()).isEqualTo((short) 3);
    repo.upsert(withAttempt(id, 4));
    assertThat(row(id).getAttempt()).isEqualTo((short) 4);
  }

  private static AiRunRecord withAttempt(UUID id, int attempt) {
    return new AiRunRecord(
        id, null, "AI_CHAT", null, null, null, null, null, null, T0, null, null, null, null, null,
        null, null, "RUNNING", null, null, attempt);
  }

  /** Review Focus 4 — 길이 넘는 값은 거절하지 않고 잘라 저장(리포지토리 경유). */
  @Test
  void upsert_longFields_truncated() {
    UUID id = UUID.randomUUID();
    repo.upsert(
        new AiRunRecord(
            id,
            null,
            "AI_CHAT",
            null,
            null,
            "라".repeat(500),
            null,
            null,
            null,
            T0,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            "FAILED",
            null,
            "e".repeat(5000),
            null));
    var r = row(id);
    assertThat(r.getTargetLabel()).hasSize(200);
    assertThat(r.getErrorDetail()).hasSize(2000);
  }

  /** M-1 — short 범위를 넘는 attempt 는 0..32767 로 묶어 저장(음수·엉뚱한 값으로 돌지 않는다). */
  @Test
  void upsert_attemptOutOfShortRange_clamped() {
    UUID big = UUID.randomUUID();
    repo.upsert(withAttempt(big, 70000));
    assertThat(row(big).getAttempt()).isEqualTo(Short.MAX_VALUE);
    UUID neg = UUID.randomUUID();
    repo.upsert(withAttempt(neg, -5));
    assertThat(row(neg).getAttempt()).isEqualTo((short) 0);
  }

  @Test
  void rls_otherTenantRowInvisible_sameRunIdIndependentRows() {
    UUID id = UUID.randomUUID();
    repo.upsert(rec(id, "RUNNING", T0, null));
    long tid2 =
        baseDsl
            .fetchOne(
                "INSERT INTO tenant (slug, name, status) VALUES (?, 'RLS-RUN', 'ACTIVE') RETURNING id",
                "rls-run-" + System.nanoTime())
            .get("id", Long.class);
    useTenant(tid2);
    assertThat(count(id)).isZero();
    repo.upsert(rec(id, "SUCCEEDED", T0, T0.plusSeconds(1)));
    assertThat(count(id)).isEqualTo(1);
    assertThat(row(id).getStatus()).isEqualTo("SUCCEEDED");

    useTenant(1L);
    assertThat(count(id)).isEqualTo(1);
    assertThat(row(id).getStatus()).isEqualTo("RUNNING");
    // RLS 를 우회하는 소유자 연결이 아니므로 전체 행도 테넌트별로 한 건씩만 보인다.
    assertThat(dsl.fetchCount(AI_RUN)).isEqualTo(1);
  }

  /** 청소기가 닫은 행을 만든다 — RUNNING 으로 넣고 기준 시각을 지나게 해 「보고 없음」 FAILED 로 닫는다. */
  private UUID sweptRow(OffsetDateTime sweepAt) {
    UUID id = UUID.randomUUID();
    repo.upsert(rec(id, "RUNNING", T0, null));
    assertThat(
            repo.failStaleRunning(
                java.util.Set.of("AI_CHAT"),
                java.time.Duration.ofMinutes(1),
                java.time.Duration.ofMinutes(30),
                sweepAt))
        .isPositive();
    assertThat(row(id).getErrorReason()).isEqualTo("보고 없음");
    return id;
  }

  /** WP-1827 — 청소기가 닫은 행에 늦은 SUCCEEDED 가 오면 성공으로 바로잡고 「보고 없음」을 지운다. */
  @Test
  void upsert_sweptRow_lateSucceeded_overridesAndClearsReason() {
    UUID id = sweptRow(T0.plusHours(1));
    repo.upsert(rec(id, "SUCCEEDED", T0, T0.plusMinutes(5)));
    var r = row(id);
    assertThat(r.getStatus()).isEqualTo("SUCCEEDED");
    assertThat(r.getErrorReason()).isNull();
    assertThat(r.getEndedAt().toInstant()).isEqualTo(T0.plusMinutes(5).toInstant());
  }

  /** 늦은 FAILED 는 보고된 사유·종료 시각(청소 시각보다 이른)으로 바로잡는다. */
  @Test
  void upsert_sweptRow_lateFailed_usesReportedReasonAndEndedAt() {
    UUID id = sweptRow(T0.plusHours(1));
    repo.upsert(
        new AiRunRecord(
            id,
            null,
            "AI_CHAT",
            null,
            null,
            null,
            null,
            null,
            null,
            T0,
            T0.plusMinutes(5),
            null,
            null,
            null,
            null,
            null,
            null,
            "FAILED",
            "rate_limit",
            "429",
            null));
    var r = row(id);
    assertThat(r.getStatus()).isEqualTo("FAILED");
    assertThat(r.getErrorReason()).isEqualTo("rate_limit");
    assertThat(r.getErrorDetail()).isEqualTo("429");
    assertThat(r.getEndedAt().toInstant()).isEqualTo(T0.plusMinutes(5).toInstant());
  }

  /** 늦게 온 RUNNING 은 닫힌 행을 다시 열지 못한다. */
  @Test
  void upsert_sweptRow_lateRunning_staysFailed() {
    UUID id = sweptRow(T0.plusHours(1));
    repo.upsert(rec(id, "RUNNING", T0, null));
    var r = row(id);
    assertThat(r.getStatus()).isEqualTo("FAILED");
    assertThat(r.getErrorReason()).isEqualTo("보고 없음");
  }

  /** 실패 레코드 — 사유·상세만 바꿔 쓴다. */
  private static AiRunRecord failedRec(
      UUID id, String reason, String detail, OffsetDateTime ended) {
    return new AiRunRecord(
        id, null, "AI_CHAT", null, null, null, null, null, null, T0, ended, null, null, null, null,
        null, null, "FAILED", reason, detail, null);
  }

  /** 사유·상세가 있는 RUNNING 레코드. */
  private static AiRunRecord runningRec(UUID id, String reason, String detail) {
    return new AiRunRecord(
        id, null, "AI_CHAT", null, null, null, null, null, null, T0, null, null, null, null, null,
        null, null, "RUNNING", reason, detail, null);
  }

  /** T0 에 시작한 RUNNING 을 모두 닫을 만큼 지난 시각(1시간 뒤)에 청소기를 돌린다(긴 종류 없음 — 기준 30분). */
  private void sweepAll() {
    repo.failStaleRunning(Set.of(), Duration.ofHours(1), Duration.ofMinutes(30), T0.plusHours(1));
  }

  /** 리뷰 후속 — 사유가 이미 있던 RUNNING 행도 청소기가 「보고 없음」 표지로 닫고, 옛 사유는 상세로 옮긴다. */
  @Test
  void sweep_runningWithReason_marksStaleAndKeepsOldReasonInDetail() {
    UUID id = UUID.randomUUID();
    repo.upsert(runningRec(id, "retrying", "1차 429"));
    sweepAll();
    var r = row(id);
    assertThat(r.getStatus()).isEqualTo("FAILED");
    assertThat(r.getErrorReason()).isEqualTo("보고 없음");
    assertThat(r.getErrorDetail()).isEqualTo("retrying / 1차 429");
    // 표지가 있으니 늦은 성공 보고가 바로잡는다.
    repo.upsert(rec(id, "SUCCEEDED", T0, T0.plusMinutes(5)));
    assertThat(row(id).getStatus()).isEqualTo("SUCCEEDED");
  }

  /** 리뷰 후속 — 사유만 있고 상세가 없던 행은 옛 사유가 그대로 상세가 된다. */
  @Test
  void sweep_runningWithReasonOnly_reasonMovesToDetail() {
    UUID id = UUID.randomUUID();
    repo.upsert(runningRec(id, "retrying", null));
    sweepAll();
    assertThat(row(id).getErrorReason()).isEqualTo("보고 없음");
    assertThat(row(id).getErrorDetail()).isEqualTo("retrying");
  }

  /**
   * 리뷰 후속 — 사유 없이 늦게 온 FAILED 는 사유 없는 행을 남기지 않고 「사유 미보고」로 채운다. 「보고 없음」 표지가 아니므로 그 뒤 성공 재전송이 실제로 보고된
   * 실패를 뒤집지 못한다.
   */
  @Test
  void upsert_sweptRow_lateFailedWithoutReason_fillsUnreportedAndStaysFailed() {
    UUID id = sweptRow(T0.plusHours(1));
    repo.upsert(failedRec(id, null, null, T0.plusMinutes(5)));
    var r = row(id);
    assertThat(r.getStatus()).isEqualTo("FAILED");
    assertThat(r.getErrorReason()).isEqualTo("사유 미보고");
    assertThat(r.getEndedAt().toInstant()).isEqualTo(T0.plusMinutes(5).toInstant());
    repo.upsert(rec(id, "SUCCEEDED", T0, T0.plusMinutes(6)));
    assertThat(row(id).getStatus()).isEqualTo("FAILED");
  }

  /** 리뷰 후속 — 늦은 FAILED 가 이기면 사유·상세를 한 묶음으로 바꾼다(청소기가 옮긴 옛 상세가 새 사유 옆에 남지 않는다). */
  @Test
  void sweep_thenLateFailedWithReasonOnly_detailReplacedTogether() {
    UUID id = UUID.randomUUID();
    repo.upsert(runningRec(id, "retrying", "1차 429"));
    sweepAll();
    repo.upsert(failedRec(id, "timeout", null, T0.plusMinutes(5)));
    var r = row(id);
    assertThat(r.getErrorReason()).isEqualTo("timeout");
    assertThat(r.getErrorDetail()).isNull();
  }

  /** 리뷰 후속 — 옛 사유를 상세로 옮겨도 상세 상한 2000자를 넘기지 않는다. */
  @Test
  void sweep_oldReasonMovedToDetail_truncatedTo2000() {
    UUID id = UUID.randomUUID();
    repo.upsert(runningRec(id, "r".repeat(200), "d".repeat(2000)));
    sweepAll();
    assertThat(row(id).getErrorDetail()).hasSize(2000).startsWith("r".repeat(200) + " / ");
  }

  /** 청소기가 닫은 게 아닌 일반 FAILED 는 이후 SUCCEEDED 로 뒤집히지 않는다(기존 규칙 유지). */
  @Test
  void upsert_normalFailed_laterSucceeded_staysFailed() {
    UUID id = UUID.randomUUID();
    repo.upsert(
        new AiRunRecord(
            id,
            null,
            "AI_CHAT",
            null,
            null,
            null,
            null,
            null,
            null,
            T0,
            T0.plusSeconds(2),
            null,
            null,
            null,
            null,
            null,
            null,
            "FAILED",
            "rate_limit",
            null,
            null));
    repo.upsert(rec(id, "SUCCEEDED", T0, T0.plusSeconds(3)));
    var r = row(id);
    assertThat(r.getStatus()).isEqualTo("FAILED");
    assertThat(r.getErrorReason()).isEqualTo("rate_limit");
  }

  /**
   * API 가 503 본문에서 남긴 provider_error 를 ai-agent 가 같은 runId 로 보낸 더 정확한 사유(model_not_found)가
   * 덮는다(WP-2106 리뷰 후속).
   */
  @Test
  void upsert_providerErrorThenModelNotFound_replaces_butSameOrHttpMarkerDoesNot() {
    UUID id = UUID.randomUUID();
    repo.upsert(failedRecord(id, "provider_error", null));
    repo.upsert(failedRecord(id, "http_503", null));
    assertThat(row(id).getErrorReason()).isEqualTo("provider_error");
    repo.upsert(failedRecord(id, "model_not_found", "no model"));
    assertThat(count(id)).isEqualTo(1);
    assertThat(row(id).getErrorReason()).isEqualTo("model_not_found");
    assertThat(row(id).getErrorDetail()).isEqualTo("no model");
  }

  /**
   * 잠정 provider_limit 을 ai-agent 의 일반 사유(runner_error 등)가 덮지 않는다 — 한도 초과가 일반 실패로 바뀌지 않게(WP-2106).
   */
  @Test
  void upsert_providerLimitThenGenericReason_keepsProviderLimit() {
    UUID id = UUID.randomUUID();
    repo.upsert(failedRecord(id, "provider_limit", null));
    for (String generic :
        new String[] {"runner_error", "handler_error", "stream_error", "failed", "agent_timeout"}) {
      repo.upsert(failedRecord(id, generic, "x"));
      assertThat(row(id).getErrorReason()).isEqualTo("provider_limit");
    }
    assertThat(count(id)).isEqualTo(1);
  }

  private AiRunRecord failedRecord(UUID id, String reason, String detail) {
    return new AiRunRecord(
        id, null, "AI_CHAT", null, null, null, "USER", 1L, null, T0, T0, null, null, null, null,
        null, null, "FAILED", reason, detail, null);
  }

  /**
   * 「표지 → ai-agent 사유로 바뀜」: 5xx 표지가 사유(http_503)로 먼저 들어와도, 그 뒤 온 ai-agent 의 실제
   * 사유(runner_error)·상세(boom)이 남아야 한다 — 표지 사유를 keep-first 로 두면 실제 사유가 영구히 묻힌다(WP-1829 리뷰 후속).
   */
  @Test
  void upsert_apiServerError_thenAgentFailed_replacesMarkerReason() {
    UUID id = UUID.randomUUID();
    repo.upsert(
        new AiRunRecord(
            id,
            null,
            "AI_CHAT",
            null,
            null,
            null,
            "USER",
            1L,
            null,
            T0,
            T0,
            null,
            null,
            null,
            null,
            null,
            null,
            "FAILED",
            "http_503",
            null,
            null));
    repo.upsert(
        new AiRunRecord(
            id,
            null,
            "AI_CHAT",
            null,
            null,
            null,
            null,
            null,
            null,
            T0,
            T0.plusSeconds(1),
            null,
            null,
            null,
            null,
            null,
            null,
            "FAILED",
            "runner_error",
            "boom",
            null));
    assertThat(count(id)).isEqualTo(1);
    var r = row(id);
    assertThat(r.getStatus()).isEqualTo("FAILED");
    assertThat(r.getErrorDetail()).isEqualTo("boom");
    assertThat(r.getErrorReason()).isEqualTo("runner_error");
  }

  /**
   * 「보고 없음 → 표지 유지」: ai-agent 가 끝내 보고하지 않으면(503·프록시 502 로 runner 를 시작 못 함) 사유 없는 FAILED 가 남지 않아야 한다
   * — 표지 사유 http_503 이 그대로 남는다(WP-1829 리뷰 후속).
   */
  @Test
  void upsert_apiServerErrorOnly_keepsMarkerReason() {
    UUID id = UUID.randomUUID();
    repo.upsert(
        new AiRunRecord(
            id,
            null,
            "AI_CHAT",
            null,
            null,
            null,
            "USER",
            1L,
            null,
            T0,
            T0,
            null,
            null,
            null,
            null,
            null,
            null,
            "FAILED",
            "http_503",
            null,
            null));
    var r = row(id);
    assertThat(r.getStatus()).isEqualTo("FAILED");
    assertThat(r.getErrorReason()).isEqualTo("http_503");
    assertThat(r.getErrorDetail()).isNull();
  }

  /** 사유 없이 온 늦은 보고는 표지를 지우지 않는다 — 표지가 사라지면 사유 없는 FAILED 가 된다(WP-1827 규칙, WP-1829 리뷰 후속). */
  @Test
  void upsert_apiServerError_thenAgentFailedWithoutReason_keepsMarkerReason() {
    UUID id = UUID.randomUUID();
    repo.upsert(
        new AiRunRecord(
            id,
            null,
            "AI_CHAT",
            null,
            null,
            null,
            "USER",
            1L,
            null,
            T0,
            T0,
            null,
            null,
            null,
            null,
            null,
            null,
            "FAILED",
            "http_503",
            null,
            null));
    repo.upsert(rec(id, "FAILED", T0, T0.plusSeconds(1)));
    var r = row(id);
    assertThat(r.getStatus()).isEqualTo("FAILED");
    assertThat(r.getErrorReason()).isEqualTo("http_503");
    assertThat(r.getErrorDetail()).isNull();
  }

  /** NUL 문자는 Postgres 가 거절하므로 저장 전에 제거한다. */
  @Test
  void upsert_nulCharacters_stripped() {
    UUID id = UUID.randomUUID();
    repo.upsert(
        new AiRunRecord(
            id,
            null,
            "AI_CHAT",
            null,
            null,
            "a\u0000b",
            null,
            null,
            null,
            T0,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            "FAILED",
            null,
            "x\u0000y\u0000",
            null));
    var r = row(id);
    assertThat(r.getTargetLabel()).isEqualTo("ab");
    assertThat(r.getErrorDetail()).isEqualTo("xy");
  }
}
