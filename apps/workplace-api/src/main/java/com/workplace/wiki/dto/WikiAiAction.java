package com.workplace.wiki.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * 인에디터 /ai 액션. 와이어 포맷은 소문자(draft|continue 등) — 프론트 및 ai-agent zod 계약과 일치시킨다.
 *
 * <p>WP-301: 요약은 상단 카드(WikiSummaryService)로 이동 — 본문 삽입형 summarize 제거.
 *
 * <p>{@link JsonValue} 로 직렬화(소문자 → 에이전트 본문 전달), {@link JsonCreator} 로 역직렬화(대소문자 무관 바인딩)한다.
 *
 * <p>WP-1302: 액션마다 무엇을 쓰고 무엇이 꼭 있어야 하는지(노트 본문 사용·selection 필수·prompt 필수)를 여기에 둔다 — 요청 검증 ({@link
 * WikiAiRequest})과 에이전트 본문 만들기(WikiAiService)가 액션 이름으로 갈라지지 않고 이 값을 읽는다.
 */
public enum WikiAiAction {
  DRAFT("draft", true, false, false),
  CONTINUE("continue", true, false, false),
  // 변형 계열(선택영역 제자리 교체) — 톤 변경/번역/확장/축약/다듬기. 선택이 없으면 에이전트가 본문 맥락으로 처리하던 기존 동작 그대로
  // 필수로 두지 않는다.
  REWRITE_TONE("rewrite_tone", true, false, false),
  TRANSLATE("translate", true, false, false),
  EXPAND("expand", true, false, false),
  CONDENSE("condense", true, false, false),
  POLISH("polish", true, false, false),
  // WP-1302 노트 HTML 블록 「AI로 고치기」 — selection(지금 HTML 소스)을 prompt 대로 고친 HTML 전체를 돌려준다. 웹이 미리보기 뒤
  // 「적용」으로만 넣는다. 블록 소스만 고치므로 노트 본문은 싣지 않고, 소스·지시가 둘 다 있어야 한다(없으면 AI 가 새 HTML 을 지어내
  // 블록을 통째 바꾸게 된다).
  FIX_HTML("fix_html", false, true, true);

  private final String wire;
  private final boolean usesPageBody;
  private final boolean requiresSelection;
  private final boolean requiresPrompt;

  WikiAiAction(
      String wire, boolean usesPageBody, boolean requiresSelection, boolean requiresPrompt) {
    this.wire = wire;
    this.usesPageBody = usesPageBody;
    this.requiresSelection = requiresSelection;
    this.requiresPrompt = requiresPrompt;
  }

  /** 에이전트에 노트 본문을 실어 보내는지 — 프롬프트가 본문을 쓰지 않는 액션은 큰 본문을 보내지 않는다. */
  public boolean usesPageBody() {
    return usesPageBody;
  }

  /** selection(고칠 원본)이 비어 있으면 안 되는지 — 요청 검증이 400 으로 거절한다. */
  public boolean requiresSelection() {
    return requiresSelection;
  }

  /** prompt(지시)가 비어 있으면 안 되는지 — 요청 검증이 400 으로 거절한다(DRAFT 처럼 지시가 선택인 액션은 거짓). */
  public boolean requiresPrompt() {
    return requiresPrompt;
  }

  /** 직렬화 — 소문자 와이어 값으로 내보낸다(에이전트 zod enum 과 일치). */
  @JsonValue
  public String wire() {
    return wire;
  }

  /** 역직렬화 — 소문자/대문자 어떤 입력이든 관용적으로 바인딩한다. */
  @JsonCreator
  public static WikiAiAction from(String raw) {
    if (raw == null) {
      throw new IllegalArgumentException("action 은 필수입니다");
    }
    String v = raw.trim().toLowerCase();
    for (WikiAiAction a : values()) {
      if (a.wire.equals(v)) {
        return a;
      }
    }
    throw new IllegalArgumentException("알 수 없는 wiki ai action: " + raw);
  }
}
