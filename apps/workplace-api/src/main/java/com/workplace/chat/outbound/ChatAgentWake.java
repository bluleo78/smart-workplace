package com.workplace.chat.outbound;

import com.workplace.global.dto.UserSummary;
import com.workplace.user.dto.AgentUsernames;
import com.workplace.user.dto.UserKind;
import com.workplace.user.service.ServerAgentResolver;
import java.util.List;
import java.util.Objects;

/**
 * 이슈 챗 글이 서버(ai-agent)의 AI 를 깨울 수 있는 후보를 고르는 규칙(WP-1375). {@link ChatEventDispatcher} 의 발사 판정과
 * ChatMessageService 의 반복 요약 읽기 판정이 같은 규칙을 쓰도록 한 곳에 둔다 — 둘이 갈라지면 발사되지 않을 글에 요약을 읽거나(쓸모없는 조회), 발사될
 * 글에 요약이 빠진다. 실행 방식(INTERNAL)·활성 판정은 DB 가 필요해 {@link #actingAgent} 가 {@link ServerAgentResolver} 로
 * 한다.
 *
 * <p>WP-1377: 멘션으로 고른 AI 가 없을 때 실행 일정 담당 AI(implicitAgentId)로 넘어가는 규칙도 여기 둔다 — 깨울 AI 를 정하는 곳이 하나여야
 * dispatcher 발사와 반복 요약 동봉이 갈라지지 않는다.
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

  /**
   * 이 글로 서버(ai-agent)가 대행할 AI id — 없으면 null(발사하지 않음). 순서:
   *
   * <ol>
   *   <li>글쓴이가 AI 면 null(self-loop 차단 — 멘션·실행 일정 담당 AI 모두).
   *   <li>멘션 후보({@link #candidates}) 중 서버 실행(INTERNAL·이 워크스페이스에서 활성)인 첫 AI.
   *   <li>그런 AI 가 없을 때만, 실행 일정 담당 AI(implicitAgentId)가 이어 처리 AI 와 다르고 서버 실행·활성이면 그 AI. 저장 쪽은 멘션이 없고
   *       이어 처리가 없을 때만 implicitAgentId 를 싣지만, 이벤트를 다른 곳에서 만들 때 멘션 응답·이어 처리와 이중 실행되지 않게 방어로 다시 본다.
   *       저장 뒤 정지·외부 전환된 AI 를 깨우지 않게 같은 실행 검사를 한 번 더 거친다.
   * </ol>
   *
   * @param tenantId 이벤트가 일어난 워크스페이스(WP-417 정지 판정)
   * @param followUpAgentId 이 글로 이어 처리를 받은 AI. 없으면 null
   * @param implicitAgentId 멘션 없이 답할 실행 일정 담당 AI(WP-1377). 없으면 null
   */
  public static Long actingAgent(
      ServerAgentResolver resolver,
      Long tenantId,
      UserSummary actor,
      List<UserSummary> mentions,
      Long followUpAgentId,
      Long implicitAgentId) {
    if (UserKind.isAgent(actor.kind())) return null;
    // 멘션 후보가 없으면 resolver 가 조회 없이 null 을 돌려준다 — 대부분의 글은 추가 조회 비용이 없다.
    Long acting = resolver.pickActingAgent(candidates(actor, mentions, followUpAgentId), tenantId);
    if (acting != null) return acting;
    if (implicitAgentId == null || Objects.equals(implicitAgentId, followUpAgentId)) return null;
    return resolver.pickActingAgentId(List.of(implicitAgentId), tenantId);
  }
}
