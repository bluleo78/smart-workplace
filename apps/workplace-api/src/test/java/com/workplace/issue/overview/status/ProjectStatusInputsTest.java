package com.workplace.issue.overview.status;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.workplace.issue.outbound.dto.ProjectStatusAiRequest;
import org.junit.jupiter.api.Test;

/** 상태 요약 입력(WP-1479) — ai-agent 로 가는 JSON 모양(배지·빈 여부는 inputs 에 없음)과 해시의 안정성·민감도. */
class ProjectStatusInputsTest {

  private static ProjectStatusInputs inputs(StatusBadge badge, int openTotal, Integer late) {
    return new ProjectStatusInputs(
        badge,
        1,
        0,
        2,
        1,
        0,
        0,
        0,
        null,
        0,
        0,
        openTotal,
        openTotal,
        0,
        0,
        "CYCLE",
        "11월 2주",
        "2026-11-14",
        3,
        5,
        "2026-11-16",
        late,
        null);
  }

  @Test
  void requestJsonMatchesAiAgentSchema() {
    ProjectStatusAiRequest req =
        new ProjectStatusAiRequest(
            "WP", "WARN", inputs(StatusBadge.WARN, 4, 2), 7L, "m", 4, 60_000L);

    JsonNode json = JsonMapper.builder().build().valueToTree(req);

    assertThat(json.get("badge").asText()).isEqualTo("WARN");
    JsonNode in = json.get("inputs");
    assertThat(in.has("badge")).isFalse();
    assertThat(in.has("empty")).isFalse();
    assertThat(in.get("openTotal").asInt()).isEqualTo(4);
    assertThat(in.get("progressEnd").asText()).isEqualTo("2026-11-14");
    assertThat(in.get("overdueOldestDays").isNull()).isTrue();
    assertThat(in.size()).isEqualTo(22);
  }

  @Test
  void hashIsStableAndSensitive() {
    String h = inputs(StatusBadge.WARN, 4, 2).hash();
    assertThat(h).hasSize(64).isEqualTo(inputs(StatusBadge.WARN, 4, 2).hash());
    assertThat(inputs(StatusBadge.WARN, 5, 2).hash()).isNotEqualTo(h);
    assertThat(inputs(StatusBadge.RISK, 4, 2).hash()).isNotEqualTo(h);
    assertThat(inputs(StatusBadge.WARN, 4, null).hash()).isNotEqualTo(h);
  }

  /** 열린 이슈·진행 범위·최근 완료·생성이 모두 0 이고 기한 지남·오래 멈춤·기다리는 중만 정한 입력. */
  private static ProjectStatusInputs quiet(int overdue, int stale, int waiting) {
    return new ProjectStatusInputs(
        StatusBadge.ON_TRACK,
        0,
        0,
        0,
        0,
        0,
        0,
        overdue,
        null,
        stale,
        waiting,
        0,
        0,
        0,
        0,
        "TREND",
        null,
        null,
        null,
        0,
        null,
        null,
        0);
  }

  @Test
  void emptyOnlyWhenNothingToSummarize() {
    assertThat(quiet(0, 0, 0).isEmpty()).isTrue();
    // 기한 지남·오래 멈춤·기다리는 중 중 하나라도 있으면 요약할 거리가 있다.
    assertThat(quiet(1, 0, 0).isEmpty()).isFalse();
    assertThat(quiet(0, 1, 0).isEmpty()).isFalse();
    assertThat(quiet(0, 0, 1).isEmpty()).isFalse();
  }
}
