package com.workplace.issue.dto;

/** 관계 일괄 가져오기 결과 — 새로 만든 관계 수와 건너뛴 수(이미 있거나 같은 요청 안의 중복 줄, 방향 없는 유형의 뒤집힌 쌍 포함). */
public record ImportRelationsResponse(int created, int skipped) {}
