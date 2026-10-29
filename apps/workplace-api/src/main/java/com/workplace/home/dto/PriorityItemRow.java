package com.workplace.home.dto;

/** AI 가 산출한 항목 하나의 중요도/긴급도 점수. sourceType/sourceId 로 원본 식별. */
public record PriorityItemRow(
    String sourceType,
    String sourceId,
    String title,
    String deepLink,
    int importanceScore,
    int urgencyScore,
    String reason) {

  /** 이슈 마감 후보의 sourceType — sourceId 는 이슈 id. 배치(저장)와 조회(읽을 때 거르기)가 같은 값을 쓴다(WP-1104). */
  public static final String ISSUE_DUE = "ISSUE_DUE";

  /**
   * 저장 행 키 {@code sourceType:sourceId} — sourceId 는 소스마다 다른 시퀀스라 단독으로는 겹친다. 배치 매칭·정리와 저장소 삭제 조건(SQL
   * 의 같은 이어 붙이기)이 이 형식 하나를 쓴다.
   */
  public static String key(String sourceType, String sourceId) {
    return sourceType + ":" + sourceId;
  }
}
