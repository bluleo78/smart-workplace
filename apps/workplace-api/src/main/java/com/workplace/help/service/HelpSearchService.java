package com.workplace.help.service;

import com.workplace.global.ai.TextEmbedder;
import com.workplace.global.util.Texts;
import com.workplace.help.repository.HelpManualSectionRepository;
import com.workplace.help.repository.HelpManualSectionRepository.ScoredRow;
import com.workplace.home.service.SearchTerms;
import java.time.Duration;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import org.springframework.stereotype.Service;

/**
 * 도움말 의미 검색(WP-1509) — 질의를 임베딩해 매뉴얼 절과 코사인 유사도로 겨루고, 낱말이 제목·본문에 있으면 보너스를 더한다. 임베딩을 못 받으면 키워드 점수만으로
 * 강등한다(KEYWORD 모드). 웹·인증에 의존하지 않아 MCP 도구(WP-1510)가 그대로 재사용한다.
 */
@Service
public class HelpSearchService {

  /** 질의 임베딩 대기 시간. */
  static final Duration EMBED_WAIT = Duration.ofSeconds(5);

  /** 이 유사도 이상이면 낱말이 안 겹쳐도 후보. */
  static final double MIN_SIMILARITY = 0.45;

  /** 낱말이 절 이름(label·title)에 있을 때 더하는 점수. */
  static final double TITLE_BONUS = 0.15;

  /** 낱말이 본문에 있을 때 더하는 점수. */
  static final double BODY_BONUS = 0.05;

  /** 결과 발췌 글자 수. */
  static final int SNIPPET_CHARS = 160;

  /** 질의 글자 수 상한 — 임베딩 입력을 제한한다. */
  static final int MAX_QUERY_CHARS = 200;

  static final int DEFAULT_LIMIT = 8;
  static final int MAX_LIMIT = 20;

  /** 검색 방식 — 의미(임베딩) 또는 키워드 강등. */
  public enum HelpSearchMode {
    SEMANTIC,
    KEYWORD
  }

  /** 결과 한 건 — path 는 장 최상위부터 이 절까지 화면 칸 이름(WP-1510, 목록에 없으면 [label]). */
  public record HelpSearchHit(
      String chapter,
      String sectionId,
      String label,
      String title,
      List<String> path,
      String snippet,
      double score) {

    /** 같은 결과에 화면 칸 경로만 바꿔 붙인다. */
    HelpSearchHit withPath(List<String> newPath) {
      return new HelpSearchHit(chapter, sectionId, label, title, newPath, snippet, score);
    }
  }

  /** 검색 결과 — 실제로 쓴 방식과 순위대로의 결과. */
  public record HelpSearchResult(HelpSearchMode mode, List<HelpSearchHit> hits) {}

  private final HelpManualSectionRepository repository;
  private final TextEmbedder embedder;
  private final HelpManualCatalog catalog;

  public HelpSearchService(
      HelpManualSectionRepository repository, TextEmbedder embedder, HelpManualCatalog catalog) {
    this.repository = repository;
    this.embedder = embedder;
    this.catalog = catalog;
  }

