package com.workplace.issue.outbound.dto;

import com.workplace.issue.report.ProjectReportEpics;
import com.workplace.issue.report.ReportTableRow;
import java.util.List;

/**
 * ai-agent POST /issue/project-report 요청 DTO(WP-1483) — 템플릿 샘플·시스템 계산값·에픽 집계를 보내 리포트 마크다운을 받는다. 필드
 * 이름은 ai-agent 의 projectReportInputSchema 와 1:1 이다.
 *
 * @param projectName 프로젝트 이름
 * @param title 리포트 제목(h1 로 쓰지 않는다 — 참고용)
 * @param periodLabel 기간 문구(「11월 9일 ~ 15일」)
 * @param cadenceLabel 주기 문구(주간·격주·월간)
 * @param templateMarkdown 템플릿 본문(샘플) — 지시 상자를 담은 그대로 보낸다(AI 가 따르되 출력하지 않는다)
 * @param badge 시스템이 정한 배지(ON_TRACK / WARN / RISK)
 * @param previousBadge 지난 리포트의 배지(없으면 null)
 * @param tableRows 시스템이 만든 변화 표 행
 * @param epics 에픽 집계(WP-1629) — 이슈 60건 목록을 대신한다. 프로젝트 소유자 이름({@code epics.projectOwner})도 여기 든다.
 *     레코드 필드 이름 그대로 camelCase JSON 으로 나간다
 * @param assistantAgentId 워크스페이스 공통 비서 사용자 id
 * @param model 비서 모델
 * @param maxTurns 비서 최대 턴
 * @param timeoutMs 비서 타임아웃(ms)
 */
public record ProjectReportAiRequest(
    String projectName,
    String title,
    String periodLabel,
    String cadenceLabel,
    String templateMarkdown,
    String badge,
    String previousBadge,
    List<ReportTableRow> tableRows,
    ProjectReportEpics epics,
    long assistantAgentId,
    String model,
    int maxTurns,
    long timeoutMs) {}
