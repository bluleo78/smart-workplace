package com.workplace.messaging.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.messaging.service.LinkPreviewService.ImageResult;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

/** WP-874: 썸네일 서버 캐시 — 적중·만료·바이트 상한 LRU·실패 미캐시·동시 요청 합치기. 네트워크 없음(loader 를 직접 준다). */
class LinkPreviewImageCacheTest {

  private final AtomicLong now = new AtomicLong(1_000);
  private final AtomicInteger loads = new AtomicInteger();

  private LinkPreviewImageCache.Outcome img(int size) {
    loads.incrementAndGet();
    return LinkPreviewImageCache.Outcome.ok(new ImageResult("image/png", new byte[size]));
  }

  @Test
  void hit_avoidsReload_untilTtlExpires() {
    var cache = new LinkPreviewImageCache(1_000, 100, 50, now::get);
    cache.get("u", u -> img(10));
    cache.get("u", u -> img(10));
    assertThat(loads.get()).isEqualTo(1);
    now.addAndGet(100);
    cache.get("u", u -> img(10));
    assertThat(loads.get()).isEqualTo(2);
  }

  @Test
  void byteCap_evictsLeastRecentlyUsed_andSkipsOversized() {
    var cache = new LinkPreviewImageCache(100, 10_000, 50, now::get);
    cache.get("a", u -> img(40));
    cache.get("b", u -> img(40));
    cache.get("a", u -> img(40)); // a 를 최근으로
    cache.get("c", u -> img(40)); // 120 > 100 → 가장 오래 안 쓴 b 를 버린다
    assertThat(cache.totalBytes()).isEqualTo(80);
    loads.set(0);
    cache.get("a", u -> img(40));
    assertThat(loads.get()).isZero();
    cache.get("b", u -> img(40));
    assertThat(loads.get()).isEqualTo(1);
    // 상한보다 큰 하나는 담지 않는다.
    cache.get("huge", u -> img(500));
    assertThat(cache.totalBytes()).isLessThanOrEqualTo(100);
  }

  @Test
  void transientFailures_notCached_permanentFailures_cachedBriefly() {
    var cache = new LinkPreviewImageCache(1_000, 10_000, 50, now::get);
    assertThat(
            cache.get(
                "t",
                u -> {
                  loads.incrementAndGet();
                  return LinkPreviewImageCache.Outcome.failed(false);
                }))
        .isEmpty();
    assertThat(cache.get("t", u -> img(5))).isPresent();
    assertThat(loads.get()).isEqualTo(2);

    loads.set(0);
    assertThat(
            cache.get(
                "p",
                u -> {
                  loads.incrementAndGet();
                  return LinkPreviewImageCache.Outcome.failed(true);
                }))
        .isEmpty();
    assertThat(cache.get("p", u -> img(5))).isEmpty(); // 기억한 확정 실패
    assertThat(loads.get()).isEqualTo(1);
    now.addAndGet(50);
    assertThat(cache.get("p", u -> img(5))).isPresent(); // 실패 기억 만료 뒤 다시 가져온다
  }

  @Test
  void concurrentRequests_forSameUrl_loadOnce() throws Exception {
    var cache = new LinkPreviewImageCache(1_000, 10_000, 50, now::get);
    CountDownLatch release = new CountDownLatch(1);
    ExecutorService pool = Executors.newFixedThreadPool(5);
    try {
      List<Future<Optional<ImageResult>>> results = new ArrayList<>();
      for (int i = 0; i < 5; i++) {
        results.add(
            pool.submit(
                () ->
                    cache.get(
                        "u",
                        u -> {
                          try {
                            release.await(2, TimeUnit.SECONDS);
                          } catch (InterruptedException e) {
                            Thread.currentThread().interrupt();
                          }
                          return img(7);
                        })));
      }
      // 다섯 요청이 모두 들어와 첫 가져오기를 기다리게 한 뒤 풀어 준다.
      Thread.sleep(300);
      release.countDown();
      for (var f : results) assertThat(f.get(3, TimeUnit.SECONDS)).isPresent();
      assertThat(loads.get()).isEqualTo(1);
    } finally {
      pool.shutdownNow();
    }
  }
}
