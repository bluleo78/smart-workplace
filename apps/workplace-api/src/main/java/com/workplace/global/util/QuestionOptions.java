package com.workplace.global.util;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;

/**
 * AI 질문 글의 답 선택지(WP-1569) 정리·검증 규칙 — 이슈 챗 질문 아래 「빠른 답변」 칩으로 보이는 문구다. report_agent_work 의 options
 * 검증(issue)과 서버 보완 추출 결과 정리(chat)가 같은 규칙을 쓰도록 한 곳에 둔다.
 *
 * <p>정리: 앞뒤 공백 제거 → 빈 값 제거 → 중복 제거(처음 나온 순서 유지). 유효: 정리 뒤 {@value #MIN}~{@value #MAX}개이고 각 {@value
 * #MAX_CHARS}자(코드 포인트) 이하 — 칩 한 줄에 들어가는 길이이고, 하나뿐이면 고를 것이 없다.
 */
public final class QuestionOptions {

  /** 선택지 최소 개수 — 하나뿐이면 고를 것이 없어 칩을 두지 않는다. */
  public static final int MIN = 2;

  /** 선택지 최대 개수 — 칩이 질문 아래를 덮지 않게. */
  public static final int MAX = 4;

  /** 선택지 한 개 최대 길이(코드 포인트) — 칩 한 줄. */
  public static final int MAX_CHARS = 40;

  private QuestionOptions() {}

  /** 앞뒤 공백 제거·빈 값 제거·중복 제거(순서 유지). null 이면 빈 목록. */
  public static List<String> normalize(List<String> raw) {
    if (raw == null) return List.of();
    LinkedHashSet<String> seen = new LinkedHashSet<>();
    for (String s : raw) {
      if (s == null) continue;
      String t = s.strip();
      if (!t.isEmpty()) seen.add(t);
    }
    return List.copyOf(seen);
  }

  /** 정리된 목록이 저장할 수 있는 선택지인지 — 개수 {@value #MIN}~{@value #MAX}, 각 {@value #MAX_CHARS}자 이하. */
  public static boolean isValid(List<String> normalized) {
    if (normalized == null || normalized.size() < MIN || normalized.size() > MAX) return false;
    return normalized.stream().allMatch(QuestionOptions::fitsLength);
  }

  /**
   * AI 가 뽑은 선택지(서버 보완 추출)를 저장할 모양으로 — 정리 뒤 너무 긴 것은 버리고 앞에서 {@value #MAX}개까지. {@value #MIN}개가 안 되면 빈
   * 목록(칩 없음). 사람이 보낸 요청과 달리 거절할 상대가 없어, 쓸 수 있는 것만 남긴다.
   */
  public static List<String> fromExtracted(List<String> items) {
    List<String> kept = new ArrayList<>(MAX);
    for (String s : normalize(items)) {
      if (!fitsLength(s)) continue;
      kept.add(s);
      if (kept.size() == MAX) break;
    }
    return kept.size() < MIN ? List.of() : List.copyOf(kept);
  }

  /** 코드 포인트 기준 길이 상한 — 이모지(서로게이트 쌍)를 두 글자로 세지 않는다. */
  private static boolean fitsLength(String s) {
    return s.codePointCount(0, s.length()) <= MAX_CHARS;
  }
}
