package com.workplace.airun.status;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.airun.status.AiStatusAlertEvaluator.AccountUsagePoint;
import com.workplace.airun.status.AiStatusAlertEvaluator.BacklogPoint;
import com.workplace.airun.status.AiStatusAlertEvaluator.KindFailure;
import com.workplace.airun.status.dto.AiStatusAlert;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** AI 현황 경고 판정 규칙 검증. */
class AiStatusAlertEvaluatorTest {

  private static final Instant NOW = Instant.parse("2026-11-22T10:00:00Z");
  private static final String KIND = "MAIL_ANALYZE_CONTENT";

  private static List<AiStatusAlert> kinds(KindFailure k) {
    return AiStatusAlertEvaluator.evaluate(List.of(k), null, List.of(), List.of(), NOW);
  }

  /** NOW 기준 minutesAgo 분 전의 MAIL_CLASSIFY 표본. */
  private static BacklogPoint pt(int minutesAgo, int n) {
    return new BacklogPoint(NOW.minusSeconds(minutesAgo * 60L), Map.of("MAIL_CLASSIFY", n));
  }

  private static List<AiStatusAlert> backlog(List<BacklogPoint> pts) {
    return AiStatusAlertEvaluator.evaluate(List.of(), null, List.of(), pts, NOW);
  }

  @Test
  void evaluate_kindFailure_9failed_noAlert() {
    assertThat(kinds(new KindFailure(KIND, 9, 0.5, 0.1))).isEmpty();
  }

  @Test
  void evaluate_kindFailure_10failed_3x_danger() {
    var r = kinds(new KindFailure(KIND, 10, 0.3, 0.1));
    assertThat(r).hasSize(1);
    assertThat(r.get(0).code()).isEqualTo("KIND_FAILURE");
    assertThat(r.get(0).severity()).isEqualTo("DANGER");
    assertThat(r.get(0).kind()).isEqualTo(KIND);
  }

  @Test
  void evaluate_kindFailure_10failed_under3x_noAlert() {
    assertThat(kinds(new KindFailure(KIND, 10, 0.29, 0.1))).isEmpty();
  }

  @Test
  void evaluate_kindFailure_prevNull_10failed_danger() {
    var r = kinds(new KindFailure(KIND, 10, 0.3, null));
    assertThat(r).hasSize(1);
    assertThat(r.get(0).severity()).isEqualTo("DANGER");
  }

  @Test
  void evaluate_kindFailure_prevZero_10failed_danger() {
    assertThat(kinds(new KindFailure(KIND, 10, 0.3, 0.0))).hasSize(1);
  }

  @Test
  void evaluate_queueWait_1799_none_1800_warning() {
    assertThat(AiStatusAlertEvaluator.evaluate(List.of(), 1799, List.of(), List.of(), NOW))
        .isEmpty();
    var r = AiStatusAlertEvaluator.evaluate(List.of(), 1800, List.of(), List.of(), NOW);
    assertThat(r).hasSize(1);
    assertThat(r.get(0).code()).isEqualTo("QUEUE_WAIT");
    assertThat(r.get(0).severity()).isEqualTo("WARNING");
    assertThat(r.get(0).value()).isEqualTo(1800.0);
    assertThat(r.get(0).threshold()).isEqualTo(1800.0);
  }

  @Test
  void evaluate_account_79_none_80_warning_100_danger() {
    List<AccountUsagePoint> a =
        List.of(
            new AccountUsagePoint(1, "A", "5h", 79.9),
            new AccountUsagePoint(2, "B", "7d", 80.0),
            new AccountUsagePoint(3, "C", "5h", 100.0));
    var r = AiStatusAlertEvaluator.evaluate(List.of(), null, a, List.of(), NOW);
    assertThat(r).hasSize(2);
    assertThat(r.get(0).code()).isEqualTo("ACCOUNT_USAGE");
    assertThat(r.get(0).severity()).isEqualTo("WARNING");
    assertThat(r.get(0).accountId()).isEqualTo(2L);
    assertThat(r.get(0).label()).isEqualTo("B · 7d");
    assertThat(r.get(0).value()).isEqualTo(80.0);
    assertThat(r.get(1).severity()).isEqualTo("DANGER");
    assertThat(r.get(1).accountId()).isEqualTo(3L);
  }

  @Test
  void evaluate_backlogStuck_neverDecreased_warning() {
    List<BacklogPoint> pts = new ArrayList<>();
    pts.add(pt(70, 5));
    pts.add(pt(65, 5));
    pts.add(pt(60, 5));
    pts.add(pt(30, 6));
    pts.add(pt(1, 7));
    var r = backlog(pts);
    assertThat(r).hasSize(1);
    assertThat(r.get(0).code()).isEqualTo("BACKLOG_STUCK");
    assertThat(r.get(0).severity()).isEqualTo("WARNING");
    assertThat(r.get(0).kind()).isEqualTo("MAIL_CLASSIFY");
  }

  @Test
  void evaluate_backlogDecreasedOnce_noAlert() {
    assertThat(backlog(List.of(pt(70, 5), pt(60, 5), pt(30, 4), pt(1, 7)))).isEmpty();
  }

  @Test
  void evaluate_backlogAppearedWithin60m_fromZero_noAlert() {
    // 기준 표본(60분 전)은 0 — 줄지 않은 게 아니라 60분 안에 새로 생긴 적체라 경고하지 않는다.
    assertThat(backlog(List.of(pt(70, 0), pt(60, 0), pt(30, 3), pt(1, 5)))).isEmpty();
  }

  @Test
  void evaluate_kindFailure_prevZero_thresholdNull() {
    var r = kinds(new KindFailure(KIND, 10, 0.3, 0.0));
    assertThat(r.get(0).threshold()).isNull();
  }

  @Test
  void evaluate_backlogZeroNow_noAlert() {
    assertThat(backlog(List.of(pt(70, 5), pt(60, 5), pt(1, 0)))).isEmpty();
  }

  @Test
  void evaluate_backlogUnder60mCoverage_noAlert() {
    assertThat(backlog(List.of(pt(40, 5), pt(20, 6), pt(1, 7)))).isEmpty();
  }

  @Test
  void evaluate_staleSample_noSampleAlerts() {
    assertThat(AiStatusAlertEvaluator.evaluate(List.of(), null, List.of(), List.of(), NOW))
        .isEmpty();
  }
}
