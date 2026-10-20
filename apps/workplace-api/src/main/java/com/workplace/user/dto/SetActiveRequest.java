package com.workplace.user.dto;

import jakarta.validation.constraints.NotNull;

/**
 * 구성원 활성 상태 변경 요청. WP-568: 원시 boolean 이면 필드가 빠진 빈 본문({@code {}})이 false 로 바뀌어 의도하지 않은 정지가 됐다 — 래퍼 +
 * {@code @NotNull} 로 누락을 400 으로 거절한다.
 */
public record SetActiveRequest(@NotNull(message = "활성 여부(active)를 보내 주세요") Boolean active) {}
