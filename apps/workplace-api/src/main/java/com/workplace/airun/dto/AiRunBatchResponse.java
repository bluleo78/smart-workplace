package com.workplace.airun.dto;

/**
 * 묶음 수신 결과(WP-1827).
 *
 * @param accepted 저장(합치기 포함)된 건수
 * @param dropped 형식 오류·비활성 테넌트·저장 실패로 버린 건수
 */
public record AiRunBatchResponse(int accepted, int dropped) {}
