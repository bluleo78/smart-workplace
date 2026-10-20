package com.workplace.mail.dto;

/**
 * 새 메일 AI 초안 응답(WP-576, 미영속).
 *
 * @param subject 요청 제목이 비어 있어 AI 가 만든 제목. 요청에 제목이 있었으면 null(사용자 제목을 덮어쓰지 않는다).
 * @param body 평문 본문(HTML 아님)
 */
public record MailComposeDraft(String subject, String body) {}
