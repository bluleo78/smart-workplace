package com.workplace.issue.dto;

import jakarta.validation.constraints.NotNull;
import java.util.List;

/**
 * 이슈 구성요소 집합 교체 요청(WP-933). 빈 배열이면 모두 뗀다. 원소 null 은 검증 오류(400)로 막는다 — 서비스까지 들어가면 NPE 로 500 이 난다(라벨
 * 교체 WP-500 과 같은 이유).
 */
public record ReplaceComponentsRequest(@NotNull List<@NotNull Long> componentIds) {}
