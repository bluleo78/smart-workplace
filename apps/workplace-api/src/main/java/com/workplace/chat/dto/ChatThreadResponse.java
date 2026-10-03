package com.workplace.chat.dto;

import java.time.Instant;
import java.util.List;

/**
 * Thread getter 응답. 멤버 + 최근 메시지 동봉. canPost 는 호출자가 메시지를 쓸 수 있는지(스레드 멤버이거나 댓글 작성 권한 보유 — 보낼 때 자동 참여,
 * WP-213). false 면 화면은 입력창 대신 안내를 보여 준다.
 */
public record ChatThreadResponse(
    Long threadId,
    Long issueId,
    Instant archivedAt,
    List<ChatMemberResponse> members,
    List<ChatMessageResponse> recentMessages,
    boolean canPost) {}
