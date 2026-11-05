package com.workplace.issue.dto;

/**
 * 이슈 반복 저장 요청(WP-989 PUT). 형식 검증(rrule 허용 범위·HH:mm)은 서비스가 한국어 사유와 함께 400 으로 한다 — 규칙이 여러 키의 조합이라
 * Bean Validation 어노테이션 하나로 표현하기 어렵다.
 *
 * @param rrule 반복 규칙(FREQ=DAILY | FREQ=WEEKLY;BYDAY=MO,WE | FREQ=MONTHLY;BYMONTHDAY=15 |
 *     FREQ=HOURLY;INTERVAL=2;BYDAY=MO,TU;UNTILTIME=18:00 — 몇 시간마다, WP-1373)
 * @param time KST 실행 시각 "HH:mm" — 몇 시간마다는 시간대의 시작 시각
 * @param agentUserId 회차를 실행할 담당 AI(WP-1314, 선택). 없으면 개인 작업은 소유자의 AI 비서, 팀 이슈는 지금 일정의 AI(없으면 저장하는
 *     사람의 AI 비서)
 */
public record IssueRecurrenceRequest(String rrule, String time, Long agentUserId) {

  /** 담당 AI 를 고르지 않는 요청(WP-1314 이전 모양) — 기존 호출부·테스트 호환. */
  public IssueRecurrenceRequest(String rrule, String time) {
    this(rrule, time, null);
  }
}
