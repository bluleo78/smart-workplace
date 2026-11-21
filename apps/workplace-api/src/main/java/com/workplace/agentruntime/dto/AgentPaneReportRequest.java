package com.workplace.agentruntime.dto;

import jakarta.validation.constraints.Size;

/**
 * 칸 차단 보고 요청(WP-1913) — Pod 안 진입점이 칸을 띄우지 못한 사실과 이유를 자기 AI 키로 알린다(관리자 화면의 「오류」+이유). 본문 두 모양: 차단 때
 * {@code {"state":"BLOCKED","message":"…"}}, 다시 띄웠을 때 {@code {"state":"OK"}}.
 *
 * @param state 차단 여부 — {@code BLOCKED}(칸을 못 띄움) 또는 {@code OK}(다시 띄움 — 앞서 보고한 차단을 지운다). 그 밖의 값은 서비스가
 *     400 으로 거절한다(jakarta 만으로는 값을 갈라 필수를 나눌 수 없어 서비스에서 검증한다)
 * @param message 차단 이유, 500자 이하(501자를 넘으면 400) — {@code BLOCKED} 일 때만 필수(없으면 서비스가 400), {@code OK}
 *     에는 쓰지 않는다
 * @param generation 보고한 Pod 의 generation({@code GENIA_AGENT_GENERATION}) — 지금 generation 과 다르면 그
 *     보고는 옛 Pod 것이라 무시한다(끝나는 중인 옛 Pod 의 늦은 차단이 새 generation 을 덮지 않게, WP-1913 리뷰 반려 ①). 없으면(null)
 *     그대로 믿는다 — 플러그인을 아직 갈아끼우지 않은 이미지가 계속 보고할 수 있게
 */
public record AgentPaneReportRequest(
    String state, @Size(max = 500) String message, Long generation) {}
