package com.workplace.mail.dto;

/**
 * 메일 분류 교정 학습 결과(WP-1341). 웹은 CREATE·UPDATE 일 때만 「AI 비서가 기억했어요: {content}」를 띄운다.
 *
 * @param action CREATE(새 기억) · UPDATE(기존 기억 고침) · NONE(기억할 것 없음·저장 못 함·ai-agent 실패)
 * @param memoryId 만든·고친 기억 id(NONE 이면 null) — [기억 취소]가 지우거나 되돌릴 대상
 * @param content 저장한 기억 문장(NONE 이면 null)
 * @param previousContent UPDATE 면 고치기 전 문장(그 외 null) — [기억 취소]가 되돌릴 값
 */
public record LearnMailCategoryResponse(
    String action, Long memoryId, String content, String previousContent) {

  /** 기억하지 않음. */
  public static final LearnMailCategoryResponse NONE =
      new LearnMailCategoryResponse("NONE", null, null, null);
}
