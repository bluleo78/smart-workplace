package com.workplace.wiki.dto;

/**
 * 공개 공유 링크의 미리보기 정보(WP-895) — 외부 메신저 카드에 쓰는 노트 제목과 본문 앞부분 평문.
 *
 * @param title 노트 제목(비면 「제목 없음」)
 * @param description 가린 본문의 앞부분 평문(길이 제한, 본문이 비면 제목)
 */
public record WikiSharePreview(String title, String description) {}
