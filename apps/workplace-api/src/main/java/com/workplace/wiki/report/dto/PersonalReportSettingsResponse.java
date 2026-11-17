package com.workplace.wiki.report.dto;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * 개인 보고 설정 응답(WP-1486) — 「보고서 설정」 창. 행이 없으면 기본값(꺼짐·09:00·건너뜀 켬).
 *
 * @param timeOfDay 자동 일일 시각(KST 정시, 「HH:00」)
 * @param dailyTemplatePageId 일일 템플릿 노트 — 내 노트 공간 안에 있을 때만(WP-1655, 없으면 null → 「켜면 노트에 만들어요」)
 * @param weeklyTemplatePageId 주간(·월간) 템플릿 노트 — 같은 규칙
 * @param dailyTemplatePath 일일 템플릿의 실제 위치 경로 제목(기본 「템플릿 › 일일 보고」) — 템플릿 id 가 없으면 null
 * @param weeklyTemplatePath 주간·월간 템플릿의 실제 위치 경로 제목(기본 「템플릿 › 주간·월간 보고」) — 템플릿 id 가 없으면 null
 * @param templateRootPageId 내 노트 맨 위 「템플릿」 페이지(없으면 null) — 저장 위치 고르기 창에서 뺀다
 * @param templateRecreatedAt 템플릿을 다시 만든 시각(없으면 null) — 설정 창 「템플릿을 다시 만들었어요」 알림, 다음 설정 쓰기가 지운다
 * @param reportsPageId 지금 쓰는 저장 위치 페이지(고른 위치가 유효하면 그것, 아니면 「보고」 — 「보고」도 없으면 null)
 * @param reportLocationPath 저장 위치 경로 제목(기본 {@code ["보고"]})
 * @param spaceId 내 노트(PERSONAL) 공간(있으면 — 「보고」 유무와 무관, WP-1655)
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
    List<String> dailyTemplatePath,
    List<String> weeklyTemplatePath,
    Long templateRootPageId,
    OffsetDateTime templateRecreatedAt,
    Long reportsPageId,
    List<String> reportLocationPath,
    Long spaceId,
    OffsetDateTime nextRunAt,
    boolean assistantAvailable,
    String lastError) {}
