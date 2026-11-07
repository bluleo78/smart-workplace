package com.workplace.wiki;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static com.workplace.jooq.Tables.WIKI_PAGE;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.dto.MovePageRequest;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.dto.WikiPageSummary;
import com.workplace.wiki.exception.WikiInvalidMoveException;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSpaceService;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 부모를 다른 스페이스로 옮기는 중에 그 밑에 하위 페이지를 만들어도 부모·자식 스페이스가 어긋나지 않는다(WP-988 리뷰).
 *
 * <p>만들기가 부모의 스페이스를 확인한 뒤 바로 넣으면, 커밋 전인 이동이 부모를 옮기는 사이 새 자식이 옛 스페이스에 「다른 스페이스 부모」(#758)를 가진 채 남는다 —
 * 두 사이드바 어디에도 안 보이고, 부모를 지우면 다른 스페이스 페이지까지 지워진다. 이제 만들기도 스페이스 트리 잠금을 잡아 이동이 커밋된 뒤의 부모를 보고 거절한다. 이동을
 * 트랜잭션을 연 채(커밋 전) 멈춰 두고 만들기를 보내 결정적으로 만든다.
 */
// 두 경합 트랜잭션이 연결을 점유하는 동안 pg_locks를 조회할 세 번째 연결을 확보한다.
@TestPropertySource(properties = "spring.datasource.hikari.maximum-pool-size=3")
class WikiPageCreateMoveRaceTest extends IntegrationTestBase {

  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;

  private final List<Long> users = new ArrayList<>();
  private final List<Long> spaces = new ArrayList<>();
  private long owner;
  private long sourceId;
  private long targetId;
  private long parentId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    owner = user("owner");
    sourceId = space("이동원본");
    targetId = space("이동대상");
    parentId = pageService.create(owner, sourceId, new CreatePageRequest(null, "옮길 부모")).id();
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          baseDsl.deleteFrom(WIKI_SPACE).where(WIKI_SPACE.ID.in(spaces)).execute();
          baseDsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(users)).execute();
        });
    baseDsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.in(users)).execute();
    baseDsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
    TenantContext.clear();
  }

  /** 첫 생성의 커밋 전에 다음 생성을 보내도 루트 형제의 위치가 겹치지 않아야 한다. */
  @Test
  void 동시_루트_생성은_서로_다른_위치를_받는다() throws Exception {
    Object result =
        race(
            () -> pageService.create(owner, sourceId, new CreatePageRequest(null, "첫 루트")),
            () -> pageService.create(owner, sourceId, new CreatePageRequest(null, "둘째 루트")));

    assertThat(result).isInstanceOf(WikiPageDetail.class);
    // seed의 루트까지 포함해 위치를 확인해야 중복 위치가 숨지 않는다.
    assertThat(
            pageService.listTree(owner, sourceId).stream()
                .filter(p -> p.parentId() == null)
                .map(WikiPageSummary::position)
                .sorted()
                .toList())
        .containsExactly(0, 1, 2);
  }

  /** 같은 부모 아래 생성도 기존 트리 잠금으로 직렬화되어 서로 다른 위치를 받아야 한다. */
  @Test
  void 동시_자식_생성은_서로_다른_위치를_받는다() throws Exception {
    Object result =
        race(
            () -> pageService.create(owner, sourceId, new CreatePageRequest(parentId, "첫 자식")),
            () -> pageService.create(owner, sourceId, new CreatePageRequest(parentId, "둘째 자식")));

    assertThat(result).isInstanceOf(WikiPageDetail.class);
    assertThat(
            pageService.listTree(owner, sourceId).stream()
                .filter(p -> p.parentId() != null && p.parentId().equals(parentId))
                .map(WikiPageSummary::position)
                .sorted()
                .toList())
        .containsExactly(0, 1);
  }

  @Test
  void 부모가_다른_스페이스로_옮겨지는_중에_만든_하위는_거절된다() throws Exception {
    Object r =
        race(
            () -> pageService.move(owner, parentId, new MovePageRequest(null, 0, targetId)),
            () -> pageService.create(owner, sourceId, new CreatePageRequest(parentId, "새 하위")));
    assertThat(r).isInstanceOf(WikiInvalidMoveException.class);
    // 부모는 대상 스페이스로 옮겨졌고, 옛 스페이스에 그 부모를 가리키는 자식이 남지 않았다.
    assertThat(
            inTenant(
                () ->
                    baseDsl.fetchCount(
                        WIKI_PAGE,
                        WIKI_PAGE.PARENT_ID.eq(parentId).and(WIKI_PAGE.SPACE_ID.eq(sourceId)))))
        .isZero();
  }

  private <T> T inTenant(java.util.function.Supplier<T> body) {
    TenantContext.set(1L);
    return new TransactionTemplate(txManager).execute(st -> body.get());
  }

  private long space(String prefix) {
    long id = spaceService.createTeamSpace(owner, prefix + "-" + UUID.randomUUID()).id();
    spaces.add(id);
    return id;
  }

  private long user(String prefix) {
    String s = UUID.randomUUID().toString().substring(0, 8);
    long id =
        baseDsl
            .insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + s + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = baseDsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    baseDsl
        .insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, id)
        .set(USER_ROLE.ROLE_ID, roleId)
        .execute();
    TestFixtures.addMember(baseDsl, id, 1L);
    users.add(id);
    return id;
  }

  /** 두 번째 트랜잭션의 미획득 공간 advisory lock을 별도 연결에서 관찰한다. */
  private boolean waitsForSpaceTreeLock(int pid) {
    return Boolean.TRUE.equals(
        baseDsl
            .fetchOne(
                """
                SELECT EXISTS (
                  SELECT 1 FROM pg_locks
                  WHERE pid = ? AND locktype = 'advisory' AND NOT granted
                    AND objid = ?::oid AND objsubid = 2
                )
                """,
                pid,
                sourceId)
            .get(0, Boolean.class));
  }

  /**
   * first 를 커밋 전에 멈추고 second 가 공간 advisory lock을 실제로 기다리는지 확인한 뒤 first 를 커밋한다. second 의 결과(값 또는
   * 예외)를 돌려주며, 시간 경과만으로 경합이 발생했다고 간주하지 않는다.
   */
  private Object race(Runnable first, Callable<Object> second) throws Exception {
    CountDownLatch firstDone = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    AtomicInteger secondPid = new AtomicInteger();
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      Future<?> f1 =
          pool.submit(
              () -> {
                TenantContext.set(1L);
                try {
                  new TransactionTemplate(txManager)
                      .executeWithoutResult(
                          st -> {
                            first.run();
                            firstDone.countDown();
                            try {
                              release.await(20, TimeUnit.SECONDS);
                            } catch (InterruptedException e) {
                              Thread.currentThread().interrupt();
                            }
                          });
                } finally {
                  TenantContext.clear();
                }
              });
      assertThat(firstDone.await(10, TimeUnit.SECONDS)).as("첫 트랜잭션의 작업 완료").isTrue();
      Future<Object> f2 =
          pool.submit(
              () -> {
                TenantContext.set(1L);
                try {
                  // PID 조회와 두 번째 호출을 같은 트랜잭션에 묶어 관찰하는 DB 연결이 바뀌지 않게 한다.
                  return new TransactionTemplate(txManager)
                      .execute(
                          st -> {
                            secondPid.set(
                                baseDsl.fetchOne("SELECT pg_backend_pid()").get(0, Integer.class));
                            try {
                              return second.call();
                            } catch (Exception e) {
                              // 서비스의 예외를 결과로 돌려주되 실패한 작업은 반드시 롤백한다.
                              st.setRollbackOnly();
                              return e;
                            }
                          });
                } finally {
                  TenantContext.clear();
                }
              });
      // 두 번째 작업이 먼저 끝나면 잠금 누락이므로 즉시 실패한다. 실제 대기를 본 뒤에만 첫 잠금을 해제한다.
      await()
          .atMost(10, TimeUnit.SECONDS)
          .until(() -> f2.isDone() || waitsForSpaceTreeLock(secondPid.get()));
      assertThat(waitsForSpaceTreeLock(secondPid.get()))
          .as("두 번째 트랜잭션이 공간 트리 advisory lock을 기다린다")
          .isTrue();
      release.countDown();
      f1.get(20, TimeUnit.SECONDS);
      return f2.get(20, TimeUnit.SECONDS);
    } finally {
      release.countDown();
      pool.shutdownNow();
      pool.awaitTermination(30, TimeUnit.SECONDS);
    }
  }
}
