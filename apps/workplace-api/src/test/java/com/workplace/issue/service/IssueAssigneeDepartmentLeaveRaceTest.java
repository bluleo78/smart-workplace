package com.workplace.issue.service;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.ISSUE_WATCHER;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_GROUP;
import static com.workplace.jooq.Tables.USER_GROUP_MEMBER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.exception.InvalidAssigneeForProjectException;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectMemberGroupService;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
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
 * 부서로만 프로젝트에 들어온 사람을 담당자로 지정하는 요청과, 그 사람을 조직도 부서에서 빼는 요청이 겹칠 때(WP-1128) — 어느 쪽이 먼저든 빠진 사람이 담당자로 남지
 * 않는다.
 *
 * <p>지정이 먼저면 부서에서 빼기(구성원 행 삭제)가 지정의 커밋을 기다렸다가 커밋 직전 정리가 그 담당까지 해제하고, 빼기가 먼저면 나중 지정은 멤버가 아니라 400 이다.
 * 고치기 전에는 지정이 부서 행(project_member_group)만 잠그고 구성원 행(user_group_member)은 잠그지 않아, 지정이 커밋하기 전에 빼기가
 * 커밋하면 그 정리가 아직 보이지 않는 담당을 놓쳐 담당자로 남았다. 먼저 요청을 트랜잭션을 연 채(커밋 전) 멈춰 두고 나중 요청을 보내 결정적으로 만든다
 * (IssueAssigneeMemberRemovalRaceTest 와 같은 방식). 실제로 커밋해야 커밋 직전 정리가 돌므로 테스트 트랜잭션을 쓰지 않고 끝나면 지운다.
 */
class IssueAssigneeDepartmentLeaveRaceTest extends IntegrationTestBase {

  @Autowired IssueAssigneeService assigneeService;
  @Autowired IssueService issueService;
  @Autowired ProjectService projectService;
  @Autowired ProjectMemberGroupService memberGroupService;
  @Autowired UserGroupService groupService;

  private final List<Long> users = new ArrayList<>();
  private long owner;
  private long member; // 부서 구성원 — 프로젝트 직접 멤버가 아니다
  private long departmentId;
  private ProjectResponse project;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    owner = user("o");
    member = user("m");
    TestFixtures.grantRole(baseDsl, owner, "ADMIN"); // 조직도 쓰기 권한
    departmentId =
        baseDsl
            .insertInto(USER_GROUP)
            .set(USER_GROUP.NAME, "부서-" + UUID.randomUUID().toString().substring(0, 8))
            .set(USER_GROUP.VISIBILITY, "SHARED")
            .set(USER_GROUP.TENANT_ID, 1L)
            .returning(USER_GROUP.ID)
            .fetchOne()
            .getId();
    baseDsl
        .insertInto(USER_GROUP_MEMBER)
        .set(USER_GROUP_MEMBER.GROUP_ID, departmentId)
        .set(USER_GROUP_MEMBER.TARGET_TYPE, "MEMBER")
        .set(USER_GROUP_MEMBER.TARGET_ID, member)
        .set(USER_GROUP_MEMBER.TENANT_ID, 1L)
        .execute();
    String key =
        "ADL" + UUID.randomUUID().toString().replace("-", "").toUpperCase().substring(0, 4);
    project = projectService.create(owner, new CreateProjectRequest(key, "P", "x", "TEAM"));
    issueService.create(
        owner,
        project.key(),
        new CreateIssueRequest("t1", null, "MID", null, null, null, null, null));
    memberGroupService.add(owner, project.key(), departmentId, null);
  }

  @AfterEach
  void cleanup() {
    TenantContext.set(1L);
    var issueIds = baseDsl.select(ISSUE.ID).from(ISSUE).where(ISSUE.PROJECT_ID.eq(project.id()));
    baseDsl.deleteFrom(ISSUE_ASSIGNEE).where(ISSUE_ASSIGNEE.ISSUE_ID.in(issueIds)).execute();
    baseDsl.deleteFrom(ISSUE_WATCHER).where(ISSUE_WATCHER.ISSUE_ID.in(issueIds)).execute();
    baseDsl.deleteFrom(ISSUE_HISTORY).where(ISSUE_HISTORY.ISSUE_ID.in(issueIds)).execute();
    baseDsl.deleteFrom(AGENT_WORK).where(AGENT_WORK.ISSUE_ID.in(issueIds)).execute();
    baseDsl.deleteFrom(ISSUE).where(ISSUE.PROJECT_ID.eq(project.id())).execute();
    baseDsl.deleteFrom(PROJECT).where(PROJECT.ID.eq(project.id())).execute();
    // 부서를 지우면 구성원 행·프로젝트 멤버 부서 행이 CASCADE 로 함께 지워진다.
    baseDsl.deleteFrom(USER_GROUP).where(USER_GROUP.ID.eq(departmentId)).execute();
    baseDsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(users)).execute();
    baseDsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.in(users)).execute();
    baseDsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
    TenantContext.clear();
  }

  private long user(String prefix) {
    long id = TestFixtures.createHuman(baseDsl);
    grantUserRole(id);
    TestFixtures.addMember(baseDsl, id, 1L);
    users.add(id);
    return id;
  }

  /** 이 프로젝트에서 member 가 담당자로 걸린 행 수. */
  private int memberAssignments() {
    return baseDsl.fetchCount(
        ISSUE_ASSIGNEE.join(ISSUE).on(ISSUE.ID.eq(ISSUE_ASSIGNEE.ISSUE_ID)),
        ISSUE.PROJECT_ID.eq(project.id()).and(ISSUE_ASSIGNEE.USER_ID.eq(member)));
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
  void 담당자_지정이_먼저면_부서에서_빼기가_그_담당까지_지운다() throws Exception {
    Object r =
        race(
            () -> assigneeService.replace(owner, project.key(), 1, List.of(member)),
            () -> {
              groupService.removeMember(owner, departmentId, "MEMBER", member);
              return "removed";
            });
    assertThat(r).isEqualTo("removed");
    assertThat(memberAssignments()).isZero();
  }

  @Test
  void 부서에서_빼기가_먼저면_나중_담당자_지정은_400이고_담당자로_남지_않는다() throws Exception {
    Object r =
        race(
            () -> groupService.removeMember(owner, departmentId, "MEMBER", member),
            () -> assigneeService.replace(owner, project.key(), 1, List.of(member)));
    assertThat(r).isInstanceOf(InvalidAssigneeForProjectException.class);
    assertThat(memberAssignments()).isZero();
  }
}
