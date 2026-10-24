package com.workplace.issue.outbound;

import com.workplace.issue.dto.AgentWorkState;
import java.util.List;
import java.util.Set;

/**
 * AI 작업 보고로 작업 상태가 알림 대상 값으로 바뀌었다는 이벤트(WP-913). notify 가 커밋 뒤 받아 「검토
 * 요청」(REVIEW)·「실패」(FAILED·REJECTED)· 「답변 필요」(AUTH_REQUIRED·BLOCKED·글 없는 INPUT_REQUIRED) 알림을 만든다.
 *
 * <p>상태가 <b>그 값으로 바뀌는 순간</b>에만 낸다 — 같은 상태 재보고·note 갱신, 이미 끝난 작업의 재종료 보고는 내지 않는다. 작업자가 AI(AGENT)일 때만
 * 낸다 — 판정은 보고 시점에 작업자 종류를 이미 아는 issue 쪽이 하고, notify 는 다시 묻지 않는다.
 *
 * <p>알림 대상 상태 상수·집합은 issue(발행)와 notify(문구·분기)가 함께 쓰는 계약이라 여기 한 곳에 둔다 — 값은 {@link AgentWorkState}
 * 그대로라 두 모듈이 문자열을 따로 베껴 두다 어긋나는 일이 없다.
 *
 * @param state 바뀐 작업 상태(AgentWorkState 값)
 * @param delegateCandidates 검토 요청·실패 수신 후보 — [그 AI 담당 행의 assigned_by, 이슈 보고자] 순서, null 제외
 */
public record AgentWorkNoticeEvent(
    long issueId, long workerId, String state, List<Long> delegateCandidates) {

  /** 검토 대기 → AI_REVIEW_REQUESTED. */
  public static final String REVIEW = AgentWorkState.REVIEW;

  /** 실패 → AI_WORK_FAILED. */
  public static final String FAILED = AgentWorkState.FAILED;

  /** AI 가 거절 → AI_WORK_FAILED. */
  public static final String REJECTED = AgentWorkState.REJECTED;

  /** 글 없는 답변 필요 → AI_QUESTION(글 있는 질문은 이슈 챗 질문 경로가 만든다). */
  public static final String INPUT_REQUIRED = AgentWorkState.INPUT_REQUIRED;

  /** 권한 필요 → AI_QUESTION. */
  public static final String AUTH_REQUIRED = AgentWorkState.AUTH_REQUIRED;

  /** 막힘 → AI_QUESTION. */
  public static final String BLOCKED = AgentWorkState.BLOCKED;

  /** 진행 상태로 들어설 때 알리는 상태(INPUT_REQUIRED 는 글이 없을 때만 — 그 판단은 발행 쪽이 한다). */
  public static final Set<String> ON_ENTER = Set.of(REVIEW, AUTH_REQUIRED, BLOCKED, INPUT_REQUIRED);

  /** 작업을 끝낼 때 알리는 종료 상태. */
  public static final Set<String> ON_END = Set.of(FAILED, REJECTED);
}
