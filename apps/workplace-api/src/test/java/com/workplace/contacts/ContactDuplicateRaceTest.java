package com.workplace.contacts;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.CONTACT_ENTRY;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.contacts.dto.ExternalContactDetail;
import com.workplace.contacts.dto.ExternalContactRequest;
import com.workplace.contacts.dto.UpdateExternalContactRequest;
import com.workplace.contacts.exception.ContactDuplicateWarningException;
import com.workplace.contacts.service.ContactService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.PostgresTestContainer;
import com.workplace.support.RowLockWaits;
import com.workplace.support.TestFixtures;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
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
 * 외부 연락처 중복 판정이 동시 요청에도 지켜지는지(WP-1952) — 같은 테넌트·이름·이메일 요청은 판정 전 잠금으로 줄을 서, 나중 요청이 먼저 요청의 커밋을 보고 409
 * 를 받는다. 먼저 요청을 트랜잭션을 연 채(커밋 전) 멈춰 두고 나중 요청을 보내 순서를 결정적으로 만든다.
 */
class ContactDuplicateRaceTest extends IntegrationTestBase {

  @Autowired ContactService contactService;

  private final List<Long> users = new ArrayList<>();
  private final List<Long> tenants = new ArrayList<>();
  private long owner;
  private long other;
  private String name;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    owner = user(1L);
    other = user(1L);
    name = "dup-" + UUID.randomUUID().toString().substring(0, 6);
  }

  @AfterEach
  void cleanup() throws Exception {
    baseDsl.deleteFrom(CONTACT_ENTRY).where(CONTACT_ENTRY.OWNER_ID.in(users)).execute();
    baseDsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(users)).execute();
    baseDsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
    if (!tenants.isEmpty()) {
      dropExtraTenants();
    }
    TenantContext.clear();
  }

  /** 두 번째 테넌트 정리 — tenant 삭제는 런타임 롤이 못 하므로(V46) 소유자 커넥션으로 하고, RLS 로 가려진 그 테넌트의 연락처도 함께 지운다. */
  private void dropExtraTenants() throws Exception {
    var c = PostgresTestContainer.INSTANCE;
    List<String> deletes =
        List.of(
            "DELETE FROM contact_entry WHERE tenant_id = ?",
            "DELETE FROM audit_log WHERE tenant_id = ?",
            "DELETE FROM membership WHERE tenant_id = ?",
            "DELETE FROM tenant WHERE id = ?");
    try (Connection conn =
        DriverManager.getConnection(c.getJdbcUrl(), c.getUsername(), c.getPassword())) {
      for (long t : tenants) {
        for (String sql : deletes) {
          try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, t);
            ps.executeUpdate();
          }
        }
      }
    }
  }

  /** 사용자를 만들어 지정 테넌트 구성원으로 넣고, 정리 대상으로 기록한다. */
  private long user(long tenantId) {
    long id = TestFixtures.createHuman(baseDsl);
    TestFixtures.addMember(baseDsl, id, tenantId);
    users.add(id);
    return id;
  }

  private static ExternalContactRequest req(String name, String email) {
    return new ExternalContactRequest(name, email, null, null, null, null, "SHARED");
  }

  private int rows(String n) {
    return baseDsl.fetchCount(CONTACT_ENTRY, CONTACT_ENTRY.NAME.eq(n));
  }

  /** 테넌트 컨텍스트를 지정해 작업을 실행하고 끝나면 비운다(풀 스레드는 재사용되므로 누수 방지). */
  private static <T> T inTenant(long tenantId, Callable<T> body) throws Exception {
    TenantContext.set(tenantId);
    try {
      return body.call();
    } finally {
      TenantContext.clear();
    }
  }

  /** first 를 테넌트 1 트랜잭션 안에서 실행한 뒤 커밋 전에 release 신호까지 멈춰 잠금을 쥔 채 둔다. */
  private Future<?> startFirst(
      ExecutorService pool, Runnable first, CountDownLatch firstDone, CountDownLatch release) {
    return pool.submit(
        () ->
            inTenant(
                1L,
                () -> {
                  new TransactionTemplate(txManager)
                      .executeWithoutResult(
                          st -> {
                            first.run();
                            firstDone.countDown();
                            // 상한은 main 의 잠금 대기 확인(최대 10초)보다 넉넉히.
                            try {
                              if (!release.await(30, TimeUnit.SECONDS)) {
                                throw new AssertionError("release 신호가 오지 않았다");
                              }
                            } catch (InterruptedException e) {
                              Thread.currentThread().interrupt();
                              throw new AssertionError(e);
                            }
                          });
                  return null;
                }));
  }

  /** second 를 지정 테넌트에서 실행해 결과 값 또는 던진 예외를 그대로 돌려준다. */
  private Future<Object> startSecond(ExecutorService pool, Callable<Object> second, long tenantId) {
    return pool.submit(
        () -> {
          try {
            return inTenant(tenantId, second);
          } catch (Exception e) {
            return e;
          }
        });
  }

  /**
   * first 를 트랜잭션 안에서 커밋 전에 멈추고 second 를 보낸 뒤 first 를 커밋시키고 second 의 결과(값 또는 예외)를 돌려준다.
   *
   * @param expectWait true 면 second 가 first 의 잠금을 실제로 기다리는 것을 확인한 뒤 first 를 놓고(WP-1646·1647), false
   *     면 first 를 쥔 채 second 가 10초 안에 끝나는지 본 뒤 놓는다.
   */
  private Object runWithHeldFirst(
      Runnable first, Callable<Object> second, long secondTenant, boolean expectWait)
      throws Exception {
    CountDownLatch firstDone = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      Future<?> f1 = startFirst(pool, first, firstDone, release);
      if (!firstDone.await(30, TimeUnit.SECONDS)) {
        if (f1.isDone()) f1.get();
        throw new AssertionError("first 가 커밋 전 멈춤에 닿지 못했다");
      }
      Future<Object> f2 = startSecond(pool, second, secondTenant);
      Object result;
      if (expectWait) {
        RowLockWaits.awaitLockWaiter(f2);
        release.countDown();
        result = f2.get(20, TimeUnit.SECONDS);
      } else {
        result = f2.get(10, TimeUnit.SECONDS);
        release.countDown();
      }
      f1.get(20, TimeUnit.SECONDS);
      return result;
    } finally {
      release.countDown();
      pool.shutdownNow();
      pool.awaitTermination(30, TimeUnit.SECONDS);
    }
  }

  /** 같은 테넌트의 second 가 first 의 잠금을 기다렸다가 first 커밋 뒤 끝나는 경우. */
  private Object race(Runnable first, Callable<Object> second) throws Exception {
    return runWithHeldFirst(first, second, 1L, true);
  }

  /** 기다리지 않아야 하는 경우 — first 를 멈춘 채 second 가 먼저 끝나야 한다. */
  private Object holdFirstThen(Runnable first, Callable<Object> second, long secondTenant)
      throws Exception {
    return runWithHeldFirst(first, second, secondTenant, false);
  }

  @Test
  void 동시_생성은_한_건만_통과하고_나중은_409() throws Exception {
    var r = req(name, "a@x.com");
    Object res =
        race(
            () -> contactService.create(owner, r, false),
            () -> contactService.create(other, r, false));
    assertThat(res).isInstanceOf(ContactDuplicateWarningException.class);
    assertThat(rows(name)).isEqualTo(1);
  }

  @Test
  void 공백_대소문자만_다른_동시_생성도_409() throws Exception {
    Object res =
        race(
            () -> contactService.create(owner, req(name, "A@x.com"), false),
            () -> contactService.create(other, req("  " + name + " ", " a@X.COM "), false));
    assertThat(res).isInstanceOf(ContactDuplicateWarningException.class);
    assertThat(rows(name)).isEqualTo(1);
  }

  @Test
  void 이메일_없는_동시_생성도_409() throws Exception {
    Object res =
        race(
            () -> contactService.create(owner, req(name, null), false),
            () -> contactService.create(other, req(name, ""), false));
    assertThat(res).isInstanceOf(ContactDuplicateWarningException.class);
    assertThat(rows(name)).isEqualTo(1);
  }

  @Test
  void 강행_생성이_잡은_동안_비강행은_기다렸다가_409() throws Exception {
    var r = req(name, "a@x.com");
    Object res =
        race(
            () -> contactService.create(owner, r, true),
            () -> contactService.create(other, r, false));
    assertThat(res).isInstanceOf(ContactDuplicateWarningException.class);
    assertThat(rows(name)).isEqualTo(1);
  }

  @Test
  void 강행이면_기다린_뒤_그대로_저장() throws Exception {
    var r = req(name, "a@x.com");
    Object res =
        race(
            () -> contactService.create(owner, r, false),
            () -> contactService.create(other, r, true));
    assertThat(res).isInstanceOf(ExternalContactDetail.class);
    assertThat(rows(name)).isEqualTo(2);
  }

  @Test
  void 동시_수정과_생성도_한_건만_통과() throws Exception {
    TenantContext.set(1L);
    ExternalContactDetail x =
        new TransactionTemplate(txManager)
            .execute(st -> contactService.create(owner, req(name, "other@x.com"), false));
    var update = new UpdateExternalContactRequest(null, "a@x.com", null, null, null, null, null);
    Object res =
        race(
            () -> contactService.create(other, req(name, "a@x.com"), false),
            () -> contactService.update(owner, x.id(), update, false));
    assertThat(res).isInstanceOf(ContactDuplicateWarningException.class);
    assertThat(rows(name)).isEqualTo(2);
  }

  @Test
  void 다른_이름은_기다리지_않는다() throws Exception {
    String otherName = name + "-b";
    Object res =
        holdFirstThen(
            () -> contactService.create(owner, req(name, "a@x.com"), false),
            () -> contactService.create(other, req(otherName, "a@x.com"), false),
            1L);
    assertThat(res).isInstanceOf(ExternalContactDetail.class);
  }

  @Test
  void 다른_테넌트는_기다리지_않는다() throws Exception {
    long tenant2 = TestFixtures.createTenant(baseDsl, "ACTIVE");
    tenants.add(tenant2);
    long user2 = user(tenant2);
    Object res =
        holdFirstThen(
            () -> contactService.create(owner, req(name, "a@x.com"), false),
            () -> contactService.create(user2, req(name, "a@x.com"), false),
            tenant2);
    assertThat(res).isInstanceOf(ExternalContactDetail.class);
  }
}
