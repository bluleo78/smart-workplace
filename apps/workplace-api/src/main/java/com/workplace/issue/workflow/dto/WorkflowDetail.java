package com.workplace.issue.workflow.dto;

import java.time.Instant;
import java.util.List;

/**
 * 워크플로우 한 건의 응답.
 *
 * @param activeVersion 게시한 적 없으면 null
 * @param draftUpdatedAt 다음 저장·게시 때 {@code expectedDraftUpdatedAt} 으로 되보낼 값
 * @param draftProblems 저장해 두지 않고 읽을 때마다 지금 구성원으로 다시 계산한 문제
 */
public record WorkflowDetail(
    long id,
    long projectId,
    String name,
    boolean enabled,
    WorkflowActiveVersion activeVersion,
    String draftYaml,
    Instant draftUpdatedAt,
    List<WorkflowProblem> draftProblems) {}
