package com.workplace.calendar.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.mail.outbound.GraphCalendarClient.GraphEvent;
import com.workplace.mail.outbound.GraphCalendarClient.GraphItemBody;
import org.junit.jupiter.api.Test;

/**
 * {@link GraphCalendarFetcher#mapDescription} 단위 테스트(WP-709).
 *
 * <p>DB·Spring 없이 본문 → 설명 변환 규칙만 검증한다: 본문 우선·미리보기 폴백·HTML 방어·정규화·길이 상한.
 */
class GraphCalendarFetcherDescriptionTest {

  private static GraphEvent event(String preview, GraphItemBody body) {
    return new GraphEvent(
        "e", "s", preview, body, null, null, false, null, null, null, false, null, null, null);
  }

  @Test
  void body_wins_over_preview() {
    assertThat(
            GraphCalendarFetcher.mapDescription(event("미리보기", new GraphItemBody("text", "전체 본문"))))
        .isEqualTo("전체 본문");
  }

  @Test
  void empty_body_falls_back_to_preview_and_both_empty_is_null() {
    assertThat(
            GraphCalendarFetcher.mapDescription(event("미리보기", new GraphItemBody("text", " \r\n "))))
        .isEqualTo("미리보기");
    assertThat(GraphCalendarFetcher.mapDescription(event("미리보기", null))).isEqualTo("미리보기");
    assertThat(GraphCalendarFetcher.mapDescription(event("  ", new GraphItemBody("text", ""))))
        .isNull();
    assertThat(GraphCalendarFetcher.mapDescription(event(null, null))).isNull();
  }

  /** Graph 가 Prefer 헤더를 무시하고 HTML 을 주면 태그를 화면에 내지 않도록 미리보기로 대신한다. */
  @Test
  void html_body_is_ignored_in_favor_of_preview() {
    assertThat(
            GraphCalendarFetcher.mapDescription(
                event("미리보기", new GraphItemBody("html", "<html><body><p>안녕</p></body></html>"))))
        .isEqualTo("미리보기");
  }

  @Test
  void normalizes_line_breaks_nul_and_trims() {
    assertThat(
            GraphCalendarFetcher.mapDescription(
                event(null, new GraphItemBody("text", "\r\n\r\n첫째\r\n둘째\r셋째\u0000\r\n  "))))
        .isEqualTo("첫째\n둘째\n셋째");
  }

  @Test
  void caps_at_10000_with_ellipsis_and_keeps_exact_limit_untouched() {
    String exact = "a".repeat(10_000);
    assertThat(GraphCalendarFetcher.mapDescription(event(null, new GraphItemBody("text", exact))))
        .isEqualTo(exact);
    String capped =
        GraphCalendarFetcher.mapDescription(
            event(null, new GraphItemBody("text", "a".repeat(10_001))));
    assertThat(capped).isEqualTo("a".repeat(9_999) + "…").hasSize(10_000);
  }

  /** 자르는 위치가 이모지(서로게이트 쌍) 한가운데면 쌍 앞에서 잘라 홀로 남은 반쪽이 생기지 않는다. */
  @Test
  void does_not_split_surrogate_pair_at_cap() {
    String text = "a".repeat(9_998) + "😀" + "b".repeat(50); // 😀 = 2 chars, 인덱스 9998~9999
    String capped =
        GraphCalendarFetcher.mapDescription(event(null, new GraphItemBody("text", text)));
    assertThat(capped).isEqualTo("a".repeat(9_998) + "…");
    assertThat(Character.isHighSurrogate(capped.charAt(capped.length() - 2))).isFalse();
  }
}
