package com.workplace.global;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_COMMENT;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static com.workplace.support.RowLockWaits.awaitLockWaiter;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.cycle.dto.CreateCycleRequest;
import com.workplace.cycle.exception.CycleNotFoundException;
import com.workplace.cycle.service.CycleService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateCommentRequest;
import com.workplace.issue.dto.CreateIssueFieldDefRequest;
import com.workplace.issue.dto.CreateIssueTypeRequest;
import com.workplace.issue.dto.UpdateCommentRequest;
import com.workplace.issue.exception.FieldNotFoundException;
import com.workplace.issue.exception.IssueCommentNotFoundException;
import com.workplace.issue.exception.TypeNotFoundException;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.service.IssueCommentService;
import com.workplace.issue.service.IssueFieldDefService;
import com.workplace.issue.service.IssueTypeService;
import com.workplace.label.dto.CreateLabelRequest;
import com.workplace.label.exception.LabelNotFoundException;
import com.workplace.label.service.LabelService;
import com.workplace.milestone.dto.CreateMilestoneRequest;
import com.workplace.milestone.exception.MilestoneNotFoundException;
import com.workplace.milestone.service.MilestoneService;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.view.dto.SaveViewRequest;
import com.workplace.view.exception.SavedViewNotFoundException;
import com.workplace.view.service.SavedViewService;
import java.time.LocalDate;
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
 * 수정과 삭제가 겹치면 수정은 500 이 아니라 그 자원의 404 로 끝난다(WP-755).
 *
 * <p>라벨·사이클·마일스톤·커스텀 필드·이슈 유형·저장된 뷰·댓글의 수정은 「찾기 → 고치기 → 다시 읽어 응답」인데, 다시 읽기가 {@code
 * findById().orElseThrow()} 라 그 사이 삭제가 커밋되면 NoSuchElementException 으로 500 「An unexpected error
 * occurred」가 났다. 삭제를 트랜잭션을 연 채(커밋 전) 멈춰 두고 수정을 보내, 수정이 그 행의 잠금을 기다리는 것을 확인한 뒤 삭제를 커밋시켜 결정적으로 만든다.
 */
class UpdateDeleteRaceNotFoundTest extends IntegrationTestBase {

  @Autowired ProjectService projectService;
  @Autowired LabelService labelService;
  @Autowired CycleService cycleService;
  @Autowired MilestoneService milestoneService;
  @Autowired IssueFieldDefService fieldDefService;
  @Autowired IssueTypeService issueTypeService;
  @Autowired SavedViewService savedViewService;
  @Autowired IssueCommentService commentService;
  @Autowired IssueRepository issueRepository;

  private final List<Long> users = new ArrayList<>();
  private long owner;
  private String key;
  private Long projectId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    owner = user();
    key = "U" + UUID.randomUUID().toString().replace("-", "").substring(0, 6).toUpperCase();
    projectId = projectService.create(owner, new CreateProjectRequest(key, "race", null)).id();
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          baseDsl
              .deleteFrom(ISSUE_COMMENT)
              .where(
                  ISSUE_COMMENT.ISSUE_ID.in(
                      baseDsl.select(ISSUE.ID).from(ISSUE).where(ISSUE.PROJECT_ID.eq(projectId))))
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
  void 라벨() throws Exception {
    long id = labelService.create(owner, key, new CreateLabelRequest("l", "RED")).id();
    Object r =
        race(
            () -> labelService.delete(owner, key, id),
            () -> labelService.update(owner, key, id, new CreateLabelRequest("l2", "BLUE")));
    assertThat(r).isInstanceOf(LabelNotFoundException.class);
  }

  @Test
  void 사이클() throws Exception {
    long id =
        cycleService.create(owner, key, new CreateCycleRequest("c", null, null, null, null)).id();
    Object r =
        race(
            () -> cycleService.delete(owner, key, id),
            () ->
                cycleService.update(
                    owner, key, id, new CreateCycleRequest("c2", null, null, null, null)));
    assertThat(r).isInstanceOf(CycleNotFoundException.class);
  }

