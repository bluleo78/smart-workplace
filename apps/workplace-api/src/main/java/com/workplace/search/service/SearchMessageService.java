package com.workplace.search.service;

import com.workplace.global.dto.MentionResponse;
import com.workplace.global.service.UserMentionHydrator;
import com.workplace.global.util.ChatMarkdownText;
import com.workplace.global.util.MentionParser;
import com.workplace.messaging.dto.DmParticipant;
import com.workplace.messaging.repository.MessagingSummaryRepository;
import com.workplace.messaging.service.MessagingSummaryService;
import com.workplace.search.dto.MessageSearchHit;
import com.workplace.search.dto.MessageSearchPage;
import com.workplace.search.repository.MessageSearchRepository;
import com.workplace.search.repository.MessageSearchRepository.Row;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 통합 검색 팔레트(WP-1358)의 메시지 본문 검색 — 내가 멤버인 채널·DM 의 메시지를 최신순으로 찾아 화면이 한 줄로 그릴 모양(보낸 사람·발췌·대화 이름·시각)으로
 * 돌려준다. DM 이름은 대화 목록과 같은 규칙({@link MessagingSummaryService#dmLabel})으로 보는 사람 기준 상대 이름을 붙인다.
 */
@Service
@RequiredArgsConstructor
public class SearchMessageService {

  /** 최소 검색어 길이(공백 뺀 길이 미만이면 빈 결과) — 다른 통합 검색 API 와 같다. */
  private static final int MIN_QUERY = 2;

  /** 발췌 길이(코드포인트) — AI 대화 검색과 같다. */
  private static final int EXCERPT_CHARS = 120;

  /**
   * 맞은 곳 앞에 남길 글자 수(코드포인트). 팔레트의 메시지 행은 보낸 사람 옆 한 줄이라 앞 40자 남짓만 보인다 — 맞은 곳이 뒤쪽이면 화면 밖으로 밀려 강조가 안
   * 보이므로, 맞은 곳 앞을 이만큼만 남기고 자른다.
   */
  private static final int LEAD_CHARS = 12;

  private final MessageSearchRepository repo;
  private final MessagingSummaryRepository summaryRepo;
  private final UserMentionHydrator mentionHydrator;

  /**
   * 한 페이지. size+1 건을 읽어 다음 페이지 유무를 판정한다. message·channel 이 RLS 표라 읽기 트랜잭션 안에서 돈다. beforeAt·beforeId
   * 는 둘 다 있을 때만 커서로 쓴다(하나만 오면 첫 쪽).
   */
  @Transactional(readOnly = true)
  public MessageSearchPage search(
      long callerId, String q, Instant beforeAt, Long beforeId, int size) {
    String query = q == null ? "" : q.strip();
    if (query.replaceAll("\\s+", "").length() < MIN_QUERY) {
      return new MessageSearchPage(List.of(), false);
    }
    List<Row> rows = repo.search(callerId, query, beforeAt, beforeId, size + 1);
    boolean hasMore = rows.size() > size;
    List<Row> page = hasMore ? rows.subList(0, size) : rows;

    // DM 참가자는 한 번에 읽어 이름을 만든다(행마다 조회하지 않게).
    List<Long> dmIds =
        page.stream()
            .filter(r -> "DM".equals(r.channelKind()))
            .map(Row::channelId)
            .distinct()
            .toList();
    Map<Long, List<DmParticipant>> participants = summaryRepo.participantsByChannel(dmIds);
    // 본문의 멘션 토큰(<@id>)을 @이름 으로 보이게 — 쪽 안의 멘션 대상을 한 번에 읽는다.
    List<Long> mentionIds =
        page.stream().flatMap(r -> MentionParser.parse(r.body()).stream()).distinct().toList();
    List<MentionResponse> mentions = mentionHydrator.asMentionResponses(mentionIds);
    // 발췌 위치는 검색어 전체(소문자)로 찾는다 — SQL 이 검색어 전체를 부분 일치로 보므로 같은 기준.
    List<String> terms = List.of(query.toLowerCase(Locale.ROOT));

    List<MessageSearchHit> items =
        page.stream()
            .map(
                r ->
                    new MessageSearchHit(
                        r.id(),
                        r.channelId(),
                        r.channelKind(),
                        "DM".equals(r.channelKind())
                            ? MessagingSummaryService.dmLabel(
                                participants.getOrDefault(r.channelId(), List.of()), callerId)
                            : r.channelName(),
                        r.parentMessageId(),
                        r.authorName(),
                        r.authorKind(),
                        excerpt(r.body(), mentions, terms),
                        r.createdAt().toInstant()))
            .toList();
    return new MessageSearchPage(items, hasMore);
  }

  /**
   * 본문 → 평문(마크다운 기호 제거·멘션은 @이름) → 맞은 곳 앞 {@link #LEAD_CHARS}자부터 한 줄(줄바꿈은 한 칸, 앞뒤를 자르면 「…」). AI 대화
   * 발췌와 달리 끝에 맞춰 창을 당기지 않는다 — 한 줄 행에서 맞은 곳이 늘 앞쪽에 보이게.
   */
  static String excerpt(String body, List<MentionResponse> mentions, List<String> terms) {
    String plain = MentionParser.replaceWithNames(ChatMarkdownText.toPlain(body), mentions);
    String s = plain.replaceAll("\\s+", " ").strip();
    String lower = s.toLowerCase(Locale.ROOT);
    int hitChar = terms.stream().mapToInt(lower::indexOf).filter(i -> i >= 0).min().orElse(-1);
    int hitCp = hitChar < 0 ? 0 : s.codePointCount(0, hitChar);
    int start = Math.max(0, hitCp - LEAD_CHARS);
    String rest = s.substring(s.offsetByCodePoints(0, start));
    String head = start > 0 ? "…" : "";
    if (rest.codePointCount(0, rest.length()) <= EXCERPT_CHARS) return head + rest;
    return head + rest.substring(0, rest.offsetByCodePoints(0, EXCERPT_CHARS)) + "…";
  }
}
