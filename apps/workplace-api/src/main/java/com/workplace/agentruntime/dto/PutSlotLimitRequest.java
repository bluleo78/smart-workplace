package com.workplace.agentruntime.dto;

/**
 * 「동시 진행」 상한 변경 요청(WP-1754).
 *
 * @param slotLimit 1·2·3·5 중 하나. null 이면 덮어쓴 값을 지우고 템플릿 기본값을 따른다
 */
public record PutSlotLimitRequest(Integer slotLimit) {}
