package com.workplace.home.service;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.home.repository.AiMemoryRepository;
import com.workplace.home.repository.AiMemoryRepository.NewMemory;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;

/**
 * WP-383 메모리 선택 평가 세트(src/test/resources/ai-memory-eval/fixture.json) — 읽기·넣기·recall 계산. CI 평가(가짜
 * 임베딩)와 수동 평가(실제 워커)가 같은 픽스처·같은 계산을 쓴다.
 */
final class AiMemoryEvalSupport {

  /** 메모리 1건 — scope null = 공통. */
  record Memory(String key, String scope, String kind, String content, boolean pinned) {}

  /** 질문 1건 — app null = 홈 화면(공통만). expected = 블록에 들어야 할 메모리 key. */
  record Question(String key, String app, String text, List<String> expected) {}

  @JsonIgnoreProperties(ignoreUnknown = true)
  record Fixture(List<List<String>> synonyms, List<Memory> memories, List<Question> questions) {}

  private AiMemoryEvalSupport() {}

  static Fixture load() {
    try (InputStream in =
        AiMemoryEvalSupport.class.getResourceAsStream("/ai-memory-eval/fixture.json")) {
      return new ObjectMapper()
          .readValue(Objects.requireNonNull(in, "fixture.json 없음"), Fixture.class);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  /** 순서대로 넣는다(뒤가 최신 — 저장소가 앱 시각을 쓴다) → key → id. 고정은 넣은 뒤 켠다(updated_at 은 그대로). */
  static Map<String, Long> seed(AiMemoryRepository repo, long userId, Fixture f) {
    Map<String, Long> ids = new LinkedHashMap<>();
    for (Memory m : f.memories()) {
      long id =
          repo.insert(userId, new NewMemory(m.kind(), m.content(), "USER", null, m.scope(), null))
              .id();
      if (m.pinned()) repo.setPinned(userId, id, true);
      ids.put(m.key(), id);
    }
    return ids;
  }

  /** 기대 메모리 중 고른 목록에 든 비율(질문 전체 합산). */
  static double recall(Fixture f, Map<String, Long> ids, Function<Question, List<Long>> select) {
    int hit = 0;
    int total = 0;
    for (Question q : f.questions()) {
      List<Long> chosen = select.apply(q);
      for (String key : q.expected()) {
        total++;
        if (chosen.contains(ids.get(key))) hit++;
      }
    }
    return (double) hit / total;
  }

  /** 그 질문의 후보 범위(공통 + 앱)에 있는 고정 메모리 key. */
  static List<String> pinnedKeys(Fixture f, Question q) {
    return f.memories().stream()
        .filter(Memory::pinned)
        .filter(m -> m.scope() == null || m.scope().equals(q.app()))
        .map(Memory::key)
        .toList();
  }

  /** 도입 전 규칙(범위마다 최신 50 전부 주입)의 후보 key — 공통과 그 앱 범위 각각 픽스처 순서상 뒤(최신)에서 50개. 만료·고정 구분은 없었다. */
  static List<String> legacyKeys(Fixture f, Question q) {
    List<String> out = new java.util.ArrayList<>();
    List<String> scopes =
        q.app() == null
            ? java.util.Collections.singletonList(null)
            : java.util.Arrays.asList(null, q.app());
    for (String scope : scopes) {
      List<String> inScope =
          f.memories().stream()
              .filter(m -> Objects.equals(m.scope(), scope))
              .map(Memory::key)
              .toList();
      out.addAll(inScope.subList(Math.max(0, inScope.size() - 50), inScope.size()));
    }
    return out;
  }

  /** 도입 전 규칙으로 주입했을 줄 수·근사 토큰(머리 포함). */
  static int[] legacyLinesAndTokens(Fixture f, Question q) {
    int tokens = AiMemoryService.BLOCK_HEADER_TOKENS;
    List<String> keys = legacyKeys(f, q);
    for (Memory m : f.memories()) {
      if (keys.contains(m.key())) tokens += AiMemoryService.lineTokens(m.content(), m.pinned());
    }
    return new int[] {keys.size(), tokens};
  }
}
