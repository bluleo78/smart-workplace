package com.workplace.chat.dto;

import com.workplace.drive.dto.DriveLinkResponse;
import com.workplace.global.dto.MentionResponse;
import java.time.Instant;
import java.util.List;

/** 메시지 1건. deleted=true 이면 body 는 "(삭제됨)" 으로 마스킹돼 전달된다. */
public record ChatMessageResponse(
    Long id,
    Long threadId,
    Long authorId,
    String authorName,
    String authorKind,
    String body,
    List<MentionResponse> mentions,
    List<ChatMessageAttachmentResponse> attachments,
    List<DriveLinkResponse> driveLinks,
    Instant createdAt,
    Instant editedAt,
    boolean deleted) {

  /** 첨부 목록을 교체한 복사본. (하이드레이션용) */
  public ChatMessageResponse withAttachments(List<ChatMessageAttachmentResponse> a) {
    return new ChatMessageResponse(
        id,
        threadId,
        authorId,
        authorName,
        authorKind,
        body,
        mentions,
        a,
        driveLinks,
        createdAt,
        editedAt,
        deleted);
  }

  /** 드라이브 링크 목록을 교체한 복사본. (하이드레이션용) */
  public ChatMessageResponse withDriveLinks(List<DriveLinkResponse> d) {
    return new ChatMessageResponse(
        id,
        threadId,
        authorId,
        authorName,
        authorKind,
        body,
        mentions,
        attachments,
        d,
        createdAt,
        editedAt,
        deleted);
  }
}
