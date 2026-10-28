package com.workplace.messaging.dto;

import java.time.Instant;

/**
 * 인박스 카드 1건. rootMessage 는 스레드 루트(unreadReplyCount/followed 채워짐, reactions/attachments 는 카드에 불필요해 빈
 * 리스트). channelName 으로 채널 컨텍스트 표시, lastReplyAt 으로 정렬/시각 표시. channelKind('CHANNEL'|'DM')로 웹이 DM 스레드를
 * DM 화면(/chat/dms)으로 연다 — DM 은 channelName 이 null 이다(WP-1083).
 */
public record ThreadInboxItem(
    MessageResponse rootMessage, String channelName, String channelKind, Instant lastReplyAt) {}
