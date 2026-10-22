package com.workplace.drive.service;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.drive.exception.DriveSpaceNameDuplicatedException;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.RowLockWaits;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.exception.WikiSpaceNameDuplicatedException;
import com.workplace.wiki.service.WikiSpaceService;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 같은 이름의 드라이브·노트 팀 공간 동시 생성 경합(WP-772) — WP-693 이 유니크 인덱스를 내리고 「만드는 사람이 볼 수 있는 공간과 이름이 겹치지 않는지」 서비스
 * 검사만 남겨, 같은 사람이 같은 이름으로 동시에 만들면 둘 다 검사를 통과해 이름이 같은 공간이 여럿 생겼다. 차례로 보내면 늦은 쪽은 409 다.
 *
 * <p>순서를 결정적으로 맞춘다: A 가 공간을 만들고 커밋 전에 멈춤 → B 가 같은 이름으로 만들기 → A 커밋. 고친 뒤에는 B 가 A 를 기다렸다가 A 의 공간을 보고
 * 409 로 거절돼야 한다. 결과가 커밋돼야 하는 흐름이라 롤백 격리 대신 @AfterEach 로 정리한다.
 */
class TeamSpaceNameRaceTest extends IntegrationTestBase {

  private static final long TENANT_ID = 1L;

  @Autowired DriveSpaceService driveSpaces;
  @Autowired WikiSpaceService wikiSpaces;

  private long owner;
  private String name;

  @BeforeEach
  void seed() {
    owner = TestFixtures.createHuman(baseDsl);
    TestFixtures.addMember(baseDsl, owner, TENANT_ID);
    name = "경합공간-" + UUID.randomUUID().toString().substring(0, 8);
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        TENANT_ID,
        () -> {
          baseDsl.deleteFrom(DRIVE_SPACE).where(DRIVE_SPACE.OWNER_ID.eq(owner)).execute();
          baseDsl.deleteFrom(WIKI_SPACE).where(WIKI_SPACE.OWNER_ID.eq(owner)).execute();
          baseDsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.eq(owner)).execute();
        });
    baseDsl.deleteFrom(USER).where(USER.ID.eq(owner)).execute();
  }

  @Test
  void 같은_이름의_드라이브_팀_공간을_동시에_만들면_하나만_생기고_늦은_쪽은_409() throws Exception {
    Throwable late =
        race(
            () -> driveSpaces.createTeamSpace(owner, name),
            () -> driveSpaces.createTeamSpace(owner, name.toUpperCase()));

    assertThat(late).isInstanceOf(DriveSpaceNameDuplicatedException.class);
    assertThat(count(() -> baseDsl.fetchCount(DRIVE_SPACE, DRIVE_SPACE.OWNER_ID.eq(owner))))
        .isEqualTo(1);
  }

  @Test
  void 같은_이름의_노트_팀_공간을_동시에_만들면_하나만_생기고_늦은_쪽은_409() throws Exception {
    Throwable late =
        race(
            () -> wikiSpaces.createTeamSpace(owner, name),
            () -> wikiSpaces.createTeamSpace(owner, " " + name + " "));

    assertThat(late).isInstanceOf(WikiSpaceNameDuplicatedException.class);
    assertThat(
            count(
                () ->
                    baseDsl.fetchCount(
                        WIKI_SPACE, WIKI_SPACE.OWNER_ID.eq(owner).and(WIKI_SPACE.TYPE.eq("TEAM")))))
        .isEqualTo(1);
  }

  /**
   * first 를 tx 안에서 실행하고 커밋 전에 멈춘 채 second 를 다른 스레드로 보낸다. second 가 잠금을 기다리면 그것을 본 뒤, 기다리지 않고 끝나면(고치기
   * 전) 바로 first 를 커밋한다. second 가 던진 예외(없으면 null)를 돌려준다.
   */
  private Throwable race(Supplier<Object> first, Supplier<Object> second) throws Exception {
    CountDownLatch firstDone = new CountDownLatch(1);
    CountDownLatch releaseFirst = new CountDownLatch(1);
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      Future<Object> a =
          pool.submit(
              () ->
                  inTenant(
                      () -> {
                        Object r = first.get();
                        firstDone.countDown();
                        RowLockWaits.awaitQuietly(releaseFirst);
                        return r;
                      }));
      assertThat(firstDone.await(10, TimeUnit.SECONDS)).isTrue();
      Future<Object> b = pool.submit(() -> inTenant(second));
      try {
        RowLockWaits.awaitLockWaiter(b);
      } catch (AssertionError finishedWithoutWaiting) {
        // 잠금 없이 끝났다 — 아래 결과 검증이 무엇이 잘못됐는지 보인다.
      }
      releaseFirst.countDown();
      a.get(10, TimeUnit.SECONDS);
      try {
        b.get(10, TimeUnit.SECONDS);
        return null;
      } catch (ExecutionException e) {
        return e.getCause();
      }
    } finally {
      releaseFirst.countDown();
      pool.shutdownNow();
      pool.awaitTermination(20, TimeUnit.SECONDS);
    }
  }

  private int count(Supplier<Integer> query) {
    return inTenant(query);
  }

  /** 테넌트 1 트랜잭션에서 실행한다(서비스 호출 스레드마다 TenantContext 를 세운다). */
  private <T> T inTenant(Supplier<T> body) {
    TenantContext.set(TENANT_ID);
    try {
      return new TransactionTemplate(txManager).execute(s -> body.get());
    } finally {
      TenantContext.clear();
    }
  }
}
