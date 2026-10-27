package com.workplace.wiki;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static com.workplace.jooq.Tables.WIKI_PAGE;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.dto.MovePageRequest;
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
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 부모를 다른 스페이스로 옮기는 중에 그 밑에 하위 페이지를 만들어도 부모·자식 스페이스가 어긋나지 않는다(WP-988 리뷰).
 *
 * <p>만들기가 부모의 스페이스를 확인한 뒤 바로 넣으면, 커밋 전인 이동이 부모를 옮기는 사이 새 자식이 옛 스페이스에 「다른 스페이스 부모」(#758)를 가진 채 남는다 —
 * 두 사이드바 어디에도 안 보이고, 부모를 지우면 다른 스페이스 페이지까지 지워진다. 이제 만들기도 스페이스 트리 잠금을 잡아 이동이 커밋된 뒤의 부모를 보고 거절한다. 이동을
 * 트랜잭션을 연 채(커밋 전) 멈춰 두고 만들기를 보내 결정적으로 만든다.
 */
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

  /**
   * first 를 트랜잭션 안에서 실행하고 커밋 전에 멈춘 뒤 second 를 보내, 잠시 뒤 first 를 커밋시킨다. second 의 결과(값 또는 예외)를 돌려준다.
   */
  private Object race(Runnable first, Callable<Object> second) throws Exception {
    CountDownLatch firstDone = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
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
      firstDone.await(10, TimeUnit.SECONDS);
      Future<Object> f2 =
          pool.submit(
              () -> {
                TenantContext.set(1L);
                try {
                  return second.call();
                } catch (Exception e) {
                  return e;
                } finally {
                  TenantContext.clear();
                }
              });
      Thread.sleep(800);
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
