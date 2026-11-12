package com.workplace.help.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.help.outbound.HelpBundle;
import com.workplace.help.outbound.HelpBundle.Chapter;
import com.workplace.help.outbound.HelpBundle.Section;
import com.workplace.help.service.HelpIndexSchedulerTest.MutableClock;
import com.workplace.help.service.HelpManualCatalog.Found;
import com.workplace.help.service.HelpManualIndexerTest.MutableSource;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;

/**
 * HelpManualCatalog(WP-1510) — 화면 칸 경로(parent 따라 올라가기), 관리자 장 숨김·links 거르기, 빈 목록 첫 요청의 한 번 읽기(동시 요청
 * 포함), 읽기 실패 뒤 재시도 간격, 검색 경로(entries)가 읽기를 하지 않음을 가짜 묶음·시계로 확인한다.
 */
class HelpManualCatalogTest {

  /** 구성원 장(위젯 → 고르기 → 순서) 과 관리자 전용 장. */
  static HelpBundle bundle(String pickTitle) {
    return new HelpBundle(
        List.of(
            new Chapter(
                "home",
                "홈",
                List.of("member"),
                List.of(
                    new Section("home.widget", "홈 위젯", "위젯", null, "위젯 본문", List.of(), List.of()),
                    new Section(
                        "home#위젯-고르기", "", pickTitle, "home.widget", "고르기", List.of(), List.of()),
                    new Section(
                        "home.order", "순서", "순서 바꾸기", "home#위젯-고르기", "순서", List.of(), List.of()))),
            new Chapter(
                "admin",
                "관리",
                List.of("admin"),
                List.of(new Section("admin.sso", "SSO", "SSO 연결", "관리 본문")))));
  }

  private final MutableClock clock = new MutableClock();
  private final MutableSource source = new MutableSource();
  private final HelpManualCatalog catalog = new HelpManualCatalog(source, clock);

  /** 절 제목 — 없으면 빈 값. */
  private static Optional<String> titleOf(Optional<Found> f) {
    return f.map(x -> x.entry().section().title());
  }

  @Test
  void pathFollowsParentsFromChapterTopUsingTitleWhenLabelBlank() {
    catalog.replace(bundle("위젯 고르기"));
    assertThat(catalog.entries().get("home.order").path()).containsExactly("홈 위젯", "위젯 고르기", "순서");
    assertThat(catalog.entries().get("home.widget").path()).containsExactly("홈 위젯");
    assertThat(source.fetches.get()).isZero();
  }

  @Test
  void parentCycleDoesNotLoopForever() {
    catalog.replace(
        new HelpBundle(
            List.of(
                new Chapter(
                    "c",
                    "장",
                    List.of(),
                    List.of(
                        new Section("a", "가", "가", "b", "", List.of(), List.of()),
                        new Section("b", "나", "나", "a", "", List.of(), List.of()))))));
    assertThat(catalog.entries().get("a").path()).containsExactly("나", "가");
  }

  @Test
  void adminChapterVisibleOnlyToAdmin() {
    catalog.replace(bundle("위젯 고르기"));
    assertThat(catalog.lookup("admin.sso", false)).isEmpty();
    assertThat(catalog.lookup("admin.sso", true)).isPresent();
    assertThat(catalog.lookup("home.widget", false)).isPresent();
  }

  @Test
  void unknownIdIsEmptyWithoutReading() {
    catalog.replace(bundle("위젯 고르기"));
    assertThat(catalog.lookup("no.such", false)).isEmpty();
    // 목록이 차 있으면 없는 id 로 웹을 두드리지 않는다
    assertThat(source.fetches.get()).isZero();
  }

  @Test
  void emptyCatalogLoadsOnFirstLookup() {
    source.bundle = bundle("위젯 고르기");
    assertThat(titleOf(catalog.lookup("home#위젯-고르기", false))).contains("위젯 고르기");
    assertThat(titleOf(catalog.lookup("home.order", false))).contains("순서 바꾸기");
    assertThat(source.fetches.get()).isEqualTo(1);
  }

  @Test
  void entriesNeverReadEvenWhenEmpty() {
    source.bundle = bundle("위젯 고르기");
    // 검색 경로는 지금 목록만 본다 — 비었으면 빈 판(호출자가 [label] 로 답한다)
    assertThat(catalog.entries()).isEmpty();
    assertThat(source.fetches.get()).isZero();
  }

