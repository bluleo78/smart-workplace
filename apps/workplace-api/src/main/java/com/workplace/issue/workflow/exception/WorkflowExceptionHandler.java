package com.workplace.issue.workflow.exception;

import com.workplace.issue.workflow.dto.WorkflowErrorResponse;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.util.Map;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * {@link WorkflowException} 만 응답으로 옮긴다. 전역 처리기의 {@code Exception} 처리가 먼저 잡으면 {@code problems} 가
 * 사라지므로 가장 먼저 돈다. 다른 예외(입력 검증·권한·프로젝트 404)는 전역 처리기의 본문 그대로다.
 */
@Order(Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice
public class WorkflowExceptionHandler {

  /** 전역 본문과 같은 칸에 problems 를 더해 낸다(422 외에는 빈 목록). */
  @ExceptionHandler(WorkflowException.class)
  public ResponseEntity<WorkflowErrorResponse> handle(
      WorkflowException e, HttpServletRequest request) {
    return ResponseEntity.status(e.status())
        .body(
            new WorkflowErrorResponse(
                e.status().value(),
                e.status().getReasonPhrase(),
                e.getMessage(),
                Map.of("code", e.code()),
                Instant.now().toString(),
                request.getRequestURI(),
                e.problems()));
  }
}
