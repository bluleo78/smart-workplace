package com.workplace.messaging.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.dto.MentionResponse;
import java.util.List;
import org.junit.jupiter.api.Test;

/** 푸시 미리보기 — 멘션 토큰을 @이름으로, 첨부만이면 고정 문구, 120자 제한. */
class MessagePushPreviewTest {

  @Test
  void replacesMentionTokens() {
    String p =
        MessagePushPreview.of(
            "<@12> 리뷰 부탁 <@99>", List.of(new MentionResponse(12L, "kim", "김철수", "HUMAN")), false);
    assertThat(p).isEqualTo("@김철수 리뷰 부탁 @사용자");
  }

  @Test
  void attachmentOnly_fixedText() {
    assertThat(MessagePushPreview.of("", List.of(), true)).isEqualTo("파일을 보냈습니다");
    assertThat(MessagePushPreview.of(null, List.of(), true)).isEqualTo("파일을 보냈습니다");
  }

  @Test
  void truncatesTo120() {
    assertThat(MessagePushPreview.of("가".repeat(200), List.of(), false)).hasSize(121);
  }

  @Test
  void collapsesWhitespace() {
    assertThat(MessagePushPreview.of("줄1\n\n줄2   끝", List.of(), false)).isEqualTo("줄1 줄2 끝");
  }

  /** WP-101: 마크다운 기호는 지우고 멘션은 그대로 이름으로 바꾼다. */
  @Test
  void stripsMarkdownBeforeMentions() {
    String p =
        MessagePushPreview.of(
            "<@12> **배포** 확인\n- [로그](https://a.com/x) 보기\n```\nint a = 2*3;\n```",
            List.of(new MentionResponse(12L, "kim", "*김*철수", "HUMAN")),
            false);
    assertThat(p).isEqualTo("@*김*철수 배포 확인 로그 보기 int a = 2*3;");
  }

  @Test
  void keepsPlainSymbols() {
    assertThat(MessagePushPreview.of("snake_case 2*3 a_b", List.of(), false))
        .isEqualTo("snake_case 2*3 a_b");
  }
}
