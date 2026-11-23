package com.workplace.issue.workflow.repository;

import java.time.Instant;
import java.util.List;

/**
 * 실행 목록 한 줄(WP-1985) — 실행 행에 이슈 번호·제목, 고정한 버전 번호, 지금 노드 방문(가장 최근 node_run)의 담당·들어간 시각을 붙인 것.
 *
 * @param versionId 실행이 고정한 게시 버전 id(지금 노드 이름을 그 버전 모델에서 찾는다)
 * @param assigneeIds 지금 노드 방문의 담당(방문이 없으면 빈 목록)
 * @param enteredAt 지금 노드에 들어간 시각(방문이 없으면 null)
 */
public record RunListRow(
    long runId,
    long issueId,
    int issueNumber,
    String title,
    String status,
    String currentNode,
    long versionId,
    int versionNo,
    Instant startedAt,
    List<Long> assigneeIds,
    Instant enteredAt) {}
