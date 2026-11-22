package com.workplace.home.dto;

import java.util.List;

/**
 * 사용자 홈 대시보드 레이아웃 응답 — 위젯 설정의 정렬된 목록(순서가 곧 표시 순서)과 낙관적 동시성 version(WP-1953).
 *
 * <p>version 은 저장 성공마다 1 오르고, 저장된 행이 없으면 0 이다. 클라이언트는 이 값을 PUT 에 실어 읽은 뒤 바뀐 레이아웃을 덮어쓰지 않게 한다.
 */
public record DashboardResponse(List<DashboardWidgetConfig> widgets, long version) {}
