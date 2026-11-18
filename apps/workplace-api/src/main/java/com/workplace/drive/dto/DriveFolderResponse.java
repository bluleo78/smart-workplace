package com.workplace.drive.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.OffsetDateTime;

/**
 * 폴더 응답. parentId NULL = 공간 루트. updatedAt 은 목록 3열(이름/크기/수정일, #799) 노출용(이름변경/이동 시 갱신).
 *
 * <p>starred 는 내가 별표했는지(WP-1698) — 공간 폴더 목록({@code GET /spaces/{id}/items})만 채우고, 그 밖 응답은 null 이라
 * JSON 에서 빠진다.
 */
public record DriveFolderResponse(
    long id,
    Long parentId,
    String name,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt,
    @JsonInclude(JsonInclude.Include.NON_NULL) Boolean starred) {

  /** 별표 칸 없는 폴더 응답 — 별표를 보이지 않는 응답(생성·이름 바꾸기·검색 등)이 쓴다. */
  public DriveFolderResponse(
      long id, Long parentId, String name, OffsetDateTime createdAt, OffsetDateTime updatedAt) {
    this(id, parentId, name, createdAt, updatedAt, null);
  }

  /** 별표 여부를 실은 사본 — 폴더 목록이 내 별표를 한 번에 읽은 뒤 붙인다. */
  public DriveFolderResponse withStarred(boolean value) {
    return new DriveFolderResponse(id, parentId, name, createdAt, updatedAt, value);
  }
}
