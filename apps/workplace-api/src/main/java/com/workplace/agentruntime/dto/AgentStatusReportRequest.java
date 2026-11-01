package com.workplace.agentruntime.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.OffsetDateTime;

/**
 * AI 상태 보고 요청(WP-1250) — Works 가 띄운 AI 가 자기 키로 보낸다.
 *
 * @param state 지금 상태
 * @param issueKey 처리 중인 이슈 키(없으면 null — 쉬는 중이면 비운다)
 * @param nextCheckAt 쉬는 중일 때 다음에 확인할 시각
 * @param generation 이 AI 가 떠 있는 실행 설정 generation(Pod 환경변수) — 없으면 교체 여부를 따지지 않는다
 */
public record AgentStatusReportRequest(
    @NotNull AgentState state,
    @Size(max = 32) String issueKey,
    OffsetDateTime nextCheckAt,
    Long generation) {}
