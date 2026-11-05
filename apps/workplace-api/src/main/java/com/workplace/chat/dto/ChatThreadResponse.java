package com.workplace.chat.dto;

import com.workplace.global.dto.UserSummary;
import com.workplace.issue.outbound.ImplicitChatAgents.ImplicitChatAgent;
import java.time.Instant;
import java.util.List;

/**
 * Thread getter 응답. 멤버 + 최근 메시지 동봉. canPost 는 호출자가 메시지를 쓸 수 있는지(스레드 멤버이거나 댓글 작성 권한 보유 — 보낼 때 자동 참여,
 * WP-213). false 면 화면은 입력창 대신 안내를 보여 준다.
 *
 * <p>recentNextCursor·recentHasMore 는 최근 메시지 다음(더 오래된) 페이지 정보다. 화면이 최근 메시지를 메시지 목록의 첫 페이지로 쓰므로, 이것이
 * 있어야 다시 연 챗에서 위로 스크롤해 이전 대화를 불러올 수 있다(WP-365).
 *
 * <p>externalAgent 는 이슈 담당자 중 첫 외부 실행 AI(WP-373) — 작성창 안내에 이름을 쓴다. 없으면 null.
 *
 * <p>implicitAgent 는 조회자의 멘션 없는 글에도 답할 실행 일정 담당 AI(WP-1377) — 작성창 안내에 이름을 쓴다. mode 가 ALWAYS 면 늘,
 * AFTER_AI_REPLY 면 마지막 글이 그 AI 의 글일 때만 답한다(화면이 마지막 글 작성자로 판정). 글을 쓸 수 없거나 해당 없으면 null.
 */
public record ChatThreadResponse(
    Long threadId,
    Long issueId,
    Instant archivedAt,
    List<ChatMemberResponse> members,
    List<ChatMessageResponse> recentMessages,
    String recentNextCursor,
    boolean recentHasMore,
    boolean canPost,
    // WP-373: 이슈 담당자 중 첫 외부 실행 AI — 작성창 안내에 이름을 쓴다. 없으면 null.
    UserSummary externalAgent,
    // WP-1377: 멘션 없이도 답하는 실행 일정 담당 AI — 없으면 null. 끝에 붙여 예전 화면은 모르는 키로 무시한다.
    ImplicitAgent implicitAgent) {

  /**
   * 멘션 없이도 답하는 담당 AI(WP-1377).
   *
   * @param id AI 사용자 id — 화면이 마지막 글 작성자와 견준다
   * @param name 안내 문구에 쓸 AI 이름
   * @param mode ALWAYS | AFTER_AI_REPLY
   */
  public record ImplicitAgent(long id, String name, String mode) {

    /** issue 포트의 판정 결과를 화면 모양({id,name,mode})으로 옮긴다 — 응답 JSON 키를 포트 필드명과 따로 고정해 둔다. */
    public static ImplicitAgent from(ImplicitChatAgent agent) {
      return new ImplicitAgent(agent.agentId(), agent.agentName(), agent.mode().name());
    }
  }
}
