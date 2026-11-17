package com.workplace.notify.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * 보관 되돌리기 요청(WP-1689) — 되돌릴 알림 id 묶음(보통 방금 「읽은 알림 보관」이 돌려준 archivedIds). 빈 배열·null 원소는 거절하고, 한 번에
 * 최대 1000개로 막아 한 요청이 거대한 IN 목록을 만들지 않게 한다.
 */
public record UnarchiveNotificationsRequest(
    @NotNull @Size(min = 1, max = 1000) List<@NotNull Long> ids) {}
