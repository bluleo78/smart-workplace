package com.workplace.messaging.dto;

/**
 * 일정 제안 시 같은 시간대에 겹치는 기존 일정 1건(카드 노출용). startsAt/endsAt 은 ai-agent 가 보낸 ISO-8601 문자열 그대로. 충돌 검사는
 * ai-agent 핸들러가 listEvents 로 결정적으로 수행하므로 여기서는 결과만 운반한다.
 */
public record EventConflictDto(long id, String title, String startsAt, String endsAt) {}
