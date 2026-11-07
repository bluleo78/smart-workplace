package com.workplace.agentruntime.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.OffsetDateTime;

/**
 * AI 상태 보고 요청(WP-1250) — Works 가 띄운 AI 가 자기 키로 보낸다.
 *
 * @param state 지금 상태
 * @param issueKey 처리 중인 이슈 키(없으면 null — 쉬는 중이면 비운다)
 * @param nextCheckAt 쉬는 중일 때 다음에 확인할 시각
 * @param generation 이 AI 가 떠 있는 실행 설정 generation(Pod 환경변수) — 없으면 교체 여부를 따지지 않는다
 * @param slot 보고한 칸(한 Pod 안의 work-loop 하나 — 프로젝트 키, WP-1409). 서버는 대문자로 바꿔 칸별로 저장하고 모든 칸을 합쳐 AI 상태를
 *     정한다. 없거나 빈 값이면 {@code ''} 칸(옛 플러그인·외부 구성 — 한 칸처럼 동작). 형식({@code [A-Za-z0-9_-]} 32자 이내)이 아니면
 *     400. 옛 클라이언트와 호환되도록 끝에 둔다.
 */
public record AgentStatusReportRequest(
    @NotNull AgentState state,
    @Size(max = 32) String issueKey,
    OffsetDateTime nextCheckAt,
    Long generation,
    // 이 형식(영문·숫자·_·- 32자 이내)은 클라이언트 plugins/genia-works/scripts/gw-status 의 칸 키 검사와 같아야 한다 — 바꾸면 함께
    // 바꾼다. gw-status 는 형식이 아니면 slot 을 빼고 보내 400 대신 '' 칸으로 RUN 을 받는다.
    @Pattern(regexp = "^[A-Za-z0-9_-]{0,32}$") String slot) {}
