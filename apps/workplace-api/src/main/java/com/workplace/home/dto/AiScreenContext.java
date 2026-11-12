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
 *
 * <p>help(WP-1511)는 도움말 패널이 열려 있을 때 web 이 얹는 도움말 층이다. 비밀 입력칸의 값을 싣지 않는 판정은 web 몫이고, api 는 크기 상한만
 * 검증해 그대로 넘긴다(AiSuggestionRequest 도 같은 record 를 쓰므로 따로 손대지 않는다).
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record AiScreenContext(
    @NotBlank @Size(max = 50) String view,
    @Valid Focus focus,
    @Valid Scope scope,
    @Valid Help help) {

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
  public record Fact(
      @NotBlank @Size(max = 30) String label, @NotNull @Size(max = 200) String value) {}

  /** WP-1511 — 도움말 층. 모든 하위 필드는 선택이며, 상한은 web LIMITS.help* 와 같다. */
  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record Help(
      @Valid Section section,
      @Valid HelpFocus focus,
      @Size(max = 100) String dialog,
      @Size(max = 200) String query,
      @Size(max = 5) List<@Valid DialogTarget> dialogs) {}

  /** 보고 있는 도움말 절 — id·경로(최대 8단)·본문(조건·자리표시 처리 뒤). */
  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record Section(
      @NotBlank @Size(max = 100) String id,
      @NotNull @Size(max = 8) List<@NotBlank @Size(max = 50) String> path,
      @NotNull @Size(max = 2000) String body) {}

  /** 포커스된 입력칸 — secret 이면 web 이 value 를 싣지 않는다(api 는 상한만 본다). */
  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record HelpFocus(
      @NotBlank @Size(max = 100) String name, Boolean secret, @Size(max = 200) String value) {}

  /** AI 가 열어 줄 수 있는 창 — id 와 사용자에게 보이는 이름. */
  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record DialogTarget(
      @NotBlank @Size(max = 100) String id, @NotBlank @Size(max = 50) String label) {}
}
