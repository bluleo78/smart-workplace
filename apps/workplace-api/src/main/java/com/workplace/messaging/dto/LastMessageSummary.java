package com.workplace.messaging.dto;

import java.time.Instant;

/**
 * 목록 행 미리보기용 마지막 메시지 요약(WP-135 모바일 채팅 목록). 최상위·미삭제 메시지 중 최신 1건.
 *
 * @param authorId 작성자 id — 프론트가 "나:" 접두 판정에 사용
 * @param authorName 작성자 표시명 — 채널·그룹 DM 의 "이름:" 접두용
 * @param preview 멘션 치환·공백 접기·120자 자른 본문(첨부만이면 "파일을 보냈습니다")
 */
public record LastMessageSummary(
    long id, Long authorId, String authorName, String preview, Instant createdAt) {}
