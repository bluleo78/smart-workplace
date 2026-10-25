package com.workplace.issue.domain;

import java.util.List;

/**
 * 이슈 관계의 기본 유형(WP-887) — 모든 워크스페이스가 같은 6개를 코드 키로 가진다. AI·MCP·가져오기가 코드로 부르므로 이름·말은 바꿀 수 없고, {@code
 * BLOCKS} 외에는 숨길 수만 있다.
 *
 * <p>이 목록은 두 곳이 같은 값으로 쓴다 — V214 마이그레이션(기존 워크스페이스)과 {@code
 * PlatformTenantRepository.insertBuiltInRelationTypes}(새 워크스페이스). 한쪽만 바꾸면 기존·신규 워크스페이스가 어긋나므로
 * {@code IssueRelationSchemaTest}·{@code NewTenantProvisioningTest} 가 둘을 대조한다.
 *
 * <p>말은 모두 「이 이슈는 ___」의 서술어다. {@code outwardLabel} 은 A(source) 쪽, {@code inwardLabel} 은 B(target)
 * 쪽이며 방향이 없는 유형은 {@code inwardLabel} 이 null 이다.
 */
public final class IssueRelationBuiltIns {

  private IssueRelationBuiltIns() {}

  /** 차단 — 저장은 issue_dependency 그대로이고 관계 유형 행은 목록·숨김 불가 표시용이다. */
  public static final String BLOCKS = "BLOCKS";

  public static final String RELATES = "RELATES";
  public static final String DUPLICATES = "DUPLICATES";
  public static final String CLONES = "CLONES";
  public static final String CAUSES = "CAUSES";

  /** 다른 프로젝트(다른 시스템) 에픽에 속함 — 외부 링크 전용. 방향 있음(외부에서 이 이슈가 A). */
  public static final String PARENT_EPIC = "PARENT_EPIC";

  /** 사용자 정의 유형의 정렬값 — 기본 유형(10~60)보다 항상 뒤. */
  public static final int CUSTOM_SORT_ORDER = 1000;

  /**
   * 기본 유형 한 줄.
   *
   * @param code 코드 키(워크스페이스 안 유일)
   * @param name 유형 이름
   * @param directed 방향 있음 여부
   * @param outwardLabel A 쪽 말
   * @param inwardLabel B 쪽 말(방향 없으면 null)
   * @param externalOnly 외부 링크에만 쓰는 유형
   * @param sortOrder 정렬값
   */
  public record BuiltIn(
      String code,
      String name,
      boolean directed,
      String outwardLabel,
      String inwardLabel,
      boolean externalOnly,
      int sortOrder) {}

  /** 기본 유형 전체 — 정렬값 순. */
  public static final List<BuiltIn> ALL =
      List.of(
          new BuiltIn(BLOCKS, "차단", true, "차단 중", "차단됨", false, 10),
          new BuiltIn(RELATES, "관련", false, "관련", null, false, 20),
          new BuiltIn(DUPLICATES, "중복", true, "중복임", "원본임", false, 30),
          new BuiltIn(CLONES, "복제", true, "복제본임", "복제 원본임", false, 40),
          new BuiltIn(CAUSES, "원인", true, "원인임", "결과임", false, 50),
          new BuiltIn(PARENT_EPIC, "상위 에픽", true, "에픽에 속함", null, true, 60));
}
