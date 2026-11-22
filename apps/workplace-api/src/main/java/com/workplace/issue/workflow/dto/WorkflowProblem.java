package com.workplace.issue.workflow.dto;

/**
 * 워크플로우 정의의 문제 한 건(파서·검증기 공용).
 *
 * <p>왜: 편집기가 줄·열로 잘못된 곳을 짚어 주고, 게시가 ERROR 가 있으면 거절해야 해서 심각도·코드·위치를 한 모양으로 묶는다. 행·열은 1 부터이고 열은
 * UTF-16 단위로 센다(자바스크립트 문자열과 같다 — 코드 포인트·바이트가 아니다). 위치를 모르면 1행 1열(0 은 쓰지 않는다). {@code nodeKey} 는 문제가
 * 어느 노드 안에 있는지(없으면 null).
 *
 * @param severity ERROR 또는 WARNING
 * @param code 대문자 snake 문제 코드(예: YAML_SYNTAX)
 * @param message 사용자에게 보이는 쉬운 우리말 설명
 * @param line 1 부터 시작하는 줄
 * @param column 1 부터 시작하는 열(UTF-16 단위 — 보조 평면 글자는 2)
 * @param nodeKey 문제가 속한 노드 키(없으면 null)
 */
public record WorkflowProblem(
    String severity, String code, String message, int line, int column, String nodeKey) {

  /** 심각도: 게시를 막는 문제. */
  public static final String ERROR = "ERROR";

  /** 심각도: 게시는 되지만 확인을 권하는 문제. */
  public static final String WARNING = "WARNING";
}
