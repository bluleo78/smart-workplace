package com.workplace.issue.service;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.exception.EpicHasIncompleteChildrenException;
import com.workplace.issue.exception.InvalidParentException;
import com.workplace.issue.repository.IssueTypeRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
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
 * 에픽 완료와 그 에픽 아래로 미완료 이슈를 넣는 요청이 겹쳐도 완료 에픽 아래 미완료 하위가 남지 않는다(WP-771).
 *
 * <p>완료 전이는 「미완료 하위가 있으면 완료 불가」(#710), 하위 생성·부모 지정은 「완료 에픽에는 미완료 하위 불가」(WP-689)를 보는데, 서로 상대의 커밋 전
 * 상태를 보고 둘 다 통과했다. 완료 전이는 에픽 행을 잠그고, 하위 생성·부모 지정은 에픽을 공유 잠금으로 다시 읽어(WP-759) 그 최신 상태로 규칙을 다시 본다. 먼저
 * 요청을 트랜잭션을 연 채(커밋 전) 멈춰 두고 나중 요청을 보내 결정적으로 만든다.
 */
class IssueEpicDoneRaceTest extends IntegrationTestBase {

  @Autowired IssueService issueService;
  @Autowired ProjectService projectService;
  @Autowired IssueTypeRepository typeRepository;

  private final List<Long> users = new ArrayList<>();
  private long owner;
  private String key;
  private Long projectId;
  private long epicTypeId;
  private int epic;
  private int task;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    owner = user();
    key = "E" + UUID.randomUUID().toString().replace("-", "").substring(0, 6).toUpperCase();
    projectId =
        projectService.create(owner, new CreateProjectRequest(key, "epic done race", null)).id();
    epicTypeId = typeRepository.findByProjectAndName(projectId, "EPIC").orElseThrow().id();
    epic = issueService.create(owner, key, request("에픽", epicTypeId, null)).number();
    task = issueService.create(owner, key, request("태스크", null, null)).number();
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          var ids = baseDsl.select(ISSUE.ID).from(ISSUE).where(ISSUE.PROJECT_ID.eq(projectId));
          baseDsl.deleteFrom(ISSUE_HISTORY).where(ISSUE_HISTORY.ISSUE_ID.in(ids)).execute();
          baseDsl
              .update(ISSUE)
              .setNull(ISSUE.PARENT_ISSUE_ID)
              .where(ISSUE.PROJECT_ID.eq(projectId))
              .execute();
          baseDsl.deleteFrom(ISSUE).where(ISSUE.PROJECT_ID.eq(projectId)).execute();
          baseDsl.deleteFrom(PROJECT).where(PROJECT.ID.eq(projectId)).execute();
          baseDsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(users)).execute();
        });
    baseDsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.in(users)).execute();
    baseDsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
    TenantContext.clear();
  }

  @Test
  void 에픽_완료가_먼저면_나중_하위_생성은_400() throws Exception {
    Object r =
        race(
            () -> issueService.updateStatus(owner, key, epic, "DONE"),
            () -> issueService.create(owner, key, request("새 하위", null, epic)));

    assertThat(r).isInstanceOf(InvalidParentException.class);
    assertThat(openChildrenUnderDoneEpic()).isZero();
  }

  @Test
  void 에픽_완료가_먼저면_나중_부모_지정은_400() throws Exception {
    Object r =
        race(
            () -> issueService.updateStatus(owner, key, epic, "DONE"),
            () -> issueService.setParent(owner, key, task, epic));

    assertThat(r).isInstanceOf(InvalidParentException.class);
    assertThat(openChildrenUnderDoneEpic()).isZero();
  }

  @Test
  void 하위_생성이_먼저면_나중_에픽_완료는_400() throws Exception {
    Object r =
        race(
            () -> issueService.create(owner, key, request("새 하위", null, epic)),
            () -> issueService.updateStatus(owner, key, epic, "DONE"));

    assertThat(r).isInstanceOf(EpicHasIncompleteChildrenException.class);
    assertThat(openChildrenUnderDoneEpic()).isZero();
  }

  @Test
  void 부모_지정이_먼저면_나중_에픽_완료는_400() throws Exception {
    Object r =
        race(
            () -> issueService.setParent(owner, key, task, epic),
            () -> issueService.updateStatus(owner, key, epic, "DONE"));

    assertThat(r).isInstanceOf(EpicHasIncompleteChildrenException.class);
    assertThat(openChildrenUnderDoneEpic()).isZero();
  }

  @Test
  void 에픽_완료가_먼저면_나중에_다시_연_하위가_에픽도_다시_연다() throws Exception {
    int child = issueService.create(owner, key, request("끝난 하위", null, epic)).number();
    issueService.updateStatus(owner, key, child, "DONE");

    Object r =
        race(
            () -> issueService.updateStatus(owner, key, epic, "DONE"),
            () -> issueService.updateStatus(owner, key, child, "TODO"));

    assertThat(r).isNotInstanceOf(Exception.class);
    assertThat(openChildrenUnderDoneEpic()).isZero();
  }

  @Test
  void 완료_에픽의_두_하위를_동시에_다시_열어도_서로_기다리다_멈추지_않는다() throws Exception {
    int c1 = issueService.create(owner, key, request("하위1", null, epic)).number();
    int c2 = issueService.create(owner, key, request("하위2", null, epic)).number();
    issueService.updateStatus(owner, key, c1, "DONE");
    issueService.updateStatus(owner, key, c2, "DONE");
    issueService.updateStatus(owner, key, epic, "DONE");

    Object r =
        race(
            () -> issueService.updateStatus(owner, key, c1, "TODO"),
            () -> issueService.updateStatus(owner, key, c2, "TODO"));

    assertThat(r).isNotInstanceOf(Exception.class);
    assertThat(openChildrenUnderDoneEpic()).isZero();
  }

  /** 완료(DONE) 에픽 아래 살아 있는 미완료(DONE·CANCELED 아님) 하위 수. */
  private int openChildrenUnderDoneEpic() {
    var parent = ISSUE.as("p");
    return baseDsl.fetchCount(
        baseDsl
            .select(ISSUE.ID)
            .from(ISSUE)
            .join(parent)
            .on(parent.ID.eq(ISSUE.PARENT_ISSUE_ID))
            .where(ISSUE.PROJECT_ID.eq(projectId))
            .and(ISSUE.DELETED_AT.isNull())
            .and(ISSUE.STATUS.notIn("DONE", "CANCELED"))
            .and(parent.STATUS.eq("DONE")));
  }

  private static CreateIssueRequest request(String title, Long typeId, Integer parentNumber) {
    return new CreateIssueRequest(
        title, null, null, null, null, typeId, parentNumber, null, null, null, null, null);
  }

  private long user() {
    String s = UUID.randomUUID().toString().substring(0, 8);
    long id =
        baseDsl
            .insertInto(USER)
            .set(USER.USERNAME, "epic-" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "epic")
            .set(USER.EMAIL, "epic-" + s + "@example.com")
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
