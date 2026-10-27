package com.workplace.issue.outbound;

import com.workplace.issue.dto.AgentWorkState;
import java.util.List;
import java.util.Set;

/**
 * AI 작업 보고가 만드는 알림 이벤트(WP-913·WP-1009). notify 가 커밋 뒤 받아 「검토 요청」(REVIEW)·「실패」(FAILED·REJECTED)· 「답변
 * 필요」(AUTH_REQUIRED·BLOCKED·글 없는 INPUT_REQUIRED) 알림과, 보고 글에서 멘션된 사람의 알림을 <b>사람당 1건</b>으로 함께 만든다 —
 * 상태 알림을 받는 사람은 같은 보고의 멘션 알림에서 뺀다(더 구체적인 이유가 이긴다).
 *
 * <p>state 는 상태가 <b>그 값으로 바뀌는 순간</b>에만 싣는다 — 같은 상태 재보고·note 갱신, 이미 끝난 작업의 재종료 보고는 null 이다. 작업자가
 * AI(AGENT)일 때만 싣는다 — 판정은 보고 시점에 작업자 종류를 이미 아는 issue 쪽이 하고, notify 는 다시 묻지 않는다. 멘션은 작업자 종류와 무관하게
 * 싣는다(사람이 자기 도구로 보고해도 멘션은 알린다). 둘 다 없으면 내지 않는다. 글 있는 AI 질문(INPUT_REQUIRED)은 챗 질문 경로가 멘션까지 함께 알리므로 둘
 * 다 싣지 않는다.
 *
 * <p>알림 대상 상태 상수·집합은 issue(발행)와 notify(문구·분기)가 함께 쓰는 계약이라 여기 한 곳에 둔다 — 값은 {@link AgentWorkState}
 * 그대로라 두 모듈이 문자열을 따로 베껴 두다 어긋나는 일이 없다.
 *
 * @param state 바뀐 작업 상태(AgentWorkState 값). 알릴 상태 변화가 없으면 null(멘션만)
 * @param delegateCandidates 검토 요청·실패 수신 후보 — [그 AI 담당 행의 assigned_by, 이슈 보고자] 순서, null 제외. state 가
 *     null 이면 빈 목록
 * @param mentionedIds 보고 글(message)에서 멘션된 사용자 id(<@id> 토큰) — 사람인지·이슈를 볼 수 있는지는 notify 가 거른다
 */
public record AgentWorkNoticeEvent(
    long issueId,
    long workerId,
    String state,
    List<Long> delegateCandidates,
    List<Long> mentionedIds) {

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
