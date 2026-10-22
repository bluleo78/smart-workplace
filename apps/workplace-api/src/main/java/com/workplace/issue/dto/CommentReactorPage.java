package com.workplace.issue.dto;

import java.util.List;

/** 이슈 코멘트 반응자 페이지(WP-504, 키셋). nextCursor 가 null 이면 마지막. 정렬 = 먼저 누른 사람부터. */
public record CommentReactorPage(
    List<CommentReactorResponse> items, String nextCursor, boolean hasMore) {}
