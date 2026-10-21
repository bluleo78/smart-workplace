package com.workplace.calendar.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.calendar.dto.OnlineMeeting;
import org.junit.jupiter.api.Test;

/**
 * {@link OnlineMeetingResolver} 단위 테스트(WP-710) — 순수 함수라 DB·Spring 없이 판정 규칙만 검증한다.
 */
class OnlineMeetingResolverTest {

  private static final String TEAMS_JOIN =
      "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%7d";

  private static OnlineMeeting fromDescription(String description) {
    return OnlineMeetingResolver.resolve(null, description, null);
  }

  @Test
  void stored_url_wins_and_provider_is_inferred_from_host() {
    OnlineMeeting m =
        OnlineMeetingResolver.resolve(
            TEAMS_JOIN, "설명엔 https://meet.google.com/abc-defg-hij 도 있다", "https://zoom.us/j/1");
    assertThat(m).isEqualTo(new OnlineMeeting("TEAMS", TEAMS_JOIN));
  }

  @Test
  void stored_url_with_unknown_host_is_OTHER() {
    OnlineMeeting m = OnlineMeetingResolver.resolve("https://meetings.example.com/room/42", null, null);
    assertThat(m).isEqualTo(new OnlineMeeting("OTHER", "https://meetings.example.com/room/42"));
  }

  /** 저장된 주소가 http(s) 가 아니면 쓰지 않고 본문 탐색으로 넘어간다(javascript: 가 버튼으로 새지 않게). */
  @Test
  void non_http_stored_url_is_ignored() {
    assertThat(OnlineMeetingResolver.resolve("javascript:alert(1)", null, null)).isNull();
    assertThat(OnlineMeetingResolver.resolve("javascript:alert(1)", "참가 " + TEAMS_JOIN, null))
        .isEqualTo(new OnlineMeeting("TEAMS", TEAMS_JOIN));
    assertThat(OnlineMeetingResolver.resolve("  ", null, null)).isNull();
  }

  @Test
  void detects_each_supported_link_shape() {
    assertThat(fromDescription("참가: " + TEAMS_JOIN + "\n암호: x"))
        .isEqualTo(new OnlineMeeting("TEAMS", TEAMS_JOIN));
    assertThat(fromDescription("https://teams.microsoft.com/meet/9876543210?p=abc"))
        .isEqualTo(new OnlineMeeting("TEAMS", "https://teams.microsoft.com/meet/9876543210?p=abc"));
    assertThat(fromDescription("https://teams.live.com/meet/9876543210?p=abc"))
        .isEqualTo(new OnlineMeeting("TEAMS", "https://teams.live.com/meet/9876543210?p=abc"));
    assertThat(fromDescription("https://meet.google.com/abc-defg-hij"))
        .isEqualTo(new OnlineMeeting("MEET", "https://meet.google.com/abc-defg-hij"));
    assertThat(fromDescription("https://meet.google.com/abc-defg-hij?authuser=1"))
        .isEqualTo(new OnlineMeeting("MEET", "https://meet.google.com/abc-defg-hij?authuser=1"));
    assertThat(fromDescription("https://us02web.zoom.us/j/123456789?pwd=abc"))
        .isEqualTo(new OnlineMeeting("ZOOM", "https://us02web.zoom.us/j/123456789?pwd=abc"));
    assertThat(fromDescription("https://acme.zoom.us/my/room"))
        .isEqualTo(new OnlineMeeting("ZOOM", "https://acme.zoom.us/my/room"));
    assertThat(fromDescription("https://zoom.us/j/123"))
        .isEqualTo(new OnlineMeeting("ZOOM", "https://zoom.us/j/123"));
  }

