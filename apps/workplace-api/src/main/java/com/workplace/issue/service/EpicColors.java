package com.workplace.issue.service;

import java.util.List;
import java.util.Map;

/**
 * 에픽 자동 색(WP-1017) — 새 에픽에 붙일 색을 정한다. 팔레트는 라벨 색 토큰(ColorToken) 12색에서 GRAY 를 뺀 11색이고, 이웃한 색끼리 잘 구분되게
 * 순서를 정했다(V223 백필과 같은 순서). GRAY 는 「색 없음」처럼 보여 자동으로는 주지 않지만 사람이 직접 고를 수는 있다.
 */
public final class EpicColors {
  private EpicColors() {}

  /** 자동 배정 순서 — 앞에서부터 쓴다. */
  public static final List<String> PALETTE =
      List.of(
          "BLUE", "ORANGE", "GREEN", "PURPLE", "RED", "TEAL", "PINK", "YELLOW", "INDIGO", "CYAN",
          "BROWN");

  /**
   * 프로젝트의 에픽 색 사용 수(색 → 에픽 수)를 보고 가장 적게 쓰인 팔레트 색을 고른다. 같으면 팔레트 앞쪽 — 그래서 연달아 만든 에픽은 서로 다른 색을 받고,
   * 11개를 다 쓰면 처음 색부터 다시 돈다. 팔레트 밖 색(사람이 고른 GRAY)은 세지 않는다.
   */
  public static String pickLeastUsed(Map<String, Integer> usage) {
    String best = PALETTE.get(0);
    int bestCount = Integer.MAX_VALUE;
    for (String color : PALETTE) {
      int c = usage.getOrDefault(color, 0);
      if (c < bestCount) {
        best = color;
        bestCount = c;
      }
    }
    return best;
  }
}
