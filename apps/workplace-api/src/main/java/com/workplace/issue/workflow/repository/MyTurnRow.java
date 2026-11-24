package com.workplace.issue.workflow.repository;

import java.time.Instant;

/**
 * 「내 차례」 한 줄의 저장소 행(WP-1991) — 내가 담당인 활성 노드 방문 + 그 실행·이슈·버전·정의 이름.
 *
 * <p>사람 노드 판정·노드 이름·프로젝트 읽기 권한은 저장소가 아니라 서비스가 모델·접근 판정으로 한다(여기는 SQL 로 거른 원자료만).
 *
 * @param projectId 이슈의 프로젝트 id(서비스가 읽기 권한을 보고 키를 붙인다)
 * @param versionId 실행이 고정한 게시 버전 id(노드 종류·이름을 그 버전 모델에서 찾는다)
 * @param enteredAt 이 노드에 들어간 시각(오래 기다린 순 정렬 기준)
 * @param contextJson 실행 context JSON 글(예약 키 {@code _qa} 에서 미답 질문을 찾는다)
 * @param handedById 같은 실행의 바로 앞 방문을 마치게 한 사람(없으면 null)
 */
public record MyTurnRow(
    long runId,
    long issueId,
    int issueNumber,
    String title,
    long projectId,
    long versionId,
    int versionNo,
    long workflowId,
    String workflowName,
    String nodeKey,
    Instant enteredAt,
    String contextJson,
    Long handedById) {}
