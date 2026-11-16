package com.workplace.issue.report;

/**
 * 리포트 이슈 담당자 한 명(WP-1632) — 이름과 사람/AI 구분. 개인 보고 AI 가 「오늘 할 일」에서 AI 가 진행하는 일(담당에 AI 가 있는 일)을 내가 직접
 * 움직일 일과 가려 쓰게 담당 줄에 kind 를 붙인다.
 *
 * <p>롤링 배포 호환(WP-1632 의 새 요청 필드 공통 — {@link ReportIssue#assigneesDetail}, {@code
 * PersonalReportAiRequest.completedSplit}): api 와 ai-agent 는 어느 쪽이 먼저 올라갈지 모르므로 기존 필드는 그대로 두고 새 값은
 * 선택 필드로 더한다. 구 ai-agent 는 모르는 키라 버리고 기존 {@link ReportIssue#assignees}(이름만)로 예전처럼 쓴다. 새 ai-agent 는
 * 구 api 가 새 필드를 보내지 않아도 받도록 선택(nullish)으로 두고, kind 는 HUMAN·AGENT 밖의 새 종류가 생겨도 요청을 거절하지 않게 enum 이 아닌
 * 문자열로 받는다(모르는 종류는 꼬리표 없이 이름만). 프로젝트 리포트 스키마는 assigneesDetail 을 모르므로 버린다.
 *
 * @param name 담당자 이름
 * @param kind 사용자 종류 — {@code user.kind} 값 그대로(HUMAN / AGENT)
 */
public record ReportAssignee(String name, String kind) {}