  @Test
  void 마일스톤() throws Exception {
    LocalDate due = LocalDate.of(2026, 12, 31);
    long id = milestoneService.create(owner, key, new CreateMilestoneRequest("m", due, null)).id();
    Object r =
        race(
            () -> milestoneService.delete(owner, key, id),
            () ->
                milestoneService.update(
                    owner, key, id, new CreateMilestoneRequest("m2", due, null)));
    assertThat(r).isInstanceOf(MilestoneNotFoundException.class);
  }

  @Test
  void 커스텀_필드() throws Exception {
    long id =
        fieldDefService.create(owner, key, new CreateIssueFieldDefRequest("f", "TEXT", null)).id();
    Object r =
        race(
            () -> fieldDefService.delete(owner, key, id),
            () ->
                fieldDefService.update(
                    owner, key, id, new CreateIssueFieldDefRequest("f2", "TEXT", null)));
    assertThat(r).isInstanceOf(FieldNotFoundException.class);
  }

  @Test
  void 이슈_유형() throws Exception {
    long id =
        issueTypeService.create(owner, key, new CreateIssueTypeRequest("T", "RED", "Bug")).id();
    Object r =
        race(
            () -> issueTypeService.delete(owner, key, id),
            () ->
                issueTypeService.update(
                    owner, key, id, new CreateIssueTypeRequest("T2", "BLUE", "Bug")));
    assertThat(r).isInstanceOf(TypeNotFoundException.class);
  }

  @Test
  void 저장된_뷰_수정과_고정() throws Exception {
    long id =
        savedViewService
            .create(owner, key, new SaveViewRequest("v", "status=TODO", "PRIVATE"))
            .id();
    Object r =
        race(
            () -> savedViewService.delete(owner, key, id),
            () ->
                savedViewService.update(
                    owner, key, id, new SaveViewRequest("v2", "status=DONE", "PRIVATE")));
    assertThat(r).isInstanceOf(SavedViewNotFoundException.class);

    long pinId =
        savedViewService
            .create(owner, key, new SaveViewRequest("p", "status=TODO", "PRIVATE"))
            .id();
    Object pin =
        race(
            () -> savedViewService.delete(owner, key, pinId),
            () -> savedViewService.togglePin(owner, key, pinId, true));
    assertThat(pin).isInstanceOf(SavedViewNotFoundException.class);
  }

  @Test
  void 댓글() throws Exception {
    long issueId = issueRepository.insert(projectId, 1, "t", null, "MID", null, owner).id();
    long id = commentService.create(owner, issueId, new CreateCommentRequest("c")).id();
    Object r =
        race(
            () -> commentService.delete(owner, issueId, id),
            () -> commentService.update(owner, issueId, id, new UpdateCommentRequest("c2")));
    assertThat(r).isInstanceOf(IssueCommentNotFoundException.class);
  }

  private long user() {
    String s = UUID.randomUUID().toString().substring(0, 8);
    long id =
        baseDsl
            .insertInto(USER)
            .set(USER.USERNAME, "race-" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "race")
            .set(USER.EMAIL, "race-" + s + "@example.com")
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
   * deleter 를 트랜잭션 안에서 실행하고 커밋 전에 멈춘 뒤 updater 를 보낸다. updater 가 그 행의 잠금을 기다리는 것을 확인하고 삭제를 커밋시켜,
   * updater 의 결과(값 또는 예외)를 돌려준다.
   */
  private Object race(Runnable deleter, Callable<Object> updater) throws Exception {
    CountDownLatch deleted = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      Future<?> d =
          pool.submit(
              () -> {
                TenantContext.set(1L);
                try {
                  new TransactionTemplate(txManager)
                      .executeWithoutResult(
                          st -> {
                            deleter.run();
                            deleted.countDown();
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
      assertThat(deleted.await(10, TimeUnit.SECONDS)).isTrue();
      Future<Object> u =
          pool.submit(
              () -> {
                TenantContext.set(1L);
                try {
                  return updater.call();
                } catch (Exception e) {
                  return e;
                } finally {
                  TenantContext.clear();
                }
              });
      awaitLockWaiter(u);
      release.countDown();
      d.get(20, TimeUnit.SECONDS);
      return u.get(20, TimeUnit.SECONDS);
    } finally {
      release.countDown();
      pool.shutdownNow();
      pool.awaitTermination(30, TimeUnit.SECONDS);
    }
  }
}
