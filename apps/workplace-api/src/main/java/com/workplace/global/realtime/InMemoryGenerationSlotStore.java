package com.workplace.global.realtime;

import com.workplace.global.exception.StreamingGenerationRejectedException;
import com.workplace.global.exception.StreamingGenerationRejectedException.Reason;
import com.workplace.global.realtime.StreamingGenerationRegistry.ActiveGeneration;
import com.workplace.global.realtime.StreamingGenerationRegistry.GenerationTag;
import java.time.Instant;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * {@link GenerationSlotStore} 의 메모리 구현 — 단일 노드·단위 테스트용. 판정 로직은 기존 레지스트리의 reserve 를 그대로 옮겼고, 만료된 행은
 * 무시·정리한다. 모든 연산을 {@code synchronized} 로 묶어 "확인 + 등록" 을 원자화한다.
 */
public class InMemoryGenerationSlotStore implements GenerationSlotStore {

  /** 슬롯 1건. */
  private record Slot(
      String correlationId,
      long ownerUserId,
      GenerationTag tag,
      String podId,
      Instant startedAt,
      Instant expiresAt) {
    Slot withExpiry(Instant e) {
      return new Slot(correlationId, ownerUserId, tag, podId, startedAt, e);
    }
  }

  private final Map<String, Slot> slots = new LinkedHashMap<>();

  /** 만료된 행을 지운다(호출자가 락을 쥔 상태). */
  private void purgeExpired() {
    Instant now = Instant.now();
    slots.values().removeIf(s -> !s.expiresAt.isAfter(now));
  }

  @Override
  public synchronized void reserve(
      long ownerUserId,
      GenerationTag tag,
      int perUserLimit,
      String correlationId,
      String podId,
      Instant expiresAt) {
    purgeExpired();
    // 호출자가 정한 id 가 살아 있는 생성과 겹치면(소유자 무관) 거절 — 덮으면 기존 생성의 추적을 잃는다.
    if (slots.containsKey(correlationId)) {
      throw new StreamingGenerationRejectedException(Reason.BUSY);
    }
    int running = 0;
    for (Slot s : slots.values()) {
      if (s.ownerUserId != ownerUserId || s.tag == null || !s.tag.scope().equals(tag.scope())) {
        continue;
      }
      if (s.tag.key().equals(tag.key())) {
        throw new StreamingGenerationRejectedException(Reason.BUSY);
      }
      running++;
    }
    if (running >= perUserLimit) {
      throw new StreamingGenerationRejectedException(Reason.LIMIT);
    }
    slots.put(
        correlationId, new Slot(correlationId, ownerUserId, tag, podId, Instant.now(), expiresAt));
  }

  @Override
  public synchronized void registerUntagged(
      long ownerUserId, String correlationId, String podId, Instant expiresAt) {
    purgeExpired();
    if (slots.containsKey(correlationId)) {
      throw new StreamingGenerationRejectedException(Reason.BUSY);
    }
    slots.put(
        correlationId, new Slot(correlationId, ownerUserId, null, podId, Instant.now(), expiresAt));
  }

  @Override
  public synchronized void extend(String correlationId, Instant expiresAt) {
    slots.computeIfPresent(correlationId, (id, s) -> s.withExpiry(expiresAt));
  }

  @Override
  public synchronized void remove(String correlationId) {
    slots.remove(correlationId);
  }

  @Override
  public synchronized Optional<GenerationSlot> find(String correlationId) {
    purgeExpired();
    Slot s = slots.get(correlationId);
    return s == null ? Optional.empty() : Optional.of(new GenerationSlot(s.ownerUserId, s.podId));
  }

  @Override
  public synchronized List<ActiveGeneration> active(long ownerUserId, String scope) {
    purgeExpired();
    return slots.values().stream()
        .filter(s -> s.ownerUserId == ownerUserId && s.tag != null && s.tag.scope().equals(scope))
        .sorted(Comparator.comparing(Slot::startedAt))
        .map(s -> new ActiveGeneration(s.correlationId, s.tag.key(), s.startedAt))
        .toList();
  }

  @Override
  public synchronized void removeByPod(String podId, Collection<String> keepIds) {
    // 아직 도는 생성(keepIds)의 행은 남긴다 — 자신의 반납이나 임대 만료로 사라진다.
    slots.values().removeIf(s -> s.podId.equals(podId) && !keepIds.contains(s.correlationId));
  }
}
