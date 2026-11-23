package com.workplace.issue.workflow.domain;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 이동·시작 판정의 위반 한 건 — 서비스가 첫 위반을 그대로 오류 응답으로 옮긴다.
 *
 * <p>왜: 판정은 DB·Spring 없는 순수 함수라 HTTP 예외를 던지지 않고 값으로 돌려준다. {@code code} 는 응답 {@code errors.code} 로,
 * {@code errors} 는 그 옆의 나머지 칸(STALE 의 currentNode·revision, 출력의 keys, 담당의 role·candidates)으로 간다.
 *
 * @param status HTTP 상태
 * @param code 오류 code(문자열 그대로 계약)
 * @param message 한국어 문장
 * @param errors code 를 뺀 오류 칸(문자열 맵)
 */
public record MoveViolation(int status, String code, String message, Map<String, String> errors) {

  /** errors 를 순서를 지킨 불변 사본으로. */
  public MoveViolation {
    errors = errors == null ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(errors));
  }

  /** 실행이 끝났거나 이슈가 닫혔다(§7 의 4). */
  public static MoveViolation notActive() {
    return new MoveViolation(
        409, "WORKFLOW_NOT_ACTIVE", "진행 중인 워크플로우 실행이 없습니다. 끝났거나 이슈가 닫혔습니다.", Map.of());
  }

  /** 본 뒤에 노드·revision 이 바뀌었다(§7 의 5). 다시 읽게 지금 값을 함께 준다. */
  public static MoveViolation stale(String currentNode, int revision) {
    Map<String, String> errors = new LinkedHashMap<>();
    errors.put("currentNode", currentNode == null ? "" : currentNode);
    errors.put("revision", Integer.toString(revision));
    return new MoveViolation(
        409, "WORKFLOW_STALE", "그사이 워크플로우가 바뀌었습니다. 새로 불러온 뒤 다시 시도해 주세요.", errors);
  }

  /** 실행이 멈췄거나 노드가 막혔다(§7 의 6). */
  public static MoveViolation nodeSuspended() {
    return new MoveViolation(
        409, "WORKFLOW_NODE_SUSPENDED", "워크플로우가 멈춰 있어 넘길 수 없습니다. 조치를 먼저 해 주세요.", Map.of());
  }

  /** 지금 노드의 담당도 관리자도 아니다(§7 의 7). */
  public static MoveViolation notAssignee() {
    return new MoveViolation(
        403, "WORKFLOW_NOT_ASSIGNEE", "지금 단계의 담당자나 프로젝트 관리자만 넘길 수 있습니다.", Map.of());
  }

  /** 지금 노드에 없는 결과. */
  public static MoveViolation unknownOutcome() {
    return new MoveViolation(422, "WORKFLOW_UNKNOWN_OUTCOME", "지금 단계에 없는 결과입니다.", Map.of());
  }

  /** 꼭 내놓아야 할 출력이 없다. */
  public static MoveViolation outputMissing(String keys) {
    return new MoveViolation(
        422, "WORKFLOW_OUTPUT_MISSING", "꼭 내놓아야 할 값이 빠졌습니다.", Map.of("keys", keys));
  }

  /** 출력의 형식이 틀렸거나 선언하지 않은 키이거나 너무 크다. */
  public static MoveViolation outputInvalid(String keys, String message) {
    return new MoveViolation(422, "WORKFLOW_OUTPUT_INVALID", message, Map.of("keys", keys));
  }

  /** 의견이 필요한 결과에 의견이 없다. */
  public static MoveViolation commentRequired() {
    return new MoveViolation(422, "WORKFLOW_COMMENT_REQUIRED", "이 결과로 넘기려면 의견을 적어 주세요.", Map.of());
  }

  /** 담당을 정할 수 없어 골라야 한다. role·candidates 로 다시 보낼 수 있게 한다. */
  public static MoveViolation assigneeRequired(String role, String candidates, String message) {
    return new MoveViolation(
        422, "WORKFLOW_ASSIGNEE_REQUIRED", message, roleErrors(role, candidates));
  }

  /** 보낸 담당이 후보 밖이다. */
  public static MoveViolation assigneeNotInRole(String role, String candidates) {
    return new MoveViolation(
        422,
        "WORKFLOW_ASSIGNEE_NOT_IN_ROLE",
        "담당은 다음 단계 역할의 후보 중에서 골라 주세요.",
        roleErrors(role, candidates));
  }

  /**
   * 기준(keep·생략)이 정해졌는데 기준과 다른 담당(일부만 고른 것 포함)을 보냈다. candidates 는 기준 담당이다.
   *
   * <p>왜: 기준이 있으면 그 담당이 그대로 이어진다. 일부만 보낸 요청도 받아 주면 「기준이면 그대로」가 조용히 바뀌므로 거절하고, 다시 보낼 방법을 알린다.
   */
  public static MoveViolation assigneeNotBasis(String role, String basisCandidates) {
    return new MoveViolation(
        422,
        "WORKFLOW_ASSIGNEE_NOT_IN_ROLE",
        "기준 담당이 그대로 이어집니다. assigneeIds 를 비우거나 후보 전원을 보내 주세요.",
        roleErrors(role, basisCandidates));
  }

  private static Map<String, String> roleErrors(String role, String candidates) {
    Map<String, String> errors = new LinkedHashMap<>();
    errors.put("role", role == null ? "" : role);
    errors.put("candidates", candidates);
    return errors;
  }
}
