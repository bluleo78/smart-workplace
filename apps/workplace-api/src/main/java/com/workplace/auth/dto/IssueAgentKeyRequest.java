package com.workplace.auth.dto;

import jakarta.validation.constraints.Size;

/** 키 발급 요청 — label 은 선택. */
public record IssueAgentKeyRequest(@Size(max = 80) String label) {}
