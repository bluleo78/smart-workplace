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
    boolean deleted,
    // MCP 가 숫자 id 없이 작성자를 가리킨다(#833)
    String authorUsername,
    // AI 가 사람의 답을 기다리는 질문(WP-373)
    boolean question) {

  /** 첨부만 있는 메시지의 NULL 본문은 빈 문자열로 내린다 — 웹 대화 행이 null 본문에서 터지지 않게(WP-717, 팀 채팅과 같은 규칙). */
  public ChatMessageResponse {
    if (body == null) body = "";
  }

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
        deleted,
        authorUsername,
        question);
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
        deleted,
        authorUsername,
        question);
  }
}
