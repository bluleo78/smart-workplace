package com.workplace.issue.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * 부모 에픽 외부 링크 일괄 변환(WP-1038) 요청 — Jira 이관 때 「다른 프로젝트 에픽에 속함」을 외부 링크(PARENT_EPIC)로 남긴 것을 실제 부모 관계로
 * 바꾼다.
 *
 * @param projectKey 이 프로젝트 이슈(자식)의 링크만 본다. 없으면 워크스페이스 전체
 * @param dryRun true 면 판정만 돌려주고 아무것도 쓰지 않는다. 실수로 바로 바꾸지 않게 반드시 명시해야 한다
 * @param limit 한 번에 볼 링크 수(1~500, 없으면 500) — 링크 id 순으로 afterLinkId 다음부터
 * @param afterLinkId 이 링크 id 보다 큰 링크부터 본다(없으면 처음부터). 앞 응답의 nextAfterLinkId 를 넘기면 바꾸지 못하고 남은 앞쪽 링크를
 *     건너뛰고 다음 링크를 본다
 */
public record ConvertParentEpicLinksRequest(
    @Size(max = 64, message = "프로젝트 키는 64자 이하여야 합니다.") String projectKey,
    @NotNull(message = "dryRun 을 명시해 주세요.") Boolean dryRun,
    @Min(value = 1, message = "limit 은 1 이상이어야 합니다.")
        @Max(value = MAX_LIMIT, message = "limit 은 500 이하여야 합니다.")
        Integer limit,
    @Min(value = 0, message = "afterLinkId 는 0 이상이어야 합니다.") Long afterLinkId) {

  /** 한 번에 볼 수 있는 링크 상한 — 한 트랜잭션이 너무 길어지지 않게. */
  public static final int MAX_LIMIT = 500;

  /** 실제로 쓸 상한 — 없으면 최대치. */
  public int effectiveLimit() {
    return limit == null ? MAX_LIMIT : limit;
  }
}
