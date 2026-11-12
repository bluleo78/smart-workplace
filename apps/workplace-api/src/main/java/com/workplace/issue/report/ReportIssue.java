package com.workplace.issue.report;

import com.fasterxml.jackson.annotation.JsonFormat;
import java.time.LocalDate;
import java.util.List;

/**
 * 리포트 기간 이슈 한 건(WP-1483) — AI 가 「한 일」「위험」을 쓸 때 받는 재료. 개인 보고(WP-1486)도 같은 모양에 프로젝트 이름·늦은 날수·AI와 함께를
 * 더해 쓴다(프로젝트 리포트는 project 를 비워 보내 프롬프트가 같다).
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
 * @param reason 목록에 든 이유. 프로젝트 리포트 — OVERDUE(지금 기한 지남) / DONE(기간 안 완료) / CREATED(기간 안 생김). 개인 보고 —
 *     OVERDUE / WAITING(AI 답변 필요) / DUE_TODAY(오늘 마감) / DONE / STATUS_CHANGED(기간 안 상태 바꿈) /
 *     CREATED(내가 만듦) / OPEN(진행 중, 주간·월간만). 여럿이면 이 순서로 앞의 것 하나
 * @param project 프로젝트 이름 — 에픽이 없을 때 「프로젝트별」로 묶는 데 쓴다
 * @param lateDays 기간 안에 끝냈는데 마감을 넘겼으면 늦은 날수(개인 보고 DONE 만), 아니면 null
 * @param withAi 「AI와 함께」 끝냈는가(개인 보고 DONE 만, 그 밖 false)
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
    String reason,
    String project,
    Integer lateDays,
    boolean withAi) {}
