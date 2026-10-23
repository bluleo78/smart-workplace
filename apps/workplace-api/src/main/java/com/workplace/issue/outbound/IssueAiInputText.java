package com.workplace.issue.outbound;

import com.workplace.global.util.Texts;

/**
 * AI 입력용 텍스트 자르기 공용 유틸(WP-885).
 *
 * <p>이슈 본문·코멘트 상한이 5만자로 올라 AI(요약·분류)에 그대로 보내면 모델 컨텍스트·ai-agent 요청 본문 상한을 넘긴다. 자르는 규칙·표식·글자 수 예산을 한
 * 곳에 모아 요약·분류가 같은 모양으로 잘리게 한다.
 */
public final class IssueAiInputText {

  /**
   * AI 입력에 넘기는 이슈 본문 최대 글자 수(WP-885). 본문 상한이 5만자로 올라 전부 보내면 한글 코멘트 약 27건만 돼도 ai-agent 요청 본문
   * 상한(4MB)에서 413 이, 65,536 토큰 모델(opencode)에서는 컨텍스트 초과로 502 가 난다. 요약·분류 모두 앞부분이면 충분하므로 API 가
   * payload 를 만들 때 자른다. 자른 곳은 {@link #truncate} 의 「…(이하 N자 생략)」 표식으로 모델에 알린다.
   */
  public static final int AI_BODY_MAX_CHARS = 20_000;

  /** 코멘트·채팅 메시지 1건당 최대 글자 수(WP-885) — 긴 붙여넣기 한 건이 합계 예산을 독식하지 않게 한다. */
  public static final int AI_ITEM_MAX_CHARS = 4_000;

  private IssueAiInputText() {}

  /**
   * 글자 수 상한을 넘는 텍스트를 앞부분만 남기고 「…(이하 N자 생략)」 표식을 붙인다. 상한 이하면 원문 그대로(null 도 그대로). 서로게이트 쌍(이모지 등)
   * 한가운데서는 자르지 않는다({@link Texts#headUtf16}).
   */
  public static String truncate(String text, int max) {
    String head = Texts.headUtf16(text, max);
    // headUtf16 은 자를 필요가 없으면 같은 인스턴스를 돌려준다.
    return head == text ? text : head + truncationNote(text.length() - head.length());
  }

  /** 잘린 텍스트 끝에 붙는 표식 — 모델이 내용이 더 있었음을 알게 한다. */
  private static String truncationNote(int omittedChars) {
    return "…(이하 " + omittedChars + "자 생략)";
  }
}
