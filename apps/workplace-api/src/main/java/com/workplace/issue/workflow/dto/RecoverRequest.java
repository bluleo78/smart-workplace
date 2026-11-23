package com.workplace.issue.workflow.dto;

import com.workplace.issue.dto.IssueTextLimits;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * 멈춘(SUSPENDED) 워크플로우 실행의 조치 요청(WP-1986, 설계 §5-5).
 *
 * <p>expectedRevision 은 필수다 — 빠진 revision 이 0 으로 읽혀 남이 이미 바꾼 실행에 조치가 겹치지 않게(이동과 같은 규칙). 조치는 멱등 key
 * 를 받지 않는다 — 조치가 끝나면 실행이 SUSPENDED 를 벗어나거나 revision 이 올라 같은 요청의 재시도는 409 로 막힌다.
 *
 * @param action 조치 종류
 * @param toNode 옮길 노드(MOVE_TO 에서만 필수, 다른 조치는 보지 않는다)
 * @param comment 의견 — 있으면 이동 의견과 같은 경로로 이슈 댓글이 된다(상한은 댓글과 같다)
 * @param expectedRevision 요청자가 본 실행 revision
 */
public record RecoverRequest(
    @NotNull Action action,
    String toNode,
    @StorableText @Size(max = IssueTextLimits.BODY_MAX) String comment,
    @NotNull Integer expectedRevision) {

  /** 조치 종류 — 다시 시도·onError 로 보냄·관리자 옮기기·실행 취소. */
  public enum Action {
    RETRY,
    ON_ERROR,
    MOVE_TO,
    CANCEL
  }
}
