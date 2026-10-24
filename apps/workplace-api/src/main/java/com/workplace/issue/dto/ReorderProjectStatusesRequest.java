package com.workplace.issue.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.util.List;

/**
 * 같은 범주 안 상태 순서 변경 본문(WP-809). statusIds 는 그 범주의 상태 전부를 새 순서대로 한 번씩 담는다 — 빠지거나 겹치거나 다른 범주가 섞이면 서비스가
 * 400 으로 거절한다. 범주를 넘는 이동은 받지 않는다(범주 순서는 고정).
 */
public record ReorderProjectStatusesRequest(
    @NotBlank @Pattern(regexp = IssueStatuses.CATEGORY_REGEX) String category,
    @NotNull List<Long> statusIds) {}
