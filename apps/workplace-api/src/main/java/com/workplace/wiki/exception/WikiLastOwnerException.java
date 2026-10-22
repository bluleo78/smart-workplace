package com.workplace.wiki.exception;

import java.util.List;
import java.util.stream.Collectors;

/**
 * 팀 노트 공간의 마지막 OWNER 를 제거·강등하려 함 — 관리자 없는 공간이 남는다(WP-496). HTTP 409. 문구에 공간 이름을 넣어 어느 공간의 소유자를 바꿔야
 * 하는지 알린다(WP-785). id·영문 상수 값(OWNER 등)은 넣지 않는다 — 응답 message 로 그대로 나가 화면·AI 에 내부 번호가 보였다(WP-672,
 * WP-619 후속).
 */
public class WikiLastOwnerException extends RuntimeException {
  private WikiLastOwnerException(String message) {
    super(message);
  }

  /** 멤버 제거·역할 변경 — 그 공간의 멤버 화면에서 난다. */
  public static WikiLastOwnerException ofSpace(String spaceName) {
    return new WikiLastOwnerException(
        quote(List.of(spaceName)) + " 노트 공간에는 소유자가 한 명 이상 있어야 합니다. 다른 멤버를 소유자로 지정한 뒤 다시 시도하세요");
  }

  /**
   * AI 에이전트 삭제 — 관리자가 에이전트 화면에서 지울 때, 그 에이전트가 유일한 소유자인 공간을 한 번에 모두 알린다(하나씩 고치고 다시 시도하며 찾지 않게). 관리자는
   * 그 공간 멤버가 아닐 수 있어 「그 공간에서」 소유자를 지정하라고 쓴다.
   */
  public static WikiLastOwnerException ofAgent(List<String> spaceNames) {
    return new WikiLastOwnerException(
        "이 AI 에이전트가 "
            + quote(spaceNames)
            + " 노트 공간의 유일한 소유자라 삭제할 수 없습니다. 그 공간에서 다른 멤버를 소유자로 지정한 뒤 다시 시도하세요");
  }

  private static String quote(List<String> names) {
    return names.stream().map(n -> "「" + n + "」").collect(Collectors.joining(", "));
  }
}
