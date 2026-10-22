package com.workplace.global.util;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** WP-594: 리액션 값은 이모지 하나(그래핌 하나)만 — 글자·HTML·여러 개·보이지 않는 문자는 거절. */
class ReactionEmojisTest {

  /** 웹 EmojiPicker 가 고를 수 있는 이모지(emojiSets.ts PICKER_EMOJIS)는 모두 받는다. */
  @Test
  void acceptsEveryWebPickerEmoji() {
    String[] picker = {
      "👍", "👎", "❤️", "🔥", "🎉", "😄", "😅", "😂", "🙂", "😍", "🤔", "😮", "😢", "😡", "🙏",
          "👏", "🙌",
      "💪", "✅", "❌", "👀", "🚀", "💯", "✨", "⭐", "💡", "📌", "⚡", "🐛", "🛠️", "☕", "🍕", "🎈",
          "🥳",
      "😴", "🤯", "😎", "🤝", "👋", "💩"
    };
    for (String e : picker) {
      assertThat(ReactionEmojis.isSingleEmoji(e)).as(e).isTrue();
    }
  }

  /** 피커 밖이라도 이모지 하나면 받는다 — AI 도구(MCP react_to_message)가 다른 이모지를 쓸 수 있다. */
  @Test
  void acceptsOtherSingleEmojiGraphemes() {
    for (String e : new String[] {"🤖", "👍🏽", "👩‍💻", "🇰🇷", "1️⃣", "❤"}) {
      assertThat(ReactionEmojis.isSingleEmoji(e)).as(e).isTrue();
    }
  }

  @Test
  void rejectsTextHtmlMultipleAndInvisible() {
    for (String e :
        new String[] {
          "가나다라마바사",
          "<b>x</b>",
          "👍👍",
          "👍👍👍👍👍👍👍👍",
          "​",
          "a",
          "1",
          "#",
          " ",
          "",
          "👍 ",
          "승인함"
        }) {
      assertThat(ReactionEmojis.isSingleEmoji(e)).as(e).isFalse();
    }
    assertThat(ReactionEmojis.isSingleEmoji(null)).isFalse();
  }
}
