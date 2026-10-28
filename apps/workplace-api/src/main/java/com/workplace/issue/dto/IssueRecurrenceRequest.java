package com.workplace.issue.dto;

/**
 * 이슈 반복 저장 요청(WP-989 PUT). 형식 검증(rrule 허용 범위·HH:mm)은 서비스가 한국어 사유와 함께 400 으로 한다 — 규칙이 여러 키의 조합이라
 * Bean Validation 어노테이션 하나로 표현하기 어렵다.
 *
 * @param rrule 반복 규칙(FREQ=DAILY | FREQ=WEEKLY;BYDAY=MO,WE | FREQ=MONTHLY;BYMONTHDAY=15)
 * @param time KST 실행 시각 "HH:mm"
 */
public record IssueRecurrenceRequest(String rrule, String time) {}
