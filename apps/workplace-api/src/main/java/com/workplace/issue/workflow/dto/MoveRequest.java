package com.workplace.issue.workflow.dto;

import com.workplace.issue.dto.IssueTextLimits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
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
 */
public record MoveRequest(
    @NotBlank String fromNode,
    @NotBlank String outcome,
    Map<String, Object> outputs,
    List<Long> assigneeIds,
    @StorableText @Size(max = IssueTextLimits.BODY_MAX) String comment,
    @NotNull Integer expectedRevision,
    @NotBlank @Size(max = 400) String idempotencyKey) {}
