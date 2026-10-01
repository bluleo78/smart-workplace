package com.workplace.issue.dto;

/**
 * 출처(source_type/source_id)로 연결된 이슈의 경량 참조 — 다른 모듈(mail 등)이 "키 제목 (상태)" 를 보여 주기 위해 쓴다. key 는
 * "{프로젝트키}-{번호}".
 */
public record SourceIssueRef(String key, String title, String status) {}
