package com.workplace.home.service;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 검색 질의 → 부분 일치(ILIKE) 낱말(WP-383·384). 'simple' 전문검색은 "고양이를"과 "고양이"를 다른 낱말로 봐 한글 조사가 붙으면 놓친다 — 질의를
 * 글자·숫자가 아닌 것으로 나누고, 낱말 그대로와 끝 조사를 뗀 형태를 함께 내어 내용 부분 일치로 다시 찾는다. 2자 미만은 너무 많이 맞아 버린다. 기호는 낱말이 되지
 * 않으므로 LIKE 와일드카드가 질의에서 새어 들어오지 않는다(호출자는 그래도 escape 한다).
 */
public final class SearchTerms {

  /** 질의 하나에서 쓰는 낱말 상한 — 긴 질문이 ILIKE 조건을 수십 개 만들지 않게. */
  public static final int MAX_TERMS = 8;

  /** 떼어 볼 조사 — 긴 것부터("에서"를 "서"보다 먼저 보게). 형태소 분석이 아니라 흔한 끝말 근사다. */
  private static final List<String> PARTICLES =
      List.of(
          "에서는", "으로는", "에게서", "에서", "에게", "한테", "까지", "부터", "으로", "처럼", "보다", "하고", "이랑", "랑", "은",
          "는", "이", "가", "을", "를", "에", "의", "도", "로", "와", "과", "만");

  private static final Pattern SPLIT = Pattern.compile("[^\\p{L}\\p{N}]+");

  /** 낱말 최소 길이(코드포인트). */
  private static final int MIN_CHARS = 2;

  private SearchTerms() {}

  /** 질의 → 낱말(최대 {@link #MAX_TERMS}). 순서는 질의 순서, 중복 없음. */
  public static List<String> of(String query) {
    return of(query, MAX_TERMS);
  }

  /** 질의 → 낱말(최대 max) — 소문자, 낱말 그대로 + 조사 뗀 형태. 비거나 null 이면 빈 목록. */
  public static List<String> of(String query, int max) {
    if (query == null || query.isBlank()) return List.of();
    Set<String> out = new LinkedHashSet<>();
    for (String word : SPLIT.split(query.toLowerCase(Locale.ROOT))) {
      addIfLong(out, word, max);
      addIfLong(out, stripParticle(word), max);
    }
    return List.copyOf(out);
  }

  private static void addIfLong(Set<String> out, String term, int max) {
    if (out.size() < max && term.codePointCount(0, term.length()) >= MIN_CHARS) out.add(term);
  }

  /** 한글 낱말 끝 조사를 하나 뗀다 — 떼고 남는 것이 2자 이상일 때만("이가"·"나는" 같은 짧은 낱말을 망가뜨리지 않게). */
  static String stripParticle(String word) {
    if (word.isEmpty() || !isHangulSyllable(word.codePointBefore(word.length()))) return word;
    for (String p : PARTICLES) {
      if (word.endsWith(p)) {
        String base = word.substring(0, word.length() - p.length());
        if (base.codePointCount(0, base.length()) >= MIN_CHARS) return base;
      }
    }
    return word;
  }

  private static boolean isHangulSyllable(int cp) {
    return cp >= 0xAC00 && cp <= 0xD7A3;
  }
}
