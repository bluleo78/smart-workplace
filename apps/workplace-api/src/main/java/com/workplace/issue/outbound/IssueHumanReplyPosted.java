package com.workplace.issue.outbound;

import java.util.List;

/**
 * 사람이 이슈 챗 글·댓글로 응답했다는 이벤트(WP-377) — 답변 필요로 멈춘 AI 구성원 작업을 작업 중으로 되돌리는 신호.
 *
 * <p>챗 글이면 작성자와 이 글로 이미 깨운 사용자도 싣는다(WP-1067) — 되돌린 AI 에게 멘션이 없어도 알림을 보내 바로 깨우되, 이미 멘션 알림·챗 응답으로 깨운
 * AI 는 빼려고. 댓글은 담당자·워처에게 가는 댓글 알림이 이미 AI 를 깨우므로 싣지 않는다.
 *
 * @param chatActorId 챗 글 작성자 id. 댓글이면 null
 * @param chatWokenAgentIds 이 챗 글로 이미 깨운 사용자 id — 글에서 멘션된 사용자, 또는 멘션이 없을 때 이 글에 답할 실행 일정 담당
 *     AI(WP-1377). 재개 알림에서 뺀다. 댓글이면 빈 목록
 */
public record IssueHumanReplyPosted(long issueId, Long chatActorId, List<Long> chatWokenAgentIds) {

  /** 깨운 목록은 늘 있다 — 동기 리스너가 챗 트랜잭션 안에서 읽으므로 null 로 글 작성이 되돌려지지 않게. */
  public IssueHumanReplyPosted {
    chatWokenAgentIds = chatWokenAgentIds == null ? List.of() : List.copyOf(chatWokenAgentIds);
  }

  /** 댓글 응답 — 챗 글 정보 없이. */
  public IssueHumanReplyPosted(long issueId) {
    this(issueId, null, List.of());
  }

  /** 챗 글 응답 — 작성자와 이 글로 이미 깨운 사용자(멘션 또는 실행 일정 담당 AI)를 함께. */
  public static IssueHumanReplyPosted chat(long issueId, long actorId, List<Long> wokenAgentIds) {
    return new IssueHumanReplyPosted(issueId, actorId, wokenAgentIds);
  }
}
