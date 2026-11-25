package com.workplace.issue.workflow.dto;

import com.workplace.global.dto.UserSummary;
import java.time.Instant;

/**
 * 내 작업 「내 차례」 한 줄(WP-1991, {@code GET /me/workflow-turns}) — 내가 담당인 활성 사람 노드.
 *
 * @param issueNumber 프로젝트 안의 이슈 번호 — 이슈 링크용(issueKey 를 쪼개 읽지 않게)
 * @param issueKey 「프로젝트 키-번호」
 * @param nodeName 노드 이름(모델에 없으면 null)
 * @param enteredAt 이 노드에 들어간 시각 — 오래 기다린 순의 기준
 * @param handedBy 앞 노드를 마치고 넘긴 사람(없으면 null)
 * @param question 지금 노드에서 아직 답하지 않은 질문의 첫 줄(앞뒤 빈 줄·공백을 건너뛴 첫 줄, 없으면 null)
 * @param asking 지금 노드가 질문 경로(returnTo 가 있는 사람 노드)인가 — 이면 이슈 챗에서 답한다(WP-2093)
 */
public record MyWorkflowTurn(
    long runId,
    long issueId,
    int issueNumber,
    String issueKey,
    String title,
    long projectId,
    String projectKey,
    long workflowId,
    String workflowName,
    int versionNo,
    String nodeKey,
    String nodeName,
    Instant enteredAt,
    UserSummary handedBy,
    String question,
    boolean asking) {}
