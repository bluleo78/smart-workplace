package com.workplace.messaging.dto;

/** 승인 시 위임자가 카드 드롭다운으로 바꾼 프로젝트 키(미변경이면 null → 제안 저장값 사용). */
public record ConfirmProposalRequest(String projectKey) {}
