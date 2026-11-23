package com.workplace.issue.workflow.dto;

import com.workplace.issue.dto.IssueTextLimits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;

/**
 * 노드 이동 요청.
 *
 * <p>expectedRevision·idempotencyKey 는 필수다 — 빠진 revision 이 0 으로 읽히거나 키 없는 재시도가 두 번 넘기지 않게(설계 §7).
 *
 * @param fromNode 요청자가 본 지금 노드
 * @param outcome 고른 결과 키
 * @param outputs 내놓는 값(노드 outputs 선언대로)
 * @param assigneeIds 다음 담당(필요할 때만)
 * @param comment 의견 — 있으면 이슈 댓글이 된다(상한은 댓글과 같다)
 * @param expectedRevision 요청자가 본 실행 revision
 * @param idempotencyKey 재시도 식별 키(1~400자)
 * @param runId 요청이 겨눈 실행(선택 — 클라이언트가 view 의 runId 를 그대로 보낸다). 빠지면 지금 실행을 겨눈 것으로 본다(하위 호환). 왜: AI 는
 *     key 를 결정적으로 만들어 실행이 바뀌어도 같은 key 를 다시 쓴다. 멱등 조회를 겨눈 실행 하나로 좁혀야 옛 실행에서 쓴 key 가 새 실행의 이동을
 *     막거나(조용한 무시·STALE) 하지 않는다. 그래도 옛 실행을 겨눈 재시도는 그 실행의 첫 응답을 받는다(리뷰 후속 R40).
 */
public record MoveRequest(
    @NotBlank String fromNode,
    @NotBlank String outcome,
    Map<String, Object> outputs,
    List<Long> assigneeIds,
    @StorableText @Size(max = IssueTextLimits.BODY_MAX) String comment,
    @NotNull Integer expectedRevision,
    @NotBlank @Size(max = 400) String idempotencyKey,
    @Positive Long runId) {

  /** runId 없이 만든다 — 지금 실행을 겨눈 요청(서버 안 호출·테스트용). */
  public MoveRequest(
      String fromNode,
      String outcome,
      Map<String, Object> outputs,
      List<Long> assigneeIds,
      String comment,
      Integer expectedRevision,
      String idempotencyKey) {
    this(fromNode, outcome, outputs, assigneeIds, comment, expectedRevision, idempotencyKey, null);
  }
}
