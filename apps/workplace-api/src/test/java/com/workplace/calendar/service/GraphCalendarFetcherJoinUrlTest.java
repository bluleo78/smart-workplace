package com.workplace.calendar.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.mail.outbound.GraphCalendarClient.GraphEvent;
import com.workplace.mail.outbound.GraphCalendarClient.GraphOnlineMeeting;
import org.junit.jupiter.api.Test;

/** {@link GraphCalendarFetcher#mapJoinUrl} 단위 테스트(WP-710) — 저장할 참가 주소 선별 규칙. */
class GraphCalendarFetcherJoinUrlTest {

  private static GraphEvent event(GraphOnlineMeeting meeting) {
    return new GraphEvent(
        "e", "s", null, null, null, null, false, null, null, null, false, null, meeting);
  }

  @Test
  void keeps_http_urls_trimmed() {
    assertThat(
            GraphCalendarFetcher.mapJoinUrl(
                event(new GraphOnlineMeeting("  https://teams.microsoft.com/l/meetup-join/x  "))))
        .isEqualTo("https://teams.microsoft.com/l/meetup-join/x");
  }

  @Test
  void drops_missing_blank_non_http_and_too_long_urls() {
    assertThat(GraphCalendarFetcher.mapJoinUrl(event(null))).isNull();
    assertThat(GraphCalendarFetcher.mapJoinUrl(event(new GraphOnlineMeeting(null)))).isNull();
    assertThat(GraphCalendarFetcher.mapJoinUrl(event(new GraphOnlineMeeting("  ")))).isNull();
    assertThat(GraphCalendarFetcher.mapJoinUrl(event(new GraphOnlineMeeting("javascript:alert(1)"))))
        .isNull();
    assertThat(
            GraphCalendarFetcher.mapJoinUrl(
                event(new GraphOnlineMeeting("https://x.example/" + "a".repeat(2000)))))
        .isNull();
  }

  /** 응답 판정과 같은 검사 — 접두사만 맞고 호스트가 없거나 파싱 안 되는 주소는 저장하지 않는다. */
  @Test
  void drops_urls_the_resolver_would_ignore() {
    assertThat(GraphCalendarFetcher.mapJoinUrl(event(new GraphOnlineMeeting("https://")))).isNull();
    assertThat(GraphCalendarFetcher.mapJoinUrl(event(new GraphOnlineMeeting("https:///x")))).isNull();
    assertThat(GraphCalendarFetcher.mapJoinUrl(event(new GraphOnlineMeeting("https://a b.example/x"))))
        .isNull();
  }
}
