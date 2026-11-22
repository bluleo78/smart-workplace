package com.workplace.airun.status.dto;

/**
 * AI 현황 화면의 경고 한 줄(WP-1831).
 *
 * @param code 경고 종류(KIND_FAILURE·QUEUE_WAIT·ACCOUNT_USAGE·BACKLOG_STUCK)
 * @param severity "WARNING" 또는 "DANGER"
 * @param kind 관련 작업 종류(해당 없으면 null)
 * @param accountId 관련 AI 계정 id(해당 없으면 null)
 * @param label 계정 줄의 표시 이름(해당 없으면 null)
 * @param value 현재 값(해당 없으면 null)
 * @param threshold 경고 기준 값(해당 없으면 null)
 */
public record AiStatusAlert(
    String code,
    String severity,
    String kind,
    Long accountId,
    String label,
    Double value,
    Double threshold) {}