  @Test
  void emptyCatalogLoadsOnceForConcurrentRequests() throws Exception {
    CountDownLatch inFetch = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    HelpManualCatalog slow =
        new HelpManualCatalog(
            () -> {
              source.fetches.incrementAndGet();
              inFetch.countDown();
              try {
                release.await(5, TimeUnit.SECONDS);
              } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
              }
              return bundle("위젯 고르기");
            },
            clock);
    // 요청 스레드를 모아 두어 모두 막혀 기다리는지(하나는 fetch 의 latch, 나머지는 모니터) 상태로 확인한다 — sleep 으로 짐작하지 않는다
    List<Thread> workers = new CopyOnWriteArrayList<>();
    ExecutorService pool =
        Executors.newFixedThreadPool(
            8,
            r -> {
              Thread t = new Thread(r);
              workers.add(t);
              return t;
            });
    try {
      List<Future<Optional<Found>>> calls = new ArrayList<>();
      for (int i = 0; i < 8; i++) calls.add(pool.submit(() -> slow.lookup("home.order", false)));
      assertThat(inFetch.await(5, TimeUnit.SECONDS)).isTrue();
      long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
      while (!allParkedInCatalog(workers, 8)) {
        assertThat(System.nanoTime()).as("모든 요청이 첫 읽기에 걸려야 한다").isLessThan(deadline);
        Thread.onSpinWait();
      }
      release.countDown();
      for (Future<Optional<Found>> f : calls) {
        assertThat(f.get(5, TimeUnit.SECONDS)).isPresent();
      }
    } finally {
      release.countDown();
      pool.shutdownNow();
    }
    assertThat(source.fetches.get()).isEqualTo(1);
  }

  /** 스레드 n 개가 모두 멈춰(WAITING·TIMED_WAITING·BLOCKED) 있고 HelpManualCatalog 호출 안에 있는가. */
  private static boolean allParkedInCatalog(List<Thread> threads, int n) {
    if (threads.size() < n) return false;
    for (Thread t : threads) {
      Thread.State st = t.getState();
      if (st != Thread.State.WAITING
          && st != Thread.State.TIMED_WAITING
          && st != Thread.State.BLOCKED) return false;
      boolean inCatalog = false;
      for (StackTraceElement f : t.getStackTrace()) {
        if (f.getClassName().equals(HelpManualCatalog.class.getName())) {
          inCatalog = true;
          break;
        }
      }
      if (!inCatalog) return false;
    }
    return true;
  }

  @Test
  void failedLoadAnswersEmptyAndRetriesOnlyAfterBackoff() {
    source.failure = new IOException("웹이 아직 안 떴다");
    assertThat(catalog.lookup("home.widget", false)).isEmpty();

    // 실패 직후에는 다시 읽지 않는다 — 요청마다 웹을 두드려 응답이 늘어지지 않게
    source.failure = null;
    source.bundle = bundle("위젯 고르기");
    assertThat(catalog.lookup("home.widget", false)).isEmpty();
    assertThat(source.fetches.get()).isEqualTo(1);

    clock.now = clock.now.plus(HelpManualCatalog.RETRY_AFTER).plusSeconds(1);
    assertThat(catalog.lookup("home.widget", false)).isPresent();
    assertThat(source.fetches.get()).isEqualTo(2);
  }

  @Test
  void bundleWithoutSectionsCountsAsFailedLoad() {
    // 장은 있는데 절이 하나도 없는 묶음 — 빈 묶음과 같은 장애로 본다
    source.bundle = new HelpBundle(List.of(new Chapter("home", "홈", List.of(), List.of())));
    assertThat(catalog.lookup("home.widget", false)).isEmpty();
    assertThat(catalog.lookup("home.widget", false)).isEmpty();
    // 실패 대기 중이라 두 번째 요청은 다시 읽지 않는다
    assertThat(source.fetches.get()).isEqualTo(1);
  }

  @Test
  void lookupFiltersLinksWithTheSameSnapshot() {
    catalog.replace(
        new HelpBundle(
            List.of(
                new Chapter(
                    "home",
                    "홈",
                    List.of("member"),
                    List.of(
                        new Section(
                            "home.widget",
                            "홈 위젯",
                            "위젯",
                            null,
                            "본문",
                            List.of(),
                            List.of("home.order", "admin.sso", "no.such")),
                        new Section("home.order", "순서", "순서", "본문"))),
                new Chapter(
                    "admin",
                    "관리",
                    List.of("admin"),
                    List.of(new Section("admin.sso", "SSO", "SSO 연결", "관리 본문"))))));
    // 관리자 장 절·목록에 없는 id 는 구성원 links 에서 빠진다
    assertThat(catalog.lookup("home.widget", false))
        .map(Found::links)
        .contains(List.of("home.order"));
    assertThat(catalog.lookup("home.widget", true))
        .map(Found::links)
        .contains(List.of("home.order", "admin.sso"));
  }
}
