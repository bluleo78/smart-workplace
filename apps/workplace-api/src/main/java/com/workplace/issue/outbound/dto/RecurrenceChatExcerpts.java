package com.workplace.issue.outbound.dto;

import java.util.List;

/**
 * 반복 회차 지시문용 이슈 챗 발췌 묶음(WP-1375) — 스레드를 한 번만 찾아 사람 글과 담당 AI 의 마지막 글을 함께 돌려준다.
 *
 * @param humanRecent 사람이 남긴 본문 있는 최근 글, 오래된 순(삭제 제외). 스레드가 없으면 빈 리스트
 * @param lastByAuthor 담당 AI 가 남긴 가장 최근 글(삭제 제외). 없으면 null
 */
public record RecurrenceChatExcerpts(List<ChatExcerpt> humanRecent, ChatExcerpt lastByAuthor) {

  /** 스레드가 없을 때의 빈 묶음. */
  public static RecurrenceChatExcerpts empty() {
    return new RecurrenceChatExcerpts(List.of(), null);
  }
}
