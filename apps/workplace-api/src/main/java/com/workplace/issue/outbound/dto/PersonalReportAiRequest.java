package com.workplace.issue.outbound.dto;

import com.workplace.issue.report.ReportIssue;
import com.workplace.issue.report.ReportTableRow;
import java.util.List;
import java.util.Map;

/**
 * ai-agent POST /issue/personal-report 요청 DTO(WP-1486) — 내 노트 템플릿 샘플·시스템 계산값·이슈 목록을 보내 개인 보고 마크다운을
 * 받는다. 필드 이름은 ai-agent 의 personalReportInputSchema 와 1:1 이다(남은 건수 이름 {@code omittedByEpic} 은 프로젝트
 * DTO 와 맞췄다 — 값은 에픽, 없으면 프로젝트별 건수).
 *
 * @param userName 보고 주인 이름(본인)
 * @param kind 종류(DAILY / WEEKLY / MONTHLY)
 * @param kindLabel 종류 이름(일일·주간·월간)
 * @param title 보고 제목(h1 로 쓰지 않는다 — 참고용)
 * @param periodLabel 기간 문구(「11월 11일 (수)」, 「11월 9일 ~ 15일」)
 * @param templateMarkdown 템플릿 본문(샘플) — 지시 상자를 담은 그대로 보낸다(AI 가 따르되 출력하지 않는다)
 * @param tableRows 주간·월간 비교 표 행(일일은 빈 목록)
 * @param numbersLine 일일 「어제 숫자」 한 줄(칸은 「 | 」 로 나눔, 주간·월간은 null)
 * @param issues 이슈 목록(40건 상한)
 * @param omittedByEpic 상한에 걸려 빠진 이슈의 에픽(없으면 프로젝트)별 건수(없으면 빈 맵)
 * @param assistantAgentId 비서 사용자 id(개인 비서 → 공용 비서)
 * @param model 비서 모델
 * @param maxTurns 비서 최대 턴
 * @param timeoutMs 실행 예산(ms) — 프로젝트 리포트와 같은 리포트 예산
 */
public record PersonalReportAiRequest(
    String userName,
    String kind,
    String kindLabel,
    String title,
    String periodLabel,
    String templateMarkdown,
    List<ReportTableRow> tableRows,
    String numbersLine,
    List<ReportIssue> issues,
    Map<String, Integer> omittedByEpic,
    long assistantAgentId,
    String model,
    int maxTurns,
    long timeoutMs) {}
