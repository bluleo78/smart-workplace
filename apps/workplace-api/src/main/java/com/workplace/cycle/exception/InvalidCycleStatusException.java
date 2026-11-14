package com.workplace.cycle.exception;

/**
 * 허용되지 않은 사이클 상태 — 400 매핑. 전역 처리기가 메시지를 그대로 돌려주므로 화면에 보일 한국어 문구를 담는다.
 *
 * <p>상황마다 문구가 달라 생성자는 감추고 상황별 정적 팩토리로만 만든다 — 상태값을 받는 경우와 완성된 문구를 받는 경우가 같은 {@code String} 시그니처라
 * 생성자로는 가를 수 없어서다.
 */
public class InvalidCycleStatusException extends RuntimeException {

  /** 화면에 그대로 보일 완성된 문구로 만든다. */
  private InvalidCycleStatusException(String message) {
    super(message);
  }

  /** 상태값이 화이트리스트({@code CycleStatus.ALL})에 없을 때 — 받은 값을 문구에 그대로 보인다. */
  public static InvalidCycleStatusException unknown(String status) {
    return new InvalidCycleStatusException("허용되지 않은 사이클 상태: " + status);
  }

  /** 사이클 완료(WP-1578) — 진행 중이 아닌 사이클을 완료하려 할 때. 완료 창이 이 문구를 그대로 보인다. */
  public static InvalidCycleStatusException notActiveToComplete() {
    return new InvalidCycleStatusException("진행 중인 사이클만 완료할 수 있습니다");
  }

  /** 사이클 완료(WP-1578) — 미완료 이슈를 보낼 사이클이 예정(PLANNED)이 아닐 때. */
  public static InvalidCycleStatusException targetNotPlanned() {
    return new InvalidCycleStatusException("예정 사이클로만 보낼 수 있습니다");
  }
}
