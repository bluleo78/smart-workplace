package com.workplace.home.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.List;

/** 대시보드 레이아웃 저장 요청 — 위젯 설정 배열(순서가 표시 순서). 각 항목은 per-field 검증 대상. */
public record DashboardUpdateRequest(@NotNull @Valid List<DashboardWidgetConfig> widgets) {}
