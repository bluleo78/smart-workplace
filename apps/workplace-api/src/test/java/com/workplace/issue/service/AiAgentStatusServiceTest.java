package com.workplace.issue.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.repository.AiAgentRepository.WorkRow;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

/** AI별 보기(WP-1201) 연결 판정 — 마지막으로 연결돼 있던 시각이 유예(3분) 안이면 연결, 넘거나 모르면 끊김. */
class AiAgentStatusServiceTest {

  private static final Instant NOW = Instant.parse("2026-10-29T05:00:00Z");

  /** 지금 연결 중(마지막 확인 = 지금)이면 연결. */
  @Test
  void isConnected_whenSeenNow_returnsTrue() {
    assertThat(AiAgentStatusService.isConnected(NOW, NOW)).isTrue();
  }

  /** 끊긴 지 유예 안(2분)이면 아직 연결로 본다. */
  @Test
  void isConnected_whenDisconnectedWithinGrace_returnsTrue() {
    assertThat(AiAgentStatusService.isConnected(NOW.minusSeconds(120), NOW)).isTrue();
  }

  /** 유예(3분)를 넘기면 끊김. */
  @Test
  void isConnected_whenDisconnectedPastGrace_returnsFalse() {
    assertThat(AiAgentStatusService.isConnected(NOW.minusSeconds(180), NOW)).isFalse();
  }

  /** 끊긴 시각을 모르면(서버 재시작 뒤 아직 안 붙음) 끊김. */
  @Test
  void isConnected_whenNeverSeen_returnsFalse() {
    assertThat(AiAgentStatusService.isConnected(null, NOW)).isFalse();
  }

  /** 테스트용 열린 작업 행 — 상태·note 만 바꿔 쓴다(무소식 아님, 부모 없음). */
  private static WorkRow row(long issueId, String state, String note) {
    return new WorkRow(
        1L,
        issueId,
        null,
        "WP",
        (int) issueId,
        "t",
        state,
        "workplace",
        note,
        NOW,
        NOW,
        false,
        true,
        true);
  }

  /** 선행이 풀려 자리 나기를 기다리는 대기 중(WP-1956)은 자리로 세지 않는다 — 두 note 모두. 다른 note 의 대기 중은 센다. */
  @Test
  void slotRows_excludesSlotWaitAfterBlocker() {
    List<WorkRow> rows =
        List.of(
            row(1, "WAITING", "선행 풀림 — 자리 대기(앞 WP-1)"),
            row(2, "WAITING", "선행 풀림 — 자리 대기(새 작업 받지 않는 중)"),
            row(3, "WAITING", "AI 팀장 리뷰 — 접기"),
            row(4, "WAITING", null),
            row(5, "WORKING", "선행 풀림 — 자리 대기(앞 WP-1)"),
            row(6, "WAITING", "선행 풀림 — 이어서 PR 리뷰 대기"));

    List<Long> counted =
        AiAgentStatusService.slotRows(rows).stream().map(WorkRow::issueId).toList();

    assertThat(counted).containsExactly(3L, 4L, 5L, 6L);
  }

  /** 부모(작업 중)의 하위가 자리 대기 행이면 하위는 안 세어지므로 부모는 그대로 자리를 쥔다(WP-1956). */
  @Test
  void slotRows_keepsParentWhenOnlyChildIsSlotWait() {
    WorkRow parent = row(1, "WORKING", null);
    WorkRow child =
        new WorkRow(
            1L,
            2L,
            1L,
            "WP",
            2,
            "t",
            "WAITING",
            "workplace",
            "선행 풀림 — 자리 대기(앞 WP-9)",
            NOW,
            NOW,
            false,
            true,
            true);

    List<Long> counted =
        AiAgentStatusService.slotRows(List.of(parent, child)).stream()
            .map(WorkRow::issueId)
            .toList();

    assertThat(counted).containsExactly(1L);
  }
}
