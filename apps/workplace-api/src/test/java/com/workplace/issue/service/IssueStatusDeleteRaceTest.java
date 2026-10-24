package com.workplace.issue.service;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.dto.ErrorResponse;
import com.workplace.global.exception.GlobalExceptionHandler;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.CreateProjectStatusRequest;
import com.workplace.issue.dto.ProjectStatusResponse;
import com.workplace.issue.exception.InvalidStatusForProjectException;
import com.workplace.issue.exception.RequestedStatusNotFoundException;
import com.workplace.issue.exception.StatusDeletedException;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.RowLockWaits;
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
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;

/**
 * 상태 삭제와 그 상태로 이슈를 쓰는 요청이 겹치면 「상태가 방금 삭제됐어요」 409 로 거절한다(WP-936).
 *
 * <p>삭제는 상태 행을 FOR UPDATE 로 잠근 채 이슈를 옮기고 행을 지운다. 그 사이 이 상태로 이슈를 만들거나 옮기는 요청은 서비스 확인(커밋 전이라 행이 아직
 * 보임)을 지나 쓰기의 복합 FK 검사에서 삭제 커밋을 기다렸다가 위반으로 실패한다 — 예전엔 공용 처리기가 「참조한 항목을 찾을 수 없습니다」 404 로 내 무엇을 할지 알
 * 수 없었다. 삭제가 먼저 끝났으면 서비스 확인에서 상태가 없어 경합이 아니다 — 400 + 코드 STATUS_NOT_FOUND 로 웹이 목록을 다시 받는다.
 *
 * <p>삭제가 커밋돼야 하는 흐름이라 비-{@code @Transactional} 로 두고 자기 프로젝트·이슈·사용자만 {@code @AfterEach} 로 정리한다. 삭제를
 * 커밋 전에 멈춰 두고 쓰기가 잠금을 기다리는 것을 관측한 뒤 풀어 순서를 결정적으로 맞춘다.
 */
class IssueStatusDeleteRaceTest extends IntegrationTestBase {

  @Autowired IssueService issueService;
  @Autowired ProjectService projectService;
  @Autowired ProjectStatusService statusService;
  @Autowired ProjectStatusDeletionService deletionService;

