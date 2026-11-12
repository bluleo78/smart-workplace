package com.workplace.issue.report;

import com.fasterxml.jackson.annotation.JsonFormat;
import java.time.LocalDate;
import java.util.List;

/**
 * 리포트 기간 이슈 한 건(WP-1483) — AI 가 「한 일」「위험」을 쓸 때 받는 재료.
 *
 * @param key 이슈 키(예 WP-123)
 * @param url 공개 웹 주소 {@code {public-base-url}/projects/{KEY}/issues/{n}} — 앱 링크 칩이 알아보는 모양
 * @param title 제목(80자까지)
 * @param statusName 프로젝트 상태 이름
 * @param category 상태 범주(TODO / IN_PROGRESS / DONE / CANCELED)
 * @param assignees 담당자 이름(이름순)
 * @param epic 부모 에픽 제목, 없으면 null
 * @param dueDate 마감일, 없으면 null
 * @param lastComment 지워지지 않은 마지막 코멘트(120자까지), 없으면 null
 * @param reason 목록에 든 이유 — OVERDUE(지금 기한 지남) / DONE(기간 안 완료) / CREATED(기간 안 생김). 여럿이면 이 순서로 앞의 것
 */
public record ReportIssue(
    String key,
    String url,
    String title,
    String statusName,
    String category,
    List<String> assignees,
    String epic,
    // ai-agent 로 보낼 때 [2026,11,10] 배열이 아니라 "2026-11-10" 문자열로 직렬화(zod 가 문자열을 받는다).
    @JsonFormat(shape = JsonFormat.Shape.STRING) LocalDate dueDate,
    String lastComment,
    String reason) {}
