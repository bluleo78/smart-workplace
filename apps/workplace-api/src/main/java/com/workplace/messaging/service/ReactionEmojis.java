package com.workplace.messaging.service;

import java.util.regex.Pattern;

/**
 * 리액션 값 판정(WP-594). 리액션은 이모지 하나(확장 그래핌 하나)만 받는다 — 글자·HTML·이모지 여러 개·보이지 않는 문자가 리액션 줄에 붙으면 「승인함」처럼 공식
 * 표시로 오해되거나 무엇인지 알 수 없는 칩이 생긴다. 웹 피커 목록으로 제한하지 않는 것은 AI 도구(MCP)가 다른 이모지를 쓸 수 있게 하려는 것이다.
 */
final class ReactionEmojis {

  /** 확장 그래핌 하나 — 피부색·ZWJ 묶음(👩‍💻)·국기(🇰🇷)·키캡(1️⃣)도 한 덩어리로 본다. */
  private static final Pattern ONE_GRAPHEME = Pattern.compile("\\X");

  private ReactionEmojis() {}

  /** 값이 이모지 하나인가. 그래핌이 하나이고, 그림 이모지이거나 이모지 표시(FE0F·키캡·국기)가 붙은 것만 참. */
  static boolean isSingleEmoji(String value) {
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
}
