package com.workplace.airun.capacity;

import java.time.OffsetDateTime;

/**
 * AI 처리 용량 1분 표본 한 건(WP-1830) — 저장소 입력. JSON 칸은 이미 직렬화된 문자열로 받는다.
 *
 * @param sampledAt 표본 시각(분 단위로 맞춘 값)
 * @param slotUsed 사용 중인 처리 슬롯 수
 * @param slotLimit 처리 슬롯 한도
 * @param queueWaiting 대기열에서 기다리는 처리 수
 * @param queueOldestWaitSec 가장 오래 기다린 처리의 대기 시간(초), 대기 없으면 null
 * @param accountUsageJson AI 계정별 사용 현황 JSON 배열
 * @param backlogJson 종류별 적체 건수 JSON 객체
 */
public record AiCapacitySample(
    OffsetDateTime sampledAt,
    int slotUsed,
    int slotLimit,
    int queueWaiting,
    Integer queueOldestWaitSec,
    String accountUsageJson,
    String backlogJson) {}
