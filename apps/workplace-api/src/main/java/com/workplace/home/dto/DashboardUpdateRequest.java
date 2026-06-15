package com.workplace.home.dto;

import jakarta.validation.constraints.NotNull;
import java.util.List;

/** 대시보드 레이아웃 저장 요청 — 위젯 타입 키 배열(순서가 표시 순서). */
public record DashboardUpdateRequest(@NotNull List<String> widgets) {}
