package com.workplace.mail.dto;

/**
 * 메일 분류 직접 바꾸기 요청(WP-1341). category 는 5종(업무·개인·알림·프로모션·뉴스레터) 중 하나, null 이면 직접 분류를 지워 AI 분류로 되돌린다.
 * 값 검증은 서비스가 한다(5종 밖이면 400).
 */
public record SetMailCategoryRequest(String category) {}