  private final List<Long> users = new ArrayList<>();
  private long owner;
  private ProjectResponse project;
  private long review;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    owner = TestFixtures.createHuman(baseDsl);
    TestFixtures.grantRole(baseDsl, owner, "USER");
    TestFixtures.addMember(baseDsl, owner, 1L);
    users.add(owner);
    String key =
        "SDR" + UUID.randomUUID().toString().replace("-", "").toUpperCase().substring(0, 4);
    project = projectService.create(owner, new CreateProjectRequest(key, "P", "x", "TEAM"));
    review =
        statusService
            .create(owner, key, new CreateProjectStatusRequest("검토 중", "IN_PROGRESS", null, null))
            .id();
    TenantContext.clear();
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          var ids = baseDsl.select(ISSUE.ID).from(ISSUE).where(ISSUE.PROJECT_ID.eq(project.id()));
          baseDsl.deleteFrom(ISSUE_HISTORY).where(ISSUE_HISTORY.ISSUE_ID.in(ids)).execute();
          baseDsl.deleteFrom(ISSUE).where(ISSUE.PROJECT_ID.eq(project.id())).execute();
          // project 삭제가 project_status 를 cascade 로 지운다
          baseDsl.deleteFrom(PROJECT).where(PROJECT.ID.eq(project.id())).execute();
          baseDsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(users)).execute();
          baseDsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.in(users)).execute();
        });
    baseDsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
  }

  @Test
  void 삭제가_잠금을_쥔_동안_그_상태로_생성하면_기다렸다가_409() throws Exception {
    Object r = raceWithDelete(() -> issueService.create(owner, project.key(), request(review)));

    assertStatusDeleted(r);
    assertThat(issueCount()).isZero();
  }

  @Test
  void 삭제가_잠금을_쥔_동안_다른_상태의_이슈를_그_상태로_옮기면_기다렸다가_409() throws Exception {
    int number =
        callInTenant(1L, () -> issueService.create(owner, project.key(), request(null)).number());

    Object r =
        raceWithDelete(() -> issueService.updateStatus(owner, project.key(), number, null, review));

    assertStatusDeleted(r);
    // 옮기기는 롤백돼 처음 상태(할 일) 그대로다.
    assertThat(
            callInTenant(
                1L, () -> issueService.get(owner, project.key(), number).summary().statusName()))
        .isEqualTo("할 일");
  }

  @Test
  void 삭제가_먼저_끝났으면_서비스_확인에서_STATUS_NOT_FOUND_400() {
    int number =
        callInTenant(1L, () -> issueService.create(owner, project.key(), request(null)).number());
    callInTenant(
        1L,
        () -> {
          deletionService.delete(owner, project.key(), review, null);
          return null;
        });

    assertThatThrownBy(
            () ->
                callInTenant(1L, () -> issueService.create(owner, project.key(), request(review))))
        .isInstanceOf(RequestedStatusNotFoundException.class);
    assertThatThrownBy(
            () ->
                callInTenant(
                    1L,
                    () -> issueService.updateStatus(owner, project.key(), number, null, review)))
        .isInstanceOf(RequestedStatusNotFoundException.class);
  }

  @Test
  void 다른_프로젝트의_상태는_그대로_400() {
    ProjectResponse other =
        callInTenant(
            1L,
            () ->
                projectService.create(
                    owner,
                    new CreateProjectRequest(
                        "SDO"
                            + UUID.randomUUID()
                                .toString()
                                .replace("-", "")
                                .toUpperCase()
                                .substring(0, 4),
                        "O",
                        "x",
                        "TEAM")));
    try {
      long foreign =
          callInTenant(
              1L,
              () ->
                  statusService.list(owner, other.key()).stream()
                      .filter(s -> s.name().equals("진행 중"))
                      .findFirst()
                      .map(ProjectStatusResponse::id)
                      .orElseThrow());

      assertThatThrownBy(
              () ->
                  callInTenant(
                      1L, () -> issueService.create(owner, project.key(), request(foreign))))
          .isInstanceOf(InvalidStatusForProjectException.class);
    } finally {
      cleanupInTenant(
          1L, () -> baseDsl.deleteFrom(PROJECT).where(PROJECT.ID.eq(other.id())).execute());
    }
  }

  @Test
  void 응답은_409와_코드_STATUS_DELETED와_다른_상태를_고르라는_안내() {
    ResponseEntity<ErrorResponse> res =
        new GlobalExceptionHandler()
            .handleCoded(
                new StatusDeletedException(new RuntimeException("fk_issue_status_category")),
                new MockHttpServletRequest("PATCH", "/api/v1/projects/X/issues/1/status"));

    assertThat(res.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(res.getBody().message()).isEqualTo("상태가 방금 삭제됐어요. 다른 상태를 골라 주세요.");
    assertThat(res.getBody().errors()).containsEntry("code", "STATUS_DELETED");
  }

  /**
   * 「검토 중」 삭제를 트랜잭션 안에서 실행하고 커밋 전에 멈춘 뒤 write 를 보낸다. write 가 상태 행 잠금을 기다리는 것을 관측하면 삭제를 커밋시키고 write
   * 의 결과(값 또는 예외)를 돌려준다.
   */
  private Object raceWithDelete(Callable<Object> write) throws Exception {
    CountDownLatch deleted = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      Future<?> deletion =
          pool.submit(
              () ->
                  callInTenant(
                      1L,
                      () -> {
                        deletionService.delete(owner, project.key(), review, null);
                        deleted.countDown();
                        RowLockWaits.awaitQuietly(release);
                        return null;
                      }));
      assertThat(deleted.await(10, TimeUnit.SECONDS)).isTrue();
      Future<Object> writer =
          pool.submit(
              () -> {
                TenantContext.set(1L);
                try {
                  return write.call();
                } catch (Exception e) {
                  return e;
                } finally {
                  TenantContext.clear();
                }
              });
      RowLockWaits.awaitLockWaiter(writer);
      release.countDown();
      deletion.get(10, TimeUnit.SECONDS);
      return writer.get(10, TimeUnit.SECONDS);
    } finally {
      release.countDown();
      pool.shutdownNow();
      pool.awaitTermination(20, TimeUnit.SECONDS);
    }
  }

  private int issueCount() {
    return callInTenant(1L, () -> baseDsl.fetchCount(ISSUE, ISSUE.PROJECT_ID.eq(project.id())));
  }

  /**
   * 쓰기가 상태 복합 FK 위반으로 실패했고, 공용 처리기가 그것을 409 STATUS_DELETED 로 바꾸는지 본다 — 저장소는 위반을 그대로 던지고 번역은 처리기가
   * 한다(WP-936).
   */
  private static void assertStatusDeleted(Object r) {
    assertThat(r).isInstanceOf(DataIntegrityViolationException.class);
    ResponseEntity<ErrorResponse> res =
        new GlobalExceptionHandler()
            .handleDataIntegrityViolation(
                (DataIntegrityViolationException) r,
                new MockHttpServletRequest("PATCH", "/api/v1/projects/X/issues/1/status"));
    assertThat(res.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(res.getBody().message()).isEqualTo("상태가 방금 삭제됐어요. 다른 상태를 골라 주세요.");
    assertThat(res.getBody().errors()).containsEntry("code", "STATUS_DELETED");
  }

  private static CreateIssueRequest request(Long statusId) {
    return new CreateIssueRequest(
        "t", null, null, null, List.of(), null, null, null, null, null, null, null, null, null,
        statusId);
  }
}
