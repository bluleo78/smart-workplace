package com.workplace.chat.outbound;

import com.workplace.chat.dto.ChatMessageAttachmentResponse;
import com.workplace.drive.dto.DriveLinkResponse;
import com.workplace.global.dto.AiProgressStep;
import com.workplace.global.dto.UserSummary;
import java.time.Instant;
import java.util.List;

/** chat 도메인 이벤트. AFTER_COMMIT 단계에서 dispatcher 가 수신해 ai-agent 로 발사한다. */
public final class ChatDomainEvents {
  private ChatDomainEvents() {}

  /**
   * chat 메시지 작성 직후 (생성에만 발행. 수정/삭제는 본 epic 범위 외).
   *
   * <p>mentions 는 resolve 후 UserSummary 로 hydrate 된 결과. AGENT 가 포함되었는지 dispatcher 가 판단한다.
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
      Instant occurredAt) {}

  /** chat 메시지 수정 직후 (본인 수정). SSE fan-out 용. */
  public record ChatMessageUpdatedEvent(
      long threadId, long messageId, String body, List<UserSummary> mentions, Instant editedAt) {}

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
