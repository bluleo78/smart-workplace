package com.workplace.home.dto;

import java.util.List;

/** 사용자 홈 대시보드 레이아웃 응답 — 위젯 설정의 정렬된 목록(순서가 곧 표시 순서). */
public record DashboardResponse(List<DashboardWidgetConfig> widgets) {}
