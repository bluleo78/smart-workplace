package com.workplace.global.ical;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
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
}
