package com.workplace.issue.dto;

/**
 * AI 위임 작업 행의 프로젝트 묶음 정보(WP-426). /me/ai-tasks 행에만 싣는다 — 화면이 프로젝트 머리(이름 + 건수)를 그리는 데 쓴다. 다른 이슈 목록에는
 * 없다(JSON 생략).
 *
 * @param name 프로젝트 이름
 * @param size 필터 적용 후 그 프로젝트의 행 수 — 커서 앞에서 세므로 어느 페이지에서 받아도 같다
 */
public record AiTaskProject(String name, int size) {}
