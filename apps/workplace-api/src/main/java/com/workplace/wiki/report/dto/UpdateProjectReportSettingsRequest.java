package com.workplace.wiki.report.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/** 프로젝트 리포트 설정 저장 요청(WP-1483). enabled 는 필수, 나머지는 비우면 지금 값(없으면 기본값)을 그대로 둔다. 시각은 KST 정시만. */
public record UpdateProjectReportSettingsRequest(
    @NotNull(message = "리포트를 켤지 끌지 정해 주세요") Boolean enabled,
    @Pattern(regexp = "WEEKLY|BIWEEKLY|MONTHLY", message = "리포트 주기는 매주·격주·매월 중 하나여야 합니다")
        String cadence,
    @Pattern(
            regexp = "MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY",
            message = "리포트 요일이 올바르지 않습니다")
        String weekday,
    @Pattern(regexp = "^([01]\\d|2[0-3]):00$", message = "리포트 시각은 정시(00:00~23:00)여야 합니다")
        String timeOfDay) {}
