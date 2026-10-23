package com.workplace.issue.dto;

import java.util.List;

/**
 * 이슈 우선순위 값의 단일 출처(WP-886). 우선순위는 문자열 컬럼이라 enum 이 없어서, 요청 DTO 검증·검색 필터·AI 제안 보정이 같은 집합을 쓰도록 한 곳에
 * 모은다.
 *
 * <p>모든 프로젝트 공통의 고정 5단계다(프로젝트별 정의 아님). Jira 이전 데이터(Highest·High·Medium·Low·Lowest)를 담고, 운영 장애 같은 긴급
 * 결함을 「높음」과 따로 거를 수 있게 3단계(LOW·MID·HIGH)에 HIGHEST·LOWEST 를 더했다. 기존 저장값은 그대로라 데이터 이전이 없다. DB CHECK
 * (V211)·웹 {@code ISSUE_PRIORITIES}·MCP {@code mcp-tools-shared} 의 목록도 같은 값이어야 하므로 바꿀 땐 함께 바꾼다.
 */
public final class IssuePriorities {

  /** 매우 높음 — 운영 장애·보안·데이터 손실처럼 즉시 처리할 긴급 건. */
  public static final String HIGHEST = "HIGHEST";

  /** 높음. */
  public static final String HIGH = "HIGH";

  /** 보통 — 생성 시 기본값. */
  public static final String MID = "MID";

  /** 낮음. */
  public static final String LOW = "LOW";

  /** 매우 낮음. */
  public static final String LOWEST = "LOWEST";

  /** 기본 우선순위 — 지정하지 않은 생성에 쓴다. */
  public static final String DEFAULT = MID;

  /** 표시 순서(매우 높음 → 매우 낮음). 검색 필터 오류 문구도 이 순서로 나열한다. */
  public static final List<String> ORDER = List.of(HIGHEST, HIGH, MID, LOW, LOWEST);

  /**
   * 요청 DTO 의 우선순위 검증 정규식 — {@code @Pattern(regexp = ...)} 은 컴파일 타임 상수만 받아 {@link #ORDER} 에서 만들 수
   * 없으므로 상수를 이어 붙여 둔다(값을 늘리면 둘을 함께 고친다).
   */
  public static final String REGEX = HIGHEST + "|" + HIGH + "|" + MID + "|" + LOW + "|" + LOWEST;

  private IssuePriorities() {}
}
