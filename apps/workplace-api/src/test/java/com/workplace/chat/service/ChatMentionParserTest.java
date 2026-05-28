package com.workplace.chat.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/**
 * @username 정규식 파서. 중복 제거, 매칭 없음 케이스 검증.
 */
class ChatMentionParserTest {

  @Test
  void parse_singleMention_returnsUsername() {
    assertThat(ChatMentionParser.parse("@alice 안녕")).containsExactly("alice");
  }

  @Test
  void parse_multipleMentions_deduplicated() {
    assertThat(ChatMentionParser.parse("@alice @bob @alice 처리")).containsExactly("alice", "bob");
  }

  @Test
  void parse_noMention_returnsEmpty() {
    assertThat(ChatMentionParser.parse("그냥 메시지입니다")).isEmpty();
  }

  @Test
  void parse_emailLikeText_capturesTrailingHandle() {
    assertThat(ChatMentionParser.parse("문의 foo@bar.com")).containsExactly("bar.com");
  }

  @Test
  void parse_allowedCharset_underscoreDotDash() {
    assertThat(ChatMentionParser.parse("@user.name @user_name @user-name"))
        .containsExactly("user.name", "user_name", "user-name");
  }
}
