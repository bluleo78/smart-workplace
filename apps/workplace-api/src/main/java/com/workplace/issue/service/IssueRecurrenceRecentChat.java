package com.workplace.issue.service;

import com.workplace.global.util.Texts;
import com.workplace.issue.dto.IssueRecurrenceRow;
import com.workplace.issue.outbound.IssueChatExcerptReader;
import com.workplace.issue.outbound.IssueDomainEvents.IssueRecurringRunEvent.ChatLine;
import com.workplace.issue.outbound.IssueDomainEvents.IssueRecurringRunEvent.RecentChat;
import com.workplace.issue.outbound.dto.ChatExcerpt;
import com.workplace.issue.outbound.dto.RecurrenceChatExcerpts;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 반복 회차 이벤트에 싣는 이슈 챗 맥락을 만든다(WP-1375) — 사람이 남긴 최근 글(맡긴 사람 글·새 글 표시)과 담당 AI 의 마지막 글.
 *
 * <p>회차 지시문이 이슈 본문만 담아, 사람이 이슈 챗에서 정한 결정·답을 다음 회차가 몰라 같은 것을 또 묻던 문제를 고친다. 정기 회차·「지금 실행」·이어 처리가 같은
 * 규칙을 쓰도록 한 곳에 둔다. 이슈 챗 읽기는 chat 모듈이 구현한 {@link IssueChatExcerptReader} 포트로만 한다(issue→chat 직접 의존
 * 없음). 이 빈은 그 포트에만 의존해 {@link IssueRecurrenceService} ↔ 챗 포스터 사이에 빈 순환을 만들지 않는다.
 *
 * <p>상한(ai-agent 도 같은 값으로 한 번 더 막는다): 사람 글 최근 {@value #MAX_HUMAN_MESSAGES}건 → 글 하나 {@value
 * #MAX_MESSAGE_CHARS}자 → 합계 {@value #MAX_TOTAL_CHARS}자(넘으면 오래된 것부터 버린다). 담당 AI 의 마지막 글은 {@value
 * #MAX_LAST_RESULT_CHARS}자. 글자 수는 UTF-16 단위로 세고 잘린 글은 「…」까지 포함해 상한 이하라, 같은 상한을 JS(length)로 다시 적용해도
 * 그대로다.
 */
@Component
@RequiredArgsConstructor
public class IssueRecurrenceRecentChat {

  /** 사람 글 최대 건수 — 가장 최근 것부터 고른다. */
  public static final int MAX_HUMAN_MESSAGES = 20;

  /** 사람 글 하나의 최대 글자 수(「…」 포함). */
  public static final int MAX_MESSAGE_CHARS = 1000;

  /** 사람 글 본문 합계 최대 글자 수 — 넘으면 오래된 글부터 버린다. */
  public static final int MAX_TOTAL_CHARS = 6000;

  /** 담당 AI 의 마지막 글 최대 글자 수(「…」 포함). */
  public static final int MAX_LAST_RESULT_CHARS = 1500;

  private static final String ELLIPSIS = "…";

  private final IssueChatExcerptReader chatReader;

  /**
   * 이번 회차의 이슈 챗 맥락. 사람 글은 지난 회차 시각으로 자르지 않고 최근 글을 싣는다 — 계속 지킬 결정이 지난 회차 전에 남았을 수 있다. 새 글 표시(isNew)의
   * 기준은 row 의 lastRunAt 이라, 호출자는 이번 실행이 lastRunAt 을 갱신하기 <b>전</b>에 읽은 행을 넘겨야 한다(갱신 뒤의 값이면 새 글이 늘
   * 없다). 「맡긴 사람」(owner)은 반복을 저장한 사람(created_by) — 정기 회차 질문에 답하는 사람과 같다. 사람 글도 담당 AI 글도 없으면 null.
   */
  public RecentChat read(IssueRecurrenceRow row) {
    Instant since = row.lastRunAt();
    // 스레드 id 는 리더가 한 번만 찾는다.
    RecurrenceChatExcerpts chat =
        chatReader.recurrenceChat(row.issueId(), MAX_HUMAN_MESSAGES, row.agentUserId());
    List<ChatLine> human =
        capTotal(
            chat.humanRecent().stream()
                // 저장소가 이미 본문 없는 글을 뺐다 — 여기는 방어선이다(NULL 본문 하나로 회차가 매번 실패해 반복이 멈추지 않게).
                .filter(IssueRecurrenceRecentChat::hasText)
                .map(
                    m ->
                        new ChatLine(
                            m.authorName(),
                            cap(m.body(), MAX_MESSAGE_CHARS),
                            m.createdAt(),
                            m.authorId() == row.createdBy(),
                            since == null || m.createdAt().isAfter(since)))
                .toList());
    ChatExcerpt lastExcerpt = chat.lastByAuthor();
    ChatLine last =
        lastExcerpt == null || !hasText(lastExcerpt)
            ? null
            : new ChatLine(
                lastExcerpt.authorName(),
                cap(lastExcerpt.body(), MAX_LAST_RESULT_CHARS),
                lastExcerpt.createdAt(),
                false,
                false);
    if (human.isEmpty() && last == null) return null;
    return new RecentChat(human, last);
  }

  /** 오래된 순 목록에서 합계가 상한 안에 들 때까지 가장 오래된 글부터 버린다 — 최근 글이 남는다. */
  static List<ChatLine> capTotal(List<ChatLine> oldestFirst) {
    List<ChatLine> kept = new ArrayList<>(oldestFirst);
    int total = kept.stream().mapToInt(IssueRecurrenceRecentChat::length).sum();
    while (total > MAX_TOTAL_CHARS && !kept.isEmpty()) {
      total -= length(kept.removeFirst());
    }
    return kept;
  }

  /** 본문이 null·공백뿐이 아닌 글인지 — 첨부만 있는 글은 지시문에 실을 내용이 없다. */
  private static boolean hasText(ChatExcerpt m) {
    return m.body() != null && !m.body().isBlank();
  }

  /** 본문 글자 수(UTF-16). hasText 가 null 본문을 이미 걸러 항상 본문이 있다. */
  private static int length(ChatLine l) {
    return l.body().length();
  }

  /** max 글자(UTF-16)를 넘으면 앞 max-1 글자에 「…」를 붙여 정확히 max 이하로 만든다. */
  static String cap(String s, int max) {
    if (s == null || s.length() <= max) return s;
    return Texts.headUtf16(s, max - ELLIPSIS.length()) + ELLIPSIS;
  }
}
