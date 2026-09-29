package com.workplace.global.util;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** MentionParser — 파싱(중복 제거·순서 유지)과 같은 패턴으로의 표시용 치환. */
class MentionParserTest {

  @Test
  void parse_dedupesInOrder() {
    assertThat(MentionParser.parse("<@2> <@1> <@2>")).containsExactly(2L, 1L);
  }

  @Test
  void replace_usesSamePattern_andQuotesReplacement() {
    // 치환 문자열의 $ 는 정규식 그룹 참조로 해석되면 안 된다(quoteReplacement).
    assertThat(MentionParser.replace("<@1> 안녕 <@2>", id -> id == 1 ? "@김$" : "@?"))
        .isEqualTo("@김$ 안녕 @?");
    // 19자리 이상은 멘션 토큰이 아니다(파싱과 동일한 자릿수 상한).
    assertThat(MentionParser.replace("<@1234567890123456789>", id -> "X"))
        .isEqualTo("<@1234567890123456789>");
    assertThat(MentionParser.replace(null, id -> "X")).isEmpty();
  }
}
