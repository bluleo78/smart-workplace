package com.workplace.global.ai;

import java.time.Duration;
import java.util.Optional;

/**
 * 텍스트 → 의미 벡터(BGE-M3, 1024차원) SPI(WP-383·384). 구현은 drive 의 WorkerEmbedClient(워커 /embed-query) —
 * home 이 drive 를 직접 import 하지 않게(도메인은 global 만 의존) 뒤집은 의존이다(AiMemoryReader 와 같은 방식). 테스트는 이 인터페이스의
 * 가짜(결정적 벡터)를 @Primary 로 끼운다.
 *
 * <p>실패·비활성·타임아웃은 empty — 호출자는 키워드(+최신)로 강등하고 기능을 실패시키지 않는다.
 */
public interface TextEmbedder {

  /** 임베딩을 받을 수 있는 상태인가(워커·임베딩 게이트 켜짐). 꺼져 있으면 백필·커밋 뒤 채우기가 아예 돌지 않는다. */
  boolean enabled();

  /** 검색 질의 임베딩 — 최근 질의 캐시를 쓴다. timeout 안에 못 받으면 empty(채팅 1.5초·검색 5초). */
  Optional<float[]> embedQuery(String query, Duration timeout);

  /** 문서(메모리 내용·대화 턴) 임베딩 — 캐시하지 않는다(질의 캐시를 밀어내지 않게). 실패면 empty. */
  Optional<float[]> embedDocument(String text);
}