  @Test
  void ignores_non_meeting_links_and_lookalike_hosts() {
    assertThat(fromDescription("자료 https://teams.microsoft.com/l/channel/x https://example.com/j/1"))
        .isNull();
    assertThat(fromDescription("https://meet.google.com/landing")).isNull();
    assertThat(fromDescription("https://evil-zoom.us.example.com/j/123")).isNull();
    assertThat(fromDescription("https://notzoom.us/j/123")).isNull();
    assertThat(fromDescription("https://teams.microsoft.com.evil.example/meet/1")).isNull();
    assertThat(fromDescription("ftp://teams.microsoft.com/meet/1")).isNull();
    assertThat(fromDescription("javascript:alert('https://zoom.us/j/1')")).isNotNull(); // 안의 http 링크는 별개의 링크
    assertThat(fromDescription(null)).isNull();
    assertThat(fromDescription("")).isNull();
  }

  /** 설명에서 처음 나온 회의 링크가 선택된다(공급자 우선순위 없음, 글에서의 순서). */
  @Test
  void first_meeting_link_in_text_order_wins() {
    OnlineMeeting m =
        fromDescription(
            "문서 https://example.com/a 먼저 https://zoom.us/j/111 그다음 https://meet.google.com/abc-defg-hij");
    assertThat(m).isEqualTo(new OnlineMeeting("ZOOM", "https://zoom.us/j/111"));
  }

  /** 설명에 없으면 장소에서 찾는다 — 설명이 우선. */
  @Test
  void falls_back_to_location_after_description() {
    assertThat(
            OnlineMeetingResolver.resolve(
                null, "링크 없음", "https://meet.google.com/abc-defg-hij"))
        .isEqualTo(new OnlineMeeting("MEET", "https://meet.google.com/abc-defg-hij"));
    assertThat(
            OnlineMeetingResolver.resolve(
                null, "https://zoom.us/j/1", "https://meet.google.com/abc-defg-hij"))
        .isEqualTo(new OnlineMeeting("ZOOM", "https://zoom.us/j/1"));
  }

  @Test
  void trims_trailing_punctuation_brackets_and_korean_particles() {
    assertThat(fromDescription("(https://zoom.us/j/123456789)."))
        .isEqualTo(new OnlineMeeting("ZOOM", "https://zoom.us/j/123456789"));
    assertThat(fromDescription("https://zoom.us/j/123456789에서 만나요"))
        .isEqualTo(new OnlineMeeting("ZOOM", "https://zoom.us/j/123456789"));
    // Graph 텍스트 본문의 `글자<URL>` 꼴
    assertThat(fromDescription("Teams 모임 참가 <" + TEAMS_JOIN + ">\n"))
        .isEqualTo(new OnlineMeeting("TEAMS", TEAMS_JOIN));
  }

  /** 프론트 trimUrlEnd 와 같은 규칙 — 짝 없는 `]`·`}` 도 뗀다(`회의 [https://…]`). */
  @Test
  void trims_unmatched_square_and_curly_closers() {
    assertThat(fromDescription("회의 [https://zoom.us/j/123456]"))
        .isEqualTo(new OnlineMeeting("ZOOM", "https://zoom.us/j/123456"));
    assertThat(fromDescription("회의 {https://zoom.us/j/123456}"))
        .isEqualTo(new OnlineMeeting("ZOOM", "https://zoom.us/j/123456"));
  }

  /** 모든 저장 주소 검사가 같은 helper — 파싱 불가·호스트 없음은 거절. */
  @Test
  void isHttpUrl_requires_parseable_uri_with_host() {
    assertThat(OnlineMeetingResolver.isHttpUrl("https://zoom.us/j/1")).isTrue();
    assertThat(OnlineMeetingResolver.isHttpUrl("https:///nohost")).isFalse();
    assertThat(OnlineMeetingResolver.isHttpUrl("https://exa mple.com/x")).isFalse();
    assertThat(OnlineMeetingResolver.isHttpUrl("javascript:alert(1)")).isFalse();
    assertThat(OnlineMeetingResolver.isHttpUrl(null)).isFalse();
  }
}
