package com.workplace.issue.outbound.dto;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.outbound.dto.PersonalReportAiRequest.CompletedSplit;
import org.junit.jupiter.api.Test;

/**
 * 끝낸 일 나눔 만들기(WP-1632) 단위 테스트 — {@link CompletedSplit#of} 는 순수 계산이라 DB 없이 본다. AI와 함께를 [0, 끝냄] 안으로
 * 깎아 「AI와 함께 + 직접 = 끝냄」 이 늘 맞는지 확인한다.
 */
class PersonalReportAiRequestCompletedSplitTest {

  /** 보통 경우 — 직접 = 끝냄 − AI와 함께. */
  @Test
  void of_derivesDirect() {
    assertThat(CompletedSplit.of(3, 1)).isEqualTo(new CompletedSplit(3, 1, 2));
  }

  /** AI와 함께 0 이면 끝낸 일이 모두 직접. */
  @Test
  void of_zeroWithAi_allDirect() {
    assertThat(CompletedSplit.of(1, 0)).isEqualTo(new CompletedSplit(1, 0, 1));
  }

  /** 정의가 어긋나 AI와 함께가 끝냄보다 크면 끝냄으로 깎아 「끝냄 1, AI와 함께 3」 같은 어긋난 줄이 나가지 않는다. */
  @Test
  void of_withAiOverCompleted_clampedToCompleted() {
    assertThat(CompletedSplit.of(1, 3)).isEqualTo(new CompletedSplit(1, 1, 0));
  }

  /** 음수 AI와 함께는 0 으로 올린다. */
  @Test
  void of_negativeWithAi_clampedToZero() {
    assertThat(CompletedSplit.of(2, -1)).isEqualTo(new CompletedSplit(2, 0, 2));
  }
}
