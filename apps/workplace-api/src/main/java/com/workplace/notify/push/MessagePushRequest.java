package com.workplace.notify.push;

import java.util.List;

/**
 * 메시지(DM·멘션) 푸시 발송 요청. messaging 쪽 MessagePushRecipientResolver 가 커밋 후 채널 종류·멤버·멘션으로 대상을 확정해 만들고,
 * {@link PushDispatcher#dispatchMessage} 로 직접 넘긴다. notify 가 messaging 내부를 조회하지 않도록 발송에 필요한 값만 담는다.
 *
 * @param channelKind "DM" 이면 DM 제목·url 규칙을 쓴다
 * @param channelName DM 이면 null(채널이 레이스로 지워졌을 때도 null — 제목은 대체 문구)
 * @param dmRecipientIds DM 이면 작성자 외 HUMAN 멤버, 아니면 빈 목록
 * @param mentionedUserIds 채널 멤버인 HUMAN 멘션 대상(작성자 제외)
 */
public record MessagePushRequest(
    long tenantId,
    long channelId,
    String channelKind,
    String channelName,
    long messageId,
    Long parentMessageId,
    long authorId,
    String authorName,
    String preview,
    List<Long> dmRecipientIds,
    List<Long> mentionedUserIds) {}
