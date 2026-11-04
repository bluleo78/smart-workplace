package com.workplace.mail.dto;

/**
 * 메일 분류 교정 학습 요청(WP-1341) — 웹이 분류를 바꾼 직후(learnable 일 때) 보낸다. 값 검증은 서비스가 한다(toCategory 는 5종 중 하나,
 * fromCategory 는 5종 또는 null — 아니면 400).
 *
 * @param fromCategory 바꾸기 전 유효 분류(없었으면 null)
 * @param toCategory 바꾼 분류
 */
public record LearnMailCategoryRequest(String fromCategory, String toCategory) {}
