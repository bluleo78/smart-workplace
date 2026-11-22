package com.workplace.home.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.List;

/**
 * 대시보드 레이아웃 저장 요청 — 위젯 설정 배열(순서가 표시 순서). 각 항목은 per-field 검증 대상.
 *
 * <p>version 은 선택(WP-1953) — 읽은 시점의 레이아웃 version. 주면 그 version 일 때만 저장하고 아니면 409, null 이면 검사 없이
 * 저장한다(옛 호출·롤링 배포 호환).
 *
 * <p>원소에도 {@code @NotNull} 을 둔다 — {@code [null]} 이 서비스까지 가 {@code w.type()} 에서 NPE(500)가
 * 났다(WP-742).
 */
public record DashboardUpdateRequest(
    @NotNull @Valid List<@NotNull @Valid DashboardWidgetConfig> widgets, Long version) {}
