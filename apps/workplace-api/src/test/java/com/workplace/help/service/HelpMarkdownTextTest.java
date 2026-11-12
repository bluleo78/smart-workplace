package com.workplace.help.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** 마크다운 → 평문 변환 단위 시험(WP-1509). */
class HelpMarkdownTextTest {

  @Test
  void stripsMarkupKeepsPlaceholders() {
    String md =
        "### 토큰 {help=agent.run label=실행}\n![그림](a.png){crop=dialog}\n**토큰 다시 넣기** 를 [여기](help:agent) 누릅니다 {agent.username}";
    assertThat(HelpMarkdownText.toPlain(md)).isEqualTo("토큰\n토큰 다시 넣기 를 여기 누릅니다 {agent.username}");
  }

  @Test
  void stripsConditionMarksKeepsInnerText() {
    // 줄 단위 표기는 줄째 사라지고, 줄 안 표기는 표기만 지워 안의 글을 둔다. `$`·`\` 뒤 중괄호는 표기가 아니다.
    String md =
        "앞 문단.\n{if app.customMcpServer}\n안 문단.\n{/if}\n앞 {if app.customMcpServer}가운데{/if} 뒤 ${if a.b}";
    assertThat(HelpMarkdownText.toPlain(md)).isEqualTo("앞 문단.\n안 문단.\n앞 가운데 뒤 ${if a.b}");
  }

  @Test
  void nullIsEmpty() {
    assertThat(HelpMarkdownText.toPlain(null)).isEmpty();
  }
}
