package com.workplace.issue.workflow.dto;

import jakarta.validation.constraints.NotNull;

/**
 * 저장하지 않는 검증 요청. 저장할 수 없는 글자·크기 초과도 400 으로 막지 않는다 — 편집기가 위치를 보여 줄 수 있게 파서가 문제로 돌려준다.
 *
 * @param projectId 구성원 규칙을 볼 프로젝트
 */
public record ValidateWorkflowRequest(
    @NotNull(message = "프로젝트를 지정해 주세요") Long projectId,
    @NotNull(message = "YAML 내용을 보내 주세요") String yaml) {}
