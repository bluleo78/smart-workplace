package com.workplace.chat.outbound;

import com.workplace.chat.dto.ChatMessageAttachmentResponse;
import com.workplace.drive.dto.DriveLinkResponse;
import com.workplace.global.dto.AiProgressStep;
import com.workplace.global.dto.UserSummary;
import com.workplace.issue.outbound.dto.IssueRecurrenceSummary;
import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/** chat 도메인 이벤트. AFTER_COMMIT 단계에서 dispatcher 가 수신해 ai-agent 로 발사한다. */
public final class ChatDomainEvents {
  private ChatDomainEvents() {}

  /**
   * chat 메시지 작성 직후 (생성에만 발행. 수정/삭제는 본 epic 범위 외).
   *
   * <p>mentions 는 resolve 후 UserSummary 로 hydrate 된 결과. AGENT 가 포함되었는지 dispatcher 가 판단한다.
   *
   * <p>followUpAgentId(WP-1312): 이 글이 반복 회차가 남긴 질문에 대한 소유자의 답이라 issue 모듈이 그 AI 의 이어 처리를 이미 보냈으면 그
   * AI id, 아니면 null. 답 글이 그 AI 를 멘션해도 일반 챗 응답(chat.message.posted)을 또 깨우지 않게 dispatcher 가 거른다.
   *
   * <p>implicitAgentId(WP-1377): 멘션 없는 사람 글이라도 실행 일정이 걸린 작업의 담당 AI 가 답해야 하면 그 AI id, 아니면 null.
   * 판정(일정·서버 실행·글쓴이·개인/팀·스레드 멤버·직전 글)은 글을 저장한 트랜잭션에서 끝내고, dispatcher 는 멘션으로 고른 AI 가 없을 때 이 AI 를
   * 대행으로 쓴다.
   *
   * <p>workflowWokenAgentIds(WP-2093): 이 글이 워크플로우 질문의 답이라 AI 노드로 돌아가며 진입이 깨운 AI 담당 전부.
   * followUpAgentId 에는 그 첫째만 실리므로, 판정은 둘을 합친 {@link #alreadyWokenAgentIds()} 를 쓴다.
   */
  public record ChatMessageCreatedEvent(
      long threadId,
      long messageId,
      long issueId,
      String projectKey,
      String issueKey,
      // #368: 이슈 채팅 AI 가 컨텍스트를 인지하도록 이슈 제목·상태·본문을 payload 에 동봉.
      // AGENT 는 비멤버라 get_issue_detail 로 직접 못 읽으므로 작성자 트랜잭션에서 미리 채워 전달한다.
      String issueTitle,
      String issueStatus,
      // WP-869: 사용자 정의 상태 이름 — AI 가 범주 코드 대신 이름으로 말하게. 없으면 null.
      String issueStatusName,
      String issueBody,
      UserSummary actor,
      String body,
      List<UserSummary> mentions,
      // #358: 첨부 및 드라이브 링크를 이벤트에 동봉 — SSE fan-out 시 클라이언트가 추가 조회 없이 렌더링 가능.
      List<ChatMessageAttachmentResponse> attachments,
      List<DriveLinkResponse> driveLinks,
      // WP-373: AI 질문 글인지 — 생성 직후 SSE 가 저장값 그대로 내려 화면이 바로 강조한다.
      boolean question,
      // WP-452: 글이 만들어진 경로 — 알림이 화면 글(멘션 알림)·AI 진행 보고(여기서는 알림 없음 — 멘션은 보고 쪽 알림 이벤트, WP-1009)·AI
      // 질문(질문 알림)을 구분한다.
      ChatMessageOrigin origin,
      Instant occurredAt,
      Long followUpAgentId,
      // WP-1375: 이 이슈가 AI 에게 맡긴 반복 업무면 그 요약 — 이슈 챗 AI 가 반복 맥락을 알게 ai-agent 페이로드에 싣는다. 반복이 없거나 AI 를
      // 깨울 일이 없는 글(AI 가 쓴 글·깨울 AI 없음 — 멘션도 실행 일정 담당 AI 도 없음)이면 null.
      IssueRecurrenceSummary recurrence,
      // WP-1377: 멘션 없이 답할 실행 일정 담당 AI(클래스 주석 참고). 없으면 null.
      Long implicitAgentId,
      // WP-1569: AI 질문 글에 보고와 함께 저장한 답 선택지(2~4개). 없으면 null — 질문이면 커밋 뒤 서버가 뽑아 채운다.
      List<String> options,
      // WP-2093: 이 글이 워크플로우 질문의 답이라 answered 이동이 돌아간 AI 노드에서 깨운 AI 담당 전부. 없으면 빈 목록.
      List<Long> workflowWokenAgentIds) {

    public ChatMessageCreatedEvent {
      // null 로 만들어도(테스트·다른 발행처) 빈 목록으로 맞춘다 — 판정 쪽이 null 검사 없이 쓰게.
      workflowWokenAgentIds =
          workflowWokenAgentIds == null ? List.of() : List.copyOf(workflowWokenAgentIds);
    }

    /**
     * 이 글로 다른 경로가 이미 깨운 AI 집합 — 반복 회차 이어 처리 AI(followUpAgentId, WP-1312)와 워크플로우 답 이동이 깨운 AI
     * 전부(WP-2093). 멘션 챗 응답·암묵 응답이 이들을 같은 글로 또 깨우지 않게 {@link ChatAgentWake} 가 뺀다. AI 담당이 여럿인 노드로
     * 돌아가면 둘째 AI 를 멘션해도 그 AI 가 두 번 시작되지 않는다.
     */
    public Set<Long> alreadyWokenAgentIds() {
      return alreadyWoken(followUpAgentId, workflowWokenAgentIds);
    }

    /**
     * 이미 깨운 AI 집합을 만드는 한 곳 — 이벤트의 {@link #alreadyWokenAgentIds()} 와, 이벤트를 만들기 전에 같은 집합으로 판정해야 하는
     * 발행처(글 저장 트랜잭션의 반복 요약 읽기 판정, WP-1375)가 함께 쓴다. 두 벌로 두면 한쪽만 고쳐 판정이 어긋날 수 있다. 워크플로우 답 이동 AI 순서 뒤에
     * 이어 처리 AI 를 붙인다(중복 없이). workflowWokenAgentIds 가 null 이면 빈 목록으로 본다.
     */
    public static Set<Long> alreadyWoken(Long followUpAgentId, List<Long> workflowWokenAgentIds) {
      Set<Long> woken =
          new LinkedHashSet<>(workflowWokenAgentIds == null ? List.of() : workflowWokenAgentIds);
      if (followUpAgentId != null) woken.add(followUpAgentId);
      return woken;
    }
  }

