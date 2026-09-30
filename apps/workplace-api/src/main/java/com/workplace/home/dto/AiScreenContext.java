package com.workplace.home.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;

/**
 * AI 채팅 화면 컨텍스트(WP-54) — 사용자가 보고 있는 화면의 대상(focus)·목록 상태(scope).
 *
 * <p>web 이 표시 문자열로 조립해 보내고, api 는 크기 상한만 검증한 뒤 가공 없이 ai-agent 로 전달한다(DB 비저장). 상한은 web common.ts
 * LIMITS · ai-agent screenContextSchema 와 동일. NON_NULL — 빈 선택 필드는 ai-agent 로 보내지 않는다.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record AiScreenContext(
    @NotBlank @Size(max = 50) String view, @Valid Focus focus, @Valid Scope scope) {

  /** 레벨1 — 보고 있는 대상. refs 키는 MCP 도구 인자명(issueKey 등). */
  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record Focus(
      @NotBlank @Size(max = 50) String type,
      @NotBlank @Size(max = 200) String label,
      @Size(max = 5) Map<@NotBlank @Size(max = 40) String, @NotNull @Size(max = 100) String> refs,
      @Size(max = 12) List<@Valid Fact> facts) {}

  /** 레벨2 — 목록·범위·필터 상태. count 는 화면에 로드된 건수(총계 아님). */
  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record Scope(
      @NotBlank @Size(max = 200) String label,
      @Size(max = 5) Map<@NotBlank @Size(max = 40) String, @NotNull @Size(max = 100) String> refs,
      @Size(max = 12) List<@Valid Fact> facts,
      @Min(0) Integer count,
      Boolean hasMore) {}

  /** 라벨:값 표시 문자열 한 쌍. value 는 빈 문자열은 허용하되 null 은 거부(ai-agent zod 가 string 필수라 전달 후 실패하지 않게). */
  public record Fact(@NotBlank @Size(max = 30) String label, @NotNull @Size(max = 200) String value) {}
}
