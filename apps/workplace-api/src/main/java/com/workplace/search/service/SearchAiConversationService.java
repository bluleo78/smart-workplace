package com.workplace.search.service;

import com.workplace.home.repository.HomeConversationSearchRepository;
import com.workplace.home.repository.HomeConversationSearchRepository.Hit;
import com.workplace.home.service.HomeConversationSearchService;
import com.workplace.home.service.SearchTerms;
import com.workplace.search.dto.AiConversationHit;
import com.workplace.search.dto.AiConversationPage;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 통합 검색 팔레트(WP-1360)의 AI 대화 검색 — 본인 대화의 메시지를 키워드로만 찾고(질의 임베딩 대기 최대 5초를 피한다) 맞은 대화를 최근 대화 순으로 돌려준다.
 * 「AI 기억」 설정(memoryEnabled)과 상관없이 본인 대화를 찾는다 — 기억 기능이 아니라 사용자가 자기 기록을 뒤지는 화면이라서다.
 *
 * <p>한계: 키워드 후보는 SQL 에서 메시지 상위 50({@code AiMemoryRanker.CANDIDATES})으로 잘리므로 한 질의로 볼 수 있는 대화 수는 그
 * 안이다(offset 페이지를 넘겨도 그 후보 안에서만 넘어간다).
 */
@Service
@RequiredArgsConstructor
public class SearchAiConversationService {

  /** 최소 검색어 길이(공백 뺀 길이 미만이면 빈 결과) — 드라이브 검색과 같다. */
  private static final int MIN_QUERY = 2;

  /** 발췌 길이(코드포인트). */
  private static final int EXCERPT_CHARS = 120;

  private final HomeConversationSearchRepository repo;

  /** 한 페이지. size+1 건을 읽어 다음 페이지 유무를 판정한다. RLS 때문에 읽기 트랜잭션 안에서 돈다. */
  @Transactional(readOnly = true)
  public AiConversationPage search(long userId, String q, int offset, int size) {
    String query = q == null ? "" : q.strip();
    if (query.replaceAll("\\s+", "").length() < MIN_QUERY) {
      return new AiConversationPage(List.of(), false);
    }
    List<String> terms = SearchTerms.of(query);
    List<Hit> hits = repo.search(userId, query, terms, null, null, size + 1, offset, true);
    boolean hasMore = hits.size() > size;
    List<Hit> page = hasMore ? hits.subList(0, size) : hits;
    List<AiConversationHit> items = page.stream().map(h -> toItem(h, terms)).toList();
    return new AiConversationPage(items, hasMore);
  }

  /** 맞은 메시지(role 기준 질문/답)를 발췌한다. 그쪽이 비어 있으면 다른 쪽과 그 role 을 쓴다. */
  private static AiConversationHit toItem(Hit h, List<String> terms) {
    boolean assistant = "ASSISTANT".equals(h.role());
    String hitText = assistant ? h.answer() : h.question();
    String other = assistant ? h.question() : h.answer();
    String role = h.role();
    String text = hitText;
    if (text == null) {
      text = other;
      role = assistant ? "USER" : "ASSISTANT";
    }
    return new AiConversationHit(
        h.sessionId(),
        h.title(),
        h.lastMessageAt(),
        role,
        HomeConversationSearchService.excerpt(text, terms, EXCERPT_CHARS));
  }
}
