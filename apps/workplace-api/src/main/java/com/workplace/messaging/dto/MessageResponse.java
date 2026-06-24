package com.workplace.messaging.dto;

import com.workplace.drive.dto.DriveLinkResponse;
import com.workplace.global.dto.MentionResponse;
import java.time.Instant;
import java.util.List;

/**
 * 메시지 1건. deleted=true 이면 body 는 "(삭제됨)" 으로 마스킹돼 전달된다. authorKind 는 USER.KIND. mentions 는 본문에서 멘션된
 * 사용자(존재하는 user 만 hydrate). parentMessageId 가 있으면 스레드 답글. replyCount 는 이 메시지에 달린 답글 수. reactions 는
 * 이모지별 집계(서비스에서 batch hydrate). attachments 는 첨부 파일 목록(서비스에서 batch hydrate). driveLinks 는 연결된 드라이브
 * 파일 링크 목록(서비스에서 batch hydrate). unreadReplyCount 는 내가 팔로우하는 스레드면 미읽음 답글 수, 아니면 0. followed 는 이
 * 스레드(부모 메시지) 팔로우 여부. proposal 은 채팅 L3 위임 제안 카드(없으면 null).
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
    List<DriveLinkResponse> driveLinks,
    Instant createdAt,
    Instant editedAt,
    boolean deleted,
    int unreadReplyCount, // 내가 팔로우하는 스레드면 미읽음 답글 수, 아니면 0
    boolean followed, // 이 스레드(부모 메시지) 팔로우 여부
    MessageProposalResponse proposal) { // L3 위임 제안 카드 — service 가 batch enrich, 없으면 null

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
        driveLinks,
        createdAt,
        editedAt,
        deleted,
        unreadReplyCount,
        followed,
        proposal);
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
        driveLinks,
        createdAt,
        editedAt,
        deleted,
        unreadReplyCount,
        followed,
        proposal);
  }

  /** 드라이브 링크 목록을 채워 새 인스턴스 반환(service 가 batch enrich). */
  public MessageResponse withDriveLinks(List<DriveLinkResponse> driveLinks) {
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
        driveLinks,
        createdAt,
        editedAt,
        deleted,
        unreadReplyCount,
        followed,
        proposal);
  }

  /** 스레드 미읽음/팔로우 정보를 채워 새 인스턴스 반환(service 가 batch enrich). */
  public MessageResponse withThreadUnread(int unreadReplyCount, boolean followed) {
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
        driveLinks,
        createdAt,
        editedAt,
        deleted,
        unreadReplyCount,
        followed,
        proposal);
  }

  /** 제안(L3 위임 카드)을 채워 새 인스턴스 반환(service 가 batch enrich). */
  public MessageResponse withProposal(MessageProposalResponse proposal) {
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
        driveLinks,
        createdAt,
        editedAt,
        deleted,
        unreadReplyCount,
        followed,
        proposal);
  }
}
