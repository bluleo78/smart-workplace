package com.workplace.chat.outbound;

import com.workplace.global.dto.UserSummary;
import com.workplace.user.dto.AgentUsernames;
import com.workplace.user.dto.UserKind;
import java.util.List;
import java.util.Objects;

/**
 * 이슈 챗 글이 서버(ai-agent)의 AI 를 깨울 수 있는 후보를 고르는 규칙(WP-1375). {@link ChatEventDispatcher} 의 발사 판정과
 * ChatMessageService 의 반복 요약 읽기 판정이 같은 규칙을 쓰도록 한 곳에 둔다 — 둘이 갈라지면 발사되지 않을 글에 요약을 읽거나(쓸모없는 조회), 발사될
 * 글에 요약이 빠진다. 실행 방식(INTERNAL)·활성 판정은 DB 가 필요해 후보를 받은 쪽이 {@code ServerAgentResolver} 로 한다.
 */
public final class ChatAgentWake {

  private ChatAgentWake() {}

  /**
   * 깨울 수 있는 AI 후보(멘션 순서 유지). 글쓴이가 AI 면 빈 목록(self-loop 차단). 멘션 중 AGENT 이되, 남의 개인 비서(WP-638 — 주인 전용)와
   * 이 글로 반복 회차 이어 처리를 이미 받은 AI(WP-1312 — 같은 답에 두 번 응답하지 않게)는 뺀다.
   *
   * @param followUpAgentId 이 글로 이어 처리를 받은 AI. 없으면 null
   */
  public static List<UserSummary> candidates(
      UserSummary actor, List<UserSummary> mentions, Long followUpAgentId) {
    if (UserKind.isAgent(actor.kind())) return List.of();
    return mentions.stream()
        .filter(u -> UserKind.isAgent(u.kind()))
        .filter(u -> !AgentUsernames.isOthersPersonalAssistant(u.username(), actor.id()))
        .filter(u -> !Objects.equals(u.id(), followUpAgentId))
        .toList();
  }
}
