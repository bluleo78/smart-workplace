package com.workplace.wiki.dto;

import jakarta.validation.constraints.NotNull;

/**
 * 페이지 이동 요청.
 *
 * @param parentId 새 부모 페이지(null = 스페이스 최상위)
 * @param position 새 형제들 안의 자리(서버가 0..형제 수로 자른다)
 * @param targetSpaceId 다른 스페이스로 옮길 때 그 스페이스(WP-988). null 이거나 지금 스페이스와 같으면 같은 스페이스 안 이동이다. 지정하면
 *     원본·대상 스페이스 모두 EDITOR 이상이어야 하고, 부모는 대상 스페이스의 페이지여야 한다. 하위 페이지는 늘 함께 옮겨 간다
 */
public record MovePageRequest(Long parentId, @NotNull Integer position, Long targetSpaceId) {

  /** 같은 스페이스 안 이동 — 스페이스 사이 이동이 생기기 전부터 쓰던 모양. */
  public MovePageRequest(Long parentId, Integer position) {
    this(parentId, position, null);
  }
}
