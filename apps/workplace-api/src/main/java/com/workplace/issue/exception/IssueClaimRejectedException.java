package com.workplace.issue.exception;

import com.workplace.global.exception.CodedException;
import java.util.Map;
import org.springframework.http.HttpStatus;

/**
 * 대기열 이슈 가져가기(WP-800) 거절 — 409 와 사유 코드를 함께 싣는다. 같은 409 라도 「이미 다른 AI 가 가져감」·「대기열 라벨 없음」·「닫힌
 * 이슈」·「호출자가 사람」은 호출자(MCP·work-loop)가 다음 행동이 달라, 상태만으로는 가를 수 없어 {@code errors.code} 로 구분한다.
 */
public class IssueClaimRejectedException extends RuntimeException implements CodedException {

  /** 대기열 라벨이 이슈에 붙어 있지 않다(프로젝트에 그 라벨이 없는 경우 포함) — 보통 다른 AI 가 먼저 가져가 라벨이 떨어진 것. */
  public static final String NOT_IN_QUEUE = "NOT_IN_QUEUE";

  /** AI(AGENT) 담당자가 이미 있다 — 내부·외부 실행을 가리지 않는다. */
  public static final String AI_ALREADY_ASSIGNED = "AI_ALREADY_ASSIGNED";

  /** 이슈가 완료·취소로 닫혔다. */
  public static final String ISSUE_CLOSED = "ISSUE_CLOSED";

  /** 호출자가 외부 실행 AI 구성원이 아니다 — 사람이면 라벨만 사라지고 AI 가 안 붙고, 내부 실행 AI 면 AI 작업이 안 만들어져 방치되므로 막는다. */
  public static final String CLAIM_AGENT_ONLY = "CLAIM_AGENT_ONLY";

  private final String code;

  public IssueClaimRejectedException(String code, String message) {
    super(message);
    this.code = code;
  }

  /** 응답 상태 — 항상 409. */
  @Override
  public HttpStatus status() {
    return HttpStatus.CONFLICT;
  }

  /** 응답 {@code errors} — 사유 코드 하나. */
  @Override
  public Map<String, String> errors() {
    return Map.of("code", code);
  }
}
