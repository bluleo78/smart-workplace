package com.workplace.issue.exception;

import java.util.List;

/**
 * 하위 태스크가 달린 이슈를 에픽으로 바꾸려는데 하위 태스크를 어떻게 할지(변환 유형) 정하지 않았다 — 400(WP-2098).
 *
 * <p>에픽 바로 아래에는 하위 태스크를 둘 수 없어 막는다. 응답에 막는 하위 태스크 중 호출자가 읽을 수 있는 것의 키를 싣는다(읽을 수 없는 것은 키를 드러내지 않고
 * 문구의 「외 n개」에만 센다)({@code errors.code} = {@link #CODE}, {@code errors.issueKeys} = 번호 순 키를 {@code
 * ,} 로 이은 문자열). 문구는 화면 용어로 — 토스트로 그대로 보인다.
 *
 * <p>누가 이 응답을 받나: 웹은 에픽으로 바꾸기 전에 하위를 먼저 조회해 변환 확인 창을 띄우고 고른 유형을 {@code convertSubtasksToTypeId} 로
 * 함께 보내므로 보통은 받지 않는다 — 조회와 저장 사이에 하위 태스크가 새로 생긴 경합에서만 받고, 그때는 {@code errors.code} 로 가르지 않고 문구를 토스트로
 * 보인다. {@code errors.code}·{@code errors.issueKeys} 는 옵션 없이 부르는 API 호출자가 가르는 데 쓴다 — MCP {@code
 * update_issue} 는 코드로 가르지 않고 문구를 그대로 돌려주며, AI 가 그 안내를 보고 {@code convertSubtasksToType} 을 넣어 다시 부른다.
 */
public class SubtaskConversionRequiredException extends RuntimeException {

  /** 응답 {@code errors.code} 값 — 옵션 없이 부르는 API 호출자가 이 코드로 가른다(웹·MCP 는 쓰지 않는다 — 위 클래스 설명). */
  public static final String CODE = "SUBTASK_CONVERT_REQUIRED";

  /** 문구에 직접 나열하는 키 개수 — 넘으면 「외 n개」로 줄인다. */
  private static final int SHOWN = 3;

  private final List<String> issueKeys;

  /**
   * @param issueKeys 막는 하위 태스크 키(번호 순, 전체)
   */
  public SubtaskConversionRequiredException(List<String> issueKeys) {
    this(issueKeys, 0);
  }

  /**
   * @param issueKeys 호출자가 읽을 수 있는 막는 하위 태스크 키(번호 순)
   * @param unreadableCount 호출자가 읽을 수 없어 키를 드러내지 않는 하위 태스크 수 — 「외 n개」에만 센다
   */
  public SubtaskConversionRequiredException(List<String> issueKeys, int unreadableCount) {
    super(message(issueKeys, unreadableCount));
    this.issueKeys = List.copyOf(issueKeys);
  }

  public List<String> getIssueKeys() {
    return issueKeys;
  }

  /**
   * 「하위 태스크 A, B, C 외 n개가 있어 에픽으로 바꿀 수 없습니다」. 나열할 키 외에 남는 것이 없으면 「하위 태스크 n개(A, B)가 …」 — 키 바로 뒤에 조사를
   * 붙이면 끝 숫자의 소리에 따라 「이/가」가 갈리므로 「개」 뒤에 붙인다.
   */
  private static String message(List<String> keys, int unreadableCount) {
    int total = keys.size() + unreadableCount;
    List<String> shownKeys = keys.subList(0, Math.min(SHOWN, keys.size()));
    String shown = String.join(", ", shownKeys);
    int rest = total - shownKeys.size();
    if (shownKeys.isEmpty()) return "하위 태스크 " + rest + "개가 있어 에픽으로 바꿀 수 없습니다";
    if (rest > 0) return "하위 태스크 " + shown + " 외 " + rest + "개가 있어 에픽으로 바꿀 수 없습니다";
    return "하위 태스크 " + total + "개(" + shown + ")가 있어 에픽으로 바꿀 수 없습니다";
  }
}
