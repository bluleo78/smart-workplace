package com.workplace.wiki.dto;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * 인에디터 /ai 스트리밍 요청 본문. 페이지 본문·제목은 서버가 DB 에서 채우므로 클라이언트는 액션과 선택/지시문만 보낸다.
 *
 * @param action 수행 액션(요약·초안·이어쓰기). 소문자 와이어로 바인딩.
 * @param prompt draft 액션의 지시문(선택) · fix_html 의 고칠 지시(필수)
 * @param selection 변형 대상 선택 영역(선택) · fix_html 의 지금 HTML 소스(필수)
 * @param targets fix_html 에서 고른 요소 설명(선택자 경로·태그·짧은 outerHTML·글자, WP-1302) — 있으면 AI 가 그 부분만 고친다
 */
public record WikiAiRequest(
    @NotNull WikiAiAction action,
    // WP-674: 지시문 상한 — 웹 「AI 초안 작성」 창은 짧게 막지만 API 를 바로 부르면 무제한이었다. 메일 초안 지시(4000)와 같은 값,
    // ai-agent 검증도 같다. selection 은 페이지 본문 상한(WP-625)을 따르므로 두지 않는다.
    @Size(max = 4000, message = "지시문은 4000자 이하로 입력해 주세요") String prompt,
    String selection,
    // WP-1302: 고른 요소는 웹 고르기 칩 수와 맞춰 10개, 한 개 설명은 2000자(outerHTML 앞 300자 + 경로·글자에 넉넉히)까지 — ai-agent
    // zod 와 같다.
    @Size(max = 10, message = "고른 요소는 10개까지 보낼 수 있습니다")
        List<@Size(max = 2000, message = "고른 요소 설명은 2000자 이하여야 합니다") String> targets) {

  /** 기존 호출(액션·지시문·선택만)용 — 고른 요소 없이. */
  public WikiAiRequest(WikiAiAction action, String prompt, String selection) {
    this(action, prompt, selection, null);
  }

  /**
   * selection 이 필요한 액션({@link WikiAiAction#requiresSelection()})이면 비어 있지 않아야 한다(WP-1302). 다른 액션은
   * 상관없다. 문구는 지금 이 조건을 쓰는 유일한 액션(fix_html — 고칠 HTML 소스)에 맞춘다. action 이 없으면 @NotNull 이 거절하므로 통과시킨다.
   */
  @JsonIgnore
  @AssertTrue(message = "고칠 HTML 소스가 필요합니다")
  public boolean isRequiredSelectionPresent() {
    return action == null
        || !action.requiresSelection()
        || (selection != null && !selection.isBlank());
  }

  /**
   * prompt 가 필요한 액션({@link WikiAiAction#requiresPrompt()})이면 비어 있지 않아야 한다(WP-1302). DRAFT 처럼 지시가
   * 선택인 액션은 상관없다. 문구는 fix_html(무엇을 고칠지)에 맞춘다.
   */
  @JsonIgnore
  @AssertTrue(message = "고칠 내용을 입력해 주세요")
  public boolean isRequiredPromptPresent() {
    return action == null || !action.requiresPrompt() || (prompt != null && !prompt.isBlank());
  }
}
