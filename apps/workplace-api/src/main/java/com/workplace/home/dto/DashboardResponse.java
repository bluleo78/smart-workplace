package com.workplace.home.dto;

import java.util.List;

/** 사용자 홈 대시보드 레이아웃 응답 — 위젯 타입 키의 정렬된 목록. */
public record DashboardResponse(List<String> widgets) {}