  /**
   * 서버가 질문 글에서 뽑은 답 선택지를 저장한 직후(WP-1569). SSE {@code chat.message.options} 로 스레드 멤버에게 그 메시지의 선택지만
   * 알린다 — {@code chat.message.updated} 를 쓰지 않는 까닭: 웹 처리기가 본문·멘션·수정 시각을 덮어쓴다. 질문 글을 고쳐 선택지를 지웠을 때도
   * options 를 null 로 실어 보낸다(옛 본문의 칩이 화면에 남지 않게).
   */
  public record ChatMessageOptionsEvent(long threadId, long messageId, List<String> options) {}

  /**
   * chat 메시지 수정 직후 (본인 수정). SSE fan-out 용. attachments 는 수정 뒤 첨부 전체 목록(WP-1680 — 수정에서 첨부를 뺄 수 있어 다른
   * 사람 화면도 통째로 바꾼다, 첨부가 없으면 빈 목록). 본문만 고친 수정도 늘 싣는다.
   */
  public record ChatMessageUpdatedEvent(
      long threadId,
      long messageId,
      String body,
      List<UserSummary> mentions,
      Instant editedAt,
      List<ChatMessageAttachmentResponse> attachments) {}

  /** chat 메시지 soft-delete 직후. SSE fan-out 용. */
  public record ChatMessageDeletedEvent(long threadId, long messageId) {}

  /** thread 읽음 표시 직후. lastReadMessageId 까지 읽음. SSE fan-out 용. */
  public record ChatThreadReadEvent(long threadId, long userId, long lastReadMessageId) {}

  /** thread 타이핑 알림 (transient, DB 저장 없음). 비-트랜잭션 이벤트. */
  public record ChatThreadTypingEvent(long threadId, UserSummary actor) {}

  /** thread 진행(progress) 알림 — AI 작업 단계 표시용 transient 이벤트(DB 저장 없음). */
  public record ChatThreadProgressEvent(
      long threadId,
      long agentId,
      String agentName,
      String streamId,
      String phase,
      List<AiProgressStep> steps) {}
}
