package com.workplace.issue.exception;

/** 이슈당 첨부 개수 한도(20개)를 초과한 경우 — HTTP 409 매핑. */
public class AttachmentLimitExceededException extends RuntimeException {

  /**
   * 현재 + 신규 + 한도 모두 메시지에 포함하고, 남은 자리도 알린다 — 사용자가 몇 개를 덜 붙이면 되는지 바로 알 수 있게(WP-2118). 이미 한도를 넘긴 이슈(예:
   * 한도를 낮추기 전 데이터)는 음수가 되지 않게 0 으로 자른다.
   */
  public AttachmentLimitExceededException(int current, int adding, int max) {
    super(
        "이슈당 첨부 한도("
            + max
            + "개)를 초과합니다: 현재 "
            + current
            + " + 신규 "
            + adding
            + " — "
            + remainingText(Math.max(0, max - current)));
  }

  /** 남은 자리 문구 — 0 이면 더 붙일 수 없다고, 아니면 몇 개 더 붙일 수 있는지 말한다. */
  private static String remainingText(int remaining) {
    return remaining == 0 ? "더 붙일 수 없습니다" : remaining + "개 더 붙일 수 있습니다";
  }
}
