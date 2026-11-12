package com.workplace.wiki.service;

import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.service.WikiSystemPageWriter.PersonalReportsHome;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 월 폴더 동시 보장(WP-1486) — 두 스레드가 같은 제목의 폴더를 동시에 보장해도 공간 트리 잠금으로 자식은 하나다.
 *
 * <p>두 스레드가 커밋된 데이터를 봐야 해서 비-@Transactional 이다. 테넌트 1 에 커밋하고 끝나면 지운다.
 */
class WikiSystemPageWriterConcurrencyTest extends ExternalClientMockedTestBase {

  @Autowired DSLContext dsl;
  @Autowired WikiSystemPageWriter writer;

  private long userId;
  private PersonalReportsHome home;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    userId = withMembership(TestFixtures.createHuman(dsl));
    grantUserRole(userId);
    home = writer.ensurePersonalReportsHome(userId);
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L, () -> dsl.deleteFrom(WIKI_SPACE).where(WIKI_SPACE.ID.eq(home.spaceId())).execute());
    cleanupInTenant(
        1L,
        () -> {
          dsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.eq(userId)).execute();
          dsl.deleteFrom(USER).where(USER.ID.eq(userId)).execute();
        });
    TenantContext.clear();
  }

  @Test
  void ensureChildFolder_concurrentCallsCreateOne() throws Exception {
    ExecutorService pool = Executors.newFixedThreadPool(2);
    CountDownLatch start = new CountDownLatch(1);
    List<Future<Long>> futures = new ArrayList<>();
    for (int i = 0; i < 2; i++) {
      futures.add(
          pool.submit(
              () -> {
                TenantContext.set(1L);
                try {
                  start.await();
                  return writer.ensureChildFolder(
                      home.spaceId(), home.reportsPageId(), "2026년 11월", userId, s -> 0);
                } finally {
                  TenantContext.clear();
                }
              }));
    }
    start.countDown();
    long first = futures.get(0).get(60, TimeUnit.SECONDS);
    long second = futures.get(1).get(60, TimeUnit.SECONDS);
    pool.shutdown();

    assertThat(first).isEqualTo(second);
    assertThat(writer.childIdsOrdered(home.reportsPageId())).containsExactly(first);
  }
}
