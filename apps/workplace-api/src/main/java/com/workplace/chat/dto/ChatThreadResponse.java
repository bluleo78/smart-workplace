package com.workplace.chat.dto;

import java.time.Instant;
import java.util.List;

/**
 * Thread getter 응답. 멤버 + 최근 메시지 동봉. canPost 는 호출자가 메시지를 쓸 수 있는지(스레드 멤버이거나 댓글 작성 권한 보유 — 보낼 때 자동 참여,
 * WP-213). false 면 화면은 입력창 대신 안내를 보여 준다.
 *
 * <p>recentNextCursor·recentHasMore 는 최근 메시지 다음(더 오래된) 페이지 정보다. 화면이 최근 메시지를 메시지 목록의 첫 페이지로 쓰므로, 이것이
 * 있어야 다시 연 챗에서 위로 스크롤해 이전 대화를 불러올 수 있다(WP-365).
 */
public record ChatThreadResponse(
    Long threadId,
    Long issueId,
    Instant archivedAt,
    List<ChatMemberResponse> members,
    List<ChatMessageResponse> recentMessages,
    String recentNextCursor,
    boolean recentHasMore,
    boolean canPost) {}
