package com.workplace.fileai.security;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/** HTML 스크립트 판정 규칙(WP-1262) — 웹 {@code htmlHasScripts} 와 같은 예시 JSON 을 함께 읽어 두 판정이 어긋나지 않게 한다. */
class HtmlScriptRulesTest {

  /** 웹 테스트와 공유하는 판정 예시 — 하나라도 다르면 실패한다. */
  @Test
  void hasScripts_matchesSharedCases() throws Exception {
    Path path = Path.of("../workplace-web/src/lib/htmlHasScripts.cases.json");
    JsonNode cases = new ObjectMapper().readTree(Files.readString(path));
    assertThat(cases.size()).isGreaterThanOrEqualTo(10);
    for (JsonNode c : cases) {
      String html = c.get("html").asText();
      boolean expected = c.get("hasScripts").asBoolean();
      assertThat(HtmlScriptRules.hasScripts(html))
          .as("%s — %s", c.get("note").asText(), html)
          .isEqualTo(expected);
    }
  }

  /** mime 이 HTML 이거나, 비었거나 범용이면서 확장자가 .html/.htm 일 때만 HTML 로 본다. */
  @ParameterizedTest
  @CsvSource(
      value = {
        "text/html; charset=utf-8|a.txt|true",
        "application/octet-stream|Deck.HTM|true",
        "NULL|x.html|true",
        "text/plain|x.html|false",
        "application/octet-stream|x.svg|false",
        "TEXT/HTML|x|true",
        "|page.htm|true",
        "binary/octet-stream|NULL|false"
      },
      delimiter = '|',
      nullValues = "NULL")
  void isHtml_followsWebMimeRules(String mime, String filename, boolean expected) {
    assertThat(HtmlScriptRules.isHtml(mime, filename)).isEqualTo(expected);
  }
}
