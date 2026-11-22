package com.workplace.global.util;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;

import java.time.Duration;
import java.util.Random;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

/** InvisibleChars(WP-2011) — 옛 정규식과 결과가 같고, 긴 입력에서 선형 시간인지 확인한다. */
class InvisibleCharsTest {
  private static final String CLASS = PersonNames.INVISIBLE_CLASS;
  private static final Pattern ORACLE = Pattern.compile("^" + CLASS + "+|" + CLASS + "+$");

  /** 시간 상한 — 느린 CI·냉 JIT 여유를 둔다. 제곱 시간이면 200k 입력에서 수십 초 이상이라 여전히 잡힌다. */
  private static final Duration LIMIT = Duration.ofSeconds(5);

  /** 무작위 입력에서 옛 정규식(오라클)과 같은 결과를 내는지 — 고정 시드. */
  @Test
  void stripEdges_matchesOldRegex_onRandomInputs() {
    String[] alphabet = {
      "a",
      "가",
      " ",
      "\t",
      "\n",
      "\u00A0",
      "\u200B",
      "\uFEFF",
      "\u3164",
      "\u2800",
      "\u0301",
      "\u034F",
      "\uFE0F",
      "\u0085",
      "\u2028",
      "\u202E",
      "\uD83D\uDE00",
      "\uDB40\uDC01",
      "\r",
      "\r\n",
      "\uD800",
      "\uDC00"
    };
    Random random = new Random(2011L);
    for (int i = 0; i < 5000; i++) {
      StringBuilder sb = new StringBuilder();
      int len = random.nextInt(13);
      for (int j = 0; j < len; j++) {
        sb.append(alphabet[random.nextInt(alphabet.length)]);
      }
      String input = sb.toString();
      assertEquals(ORACLE.matcher(input).replaceAll(""), InvisibleChars.stripEdges(input), input);
    }
  }

  /** 판정이 옛 문자 클래스와 BMP 전체·샘플 보충 평면 코드 포인트에서 같은지. */
  @Test
  void isInvisible_matchesClass_forAllBmpAndSampledSupplementary() {
    Pattern cls = Pattern.compile(CLASS);
    for (int cp = 0; cp <= 0xFFFF; cp++) {
      if (cp >= 0xD800 && cp <= 0xDFFF) {
        continue;
      }
      check(cls, cp);
    }
    for (int cp : new int[] {0xE0001, 0x1F600, 0xE0020}) {
      check(cls, cp);
    }
  }

  private static void check(Pattern cls, int cp) {
    boolean expected = cls.matcher(new String(Character.toChars(cp))).matches();
    assertEquals(expected, InvisibleChars.isInvisible(cp), "U+" + Integer.toHexString(cp));
  }

  /** 글자 사이의 긴 보이지 않는 줄이 있어도 5초 안에 끝나고 가운데는 건드리지 않는다. */
  @Test
  void stripEdges_longInvisibleRunBetweenLetters_isFast() {
    String middle = "a" + "\u200B".repeat(200_000) + "b";
    String both = " ".repeat(200_000) + "a" + " ".repeat(200_000);
    assertEquals(middle, assertTimeoutPreemptively(LIMIT, () -> InvisibleChars.stripEdges(middle)));
    assertEquals("a", assertTimeoutPreemptively(LIMIT, () -> InvisibleChars.stripEdges(both)));
  }

  /** 세 호출처도 긴 입력에서 빠르고 가운데를 건드리지 않는다. */
  @Test
  void threeCallers_longInput_isFast() {
    String input = "a" + " ".repeat(200_000) + "b";
    assertEquals(input, assertTimeoutPreemptively(LIMIT, () -> SingleLineTitles.normalize(input)));
    assertEquals(input, assertTimeoutPreemptively(LIMIT, () -> PersonNames.normalize(input)));
    assertEquals(input, assertTimeoutPreemptively(LIMIT, () -> Texts.stripInvisibleToNull(input)));
  }

  /** 옛 정규식의 `$` 가 끝의 U+0085 앞에서도 맞던 동작을 그대로 지키는지. */
  @Test
  void stripEdges_invisibleRunBeforeFinalNel_isStripped() {
    assertEquals("a\u0085", InvisibleChars.stripEdges("a \t\u200B\u0085"));
    assertEquals(
        ORACLE.matcher("a \t\u200B\u0085").replaceAll(""),
        InvisibleChars.stripEdges("a \t\u200B\u0085"));
  }

  @Test
  void stripEdges_allInvisible_isEmpty() {
    assertEquals("", InvisibleChars.stripEdges(" \u200B\u3164\u2800\uFEFF\n"));
  }

  @Test
  void stripEdges_empty_isEmpty() {
    assertEquals("", InvisibleChars.stripEdges(""));
  }
}
