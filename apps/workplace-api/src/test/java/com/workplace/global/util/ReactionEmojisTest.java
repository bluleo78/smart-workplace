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

  /** WP-1199: 같은 그림으로 보이는 표기는 하나로 — 웹 피커가 보내는 완전한 표기와 같게. */
  @Test
  void normalizesVariationSelectorsToFullyQualifiedForm() {
    String heart = "\u2764\uFE0F";
    assertThat(ReactionEmojis.normalize("\u2764")).isEqualTo(heart);
    assertThat(ReactionEmojis.normalize(heart)).isEqualTo(heart);
    assertThat(ReactionEmojis.normalize("\u2764\uFE0F\uFE0F")).isEqualTo(heart);
    assertThat(ReactionEmojis.normalize("\u00A9")).isEqualTo("\u00A9\uFE0F");
    // 기본이 그림 표시인 문자는 FE0F 를 뗀다.
    assertThat(ReactionEmojis.normalize("\uD83D\uDE00\uFE0F")).isEqualTo("\uD83D\uDE00");
    assertThat(ReactionEmojis.normalize("👍")).isEqualTo("👍");
    // 여러 글자 묶음은 이어 붙은 FE0F 만 줄인다.
    assertThat(ReactionEmojis.normalize("1\uFE0F\uFE0F\u20E3")).isEqualTo("1\uFE0F\u20E3");
    assertThat(ReactionEmojis.normalize("👩‍💻")).isEqualTo("👩‍💻");
    assertThat(ReactionEmojis.normalize("🛠️")).isEqualTo("🛠️");
    // 이모지가 아니면 그대로.
    assertThat(ReactionEmojis.normalize("승인함")).isEqualTo("승인함");
  }

  /** 웹 피커 이모지는 정규화해도 그대로다 — 기존에 저장된 피커 리액션과 새 리액션이 갈리지 않게. */
  @Test
  void webPickerEmojisAreAlreadyNormalized() {
    for (String e : new String[] {"👍", "❤️", "✅", "❌", "✨", "⭐", "⚡", "🛠️", "☕", "🔥", "🙏"}) {
      assertThat(ReactionEmojis.normalize(e)).as(e).isEqualTo(e);
    }
  }
}
