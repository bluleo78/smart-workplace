package com.workplace.global.util;

import java.util.regex.Pattern;

/**
 * 리액션 값 판정(WP-594). 리액션은 이모지 하나(확장 그래핌 하나)만 받는다 — 글자·HTML·이모지 여러 개·보이지 않는 문자가 리액션 줄에 붙으면 「승인함」처럼 공식
 * 표시로 오해되거나 무엇인지 알 수 없는 칩이 생긴다. 웹 피커 목록으로 제한하지 않는 것은 AI 도구(MCP)가 다른 이모지를 쓸 수 있게 하려는 것이다. 채팅 메시지 반응과
 * 이슈 코멘트 반응(WP-504)이 함께 쓰므로 global.util 에 둔다.
 */
public final class ReactionEmojis {

  /** 확장 그래핌 하나 — 피부색·ZWJ 묶음(👩‍💻)·국기(🇰🇷)·키캡(1️⃣)도 한 덩어리로 본다. */
  private static final Pattern ONE_GRAPHEME = Pattern.compile("\\X");

  private ReactionEmojis() {}

  /** 값이 이모지 하나인가. 그래핌이 하나이고, 그림 이모지이거나 이모지 표시(FE0F·키캡·국기)가 붙은 것만 참. */
  public static boolean isSingleEmoji(String value) {
    if (value == null || value.isEmpty() || !ONE_GRAPHEME.matcher(value).matches()) {
      return false;
    }
    int first = value.codePointAt(0);
    // ❤·☕ 처럼 그림 문자(Extended_Pictographic)거나, 😀 처럼 기본이 이모지 표시인 문자(국기 지역 표시 문자 포함).
    if (Character.isExtendedPictographic(first) || Character.isEmojiPresentation(first)) {
      return true;
    }
    // 1️⃣·#️⃣ 키캡 — 숫자·기호 자체는 이모지 속성이 있어도 단독으로는 글자라, 키캡 결합 문자가 붙을 때만 이모지로 본다.
    return Character.isEmoji(first) && value.indexOf('⃣') >= 0;
  }

  /** 이모지 표시 문자(VS16) — 앞 글자를 그림으로 보이게 한다. */
  private static final String VS16 = "\uFE0F";

  /** 이어 붙은 이모지 표시 문자 — 하나로 줄인다. */
  private static final Pattern VS16_RUN = Pattern.compile("\uFE0F{2,}");

  /**
   * 같은 그림으로 보이는 리액션 값을 하나로 맞춘다(WP-1199). 이모지 표시 문자(U+FE0F) 유무·개수만 다른 값이 서로 다른 리액션으로 저장돼 똑같이 보이는 「❤
   * 1」 칩이 여러 개 생기고 개수가 합쳐지지 않았다. 유니코드가 정한 완전한 표기(fully-qualified)로 맞춘다 — 웹 피커가 보내는 값과 같다.
   *
   * <ul>
   *   <li>글자 하나짜리: 기본이 그림 표시인 문자(😀)는 FE0F 를 떼고, 기본이 글자 표시인 문자(❤·©)는 FE0F 를 하나 붙인다(❤ → ❤️).
   *   <li>여러 글자 묶음(ZWJ·키캡 등): 이어 붙은 FE0F 만 하나로 줄인다 — 묶음 안의 FE0F 위치는 표기마다 의미가 있어 건드리지 않는다.
   * </ul>
   *
   * 이모지 하나가 아닌 값({@link #isSingleEmoji} 거짓)은 그대로 돌려준다 — 판정은 호출자가 먼저 한다.
   */
  public static String normalize(String value) {
    if (!isSingleEmoji(value)) return value;
    String base = value.replace(VS16, "");
    if (base.codePointCount(0, base.length()) == 1) {
      return Character.isEmojiPresentation(base.codePointAt(0)) ? base : base + VS16;
    }
    return VS16_RUN.matcher(value).replaceAll(VS16);
  }
}
