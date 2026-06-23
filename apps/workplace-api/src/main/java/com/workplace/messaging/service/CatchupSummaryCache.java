package com.workplace.messaging.service;

import com.workplace.messaging.outbound.dto.CatchupSummarizeResult;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/**
 * 캐치업 AI 요약 인메모리 캐시. 키 = (channelId, watermark, maxMessageId). channelId 가 공유 DB 전역 유일이라 테넌트 안전.
 * caller 무관(내 차례는 별도 계산). 비영속·재생성 가능하므로 마이그레이션/DB 불필요. TTL 10분, 최대 500 엔트리.
 */
@Component
public class CatchupSummaryCache {
  private static final Duration TTL = Duration.ofMinutes(10);
  private static final int MAX_ENTRIES = 500;

  private record Key(long channelId, long watermark, long maxMessageId) {}

  private record Entry(CatchupSummarizeResult value, Instant expiresAt) {}

  private final Map<Key, Entry> map = new ConcurrentHashMap<>();
  private final Clock clock;

  public CatchupSummaryCache() {
    this(Clock.systemUTC());
  }

  public CatchupSummaryCache(Clock clock) {
    this.clock = clock;
  }

  public CatchupSummarizeResult get(long channelId, long watermark, long maxMessageId) {
    var e = map.get(new Key(channelId, watermark, maxMessageId));
    if (e == null) {
      return null;
    }
    if (clock.instant().isAfter(e.expiresAt())) {
      map.remove(new Key(channelId, watermark, maxMessageId));
      return null;
    }
    return e.value();
  }

  public void put(long channelId, long watermark, long maxMessageId, CatchupSummarizeResult value) {
    if (map.size() >= MAX_ENTRIES) {
      map.clear(); // 단순 상한 — 캐치업은 재생성 저렴.
    }
    map.put(
        new Key(channelId, watermark, maxMessageId), new Entry(value, clock.instant().plus(TTL)));
  }
}
