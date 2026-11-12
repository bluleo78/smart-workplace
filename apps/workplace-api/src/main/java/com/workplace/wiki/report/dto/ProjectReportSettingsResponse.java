package com.workplace.wiki.report.dto;

import java.time.OffsetDateTime;

/**
 * 프로젝트 리포트 설정 응답(WP-1483) — 설정 화면 「리포트」 영역이 그대로 그린다.
 *
 * @param cadence WEEKLY|BIWEEKLY|MONTHLY
 * @param weekday MONDAY..SUNDAY
 * @param timeOfDay KST 정시 「HH:mm」
 * @param templatePageId 「템플릿 · 주간 리포트」 노트(아직 없거나 지워졌으면 null)
 * @param nextRunAt 다음 생성 시각(꺼졌으면 null)
 * @param canManage 호출자가 바꿀 수 있는지(프로젝트 OWNER·ADMIN, 개인 프로젝트는 false) — 아니면 화면이 읽기 전용
 */
public record ProjectReportSettingsResponse(
    boolean enabled,
    String cadence,
    String weekday,
    String timeOfDay,
    Long templatePageId,
    OffsetDateTime nextRunAt,
    boolean canManage) {}
