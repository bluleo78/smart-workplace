package com.workplace.agentruntime.dto;

import java.util.List;
import java.util.Map;

/**
 * desired 응답의 AI 한 명(WP-1249) — runner 가 Pod 하나를 만들 때 필요한 모든 것. 비밀값 원문은 싣지 않고 {@link
 * RunnerSecretRef} 로 이름·출처·버전만 알린다.
 *
 * @param tenantId 이 AI 가 일할 워크스페이스 — runner 가 Pod 환경 {@code GENIA_WORKS_TENANT} 로 넣는다(여러 워크스페이스에 속한
 *     AI 의 테넌트를 정하려고)
 * @param generation 원하는 상태 세대 — runner 는 Pod 에 붙인 세대와 다를 때만 다시 만든다
 * @param applyNow 지금 바꿔도 되는지(Works 가 계산) — false 면 지금 Pod 를 그대로 둔다
 * @param templateVersion 레지스트리의 현재 템플릿 버전(이미지·자원은 이 버전 값)
 * @param config 관리자가 고른 실행 설정(예: model)
 */
public record RunnerDesiredAgent(
    long agentUserId,
    String username,
    long tenantId,
    long generation,
    boolean applyNow,
    String templateName,
    String templateVersion,
    String image,
    Map<String, Object> resources,
    List<Map<String, Object>> sidecars,
    List<Map<String, Object>> plugins,
    Map<String, String> config,
    List<RunnerSecretRef> secrets) {}
