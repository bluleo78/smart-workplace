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
import com.workplace.issue.exception.ParentNotAllowedException;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 두 이슈를 서로의 부모로 동시에 지정해도 데드락(500)이 나지 않는다(WP-1604).
 *
 * <p>setParent 는 자기 행을 FOR NO KEY UPDATE 로 잠근 뒤 새 부모 행을 FOR SHARE 로 잠가, A→부모 B 와 B→부모 A 를 동시에 보내면
 * 반대 순서로 잠가 PostgreSQL 데드락({@code DeadlockLoserDataAccessException}) → 500 이 났다. 이제 같은 프로젝트 부모는 이슈
 * id 순으로 잠가 한쪽이 기다렸다 진행하므로, 두 요청 모두 순차 호출과 같은 400(일반 이슈는 에픽 아래에만 — {@link
 * ParentNotAllowedException})으로 끝나야 한다. 테스트 메서드는 트랜잭션으로 감싸지 않는다 — 두 스레드가 각자 서비스 트랜잭션을 열어 실제로 잠금을
 * 다퉈야 하기 때문이다.
 */
class IssueSetParentCrossRaceTest extends IntegrationTestBase {

  /** 데드락은 타이밍에 달려 있어 여러 번 겹쳐 본다. */
  private static final int ROUNDS = 20;

  @Autowired IssueService issueService;
  @Autowired ProjectService projectService;

  private final List<Long> users = new ArrayList<>();
  private long owner;
  private String key;
  private Long projectId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    owner = user();
    key = "X" + UUID.randomUUID().toString().replace("-", "").substring(0, 6).toUpperCase();
    projectId =
        projectService.create(owner, new CreateProjectRequest(key, "cross race", null)).id();
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
  void 두_태스크를_서로의_부모로_동시에_지정해도_데드락_없이_둘_다_400이다() throws Exception {
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      for (int round = 0; round < ROUNDS; round++) {
        // 매 회 새 태스크 두 개 — 일반 이슈(TASK)는 에픽 아래에만 둘 수 있어 둘 다 규칙 위반이 정답이다.
        int a = issueService.create(owner, key, task("A" + round)).number();
        int b = issueService.create(owner, key, task("B" + round)).number();

        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        Future<Object> f1 = pool.submit(() -> setParentConcurrently(a, b, ready, start));
        Future<Object> f2 = pool.submit(() -> setParentConcurrently(b, a, ready, start));
        ready.await(10, TimeUnit.SECONDS);
        start.countDown();

        Object r1 = f1.get(30, TimeUnit.SECONDS);
        Object r2 = f2.get(30, TimeUnit.SECONDS);
        // 데드락이면 한쪽이 DeadlockLoserDataAccessException(→ 500) 으로 끝난다 — 둘 다 순차 호출과 같은 400 이어야 한다.
        assertThat(r1).as("round %d A→B", round).isInstanceOf(ParentNotAllowedException.class);
        assertThat(r2).as("round %d B→A", round).isInstanceOf(ParentNotAllowedException.class);
        assertThat(parentOf(a)).as("round %d A 부모", round).isNull();
        assertThat(parentOf(b)).as("round %d B 부모", round).isNull();
      }
    } finally {
      pool.shutdownNow();
      pool.awaitTermination(30, TimeUnit.SECONDS);
    }
  }

  /** 두 스레드가 준비되면 동시에 setParent 를 보낸다. 결과(값 또는 예외)를 돌려준다. */
  private Object setParentConcurrently(
      int child, int parent, CountDownLatch ready, CountDownLatch start) {
    TenantContext.set(1L);
    try {
      ready.countDown();
      start.await(10, TimeUnit.SECONDS);
      return issueService.setParent(owner, key, child, parent);
    } catch (Exception e) {
      return e;
    } finally {
      TenantContext.clear();
    }
  }

  /** 이슈의 현재 부모 id(없으면 null). */
  private Long parentOf(int number) {
    return callInTenant(
        1L,
        () ->
            baseDsl
                .select(ISSUE.PARENT_ISSUE_ID)
                .from(ISSUE)
                .where(ISSUE.PROJECT_ID.eq(projectId).and(ISSUE.NUMBER.eq(number)))
                .fetchOne(ISSUE.PARENT_ISSUE_ID));
  }

  private static CreateIssueRequest task(String title) {
    return new CreateIssueRequest(
        title, null, null, null, null, null, null, null, null, null, null, null);
  }

  private long user() {
    String s = UUID.randomUUID().toString().substring(0, 8);
    long id =
        baseDsl
            .insertInto(USER)
            .set(USER.USERNAME, "xrace-" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "xrace")
            .set(USER.EMAIL, "xrace-" + s + "@example.com")
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
}
