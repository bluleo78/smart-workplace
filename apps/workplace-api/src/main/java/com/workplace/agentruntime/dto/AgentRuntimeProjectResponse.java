package com.workplace.agentruntime.dto;

/**
 * AI 가 작업 공간에서 맡을 프로젝트 한 개(WP-1255) — 그 AI 가 실제 멤버(직접 또는 멤버로 둔 부서)이고 연결된 저장소가 있는 프로젝트. 작업 공간의 AI 는
 * 이 프로젝트들의 저장소를 받아 일한다(start-agent 와 같은 고르기 규칙).
 *
 * @param repositoryBranch 기본 브랜치(비어 있으면 null — 저장소 기본 브랜치를 쓴다)
 */
public record AgentRuntimeProjectResponse(
    String projectKey, String name, String repositoryUrl, String repositoryBranch) {}
