package com.workplace.wiki.report.dto;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * 프로젝트 리포트 설정 응답(WP-1483, WP-1654 에서 템플릿 경로·저장 위치 추가) — 설정 화면 「리포트」 영역이 그대로 그린다. 읽기만 하는 조회라 아무 페이지도
 * 만들지 않는다.
 *
 * @param cadence WEEKLY|BIWEEKLY|MONTHLY
 * @param weekday MONDAY..SUNDAY
 * @param timeOfDay KST 정시 「HH:mm」
 * @param templatePageId 「정기 리포트」 템플릿 노트 — 프로젝트 노트 공간 안에 실제로 있을 때만(아직 없거나 지워졌거나 다른 공간이면 null)
 * @param nextRunAt 다음 생성 시각(꺼졌으면 null)
 * @param canManage 호출자가 바꿀 수 있는지(프로젝트 OWNER·ADMIN, 개인 프로젝트는 false) — 아니면 화면이 읽기 전용
 * @param noteSpaceId 프로젝트 노트 공간(없으면 null) — 저장 위치 고르기 창이 그 트리를 읽는다
 * @param templateRootPageId 맨 위 「템플릿」 페이지(없으면 null) — 고르기 창에서 그 갈래를 뺀다
 * @param templatePath 템플릿 경로 제목(예 「템플릿」·「정기 리포트」), 템플릿이 없으면 빈 목록
 * @param templateRecreatedAt 없어진 템플릿을 다시 만든 시각(설정 화면 「템플릿을 다시 만들었어요」, 없으면 null)
 * @param reportLocationPageId 유효한 저장 위치(고른 위치가 공간 안이면 그것, 아니면 「리포트」, 그것도 없으면 null)
 * @param reportLocationPath 저장 위치 경로 제목 — 기본 「리포트」(「리포트」가 아직 없어도 — 다음 생성 때 만든다)
 */
public record ProjectReportSettingsResponse(
    boolean enabled,
    String cadence,
    String weekday,
    String timeOfDay,
    Long templatePageId,
    OffsetDateTime nextRunAt,
    boolean canManage,
    Long noteSpaceId,
    Long templateRootPageId,
    List<String> templatePath,
    OffsetDateTime templateRecreatedAt,
    Long reportLocationPageId,
    List<String> reportLocationPath) {}
