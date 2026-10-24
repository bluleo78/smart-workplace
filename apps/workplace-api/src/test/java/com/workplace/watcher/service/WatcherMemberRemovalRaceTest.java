package com.workplace.watcher.service;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_WATCHER;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.support.IssueSeeds;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.exception.ProjectNotFoundException;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.watcher.repository.IssueWatcherRepository;
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
 * 프로젝트 멤버 제거와 그 사람의 이슈 구독(watch)이 겹칠 때(WP-776) — 어느 쪽이 먼저든 제거된 사람이 워처로 남지 않는다.
 *
 * <p>제거가 먼저면 나중 구독은 볼 수 없는 프로젝트라 404, 구독이 먼저면 제거의 워처 정리(WP-476)가 그 구독까지 지운다. 고치기 전에는 구독이 멤버 행을 잠그지
 * 않아 둘 다 성공한 채 워처가 남았다(제거된 사람에게 알림이 계속 감). 먼저 요청을 트랜잭션을 연 채(커밋 전) 멈춰 두고 나중 요청을 보내 결정적으로 만든다.
 */
class WatcherMemberRemovalRaceTest extends IntegrationTestBase {

  @Autowired WatcherService watcherService;
  @Autowired ProjectService projectService;
  @Autowired IssueRepository issueRepository;
  @Autowired IssueWatcherRepository watcherRepository;

  private final List<Long> users = new ArrayList<>();
  private long owner;
  private long member;
  private ProjectResponse project;
  private long issueId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    owner = user("o");
    member = user("m");
    String key =
        "WRR" + UUID.randomUUID().toString().replace("-", "").toUpperCase().substring(0, 4);
    project = projectService.create(owner, new CreateProjectRequest(key, "P", "x", "TEAM"));
    issueId =
        IssueSeeds.insert(issueRepository, baseDsl, project.id(), 1, "t1", null, "MID", null, owner)
            .id();
    projectService.addMember(owner, project.key(), new AddMemberRequest(member, "MEMBER"));
  }

  @AfterEach
  void cleanup() {
    baseDsl.deleteFrom(ISSUE_WATCHER).where(ISSUE_WATCHER.ISSUE_ID.eq(issueId)).execute();
    baseDsl.deleteFrom(ISSUE).where(ISSUE.PROJECT_ID.eq(project.id())).execute();
    baseDsl.deleteFrom(PROJECT).where(PROJECT.ID.eq(project.id())).execute();
    baseDsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(users)).execute();
    baseDsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.in(users)).execute();
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

  @Test
  void 제거가_먼저면_나중_구독은_404이고_워처가_남지_않는다() throws Exception {
    Object r =
        race(
            () -> projectService.removeMember(owner, project.key(), member),
            () -> {
              watcherService.watch(member, project.key(), 1);
              return "watched";
            });
    assertThat(r).isInstanceOf(ProjectNotFoundException.class);
    assertThat(watcherRepository.findUserIdsByIssue(issueId)).doesNotContain(member);
  }

  @Test
  void 구독이_먼저면_제거가_그_구독까지_지운다() throws Exception {
    Object r =
        race(
            () -> watcherService.watch(member, project.key(), 1),
            () -> {
              projectService.removeMember(owner, project.key(), member);
              return "removed";
            });
    assertThat(r).isEqualTo("removed");
    assertThat(watcherRepository.findUserIdsByIssue(issueId)).doesNotContain(member);
  }
}
