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
    MessageProposalResponse proposal, // L3 위임 제안 카드 — service 가 batch enrich, 없으면 null
    List<LinkPreviewResponse>
        linkPreviews, // 링크 미리보기 카드(WP-874) — service 가 batch enrich, 늘 non-null
    // 보낸 사람이 미리보기를 지웠는지(WP-896) — 웹이 앱 링크 카드도 함께 감춘다. OG 카드는 지울 때 행째 사라져 따로 볼 필요가 없다.
    boolean linkPreviewsDismissed) {

  /**
   * 본문 없이 첨부만 있는 메시지는 DB 에 body NULL 로 남는다(MCP 가 body 를 생략). 응답은 늘 문자열로 맞춘다 — null 이 내려가면 웹 메시지 행이
   * {@code body.trim()} 에서 터져 그 채널·DM 화면 전체가 오류 화면이 됐다(WP-717). 웹 작성창이 보내는 '' 와 같은 모양이 된다.
   */
  public MessageResponse {
    if (body == null) body = "";
    // 미리보기는 늘 배열로 내보낸다 — 웹이 null 분기 없이 다루도록(enrich 전·카드용 축약 응답 포함).
    if (linkPreviews == null) linkPreviews = List.of();
  }

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
        proposal,
        linkPreviews,
        linkPreviewsDismissed);
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
        proposal,
        linkPreviews,
        linkPreviewsDismissed);
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
        proposal,
        linkPreviews,
        linkPreviewsDismissed);
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
        proposal,
        linkPreviews,
        linkPreviewsDismissed);
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
        proposal,
        linkPreviews,
        linkPreviewsDismissed);
  }

  /** 링크 미리보기를 채워 새 인스턴스 반환(service 가 batch enrich, WP-874). */
  public MessageResponse withLinkPreviews(List<LinkPreviewResponse> linkPreviews) {
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
        proposal,
        linkPreviews,
        linkPreviewsDismissed);
  }
}
