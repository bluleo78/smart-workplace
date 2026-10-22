package com.workplace.issue.dto;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.List;

/**
 * 이슈 필드 값 PUT 본문. incoming 만 처리 — 전송하지 않은 defId 의 기존 값은 유지된다. value 가 null/NullNode 면 row 삭제.
 *
 * <p>원소에도 {@code @NotNull @Valid} 를 둔다 — {@code [null]} 이 서비스에서 500 이 났고, 원소의 {@code defId} 검증도 꺼져
 * 있었다(WP-743).
 */
public record UpdateIssueFieldsRequest(@NotNull List<@NotNull @Valid FieldValueInput> values) {

  /** 한 필드의 변경 입력. */
  public record FieldValueInput(@NotNull Long defId, JsonNode value) {}
}
