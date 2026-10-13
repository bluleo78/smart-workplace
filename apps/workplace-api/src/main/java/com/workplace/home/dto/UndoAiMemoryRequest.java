package com.workplace.home.dto;

/**
 * 채팅 결과 줄 되돌리기 요청(WP-55 §6). blockIndex = 그 메시지의 memory 블록 중 순번(0부터, 판정 4). 누락·음수 검증은 서비스가 400
 * AI_MEMORY_INVALID 로 한다(이 모듈의 오류 코드 규칙과 같게).
 */
public record UndoAiMemoryRequest(Long messageId, Integer blockIndex) {}
