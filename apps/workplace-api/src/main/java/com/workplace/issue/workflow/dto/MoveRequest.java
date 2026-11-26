package com.workplace.issue.workflow.dto;

import com.workplace.global.util.QuestionOptions;
import com.workplace.issue.dto.IssueTextLimits;
import jakarta.validation.constraints.AssertTrue;
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
 * @param comment 의견 — 있으면 이슈 댓글이 된다(상한은 댓글과 같다). 질문 이동(ask)이면 이슈 챗 「답변 필요 질문」 글이 된다
 * @param expectedRevision 요청자가 본 실행 revision
 * @param idempotencyKey 재시도 식별 키(1~400자)
 * @param runId 요청이 겨눈 실행(선택 — 클라이언트가 view 의 runId 를 그대로 보낸다). 빠지면 지금 실행을 겨눈 것으로 본다(하위 호환). 왜: AI 는
 *     key 를 결정적으로 만들어 실행이 바뀌어도 같은 key 를 다시 쓴다. 멱등 조회를 겨눈 실행 하나로 좁혀야 옛 실행에서 쓴 key 가 새 실행의 이동을
 *     막거나(조용한 무시·STALE) 하지 않는다. 그래도 옛 실행을 겨눈 재시도는 그 실행의 첫 응답을 받는다(리뷰 후속 R40).
 * @param fileIds 질문 글에 붙일 스테이징 파일(시안·스크린샷, WP-2147) — 질문 이동에서만. 의견 안 {@code ![](file:N)} 자리표시 첨부와
 *     합쳐 붙는다. report_agent_work 의 fileIds 와 같은 쓰임이다
 * @param options 질문 글의 답 선택지(WP-2147) — 질문 이동에서만. 정리 뒤 2~4개, 각 40자 이하({@link QuestionOptions}). 주면
 *     그대로 칩이 되고, 안 주면 지금처럼 서버가 질문 글에서 뽑는다(WP-1569)
 */
public record MoveRequest(
    @NotBlank String fromNode,
    @NotBlank String outcome,
    Map<String, Object> outputs,
    List<Long> assigneeIds,
    @StorableText @Size(max = IssueTextLimits.BODY_MAX) String comment,
    @NotNull Integer expectedRevision,
    @NotBlank @Size(max = 400) String idempotencyKey,
    @Positive Long runId,
    @Size(max = 10) List<Long> fileIds,
    List<String> options) {

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

  /** 첨부·선택지 없이 만든다 — 질문 부가 정보가 없는 이동(서버 안 호출·테스트용, WP-2147 전 모양). */
  public MoveRequest(
      String fromNode,
      String outcome,
      Map<String, Object> outputs,
      List<Long> assigneeIds,
      String comment,
      Integer expectedRevision,
      String idempotencyKey,
      Long runId) {
    this(
        fromNode,
        outcome,
        outputs,
        assigneeIds,
        comment,
        expectedRevision,
        idempotencyKey,
        runId,
        null,
        null);
  }

  /** 첨부 — 보내지 않았으면 빈 목록. */
  @Override
  public List<Long> fileIds() {
    return fileIds == null ? List.of() : fileIds;
  }

  /** 선택지 개수·길이 — report_agent_work 와 같은 규칙(정리 뒤 2~4개, 각 40자 이하). */
  @AssertTrue(message = "options 는 공백·중복을 뺀 2~4개, 각 40자 이하여야 합니다")
  public boolean isOptionsShapeValid() {
    return options == null || QuestionOptions.isValid(QuestionOptions.normalize(options));
  }

  /** 저장할 선택지 — 정리한 목록. 보내지 않았거나 정리 뒤 비면 null(「선택지 없음」 → 서버 보완 추출). */
  public List<String> normalizedOptions() {
    List<String> normalized = QuestionOptions.normalize(options);
    return normalized.isEmpty() ? null : normalized;
  }

  /** 질문 글에 붙는 부가 정보(첨부·선택지)를 보냈는지. */
  public boolean hasQuestionExtras() {
    return !fileIds().isEmpty() || options != null;
  }
}
