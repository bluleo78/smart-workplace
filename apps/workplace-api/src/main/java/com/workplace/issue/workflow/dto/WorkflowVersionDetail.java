package com.workplace.issue.workflow.dto;

import com.fasterxml.jackson.annotation.JsonRawValue;

/**
 * 게시 버전 한 건.
 *
 * @param model 저장된 JSON 글 그대로 내보낸다 — 다시 읽고 쓰면 수·순서가 저장본과 달라질 수 있다. DB 가 JSON 임을 보장한다(JSONB).
 */
public record WorkflowVersionDetail(int versionNo, String sourceYaml, @JsonRawValue String model) {}
