package com.workplace.mail.dto;

/**
 * 메일 분류 직접 바꾸기 결과(WP-1341).
 *
 * @param aiCategory 바꾼 뒤 유효 분류(직접 &gt; 개인 비서 &gt; 공용 — 목록·상세의 aiCategory 와 같은 값, 없으면 null)
 * @param categoryByMe 직접 바꾼 분류인지(null 로 되돌렸으면 false)
 * @param learnable 이어서 학습(POST .../category/learn)을 부를지 — 개인 비서 있음 · 계정 AI 사용 · AI 기억 켬 · 분류를 지정했고
 *     이전 유효 분류와 다를 때만 true
 */
public record MailCategoryChange(String aiCategory, boolean categoryByMe, boolean learnable) {}
