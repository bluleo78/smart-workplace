package com.workplace.wiki.report.dto;

import jakarta.validation.constraints.Pattern;

/**
 * 개인 보고 설정 저장 요청(WP-1486). 비운 필드는 지금 값(없으면 기본값)을 그대로 둔다. 시각은 KST 정시만(서비스도 다시 검사한다).
 *
 * @param dailyEnabled 매일 아침 일일 보고 켬/끔
 * @param timeOfDay 「HH:00」(00~23시)
 * @param skipEmpty 「한 일이 없는 날은 건너뜀」
 */
public record UpdatePersonalReportSettingsRequest(
    Boolean dailyEnabled,
    @Pattern(regexp = "^([01]\\d|2[0-3]):00$", message = "보고 시각은 정시(00:00~23:00)여야 해요")
        String timeOfDay,
    Boolean skipEmpty) {}
