package com.workplace.messaging.dto;

import java.time.Instant;

/**
 * 채팅 앱 링크 카드용 메시지 요약(WP-1236) — 링크를 보는 사람 기준으로 채운다. home 의 AppLinkController 가 카드 칸으로 옮긴다.
 *
 * @param preview 본문 미리보기(푸시·대화 목록과 같은 규칙, 120자). 첨부만 있으면 「파일을 보냈습니다」
 * @param channelName 채널 이름. DM 이면 보는 사람 기준 상대 이름(대화 목록과 같은 표기)
 * @param channelKind CHANNEL | DM
 * @param authorName 보낸 사람 이름
 * @param sentAt 보낸 시각
 */
public record MessageLinkCard(
    String preview, String channelName, String channelKind, String authorName, Instant sentAt) {}
