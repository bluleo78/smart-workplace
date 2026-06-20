package com.workplace.messaging.dto;

import java.time.Instant;

/**
 * 인박스 카드 1건. rootMessage 는 스레드 루트(unreadReplyCount/followed 채워짐, reactions/attachments 는 카드에 불필요해 빈
 * 리스트). channelName 으로 채널 컨텍스트 표시, lastReplyAt 으로 정렬/시각 표시.
 */
public record ThreadInboxItem(
    MessageResponse rootMessage, String channelName, Instant lastReplyAt) {}