  /**
   * 질의로 절을 찾는다. includeAdmin 이면 관리자 전용 장도 포함. limit 은 1~MAX_LIMIT 로 맞춘다(0 이하면 기본값). 빈 질의는 임베더를 부르지
   * 않고 빈 결과.
   */
  public HelpSearchResult search(String query, boolean includeAdmin, int limit) {
    // 코드포인트 기준으로 자른다 — 서로게이트 쌍을 가르지 않게
    String q = Texts.headCodePoints(query == null ? "" : query.strip(), MAX_QUERY_CHARS);
    if (q.isEmpty()) return new HelpSearchResult(HelpSearchMode.KEYWORD, List.of());
    int cap = limit <= 0 ? DEFAULT_LIMIT : Math.min(limit, MAX_LIMIT);

    // 임베딩을 못 받으면(꺼짐·실패·시간 초과) 키워드 모드로 강등
    Optional<float[]> vec = embedder.embedQuery(q, EMBED_WAIT);
    HelpSearchMode mode = vec.isPresent() ? HelpSearchMode.SEMANTIC : HelpSearchMode.KEYWORD;
    List<ScoredRow> rows = repository.visibleSections(includeAdmin, vec.orElse(null));

    // 보너스 낱말 — 홈 검색과 같은 규칙(SearchTerms): 소문자, 글자·숫자가 아닌 것으로 나누고 한글 끝 조사를 뗀 형태도 함께,
    // 2자 미만은 무관한 절을 끌어오므로 뺀다("토큰을" → "토큰을"·"토큰").
    List<String> words = SearchTerms.of(q);

    // 행은 묶음 순서(ORDER BY ord)로 오므로 점수 내림차순 안정 정렬이면 같은 점수는 묶음 순서로 남는다.
    List<HelpSearchHit> ranked =
        rows.stream()
            .map(r -> hit(r, words))
            .filter(Objects::nonNull)
            .sorted(Comparator.comparingDouble(HelpSearchHit::score).reversed())
            .limit(cap)
            .toList();
    if (ranked.isEmpty()) return new HelpSearchResult(mode, ranked);
    // 경로는 순위를 정한 뒤 남은 결과에만 붙인다. 목록 판은 검색 한 번에 한 번만 얻어 모든 결과에 쓰고, 묶음 읽기는 하지 않는다 —
    // 목록이 비었으면 [label] 로 답한다(HelpManualCatalog.entries). 검색이 웹 묶음 읽기에 묶이지 않게.
    Map<String, HelpManualCatalog.Entry> entries = catalog.entries();
    return new HelpSearchResult(
        mode, ranked.stream().map(h -> h.withPath(pathOf(entries, h))).toList());
  }

  /** 행 → 결과 한 건. 유사도가 바닥(MIN_SIMILARITY) 미만이고 낱말도 안 겹치면 후보가 아니라 null. 점수 = 유사도(없으면 0) + 보너스. */
  private static HelpSearchHit hit(ScoredRow r, List<String> words) {
    Double sim = r.distance() == null ? null : 1 - r.distance();
    double bonus = bonus(r, words);
    boolean candidate = (sim != null && sim >= MIN_SIMILARITY) || bonus > 0;
    if (!candidate) return null;
    double score = (sim == null ? 0 : sim) + bonus;
    return new HelpSearchHit(
        r.chapter(), r.sectionId(), r.label(), r.title(), List.of(), snippet(r.body()), score);
  }

  /** 결과의 화면 칸 경로 — 목록에 없으면(못 읽었거나 색인과 어긋남) [label]. */
  private static List<String> pathOf(
      Map<String, HelpManualCatalog.Entry> entries, HelpSearchHit h) {
    HelpManualCatalog.Entry e = entries.get(h.sectionId());
    if (e != null) return e.path();
    return h.label() == null ? List.of() : List.of(h.label());
  }

  /** 낱말 보너스 — 이름(label·title)에 하나라도 있으면 TITLE_BONUS, 본문에 있으면 BODY_BONUS(둘 다면 합). */
  private static double bonus(ScoredRow r, List<String> words) {
    String name =
        ((r.label() == null ? "" : r.label()) + "\n" + (r.title() == null ? "" : r.title()))
            .toLowerCase(Locale.ROOT);
    String body = r.body() == null ? "" : r.body().toLowerCase(Locale.ROOT);
    double b = 0;
    if (words.stream().anyMatch(name::contains)) b += TITLE_BONUS;
    if (words.stream().anyMatch(body::contains)) b += BODY_BONUS;
    return b;
  }

  /** 본문 앞 SNIPPET_CHARS 자(코드포인트 기준 — 서로게이트 쌍을 가르지 않는다). */
  private static String snippet(String body) {
    return body == null ? "" : Texts.headCodePoints(body, SNIPPET_CHARS);
  }
}
