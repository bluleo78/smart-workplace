package com.workplace.agentruntime.dto;

/**
 * AI 가 작업 공간에서 맡을 프로젝트 한 개(WP-1255) — 그 AI 가 실제 멤버(직접 또는 멤버로 둔 부서)이고 연결된 저장소가 있는 프로젝트. 작업 공간의 AI 는
 * 이 프로젝트들의 저장소를 받아 일한다(start-agent 와 같은 고르기 규칙).
 *
 * @param repositoryBranch 기본 브랜치(비어 있으면 null — 저장소 기본 브랜치를 쓴다)
 * @param repositoryHost 저장소 URL 의 호스트(소문자, 못 읽으면 null) — 서버가 {@code RepoHosts.hostOf} 로 계산한 값이 기준이라
 *     화면은 URL 을 직접 해석하지 않는다
 */
public record AgentRuntimeProjectResponse(
    String projectKey,
    String name,
    String repositoryUrl,
    String repositoryBranch,
    String repositoryHost) {}
