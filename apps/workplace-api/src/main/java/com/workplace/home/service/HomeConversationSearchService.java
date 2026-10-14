package com.workplace.home.service;

import com.workplace.global.ai.TextEmbedder;
import com.workplace.global.util.Texts;
import com.workplace.home.dto.ConversationSearchResponse;
import com.workplace.home.exception.AiMemoryException;
import com.workplace.home.repository.HomeConversationSearchRepository;
import com.workplace.home.repository.HomeConversationSearchRepository.Hit;
import com.workplace.user.service.AiPreferenceService;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 지난 대화 검색(WP-384 스펙 4.2) — 메모리 설정에 묶인 기능이라 꺼져 있으면 빈 결과 + memoryEnabled=false. 질의 임베딩(최대 5초)은 트랜잭션
 * 밖에서 받고, 실패·초과면 키워드만으로 찾는다. 읽기는 짧은 읽기 트랜잭션 두 번(꺼짐 확인 / 검색 + 대표 턴)이다.
 */
@Service
public class HomeConversationSearchService {

  static final int DEFAULT_LIMIT = 5;
  static final int MAX_LIMIT = 10;
  static final int QUESTION_CHARS = 200;
  static final int EXCERPT_CHARS = 300;

  private final AiPreferenceService preferences;
  private final HomeConversationSearchRepository repo;
  private final TextEmbedder embedder;
  private final TransactionTemplate tx;

  public HomeConversationSearchService(
      AiPreferenceService preferences,
      HomeConversationSearchRepository repo,
      TextEmbedder embedder,
      PlatformTransactionManager txManager) {
    this.preferences = preferences;
    this.repo = repo;
    this.embedder = embedder;
    this.tx = new TransactionTemplate(txManager);
    this.tx.setReadOnly(true);
  }

  /**
   * @param excludeSessionId 지금 대화(도구가 묶는다 — 모델이 고르지 못한다)
   * @param limit 기본 5, 1~10 으로 묶는다
   * @throws AiMemoryException 400 — 빈 질의(판정 9)
   */
  public ConversationSearchResponse search(
      long userId, String q, UUID excludeSessionId, Integer limit) {
    if (q == null || q.isBlank()) throw AiMemoryException.invalid("찾을 말을 넣어 주세요");
    int n = limit == null ? DEFAULT_LIMIT : Math.max(1, Math.min(limit, MAX_LIMIT));
    if (!Boolean.TRUE.equals(tx.execute(s -> preferences.memoryEnabled(userId)))) {
      return new ConversationSearchResponse(false, List.of());
    }
    String query = q.strip();
    List<String> terms = SearchTerms.of(query);
    float[] vec = embedder.embedQuery(query, AiMemoryService.SEARCH_EMBED_WAIT).orElse(null);
    List<ConversationSearchResponse.Item> items =
        tx.execute(
            s ->
                repo.search(userId, query, terms, vec, excludeSessionId, n).stream()
                    .map(h -> toItem(h, terms))
                    .toList());
    return new ConversationSearchResponse(true, items == null ? List.of() : items);
  }

  private static ConversationSearchResponse.Item toItem(Hit h, List<String> terms) {
    return new ConversationSearchResponse.Item(
        h.sessionId(),
        h.title(),
        h.lastMessageAt(),
        h.question() == null ? null : Texts.truncateCodePoints(flat(h.question()), QUESTION_CHARS),
        excerpt(h.answer(), terms, EXCERPT_CHARS),
        "/?aiChat=" + h.sessionId());
  }

  /**
   * 답 발췌 — 낱말이 처음 맞은 곳이 앞 1/3 쯤 오게 max 자(코드포인트)를 자르고, 잘린 쪽에 "…". 맞은 곳이 없으면 앞 max 자. 줄바꿈·연속 공백은 한 칸.
   */
  static String excerpt(String text, List<String> terms, int max) {
    if (text == null) return null;
    String s = flat(text);
    int total = s.codePointCount(0, s.length());
    if (total <= max) return s;
    String lower = s.toLowerCase(Locale.ROOT);
    int hitChar = terms.stream().mapToInt(lower::indexOf).filter(i -> i >= 0).min().orElse(-1);
    int hitCp = hitChar < 0 ? 0 : s.codePointCount(0, Math.min(hitChar, s.length()));
    int start = Math.max(0, Math.min(hitCp - max / 3, total - max));
    int end = start + max;
    String body = s.substring(s.offsetByCodePoints(0, start), s.offsetByCodePoints(0, end));
    return (start > 0 ? "…" : "") + body + (end < total ? "…" : "");
  }

  private static String flat(String s) {
    return s.replaceAll("\\s+", " ").strip();
  }
}
