package com.workplace.messaging.dto;

import com.workplace.global.dto.MentionResponse;
import java.time.Instant;
import java.util.List;

/**
 * 메시지 1건. deleted=true 이면 body 는 "(삭제됨)" 으로 마스킹돼 전달된다. authorKind 는 USER.KIND. mentions 는 본문에서 멘션된
 * 사용자(존재하는 user 만 hydrate). parentMessageId 가 있으면 스레드 답글. replyCount 는 이 메시지에 달린 답글 수. reactions 는
 * 이모지별 집계(서비스에서 batch hydrate). attachments 는 첨부 파일 목록(서비스에서 batch hydrate).
 */
public record MessageResponse(
    Long id,
    Long channelId,
    Long authorId,
    String authorName,
    String authorKind,
    String body,
    List<MentionResponse> mentions,
    Long parentMessageId,
    int replyCount,
    List<ReactionResponse> reactions,
    List<MessageAttachmentResponse> attachments,
    Instant createdAt,
    Instant editedAt,
    boolean deleted) {

  /**
   * 리액션 집계를 채워 새 인스턴스 반환(repository 는 reactions 를 비워서 만들고 service 가 enrich). attachments 는 그대로 전달.
   */
  public MessageResponse withReactions(List<ReactionResponse> reactions) {
    return new MessageResponse(
        id,
        channelId,
        authorId,
        authorName,
        authorKind,
        body,
        mentions,
        parentMessageId,
        replyCount,
        reactions,
        attachments,
        createdAt,
        editedAt,
        deleted);
  }

  /** 첨부 목록을 채워 새 인스턴스 반환(repository 는 attachments 를 비워서 만들고 service 가 enrich). */
  public MessageResponse withAttachments(List<MessageAttachmentResponse> attachments) {
    return new MessageResponse(
        id,
        channelId,
        authorId,
        authorName,
        authorKind,
        body,
        mentions,
        parentMessageId,
        replyCount,
        reactions,
        attachments,
        createdAt,
        editedAt,
        deleted);
  }
}
