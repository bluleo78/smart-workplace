package com.workplace.messaging.service;

import com.workplace.messaging.service.LinkPreviewService.ImageResult;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;
import java.util.function.LongSupplier;

/**
 * 링크 미리보기 썸네일 서버 캐시(WP-874). 큰 채널에서 여러 사람이 같은 카드를 보면 썸네일마다 외부로 나가고 요청 스레드가 최대 5초 묶이므로, 이미지 URL 별로
 * 바이트를 담아 둔다.
 *
 * <ul>
 *   <li>성공한 이미지: 유효 시간(기본 1시간), 전체 바이트 상한(기본 50MB)을 넘으면 오래 안 쓴 것부터 버린다(LRU).
 *   <li>확정 실패(4xx·이미지가 아닌 바이트·상한 초과·차단)는 짧게(기본 10분) 기억한다 — 깨진 썸네일을 보는 사람마다 다시 두드리지 않게. 바이트는 0 이라
 *       상한에 안 센다. 일시 실패(타임아웃·5xx)는 담지 않는다 — 잠깐의 장애가 썸네일을 오래 가리지 않게.
 *   <li>같은 URL 을 동시에 요청하면 한 번만 가져오고 나머지는 그 결과를 기다린다(coalescing).
 * </ul>
 *
 * <p>키는 이미지 URL 뿐이다 — 공개 외부 이미지라 테넌트와 무관하고, 권한 검사는 호출자가 캐시 전에 끝낸다.
 */
final class LinkPreviewImageCache {

  /** 다른 요청이 가져오는 중일 때 기다리는 최대 시간 — 가져오기 전체 상한(5초)보다 조금 길게. */
  static final long WAIT_MS = 6_000;

  /**
   * 가져오기 결과. image 가 null 이면 실패이고, permanentFailure 면 실패도 기억한다.
   *
   * @param image 성공한 이미지(실패면 null)
   * @param permanentFailure 다시 해도 같을 실패인지
   */
  record Outcome(ImageResult image, boolean permanentFailure) {
    static Outcome ok(ImageResult image) {
      return new Outcome(image, false);
    }

    static Outcome failed(boolean permanent) {
      return new Outcome(null, permanent);
    }
  }

  private record Entry(ImageResult image, long expiresAt) {
    long bytes() {
      return image == null ? 0 : image.body().length;
    }
  }

  private final long maxBytes;
  private final long ttlMs;
  private final long failureTtlMs;
  private final LongSupplier clock;
  private final LinkedHashMap<String, Entry> entries = new LinkedHashMap<>(64, 0.75f, true);
  private long totalBytes;
  private final ConcurrentHashMap<String, CompletableFuture<Optional<ImageResult>>> inflight =
      new ConcurrentHashMap<>();

  LinkPreviewImageCache(long maxBytes, long ttlMs, long failureTtlMs, LongSupplier clock) {
    this.maxBytes = maxBytes;
    this.ttlMs = ttlMs;
    this.failureTtlMs = failureTtlMs;
    this.clock = clock;
  }

  /** 캐시에 있으면 그 값(기억한 실패면 빈 값), 없으면 loader 로 한 번만 가져와 담는다. */
  Optional<ImageResult> get(String url, Function<String, Outcome> loader) {
    Optional<ImageResult> hit = lookup(url);
    if (hit != null) return hit;
    CompletableFuture<Optional<ImageResult>> mine = new CompletableFuture<>();
    CompletableFuture<Optional<ImageResult>> running = inflight.putIfAbsent(url, mine);
    if (running != null) {
      try {
        return running.get(WAIT_MS, TimeUnit.MILLISECONDS);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        return Optional.empty();
      } catch (Exception e) {
        return Optional.empty();
      }
    }
    try {
      // 이긴 뒤 한 번 더 본다 — 조회와 등록 사이에 다른 요청이 막 끝내고 담았을 수 있다.
      Optional<ImageResult> again = lookup(url);
      Optional<ImageResult> result;
      if (again != null) {
        result = again;
      } else {
        Outcome outcome = loader.apply(url);
        store(url, outcome);
        result = Optional.ofNullable(outcome.image());
      }
      mine.complete(result);
      return result;
    } catch (RuntimeException e) {
      mine.complete(Optional.empty());
      throw e;
    } finally {
      inflight.remove(url, mine);
    }
  }

  /** 유효한 항목이면 그 이미지(기억한 실패면 빈 값), 없거나 만료면 null. */
  private synchronized Optional<ImageResult> lookup(String url) {
    Entry e = entries.get(url);
    if (e == null) return null;
    if (clock.getAsLong() >= e.expiresAt()) {
      entries.remove(url);
      totalBytes -= e.bytes();
      return null;
    }
    return Optional.ofNullable(e.image());
  }

  /** 성공·확정 실패를 담고 바이트 상한을 넘으면 오래 안 쓴 것부터 버린다. 일시 실패와 상한보다 큰 이미지 하나는 담지 않는다. */
  private synchronized void store(String url, Outcome outcome) {
    if (outcome.image() == null && !outcome.permanentFailure()) return;
    long now = clock.getAsLong();
    Entry e =
        outcome.image() != null
            ? new Entry(outcome.image(), now + ttlMs)
            : new Entry(null, now + failureTtlMs);
    if (e.bytes() > maxBytes) return;
    Entry old = entries.put(url, e);
    if (old != null) totalBytes -= old.bytes();
    totalBytes += e.bytes();
    Iterator<Map.Entry<String, Entry>> it = entries.entrySet().iterator();
    while (totalBytes > maxBytes && it.hasNext()) {
      Map.Entry<String, Entry> eldest = it.next();
      if (eldest.getKey().equals(url)) continue;
      totalBytes -= eldest.getValue().bytes();
      it.remove();
    }
  }

  /** 현재 담긴 바이트 합(테스트용). */
  synchronized long totalBytes() {
    return totalBytes;
  }
}
