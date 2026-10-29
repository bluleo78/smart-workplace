package com.workplace.issue.dto;

import com.workplace.global.util.SingleLineTitles;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * 이슈 상태 분류 상수. 상태는 문자열 컬럼이라 enum 이 없어서, "종료" 판단 기준을 쿼리·서비스마다 리터럴로 반복하던 것을 한 곳에 모은다(WP-243). 진행률
 * 집계·에픽 완료 차단·블로커 계산이 같은 기준을 써야 서로 모순되지 않는다.
 *
 * <p>프로젝트별 상태(WP-807) 이후 issue.status 는 상태의 <b>범주</b>(TODO/IN_PROGRESS/DONE/CANCELED)이고, 실제 상태는
 * project_status 행이다. 여기 상수는 범주 값이다.
 */
public final class IssueStatuses {

  /** 범주 — 할 일. */
  public static final String TODO = "TODO";

  /** 범주 — 진행 중. */
  public static final String IN_PROGRESS = "IN_PROGRESS";

  /** 범주 — 완료. */
  public static final String DONE = "DONE";

  /** 범주 — 취소. */
  public static final String CANCELED = "CANCELED";

  /** 범주의 화면·보드 순서. 프로젝트 상태 목록은 이 순서로 묶이고, 범주 안에서는 position 순이다. */
  public static final List<String> CATEGORY_ORDER = List.of(TODO, IN_PROGRESS, DONE, CANCELED);

  /**
   * 요청 DTO 의 범주 검증 정규식 — {@code @Pattern(regexp = ...)} 은 컴파일 타임 상수만 받아 {@link #CATEGORY_ORDER} 에서
   * 만들 수 없으므로 한 곳에 문자열로 둔다(범주를 늘리면 둘을 함께 고친다).
   */
  public static final String CATEGORY_REGEX =
      TODO + "|" + IN_PROGRESS + "|" + DONE + "|" + CANCELED;

  /** 종료 상태(Jira 의 Done 분류) — 완료와 취소 모두 "끝난 일"로 본다. */
  public static final Set<String> CLOSED = Set.of(DONE, CANCELED);

  /** 열린 범주(종료가 아닌 것) — 화면 순서대로. 「아직 할 일」만 보는 조회가 호출부마다 다시 만들지 않게 둔다(WP-1104). */
  public static final List<String> OPEN =
      CATEGORY_ORDER.stream().filter(c -> !CLOSED.contains(c)).toList();

  private IssueStatuses() {}

  /** 이 범주가 종료(완료·취소)인가. null 은 종료가 아니다. */
  public static boolean isClosed(String category) {
    return category != null && CLOSED.contains(category);
  }

  /** 4개 범주 값 중 하나인가. */
  public static boolean isCategory(String value) {
    return value != null && CATEGORY_ORDER.contains(value);
  }

  /**
   * 프로젝트 상태 이름 비교 키(WP-807) — 저장 규칙 {@link SingleLineTitles#normalize}(NFC·줄바꿈→공백·앞뒤의 보이지 않는 문자
   * 제거)로 다듬은 뒤 {@code toLowerCase(Locale.ROOT)}. 저장되는 이름은 이미 이 정규화를 거쳤으므로, 유일 인덱스의 {@code
   * lower(btrim(name))} 와 같은 이름을 같게 본다(btrim 은 ASCII 공백만 지우지만 저장값엔 가장자리 공백이 없다). 이름으로 상태를 찾는 곳(검색
   * statusName 필터)이 입력 토큰을 저장과 같은 규칙으로 다듬어 NFD·제로폭·전각 공백이 붙은 토큰도 같은 상태를 찾게 한다.
   */
  public static String statusNameKey(String name) {
    return SingleLineTitles.normalize(name).toLowerCase(Locale.ROOT);
  }
}
