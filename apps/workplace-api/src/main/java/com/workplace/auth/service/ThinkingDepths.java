package com.workplace.auth.service;

import java.util.Set;

/**
 * 생각의 깊이 값 규칙(WP-1322) 한 곳 — 새 값은 DEFAULT(설정 안 함)와 추론 노력 단계 LOW~MAX. 옛 값(NONE/NORMAL/DEEP)은 한 릴리스
 * 동안 옛 웹 화면이 계속 보낼 수 있어 받되, 저장 전에 V264 마이그레이션과 같은 규칙으로 새 값으로 바꾼다 — Claude 연결이면 NONE→LOW,
 * NORMAL→HIGH, DEEP→MAX, 그 외(OpenAI 호환·연결 없음)는 DEFAULT(모델마다 단계가 달라 단정할 수 없다).
 */
public final class ThinkingDepths {

  /** 「설정 안 함」 — 모델 기본 추론 노력. */
  public static final String DEFAULT = "DEFAULT";

  /** 저장되는 새 값 — DEFAULT 와 추론 노력 단계(낮은 순). */
  public static final Set<String> ALLOWED =
      Set.of(DEFAULT, "LOW", "MEDIUM", "HIGH", "XHIGH", "MAX");

  /** 옛 값 — 한 릴리스 동안 요청으로 받되 저장 전에 바꾼다. 다음 릴리스에서 PATTERN 과 함께 뺀다. */
  public static final Set<String> LEGACY = Set.of("NONE", "NORMAL", "DEEP");

  /**
   * 요청 검증 정규식(ALLOWED ∪ LEGACY) — {@code @Pattern} 은 컴파일 시점 상수만 받아 집합에서 만들지 못하고 문자열로 둔다. 두 집합과 같은지는
   * ThinkingDepthsTest 가 지킨다.
   */
  public static final String PATTERN = "DEFAULT|LOW|MEDIUM|HIGH|XHIGH|MAX|NONE|NORMAL|DEEP";

  private ThinkingDepths() {}

  /** 옛 값(NONE/NORMAL/DEEP)인가. */
  public static boolean isLegacy(String depth) {
    return depth != null && LEGACY.contains(depth);
  }

  /**
   * 저장할 값 — 새 값·null 은 그대로, 옛 값은 연결 provider 로 옮긴다.
   *
   * @param anthropic 비서의 지금 연결이 Claude(anthropic)인가 — 연결이 없으면 false
   */
  public static String toStored(String depth, boolean anthropic) {
    if (!isLegacy(depth)) return depth;
    if (!anthropic) return DEFAULT;
    return switch (depth) {
      case "NONE" -> "LOW";
      case "NORMAL" -> "HIGH";
      default -> "MAX";
    };
  }
}
