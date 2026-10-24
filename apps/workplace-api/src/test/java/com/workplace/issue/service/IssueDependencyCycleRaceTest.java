package com.workplace.issue.service;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_DEPENDENCY;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.exception.DependencyCycleException;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.support.IssueSeeds;
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
 * 두 이슈가 서로를 막는 의존성을 동시에 추가해도 순환이 생기지 않는다(WP-758).
 *
 * <p>순환 검사(DFS)와 관계 저장 사이가 비어, 두 요청이 서로 커밋 전의 그래프(관계 없음)를 보고 둘 다 통과해 A→B·B→A 가 함께 저장됐다. 이제 같은 프로젝트의
 * 의존성 추가를 직렬화해, 나중 요청은 앞 요청이 커밋한 관계까지 보고 판정한다. 먼저 요청을 트랜잭션을 연 채(커밋 전) 멈춰 두고 나중 요청을 보내 결정적으로 만든다.
 */
class IssueDependencyCycleRaceTest extends IntegrationTestBase {

  @Autowired IssueDependencyService service;
  @Autowired ProjectService projectService;
  @Autowired IssueRepository issueRepository;

  private final List<Long> users = new ArrayList<>();
  private long owner;
  private String key;
  private Long projectId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    owner = user();
    key = "D" + UUID.randomUUID().toString().replace("-", "").substring(0, 6).toUpperCase();
    projectId = projectService.create(owner, new CreateProjectRequest(key, "dep race", null)).id();
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            st -> {
              IssueSeeds.insert(
                  issueRepository, baseDsl, projectId, 1, "A", null, "MID", null, owner);
              IssueSeeds.insert(
                  issueRepository, baseDsl, projectId, 2, "B", null, "MID", null, owner);
            });
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          var issueIds = baseDsl.select(ISSUE.ID).from(ISSUE).where(ISSUE.PROJECT_ID.eq(projectId));
          baseDsl
              .deleteFrom(ISSUE_DEPENDENCY)
              .where(ISSUE_DEPENDENCY.ISSUE_ID.in(issueIds))
              .execute();
          baseDsl.deleteFrom(ISSUE_HISTORY).where(ISSUE_HISTORY.ISSUE_ID.in(issueIds)).execute();
          baseDsl.deleteFrom(ISSUE).where(ISSUE.PROJECT_ID.eq(projectId)).execute();
          baseDsl.deleteFrom(PROJECT).where(PROJECT.ID.eq(projectId)).execute();
          baseDsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(users)).execute();
        });
    baseDsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.in(users)).execute();
    baseDsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
    TenantContext.clear();
  }

  @Test
  void 서로를_막는_의존성을_동시에_추가하면_나중_요청은_순환_409() throws Exception {
    Object r =
        race(
            () -> service.add(owner, key, 1, 2, "blocks"),
            () -> {
              service.add(owner, key, 2, 1, "blocks");
              return "added";
            });

    assertThat(r).isInstanceOf(DependencyCycleException.class);
    // A→B 하나만 남는다.
    var issueIds = baseDsl.select(ISSUE.ID).from(ISSUE).where(ISSUE.PROJECT_ID.eq(projectId));
    assertThat(baseDsl.fetchCount(ISSUE_DEPENDENCY, ISSUE_DEPENDENCY.ISSUE_ID.in(issueIds)))
        .isEqualTo(1);
  }

  private long user() {
    String s = UUID.randomUUID().toString().substring(0, 8);
    long id =
        baseDsl
            .insertInto(USER)
            .set(USER.USERNAME, "dep-" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "dep")
            .set(USER.EMAIL, "dep-" + s + "@example.com")
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
