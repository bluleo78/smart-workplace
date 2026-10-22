package com.workplace.issue.service;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_FIELD_DEF;
import static com.workplace.jooq.Tables.ISSUE_FIELD_VALUE;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateIssueFieldDefRequest;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.UpdateIssueFieldsRequest;
import com.workplace.issue.dto.UpdateIssueFieldsRequest.FieldValueInput;
import com.workplace.issue.exception.FieldOptionInUseException;
import com.workplace.issue.exception.InvalidFieldValueException;
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
 * SELECT 필드 옵션 삭제와 그 옵션 값 지정이 겹쳐도 이슈에 옵션에 없는 값이 남지 않는다(WP-773).
 *
 * <p>옵션 삭제(정의 수정)는 「그 옵션을 쓰는 이슈가 있으면 거절」(#707), 값 지정은 「옵션에 없는 값이면 거절」을 보는데, 서로 상대의 커밋 전 상태를 보고 둘 다
 * 통과했다. 정의 수정은 필드 정의 행을 쓰기 잠금하고, 값 지정은 정의 행을 공유 잠금으로 읽어 차례를 세운다 — 늦은 쪽은 앞선 결과를 보고 400. 먼저 요청을 트랜잭션을
 * 연 채(커밋 전) 멈춰 두고 나중 요청을 보내 결정적으로 만든다.
 */
class IssueFieldOptionRaceTest extends IntegrationTestBase {

  @Autowired IssueService issueService;
  @Autowired ProjectService projectService;
  @Autowired IssueFieldDefService defService;
  @Autowired IssueFieldValueService valueService;
  @Autowired ObjectMapper om;

  private final List<Long> users = new ArrayList<>();
  private long owner;
  private String key;
  private Long projectId;
  private long fieldId;
  private int issue;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    owner = user();
    key = "E" + UUID.randomUUID().toString().replace("-", "").substring(0, 6).toUpperCase();
    projectId =
        projectService.create(owner, new CreateProjectRequest(key, "field option race", null)).id();
    fieldId =
        defService
            .create(
                owner,
                key,
                new CreateIssueFieldDefRequest("단계", "SELECT", om.valueToTree(List.of("A", "B"))))
            .id();
    issue = issueService.create(owner, key, request("이슈", null, null)).number();
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          var ids = baseDsl.select(ISSUE.ID).from(ISSUE).where(ISSUE.PROJECT_ID.eq(projectId));
          baseDsl.deleteFrom(ISSUE_FIELD_VALUE).where(ISSUE_FIELD_VALUE.ISSUE_ID.in(ids)).execute();
          baseDsl.deleteFrom(ISSUE_HISTORY).where(ISSUE_HISTORY.ISSUE_ID.in(ids)).execute();
          baseDsl
              .update(ISSUE)
              .setNull(ISSUE.PARENT_ISSUE_ID)
              .where(ISSUE.PROJECT_ID.eq(projectId))
              .execute();
          baseDsl.deleteFrom(ISSUE).where(ISSUE.PROJECT_ID.eq(projectId)).execute();
          baseDsl
              .deleteFrom(ISSUE_FIELD_DEF)
              .where(ISSUE_FIELD_DEF.PROJECT_ID.eq(projectId))
              .execute();
          baseDsl.deleteFrom(PROJECT).where(PROJECT.ID.eq(projectId)).execute();
          baseDsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(users)).execute();
        });
    baseDsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.in(users)).execute();
    baseDsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
    TenantContext.clear();
  }

  @Test
  void 옵션_삭제가_먼저면_나중_값_지정은_400_이고_옵션_밖_값이_남지_않는다() throws Exception {
    Object r = race(() -> removeOptionA(), () -> setValueA());

    assertThat(r).isInstanceOf(InvalidFieldValueException.class);
    assertThat(storedValues()).isEmpty();
  }

  @Test
  void 값_지정이_먼저면_나중_옵션_삭제는_400_이고_옵션이_남는다() throws Exception {
    Object r = race(() -> setValueA(), () -> removeOptionA());

    assertThat(r).isInstanceOf(FieldOptionInUseException.class);
    assertThat(storedValues()).singleElement().asString().contains("A");
    assertThat(
            baseDsl
                .select(ISSUE_FIELD_DEF.OPTIONS)
                .from(ISSUE_FIELD_DEF)
                .where(ISSUE_FIELD_DEF.ID.eq(fieldId))
                .fetchOne(ISSUE_FIELD_DEF.OPTIONS)
                .data())
        .contains("A");
  }

  private Object removeOptionA() {
    return defService.update(
        owner,
        key,
        fieldId,
        new CreateIssueFieldDefRequest("단계", "SELECT", om.valueToTree(List.of("B"))));
  }

  private Object setValueA() {
    return valueService.replace(
        owner,
        key,
        issue,
        new UpdateIssueFieldsRequest(List.of(new FieldValueInput(fieldId, om.valueToTree("A")))));
  }

  /** 이 필드에 저장된 이슈 값(JSON 텍스트). */
  private List<String> storedValues() {
    return baseDsl
        .select(ISSUE_FIELD_VALUE.VALUE)
        .from(ISSUE_FIELD_VALUE)
        .where(ISSUE_FIELD_VALUE.FIELD_DEF_ID.eq(fieldId))
        .fetch(r -> r.value1().data());
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
