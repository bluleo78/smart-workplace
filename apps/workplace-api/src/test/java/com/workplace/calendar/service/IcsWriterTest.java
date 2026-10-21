package com.workplace.calendar.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import org.junit.jupiter.api.Test;

/** 태그 구독 주소(WP-715)의 순수 로직 — iCalendar 이스케이프·75옥텟 접기, ISO 주 해석, 종일 날짜. DB 없이 돈다. */
class IcsWriterTest {

  /** TEXT 값의 역슬래시·세미콜론·쉼표·줄바꿈을 이스케이프한다(RFC 5545 3.3.11). */
  @Test
  void escapeText_escapesBackslashSemicolonCommaNewline() {
    assertThat(IcsWriter.escapeText("a\\b;c,d\ne\r\nf")).isEqualTo("a\\\\b\\;c\\,d\\ne\\nf");
    String out = new IcsWriter().text("SUMMARY", "보고, 회의; 준비").build();
    assertThat(out).isEqualTo("SUMMARY:보고\\, 회의\\; 준비\r\n");
  }

  /** 빈 값은 줄을 쓰지 않는다(LOCATION 없는 일정). */
  @Test
  void blankText_isOmitted() {
    assertThat(new IcsWriter().text("LOCATION", null).text("LOCATION", "  ").build()).isEmpty();
  }

  /** 긴 한글 줄은 75옥텟마다 접히고(이어지는 줄은 공백 하나로 시작), 글자를 쪼개지 않으며, 펼치면 원래 값이 된다. */
  @Test
  void fold_splitsAt75Octets_withoutBreakingMultibyteChars() {
    String title = "가".repeat(60) + "😀끝";
    String out = new IcsWriter().text("SUMMARY", title).build();
    assertThat(out).endsWith("\r\n");
    String[] lines = out.substring(0, out.length() - 2).split("\r\n", -1);
    assertThat(lines.length).isGreaterThan(1);
    for (int i = 0; i < lines.length; i++) {
      assertThat(lines[i].getBytes(StandardCharsets.UTF_8).length).isLessThanOrEqualTo(75);
      if (i > 0) assertThat(lines[i]).startsWith(" ");
      // 서로게이트 쌍이 줄 경계에서 갈라지지 않는다
      assertThat(Character.isHighSurrogate(lines[i].charAt(lines[i].length() - 1))).isFalse();
    }
    String unfolded = out.substring(0, out.length() - 2).replace("\r\n ", "");
    assertThat(unfolded).isEqualTo("SUMMARY:" + title);
  }

  /** 사람 줄 — CN 은 큰따옴표로 감싸고 따옴표는 뺀다. 이메일이 없으면 쓰지 않는다. */
  @Test
  void person_quotesCn_andSkipsMissingEmail() {
    String out =
        new IcsWriter()
            .person("ATTENDEE", "김 \"철수\"", "kim@corp.kr", "ACCEPTED")
            .person("ATTENDEE", "이메일 없음", null, null)
            .build();
    assertThat(out).isEqualTo("ATTENDEE;CN=\"김 철수\";PARTSTAT=ACCEPTED:mailto:kim@corp.kr\r\n");
  }

  /** ?week= — ISO 주의 월요일. 없으면 오늘이 든 주, 형식 오류·그 해에 없는 주는 400 사유. */
  @Test
  void weekStart_parsesIsoWeek() {
    LocalDate today = LocalDate.of(2026, 10, 22); // 목요일
    assertThat(CalendarTagFeedService.weekStart("2026-W43", today))
        .isEqualTo(LocalDate.of(2026, 10, 19));
    assertThat(CalendarTagFeedService.weekStart(null, today)).isEqualTo(LocalDate.of(2026, 10, 19));
    assertThat(CalendarTagFeedService.weekStart("", today)).isEqualTo(LocalDate.of(2026, 10, 19));
    // 연도 경계 — 2026-W01 은 2025-12-29(월)에 시작한다
    assertThat(CalendarTagFeedService.weekStart("2026-W01", today))
        .isEqualTo(LocalDate.of(2025, 12, 29));
    // 53주가 있는 해(2026)와 없는 해(2025)
    assertThat(CalendarTagFeedService.weekStart("2026-W53", today))
        .isEqualTo(LocalDate.of(2026, 12, 28));
    assertThatThrownBy(() -> CalendarTagFeedService.weekStart("2025-W53", today))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> CalendarTagFeedService.weekStart("2026-W00", today))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> CalendarTagFeedService.weekStart("2026-43", today))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> CalendarTagFeedService.weekStart("2026-W4", today))
        .isInstanceOf(IllegalArgumentException.class);
  }

  /** 종일 날짜 — 앱 종일(한국 자정 = 전날 15:00Z)과 M365 종일(UTC 자정)이 모두 의도한 날짜가 된다. */
  @Test
  void allDayDate_handlesKstAndUtcMidnight() {
    assertThat(CalendarTagFeedService.allDayDate(OffsetDateTime.parse("2026-10-21T15:00:00Z")))
        .isEqualTo(LocalDate.of(2026, 10, 22));
    assertThat(CalendarTagFeedService.allDayDate(OffsetDateTime.parse("2026-10-23T00:00:00Z")))
        .isEqualTo(LocalDate.of(2026, 10, 23));
  }
}
