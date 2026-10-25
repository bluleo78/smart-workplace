package com.workplace.global.util;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/** 채팅 마크다운 → 미리보기 평문(WP-101). 짝 맞는 기호만 지우고, 코드·이스케이프·멘션·평범한 글자는 지킨다. */
class ChatMarkdownTextTest {

  @ParameterizedTest(name = "[{index}] {0} → {1}")
  @CsvSource(
      delimiter = '|',
      quoteCharacter = '"',
      value = {
        // 강조
        "**굵게** 끝 | 굵게 끝",
        "**중요**한 일 | 중요한 일",
        "*기울임*을 써요 | 기울임을 써요",
        "a *b* c | a b c",
        "~~취소~~ 됨 | 취소 됨",
        "<u>밑줄</u> 글 | 밑줄 글",
        "<U>밑줄</U> | 밑줄",
        "***굵은기울임*** | 굵은기울임",
        "**[링크](https://a.com)** | 링크",
        "[**굵은 링크**](https://a.com) | 굵은 링크",
        "앞**중간**뒤 | 앞중간뒤",
        // 겹친 서식 뒤에 조사가 바로 붙는 경우(WP-101 리뷰) — 기호만 지워지고 글자는 그대로
        "**<u>굵게</u>**을 | 굵게을",
        "~~**굵**~~뒤 | 굵뒤",
        "**~~x~~**뒤 | x뒤",
        "**<@5>**님 | <@5>님",
        "글**<u>x</u>** | 글x",
        // 인라인 코드 — 내용은 남기고 안은 손대지 않음
        "`a*b*c` 보세요 | a*b*c 보세요",
        "`**raw**` | **raw**",
        "`<u>x</u>` | <u>x</u>",
        // 링크
        "[문서](https://a.com/x) 참고 | 문서 참고",
        "[](https://a.com/x_y*z*) | https://a.com/x_y*z*",
        "[위키](https://en.wikipedia.org/wiki/A_(b)) | 위키",
        // 이스케이프
        "\\*별\\* 그대로 | *별* 그대로",
        "a\\_b | a_b",
        "\\[x\\](y) | [x](y)",
        "C:\\Users\\me | C:\\Users\\me",
        // 지켜야 할 평범한 글자
        "a_b | a_b",
        "snake_case_name | snake_case_name",
        "2*3 | 2*3",
        "2*3*4 | 2*3*4",
        "https://a.com/a*b*c | https://a.com/a*b*c",
        "https://a.com/x_y_z | https://a.com/x_y_z",
        "* 혼자 | 혼자",
        "**짝없음 | **짝없음",
        "~~짝없음 | ~~짝없음",
        "* * | *",
        "2026. 10. 25. 회의 | 2026. 10. 25. 회의",
        // 멘션 토큰은 그대로
        "<@12> **확인** 부탁 | <@12> 확인 부탁",
        "<@12><u>밑줄</u> | <@12>밑줄",
      })
  void toPlain(String in, String expected) {
    assertThat(ChatMarkdownText.toPlain(in)).isEqualTo(expected);
  }

  @Test
  void listMarkersAtLineStart() {
    assertThat(ChatMarkdownText.toPlain("할 일\n- 첫째\n* 둘째\n  + 셋째\n1. 하나\n12) 열둘"))
        .isEqualTo("할 일\n첫째\n둘째\n셋째\n하나\n열둘");
  }

  @Test
  void fencedCodeKeepsContentLinesRaw() {
    String in = "코드:\n```java\nint a = 2*3; // **x**\n- not list\n```\n끝 **굵게**";
    assertThat(ChatMarkdownText.toPlain(in))
        .isEqualTo("코드:\nint a = 2*3; // **x**\n- not list\n끝 굵게");
  }

  @Test
  void unclosedFenceStaysLiteral() {
    assertThat(ChatMarkdownText.toPlain("```\n**굵게**")).isEqualTo("```\n굵게");
  }

  @Test
  void crlfAndNull() {
    assertThat(ChatMarkdownText.toPlain("**a**\r\n- b")).isEqualTo("a\nb");
    assertThat(ChatMarkdownText.toPlain(null)).isEmpty();
    assertThat(ChatMarkdownText.toPlain("")).isEmpty();
  }
}
