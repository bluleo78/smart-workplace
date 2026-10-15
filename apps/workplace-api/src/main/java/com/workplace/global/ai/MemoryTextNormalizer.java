package com.workplace.global.ai;

import java.text.Normalizer;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * 메모리 문장 정규화(WP-385) — 지운 기록과 새 정리 결과가 "같은 말"인지 가르는 문자열 키. 개인 지운 기록(ai_memory_forgotten)과 WP-386 공용
 * 지운 기록이 같은 규칙을 쓰도록 global 에 둔다.
 *
 * <p>규칙: NFKC(전각 → 반각) → 소문자(Locale.ROOT) → 공백·문장부호·기호를 모두 걷는다(한국어는 띄어쓰기가 흔들려 공백도 뺀다) → 300
 * 코드포인트(DB VARCHAR(300)). 빈 결과는 어떤 기록과도 겹치지 않는 것으로 다룬다(호출자 책임).
 */
public final class MemoryTextNormalizer {

  /** 정규화 결과 최대 길이(코드포인트) — DB normalized VARCHAR(300). */
  public static final int MAX_CODE_POINTS = 300;

  /** 걷어 낼 문자 — 문장부호(\p{P})·기호(\p{S}, 이모지 포함)·공백. */
  private static final Pattern STRIP = Pattern.compile("[\\p{P}\\p{S}\\s]+");

  /** 지울 제어 문자 — 줄바꿈·탭을 뺀 나머지(NUL 등). Postgres 텍스트·JSONB 가 NUL 을 받지 않는다. */
  private static final Pattern CONTROL = Pattern.compile("[\\p{Cc}&&[^\\t\\n\\r]]");

  private MemoryTextNormalizer() {}

  /** 정규화 키 — null 이면 빈 문자열. */
  public static String normalize(String text) {
    if (text == null) return "";
    String n = Normalizer.normalize(text, Normalizer.Form.NFKC).toLowerCase(Locale.ROOT);
    n = STRIP.matcher(n).replaceAll("");
    return headCodePoints(n, MAX_CODE_POINTS);
  }

  /** 줄바꿈·탭이 아닌 제어 문자(NUL 등)를 지운다 — AI·사용자가 보낸 내용·사유를 DB 에 쓰기 전에(WP-385 최종 리뷰). null 이면 null. */
  public static String stripControl(String text) {
    return text == null ? null : CONTROL.matcher(text).replaceAll("");
  }

  /** 앞 max 코드포인트(서로게이트 쌍을 가르지 않는다) — 길이가 같거나 짧으면 그대로. 사유·발화 자르기도 이 하나를 쓴다. */
  public static String headCodePoints(String s, int max) {
    if (s.codePointCount(0, s.length()) <= max) return s;
    return s.substring(0, s.offsetByCodePoints(0, max));
  }
}
