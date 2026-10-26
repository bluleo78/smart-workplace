package com.workplace.version.dto;

import com.workplace.issue.dto.IssueHistoryEventType;

/**
 * 이슈 ↔ 버전 연결 종류(issue_version.kind, WP-888) — 수정 버전 FIX·영향 버전 AFFECTS. DB 값·저장소·서비스·이력·가져오기가 같은 글자를
 * 쓰도록 한 곳에 둔다. 종류 ↔ 이력 유형 매핑도 여기만 안다 — FIX 가 아니면 AFFECTS 로 보는 기존 기본값을 그대로 지킨다.
 */
public final class VersionKind {

  /** 수정 버전 — 이 버전에 나가는 이슈. */
  public static final String FIX = "FIX";

  /** 영향 버전 — 이 버전에서 난 결함. */
  public static final String AFFECTS = "AFFECTS";

  private VersionKind() {}

  /** 수정 버전 종류인가 — 아니면 영향 버전으로 본다. */
  public static boolean isFix(String kind) {
    return FIX.equals(kind);
  }

  /** 종류 → 변경 이력 유형(FIX_VERSIONS_CHANGED·AFFECTS_VERSIONS_CHANGED). */
  public static IssueHistoryEventType historyType(String kind) {
    return isFix(kind)
        ? IssueHistoryEventType.FIX_VERSIONS_CHANGED
        : IssueHistoryEventType.AFFECTS_VERSIONS_CHANGED;
  }

  /** 버전 변경 이력 유형인지(가져오기의 이력 이름). */
  public static boolean isHistoryType(String type) {
    return IssueHistoryEventType.FIX_VERSIONS_CHANGED.name().equals(type)
        || IssueHistoryEventType.AFFECTS_VERSIONS_CHANGED.name().equals(type);
  }

  /** 변경 이력 유형 이름 → 종류. */
  public static String fromHistoryType(String type) {
    return IssueHistoryEventType.FIX_VERSIONS_CHANGED.name().equals(type) ? FIX : AFFECTS;
  }
}
