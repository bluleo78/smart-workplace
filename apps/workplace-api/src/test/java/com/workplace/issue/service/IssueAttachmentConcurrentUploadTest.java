package com.workplace.issue.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.exception.AttachmentLimitExceededException;
import com.workplace.issue.repository.IssueAttachmentRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.jooq.Tables;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;

/**
 * 이슈 첨부 동시 업로드 레이스 컨디션 회귀 테스트 (#625).
 *
 * <p>테스트 클래스 자체는 {@code @Transactional} 을 붙이지 않는다 — 두 스레드가 각자 독립된 커넥션/트랜잭션으로 {@link
 * IssueAttachmentService#upload} 를 호출해야 실제 TOCTOU 레이스(현재 개수 조회 → 비교 → INSERT) 를 재현할 수 있기 때문이다. 테스트
 * 트랜잭션으로 감싸면 두 호출이 같은 트랜잭션을 공유해 레이스가 재현되지 않는다.
 */
class IssueAttachmentConcurrentUploadTest extends IntegrationTestBase {

  private static final long TEST_TENANT_ID = 1L;

  @Autowired DSLContext dsl;
  @Autowired IssueAttachmentService service;
  @Autowired IssueAttachmentRepository repo;
  @Autowired IssueRepository issueRepository;
  @Autowired ProjectService projectService;

  @BeforeEach
  void setUpTenantContext() {
    TenantContext.set(TEST_TENANT_ID);
  }

  @AfterEach
  void clearTenantContext() {
    TenantContext.clear();
  }

  private Long createUser(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(Tables.USER)
            .set(Tables.USER.USERNAME, prefix + "-" + suffix)
            .set(Tables.USER.PASSWORD, "pw")
            .set(Tables.USER.NAME, prefix)
            .set(Tables.USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .returning(Tables.USER.ID)
            .fetchOne()
            .getId();
    Long roleId =
        dsl.select(Tables.ROLE.ID)
            .from(Tables.ROLE)
            .where(Tables.ROLE.NAME.eq("USER"))
            .fetchOne(Tables.ROLE.ID);
    dsl.insertInto(Tables.USER_ROLE)
        .set(Tables.USER_ROLE.USER_ID, id)
        .set(Tables.USER_ROLE.ROLE_ID, roleId)
        .execute();
    return id;
  }

  private String uniqueKey(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    String key = prefix + suffix;
    return key.substring(0, Math.min(10, key.length()));
  }

  private List<MultipartFile> files(String prefix, int count) {
    return java.util.stream.IntStream.range(0, count)
        .mapToObj(
            i ->
                (MultipartFile)
                    new MockMultipartFile(
                        prefix + i, prefix + i + ".txt", "text/plain", new byte[] {1}))
        .toList();
  }

  @Test
  void concurrent_uploads_never_exceed_per_issue_limit() throws Exception {
    // given: 신규 이슈(첨부 0개), 두 스레드가 각각 6개씩(합 12개) 동시 업로드 시도 — 한도(10) 초과 조합.
    Long owner = createUser("owner");
    ProjectResponse project =
        projectService.create(owner, new CreateProjectRequest(uniqueKey("CC"), "P-CC", "x"));
    issueRepository.insert(project.id(), 1, "t", null, "MID", null, owner);

    ExecutorService pool = Executors.newFixedThreadPool(2);
    CountDownLatch ready = new CountDownLatch(2);
    CountDownLatch start = new CountDownLatch(1);
    AtomicInteger successCount = new AtomicInteger(0);
    AtomicInteger rejectedCount = new AtomicInteger(0);

    Runnable task =
        () -> {
          TenantContext.set(TEST_TENANT_ID);
          try {
            ready.countDown();
            start.await(5, TimeUnit.SECONDS);
            service.upload(owner, project.key(), 1, files("f", 6));
            successCount.incrementAndGet();
          } catch (AttachmentLimitExceededException e) {
            rejectedCount.incrementAndGet();
          } catch (Exception e) {
            throw new RuntimeException(e);
          } finally {
            TenantContext.clear();
          }
        };

    pool.submit(task);
    pool.submit(task);
    ready.await(5, TimeUnit.SECONDS);
    start.countDown();
    pool.shutdown();
    assertThat(pool.awaitTermination(10, TimeUnit.SECONDS)).isTrue();

    // then: 최종 첨부 개수는 한도(10)를 절대 넘지 않아야 하고, 두 요청 중 최소 하나는 거부돼야 한다.
    Long issueId = issueRepository.findByProjectAndNumber(project.id(), 1).orElseThrow().id();
    int finalCount = repo.countByIssue(issueId);

    assertThat(finalCount).isLessThanOrEqualTo(10);
    assertThat(rejectedCount.get()).isGreaterThanOrEqualTo(1);
    assertThat(successCount.get() + rejectedCount.get()).isEqualTo(2);

    // cleanup
    cleanupInTenant(
        TEST_TENANT_ID,
        () -> {
          repo.findByIssue(issueId).forEach(a -> repo.delete(a.fileId()));
          dsl.deleteFrom(Tables.ISSUE).where(Tables.ISSUE.ID.eq(issueId)).execute();
          dsl.deleteFrom(Tables.PROJECT_MEMBER)
              .where(Tables.PROJECT_MEMBER.PROJECT_ID.eq(project.id()))
              .execute();
          dsl.deleteFrom(Tables.PROJECT).where(Tables.PROJECT.ID.eq(project.id())).execute();
        });
  }
}
