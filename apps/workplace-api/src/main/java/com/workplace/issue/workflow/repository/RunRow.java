package com.workplace.issue.workflow.repository;

import java.time.Instant;

/**
 * 워크플로우 실행 한 행(workflow_run).
 *
 * @param versionId 실행에 고정한 게시 버전 id
 * @param status RUNNING·WAITING·SUSPENDED(활성), COMPLETED·CANCELED(끝남)
 * @param currentNode 지금 머무는 노드 key(끝났으면 end 또는 null)
 * @param contextJson 실행 문맥 JSON 글(DB 가 공백 등을 정리해 돌려줄 수 있다)
 * @param revision 낙관적 잠금 번호(시작 0, 바뀔 때마다 +1)
 * @param startedBy 시작한 사용자(탈퇴했으면 null)
 * @param endedAt 끝난 시각(진행 중이면 null)
 */
public record RunRow(
    long id,
    long issueId,
    long versionId,
    String status,
    String currentNode,
    String contextJson,
    int revision,
    Long startedBy,
    Instant startedAt,
    Instant endedAt) {}
