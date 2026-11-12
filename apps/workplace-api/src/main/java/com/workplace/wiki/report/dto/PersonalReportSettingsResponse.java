package com.workplace.wiki.report.dto;

import java.time.OffsetDateTime;

/**
 * 개인 보고 설정 응답(WP-1486) — 「보고서 설정」 창. 행이 없으면 기본값(꺼짐·09:00·건너뜀 켬).
 *
 * @param timeOfDay 자동 일일 시각(KST 정시, 「HH:00」)
 * @param dailyTemplatePageId 일일 템플릿 노트 — 「보고」 바로 아래에 아직 있을 때만(없으면 null → 「켜면 노트에 만들어요」)
 * @param weeklyTemplatePageId 주간(·월간) 템플릿 노트 — 같은 규칙
 * @param reportsPageId 내 노트 「보고」 페이지(찾기만 한다 — 없으면 null)
 * @param spaceId 내 노트(PERSONAL) 공간(「보고」가 있을 때만)
 * @param nextRunAt 다음 자동 일일 생성 시각(꺼짐이면 null)
 * @param assistantAvailable 보고를 쓸 AI 비서가 있는가(개인 비서 → 공용 비서)
 * @param lastError 자동 생성의 마지막 실패 한 줄(없으면 null) — 알림 대신 설정 창에만 보인다(P9)
 */
public record PersonalReportSettingsResponse(
    boolean dailyEnabled,
    String timeOfDay,
    boolean skipEmpty,
    Long dailyTemplatePageId,
    Long weeklyTemplatePageId,
    Long reportsPageId,
    Long spaceId,
    OffsetDateTime nextRunAt,
    boolean assistantAvailable,
    String lastError) {}
