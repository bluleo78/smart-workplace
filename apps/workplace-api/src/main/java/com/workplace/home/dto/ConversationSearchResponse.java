package com.workplace.home.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 지난 대화 검색 결과(WP-384 search_conversations) — 대화마다 대표 턴 하나. 꺼짐이면 memoryEnabled=false + 빈 목록(도구가 꺼짐
 * 안내를 돌려준다).
 */
public record ConversationSearchResponse(boolean memoryEnabled, List<Item> items) {

  /**
   * @param question 대표 턴의 질문 앞 200자(없으면 null)
   * @param answerExcerpt 대표 턴 답의 키워드 주변 300자(없으면 앞 300자, 답이 없으면 null)
   * @param link 웹 딥링크 "/?chat=<sessionId>" — AI 가 출처 링크로 그대로 붙인다
   */
  public record Item(
      UUID sessionId,
      String title,
      Instant lastMessageAt,
      String question,
      String answerExcerpt,
      String link) {}
}
