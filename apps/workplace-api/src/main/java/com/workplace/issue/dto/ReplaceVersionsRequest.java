package com.workplace.issue.dto;

import jakarta.validation.constraints.NotNull;
import java.util.List;

/**
 * 이슈 수정 버전·영향 버전 교체 요청(WP-888). 빠진(null) 키는 그 종류를 건드리지 않고, 빈 배열이면 그 종류를 모두 뗀다. 원소 null 은 검증
 * 오류(400)로 막는다 — 서비스까지 들어가면 NPE 로 500 이 난다(구성요소 교체와 같은 이유).
 */
public record ReplaceVersionsRequest(
    List<@NotNull Long> fixVersionIds, List<@NotNull Long> affectsVersionIds) {}
