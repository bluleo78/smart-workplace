package com.workplace.home.service;

import com.workplace.global.ai.TextEmbedder;
import com.workplace.home.repository.AiMemoryRankRepository;
import com.workplace.home.repository.AiMemoryRankRepository.Scored;
import com.workplace.home.repository.AiMemoryRepository;
import com.workplace.home.repository.AiMemoryRepository.Row;
import com.workplace.home.repository.ScopeFilter;
import com.workplace.home.service.AiMemoryRanker.Ranked;
import com.workplace.user.service.AiPreferenceService;
import java.time.Duration;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 매 턴 주입할 메모리 고르기(WP-383 스펙 3.3) — 후보(공통 + 지금 앱 유효 행)가 30줄 이하면 전부, 많으면 고정 전부 + 비고정 RRF 상위 20, 그 뒤
 * 토큰 예산 안에서 고정 → 순위 순으로 자르고 넣지 않은 유효 메모리 수(다른 범위 포함)를 센다.
 *
 * <p>세 단계로 나눈다: 후보 읽기(짧은 읽기 트랜잭션) → 질의 임베딩(트랜잭션 밖, 최대 embedWait) → 순위 재료 조회(짧은 읽기 트랜잭션). DB 연결을 쥔 채
 * 워커 HTTP 를 기다리지 않는다. isolated 면 두 트랜잭션을 늘 새로 연다(다른 진입점 — 바깥 트랜잭션을 rollback-only 로 만들지 않게,
 * AiMemoryReader), 아니면 바깥 트랜잭션에 참여한다(홈 채팅 펌프는 바깥이 없어 새로 열린다).
 */
@Component
public class AiMemorySelector {

  /** 이 이하면 순위 없이 전부(대부분 사용자는 이전과 같은 동작). */
  static final int SMALL_SET = 30;

  /** 많을 때 고르는 비고정 수. */
  static final int TOP_UNPINNED = 20;

  /**
   * 선택 결과.
   *
   * @param rows 고정 먼저, 그다음 순위 순 — 예산까지만
   * @param moreCount 넣지 않은 유효 메모리 수(다른 범위 포함)
   * @param today 후보를 고른 서버 오늘(ChatRequest.today 로 그대로 보낸다)
   */
  public record Selection(boolean enabled, List<Row> rows, int moreCount, LocalDate today) {
    static final Selection DISABLED = new Selection(false, List.of(), 0, null);
  }

  /** 검색 결과 — 꺼짐이면 enabled=false. */
  public record Found(boolean enabled, List<Row> rows) {}

  private record Candidates(List<Row> rows, int activeTotal, LocalDate today) {}

  private final AiPreferenceService preferences;
  private final AiMemoryClock clock;
  private final AiMemoryRepository repo;
  private final AiMemoryRankRepository rankRepo;
  private final TextEmbedder embedder;
  private final TransactionTemplate joinTx;
  private final TransactionTemplate newTx;

  public AiMemorySelector(
      AiPreferenceService preferences,
      AiMemoryClock clock,
      AiMemoryRepository repo,
      AiMemoryRankRepository rankRepo,
      TextEmbedder embedder,
      PlatformTransactionManager txManager) {
    this.preferences = preferences;
    this.clock = clock;
    this.repo = repo;
    this.rankRepo = rankRepo;
    this.embedder = embedder;
    this.joinTx = new TransactionTemplate(txManager);
    this.joinTx.setReadOnly(true);
    this.newTx = new TransactionTemplate(txManager);
    this.newTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    this.newTx.setReadOnly(true);
  }

