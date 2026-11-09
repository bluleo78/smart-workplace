package com.workplace.agentaccount.usage;

import java.time.Instant;

/**
 * 계정의 사용량 조회 기록 한 행(임대 칸은 내부용이라 싣지 않는다).
 *
 * @param checkedAt 마지막 시도 시각(성공·실패 무관, 없으면 null)
 * @param succeededAt 마지막 성공 시각
 * @param limitReached provider 가 한도 도달을 알렸는가(마지막 성공 기준)
 * @param errorCode 마지막 시도가 실패일 때의 코드(성공이면 null) — 토큰 등 평문은 담지 않는다
 * @param errorMessage 짧은 한국어 실패 문구
 * @param lastUsedAt runner 가 알린 마지막 사용 시각
 */
public record UsageCheckRow(
    Instant checkedAt,
    Instant succeededAt,
    boolean limitReached,
    String errorCode,
    String errorMessage,
    Instant lastUsedAt) {}
