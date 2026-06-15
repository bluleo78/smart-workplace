package com.workplace.home.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * 대시보드 위젯 한 개의 설정. 배열의 순서가 곧 표시 순서다.
 *
 * @param type 위젯 타입 키 (KNOWN_WIDGETS 화이트리스트로 검증)
 * @param count 위젯이 보여줄 항목 수. 허용값 3/5/10 (서비스에서 검증, 0/미지정은 기본 5로 보정)
 * @param hidden 그리드에서 숨김 여부. 숨겨도 순서·설정 보존을 위해 영속된다(클라이언트가 렌더만 생략)
 */
public record DashboardWidgetConfig(@NotBlank String type, int count, boolean hidden) {}