  /**
   * 매 턴 주입할 메모리. 꺼져 있으면 DISABLED.
   *
   * @param queryText 이번 사용자 메시지(다른 진입점은 판정 5) — 비면 고정 + 최신
   * @param embedWait 질의 임베딩 대기(채팅·진입점 1.5초)
   * @param tokenBudget 블록 토큰 예산(머리·"더 있음" 줄 몫 포함)
   */
  public Selection select(
      long userId,
      ScopeFilter filter,
      String queryText,
      Duration embedWait,
      int tokenBudget,
      boolean isolated) {
    TransactionTemplate tx = isolated ? newTx : joinTx;
    Candidates c =
        tx.execute(
            s -> {
              if (!preferences.memoryEnabled(userId)) return null;
              LocalDate today = clock.today();
              return new Candidates(
                  repo.listCandidates(userId, filter, today),
                  repo.countActive(userId, today),
                  today);
            });
    if (c == null) return Selection.DISABLED;
    List<Row> chosen;
    if (c.rows().size() <= SMALL_SET) {
      chosen = pinnedFirst(c.rows());
    } else {
      List<Row> ordered =
          isBlank(queryText)
              ? c.rows()
              : rank(userId, filter, queryText.strip(), c.today(), embedWait, tx).stream()
                  .map(Ranked::row)
                  .toList();
      chosen = new ArrayList<>(ordered.stream().filter(Row::pinned).toList());
      ordered.stream().filter(r -> !r.pinned()).limit(TOP_UNPINNED).forEach(chosen::add);
    }
    List<Row> fitted = fitToBudget(chosen, tokenBudget);
    return new Selection(true, fitted, c.activeTotal() - fitted.size(), c.today());
  }

  /**
   * 검색(search_memory) — 같은 RRF 로 순위를 매기고 키워드·의미 갈래에 든 행만 limit 개. 바깥 트랜잭션에 참여한다. 질의는 호출자가 비지 않음을
   * 확인했다.
   */
  public Found search(
      long userId, ScopeFilter filter, String query, Duration embedWait, int limit) {
    LocalDate today = joinTx.execute(s -> preferences.memoryEnabled(userId) ? clock.today() : null);
    if (today == null) return new Found(false, List.of());
    List<Row> rows =
        rank(userId, filter, query.strip(), today, embedWait, joinTx).stream()
            .filter(Ranked::matched)
            .limit(limit)
            .map(Ranked::row)
            .toList();
    return new Found(true, rows);
  }

  /** 질의 임베딩(트랜잭션 밖) → 순위 재료(짧은 트랜잭션) → RRF. 임베딩 실패·초과면 의미 갈래 없이(키워드 + 최신). */
  private List<Ranked> rank(
      long userId,
      ScopeFilter filter,
      String query,
      LocalDate today,
      Duration embedWait,
      TransactionTemplate tx) {
    List<String> terms = SearchTerms.of(query);
    float[] vec = embedder.embedQuery(query, embedWait).orElse(null);
    List<Scored> scored = tx.execute(s -> rankRepo.score(userId, today, filter, query, terms, vec));
    return AiMemoryRanker.rank(scored == null ? List.of() : scored);
  }

  /** 고정 먼저(각자 받은 순서 유지). */
  static List<Row> pinnedFirst(List<Row> rows) {
    List<Row> out = new ArrayList<>(rows.stream().filter(Row::pinned).toList());
    rows.stream().filter(r -> !r.pinned()).forEach(out::add);
    return out;
  }

  /**
   * 예산까지만 — 머리·"더 있음" 줄 몫을 먼저 빼고 순서대로 넣다가 처음 넘치는 줄에서 멈춘다(뒤의 짧은 줄로 건너뛰지 않는다 — 순위가 낮은 줄이 높은 줄을 밀어내지
   * 않게). 30줄 이하에도 적용한다(판정 4).
   */
  static List<Row> fitToBudget(List<Row> rows, int budget) {
    int left = budget - AiMemoryService.BLOCK_HEADER_TOKENS - AiMemoryService.MORE_LINE_TOKENS;
    List<Row> out = new ArrayList<>();
    for (Row r : rows) {
      int cost = AiMemoryService.lineTokens(r.content(), r.pinned());
      if (cost > left) break;
      out.add(r);
      left -= cost;
    }
    return out;
  }

  private static boolean isBlank(String s) {
    return s == null || s.isBlank();
  }
}
