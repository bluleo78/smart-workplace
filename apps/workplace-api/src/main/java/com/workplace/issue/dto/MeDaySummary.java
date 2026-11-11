package com.workplace.issue.dto;

import java.time.LocalDate;

/**
 * 「어제 한 일 / 오늘 할 일」 요약(WP-1484) — 개요 탭 첫 줄과 홈 「내 작업」 위젯 한 줄이 같은 값을 쓴다({@code GET
 * /api/v1/me/overview/today}). 기간 고르기와 무관하다. 「어제」는 달력상 어제(Asia/Seoul).
 *
 * @param yesterday 어제 날짜(서울)
 * @param yesterdayCompleted 어제 끝낸 이슈(지표 모듈 정의)
 * @param yesterdayCompletedWithAi 그중 AI와 함께
 * @param yesterdayCompletedOnTime 그중 기한 내
 * @param yesterdayCreated 어제 새로 만든 이슈(내가 보고자)
 * @param today 오늘 날짜(서울)
 * @param overdue 기한 지남 — 내가 담당인 열린 이슈 중 마감일 &lt; 오늘
 * @param oldestOverdueDays 기한 지난 것 중 가장 오래된 것의 지난 날수(없으면 null)
 * @param dueToday 오늘 마감 — 내가 담당인 열린 이슈
 * @param waiting 나를 기다림 — 내가 담당이거나 보고자인 열린 이슈 중 AI 작업이 답변 필요(INPUT_REQUIRED)
 */
public record MeDaySummary(
    LocalDate yesterday,
    int yesterdayCompleted,
    int yesterdayCompletedWithAi,
    int yesterdayCompletedOnTime,
    int yesterdayCreated,
    LocalDate today,
    int overdue,
    Integer oldestOverdueDays,
    int dueToday,
    int waiting) {}
