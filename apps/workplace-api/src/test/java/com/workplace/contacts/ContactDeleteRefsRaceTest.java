package com.workplace.contacts;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.CONTACT_ENTRY;
import static com.workplace.jooq.Tables.CONTACT_FAVORITE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_GROUP;
import static com.workplace.jooq.Tables.USER_GROUP_MEMBER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.contacts.dto.FavoriteRequest;
import com.workplace.contacts.exception.ContactNotFoundException;
import com.workplace.contacts.service.ContactService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.RowLockWaits;
import com.workplace.support.TestFixtures;
import com.workplace.user.dto.AddMemberRequest;
import com.workplace.user.dto.CreateUserGroupRequest;
import com.workplace.user.exception.InvalidUserGroupException;
import com.workplace.user.service.UserGroupService;
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
 * 외부 연락처 삭제와 그 연락처의 즐겨찾기 추가·그룹 편입이 겹칠 때(WP-820) — 어느 쪽이 먼저든 지워진 연락처를 가리키는 행이 남지 않는다.
 *
 * <p>삭제가 먼저면 나중 요청은 연락처 행 공유 잠금에서 기다렸다가 행이 없어 거절되고, 추가가 먼저면 삭제가 그 커밋을 기다렸다가 더한 행까지 지운다. 먼저 요청을
 * 트랜잭션을 연 채(커밋 전) 멈춰 두고 나중 요청을 보내 결정적으로 만든다.
 */
class ContactDeleteRefsRaceTest extends IntegrationTestBase {

  @Autowired ContactService contactService;
  @Autowired UserGroupService groupService;

  private final List<Long> users = new ArrayList<>();
  private long owner;
  private long other;
  private long contactId;
  private long groupId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    owner = user("o");
    other = user("x");
    contactId =
        baseDsl
            .insertInto(CONTACT_ENTRY)
            .set(CONTACT_ENTRY.NAME, "race-" + UUID.randomUUID().toString().substring(0, 6))
            .set(CONTACT_ENTRY.OWNER_ID, owner)
            .set(CONTACT_ENTRY.VISIBILITY, "SHARED")
            .set(CONTACT_ENTRY.TENANT_ID, 1L)
            .returning(CONTACT_ENTRY.ID)
            .fetchOne()
            .getId();
    groupId =
        new TransactionTemplate(txManager)
            .execute(
                st ->
                    groupService
                        .create(
                            other,
                            new CreateUserGroupRequest(
                                "g-" + UUID.randomUUID().toString().substring(0, 6),
                                null,
                                "PERSONAL",
                                null,
                                null))
                        .id());
  }

  @AfterEach
  void cleanup() {
    baseDsl.deleteFrom(CONTACT_FAVORITE).where(CONTACT_FAVORITE.OWNER_ID.in(users)).execute();
    baseDsl.deleteFrom(USER_GROUP_MEMBER).where(USER_GROUP_MEMBER.GROUP_ID.eq(groupId)).execute();
    baseDsl.deleteFrom(USER_GROUP).where(USER_GROUP.ID.eq(groupId)).execute();
    baseDsl.deleteFrom(CONTACT_ENTRY).where(CONTACT_ENTRY.OWNER_ID.in(users)).execute();
    baseDsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(users)).execute();
    baseDsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
    TenantContext.clear();
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
    TestFixtures.addMember(baseDsl, id, 1L);
    users.add(id);
    return id;
  }

  private int favoriteRows() {
    return baseDsl.fetchCount(
        CONTACT_FAVORITE,
        CONTACT_FAVORITE.TARGET_TYPE.eq("EXTERNAL").and(CONTACT_FAVORITE.TARGET_ID.eq(contactId)));
  }

  private int groupMemberRows() {
    return baseDsl.fetchCount(
        USER_GROUP_MEMBER,
        USER_GROUP_MEMBER
            .TARGET_TYPE
            .eq("EXTERNAL")
            .and(USER_GROUP_MEMBER.TARGET_ID.eq(contactId)));
  }

  /**
   * first 를 트랜잭션 안에서 실행하고 커밋 전에 멈춘 뒤 second 를 보내, second 가 그 잠금을 기다리는 것을 확인한 뒤 first 를 커밋시킨다.
   * second 의 결과(값 또는 예외)를 돌려준다.
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
                            // 커밋 전에 멈춰 잠금을 쥔 채 second 가 그 잠금을 기다릴 때까지 둔다.
                            // 상한은 main 의 잠금 대기 확인(최대 10초)보다 넉넉히 — 놓아 주기 전에 먼저 풀려 순서가 바뀌지 않게.
                            try {
                              if (!release.await(30, TimeUnit.SECONDS)) {
                                throw new AssertionError("release 신호가 오지 않았다");
                              }
                            } catch (InterruptedException e) {
                              Thread.currentThread().interrupt();
                              throw new AssertionError(e);
                            }
                          });
                } finally {
                  TenantContext.clear();
                }
              });
      // first 가 커밋 전 멈춤에 닿지 못했으면(예외·지연) 순서를 보장할 수 없다 — 결과를 버리지 않고 그 이유로 실패한다(WP-1647).
      if (!firstDone.await(30, TimeUnit.SECONDS)) {
        if (f1.isDone()) f1.get();
        throw new AssertionError("first 가 커밋 전 멈춤에 닿지 못했다");
      }
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
      // second 가 first 의 잠금을 실제로 기다리는 상태가 된 뒤에 first 를 커밋시킨다 — sleep 으로 가정하면 부하에서 순서가
      // 어긋난다(WP-1646·1647).
      RowLockWaits.awaitLockWaiter(f2);
      release.countDown();
      f1.get(20, TimeUnit.SECONDS);
      return f2.get(20, TimeUnit.SECONDS);
    } finally {
      release.countDown();
      pool.shutdownNow();
      pool.awaitTermination(30, TimeUnit.SECONDS);
    }
  }

  @Test
  void 삭제가_먼저면_나중_즐겨찾기는_404이고_행이_남지_않는다() throws Exception {
    Object r =
        race(
            () -> contactService.delete(owner, contactId),
            () -> {
              contactService.addFavorite(other, new FavoriteRequest("EXTERNAL", contactId));
              return "added";
            });
    assertThat(r).isInstanceOf(ContactNotFoundException.class);
    assertThat(favoriteRows()).isZero();
  }

  @Test
  void 즐겨찾기가_먼저면_삭제가_그_행까지_지운다() throws Exception {
    Object r =
        race(
            () -> contactService.addFavorite(other, new FavoriteRequest("EXTERNAL", contactId)),
            () -> {
              contactService.delete(owner, contactId);
              return "deleted";
            });
    assertThat(r).isEqualTo("deleted");
    assertThat(favoriteRows()).isZero();
  }

  @Test
  void 삭제가_먼저면_나중_그룹_편입은_400이고_행이_남지_않는다() throws Exception {
    Object r =
        race(
            () -> contactService.delete(owner, contactId),
            () ->
                groupService.addMember(
                    other, groupId, new AddMemberRequest("EXTERNAL", contactId)));
    assertThat(r).isInstanceOf(InvalidUserGroupException.class);
    assertThat(groupMemberRows()).isZero();
  }

  @Test
  void 그룹_편입이_먼저면_삭제가_그_행까지_지운다() throws Exception {
    Object r =
        race(
            () ->
                groupService.addMember(other, groupId, new AddMemberRequest("EXTERNAL", contactId)),
            () -> {
              contactService.delete(owner, contactId);
              return "deleted";
            });
    assertThat(r).isEqualTo("deleted");
    assertThat(groupMemberRows()).isZero();
  }
}
