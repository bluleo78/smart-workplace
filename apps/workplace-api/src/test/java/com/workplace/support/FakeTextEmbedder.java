package com.workplace.support;

import com.workplace.global.ai.TextEmbedder;
import com.workplace.home.service.SearchTerms;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 결정적 가짜 임베딩(WP-383·384 테스트) — 낱말(SearchTerms, 조사 뗀 형태 포함)을 1024차원에 해시해 세고 정규화한다. 같은 낱말을 나눈 문장끼리
 * 코사인이 가깝다. synonyms 로 다른 낱말을 같은 차원에 모아 "낱말은 달라도 뜻이 같은" 의미 검색을 흉내 낸다. 낱말이 하나도 없으면 첫 차원 1(영벡터는 코사인
 * 거리가 NaN 이다).
 */
public class FakeTextEmbedder implements TextEmbedder {

  /** pgvector 컬럼 차원(V175·V176 vector(1024)). */
  public static final int DIM = 1024;

  private final Map<String, String> canonical = new ConcurrentHashMap<>();
  private final Set<String> failTexts = ConcurrentHashMap.newKeySet();
  private final AtomicInteger documentCalls = new AtomicInteger();
  private volatile boolean enabled = true;
  private volatile boolean failing;
  private volatile Duration lastQueryTimeout;

  /** 테스트마다 처음 상태로 — 공유 컨텍스트의 싱글턴이다. */
  public void reset() {
    canonical.clear();
    failTexts.clear();
    documentCalls.set(0);
    enabled = true;
    failing = false;
    lastQueryTimeout = null;
  }

  /** 각 묶음의 낱말을 첫 낱말과 같은 차원으로 센다(예: [["고양이","냥이"]]). */
  public void synonyms(List<List<String>> groups) {
    for (List<String> g : groups) {
      for (String w : g) canonical.put(w, g.get(0));
    }
  }

  /** false 면 워커·게이트가 꺼진 것처럼(enabled=false, 모든 임베딩 empty). */
  public void setEnabled(boolean v) {
    enabled = v;
  }

  /** true 면 켜져 있지만 워커 호출이 실패하는 것처럼(empty). */
  public void setFailing(boolean v) {
    failing = v;
  }

  /** 이 텍스트의 문서 임베딩만 늘 실패시킨다(워커가 거절하는 "독성" 행 흉내). */
  public void failOn(String text) {
    failTexts.add(text);
  }

  /** 문서 임베딩 호출 수(커밋 뒤 채우기·백필이 부른 횟수). */
  public int documentCalls() {
    return documentCalls.get();
  }

  /** 마지막 질의 임베딩의 대기 시간(채팅 1.5초·검색 5초 고정 확인용). */
  public Duration lastQueryTimeout() {
    return lastQueryTimeout;
  }

  @Override
  public boolean enabled() {
    return enabled;
  }

  @Override
  public Optional<float[]> embedQuery(String query, Duration timeout) {
    lastQueryTimeout = timeout;
    return enabled && !failing ? Optional.of(expected(query)) : Optional.empty();
  }

  @Override
  public Optional<float[]> embedDocument(String text) {
    documentCalls.incrementAndGet();
    return enabled && !failing && text != null && !text.isBlank() && !failTexts.contains(text)
        ? Optional.of(expected(text))
        : Optional.empty();
  }

  /**
   * 두 텍스트의 기대 벡터 코사인 거리(1 − 내적, 벡터는 정규화돼 있다) — 의미 거리 상한(AiMemoryRanker.SEMANTIC_MAX_DISTANCE) 테스트가
   * "가까운 것·먼 것" 전제를 먼저 단언해 해시 충돌로 우연히 통과하지 않게 한다.
   */
  public double distance(String a, String b) {
    float[] x = expected(a);
    float[] y = expected(b);
    double dot = 0;
    for (int i = 0; i < DIM; i++) dot += x[i] * y[i];
    return 1 - dot;
  }

  /** 켜짐·실패와 무관한 기대 벡터 — 테스트가 저장된 값과 비교하거나 직접 써 넣을 때 쓴다. */
  public float[] expected(String text) {
    float[] v = new float[DIM];
    for (String term : SearchTerms.of(text, 64)) {
      String c = canonical.getOrDefault(term, term);
      v[Math.floorMod(c.hashCode(), DIM)] += 1f;
    }
    double norm = 0;
    for (float x : v) norm += x * x;
    if (norm == 0) {
      v[0] = 1f;
      return v;
    }
    float n = (float) Math.sqrt(norm);
    for (int i = 0; i < DIM; i++) v[i] /= n;
    return v;
  }
}
