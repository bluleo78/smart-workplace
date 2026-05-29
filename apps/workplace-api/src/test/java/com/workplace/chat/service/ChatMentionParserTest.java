package com.workplace.chat.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** <@id> 토큰 파서. 중복 제거(첫 등장 순서), 비토큰 무시. */
class ChatMentionParserTest {

  @Test
  void parse_singleToken_returnsId() {
    assertThat(ChatMentionParser.parse("안녕 <@42>")).containsExactly(42L);
  }

  @Test
  void parse_multipleTokens_deduplicatedInOrder() {
    assertThat(ChatMentionParser.parse("<@42> <@7> <@42> 처리")).containsExactly(42L, 7L);
  }

  @Test
  void parse_noToken_returnsEmpty() {
    assertThat(ChatMentionParser.parse("그냥 메시지입니다")).isEmpty();
  }

  @Test
  void parse_plainAtText_isIgnored() {
    // 옛 @username / 이메일 텍스트는 토큰이 아니므로 무시.
    assertThat(ChatMentionParser.parse("@alice foo@bar.com")).isEmpty();
  }

  @Test
  void parse_malformedToken_isIgnored() {
    assertThat(ChatMentionParser.parse("<@> <@abc> <@1a>")).isEmpty();
  }
}
