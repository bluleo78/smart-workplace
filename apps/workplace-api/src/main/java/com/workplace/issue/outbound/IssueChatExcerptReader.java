package com.workplace.issue.outbound;

import com.workplace.issue.outbound.dto.ChatExcerpt;
import com.workplace.issue.outbound.dto.RecurrenceChatExcerpts;
import java.util.List;

/**
 * 이슈 채팅 메시지를 AI 요약 입력으로 읽는 포트. issue→chat 직접 의존(순환)을 피하기 위해 issue 모듈이 인터페이스를 소유하고 chat 모듈이
 * 구현한다(chat→issue 는 기존 의존).
 */
public interface IssueChatExcerptReader {
  /** 이슈의 채팅 스레드 최근 메시지(시간 오름차순, 삭제 제외). 스레드 없으면 빈 리스트. */
  List<ChatExcerpt> recentForIssue(long issueId, int limit);

  /**
   * 반복 회차 지시문용(WP-1375) — 스레드를 한 번만 찾아 (1) 사람(HUMAN)이 남긴 본문 있는 글 중 가장 최근 humanLimit 건을 오래된 순으로, (2)
   * authorId(담당 AI)가 남긴 가장 최근 글을 돌려준다(삭제 제외, 글쓴이 id 포함). 지난 회차 시각으로 자르지 않는다 — 계속 지킬 결정이 지난 회차 전에
   * 남았을 수 있어서다. 스레드가 없으면 빈 묶음.
   */
  RecurrenceChatExcerpts recurrenceChat(long issueId, int humanLimit, long authorId);
}
