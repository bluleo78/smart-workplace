package com.workplace.issue;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static com.workplace.jooq.tables.IssueAiSummary.ISSUE_AI_SUMMARY;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.IssueAiSummaryRecord;
import com.workplace.issue.repository.IssueAiSummaryRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * issue_ai_summary upsert/find 왕복 검증 + RLS 테넌트 격리 증명.
 *
 * <p>케이스 1(roundtrip): 동일 이슈에 upsert 두 번 → 두 번째 값으로 덮어씌워지는지, generatedAt 이 설정되는지 확인. 케이스 2(RLS):
 * phantom 테넌트가 삽입한 행이 다른 테넌트 GUC 에서 보이지 않는지 검증(단일 트랜잭션 롤백 방식).
 */
class IssueAiSummaryRepositoryTest extends IntegrationTestBase {

  @Autowired private IssueAiSummaryRepository repo;
  @Autowired private IssueRepository issueRepository;
  @Autowired private ProjectService projectService;
  @Autowired private DSLContext dsl;
  @Autowired private PlatformTransactionManager txManager;

  // ── 케이스 1: upsert → 두 번째 호출이 첫 번째를 덮어씌움 ────────────────────────────

  /**
   * 같은 issueId 에 upsert 를 두 번 실행하면 최신 값이 반환되어야 한다. nextAction null 도 정상 저장된다. cleanupInTenant 로 공유
   * test DB 누수 방지.
   */
  @Test
  void upsert_thenFind_returnsLatest() {
    // 픽스처: 사용자 + 프로젝트 + 이슈 생성
    long userId = createUser("ais");
    TenantContext.set(1L); // tenant#1 (test DB 시드 테넌트)
    long projectId =
        projectService
            .create(userId, new CreateProjectRequest(uniqueKey("AIS"), "AIS 테스트", "x"))
            .id();
    long issueId =
        issueRepository.insert(projectId, 1, "요약 테스트 이슈", null, "MID", null, userId).id();

    try {
      // 첫 번째 upsert
      repo.upsert(issueId, "리뷰 대기 중", "리뷰어 지정");
      // 두 번째 upsert: summary 변경, nextAction null
      repo.upsert(issueId, "머지됨", null);

      IssueAiSummaryRecord found = repo.find(issueId).orElseThrow();
      assertThat(found.summary()).isEqualTo("머지됨");
      assertThat(found.nextAction()).isNull();
      assertThat(found.generatedAt()).isNotNull();
    } finally {
      // 공유 test DB(5435) 누수 방지 — RLS-안전 정리
      cleanupInTenant(1L, () -> repo.deleteByIssue(issueId));
      TenantContext.clear();
    }
  }

  // ── 케이스 2: RLS PHANTOM 격리 ────────────────────────────────────────────────────

  /**
   * 테넌트 A(tid2)가 삽입한 issue_ai_summary 행은 테넌트 B(tenant#1) GUC 에서 보이지 않는다. EventAttendeeRlsTest 패턴을
   * 미러: 단일 트랜잭션 안에서 GUC 를 전환하고 마지막에 롤백.
   */
  @Test
  void issueAiSummary_isIsolatedAcrossTenants() {
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            status -> {
              String suffix = String.valueOf(System.nanoTime() % 1_000_000);

              // phantom 테넌트(tid2) 생성 — 이 트랜잭션과 함께 롤백
              Long tid2 =
                  dsl.insertInto(TENANT)
                      .set(TENANT.SLUG, "rls-ais-" + suffix)
                      .set(TENANT.NAME, "phantom")
                      .set(TENANT.STATUS, "ACTIVE")
                      .returning(TENANT.ID)
                      .fetchOne()
                      .getId();

              // tid2 컨텍스트로 전환(GUC + TenantContext 동시 설정 — service 경유 삽입용)
              dsl.execute("SELECT set_config('app.tenant_id', '" + tid2 + "', true)");
              TenantContext.set(tid2);

              // tid2 컨텍스트에서 사용자 직접 삽입(EventAttendeeRlsTest 패턴: USER 는 RLS 비대상)
              Long ownerId =
                  dsl.insertInto(USER)
                      .set(USER.USERNAME, "rls-ais-owner-" + suffix)
                      .set(USER.PASSWORD, "pw")
                      .set(USER.NAME, "owner")
                      .set(USER.EMAIL, "rls-ais-owner-" + suffix + "@example.com")
                      .returning(USER.ID)
                      .fetchOne()
                      .getId();

              // projectService.create → IssueTypeDef 시드 포함, TenantContext 기반 tenant_id 채움
              String projKey =
                  "RA" + suffix.substring(0, Math.min(4, suffix.length())).toUpperCase();
              long projId =
                  projectService
                      .create(ownerId, new CreateProjectRequest(projKey, "RLS AIS", "x"))
                      .id();

              // issueRepository.insert 7-인자 오버로드(typeId 자동 fallback = TASK)
              long issueId =
                  issueRepository
                      .insert(projId, 9001, "rls-ais-issue-" + suffix, null, "MID", null, ownerId)
                      .id();

              // tid2 GUC 에서 issue_ai_summary 삽입 — tenant_id 는 GUC DEFAULT
              dsl.insertInto(ISSUE_AI_SUMMARY)
                  .set(ISSUE_AI_SUMMARY.ISSUE_ID, issueId)
                  .set(ISSUE_AI_SUMMARY.SUMMARY, "phantom")
                  .execute();

              // tid2 GUC: 1건 가시
              assertThat(
                      dsl.selectCount()
                          .from(ISSUE_AI_SUMMARY)
                          .where(ISSUE_AI_SUMMARY.ISSUE_ID.eq(issueId))
                          .fetchOne(0, Integer.class))
                  .isEqualTo(1);

              // tenant#1 GUC 로 전환 → tid2 행 비가시(RLS USING 차단)
              dsl.execute("SELECT set_config('app.tenant_id', '1', true)");
              assertThat(
                      dsl.selectCount()
                          .from(ISSUE_AI_SUMMARY)
                          .where(ISSUE_AI_SUMMARY.ISSUE_ID.eq(issueId))
                          .fetchOne(0, Integer.class))
                  .isEqualTo(0);

              // 공유 DB 무오염 — 단일 트랜잭션 롤백
              status.setRollbackOnly();
            });

    // TenantContext 복원(트랜잭션 내 set 이 ThreadLocal 에 잔류)
    TenantContext.clear();
  }

  // ── 헬퍼 ────────────────────────────────────────────────────────────────────────

  /** 테스트용 USER 직접 삽입. */
  private long createUser(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        baseDsl
            .insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = baseDsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    baseDsl
        .insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, id)
        .set(USER_ROLE.ROLE_ID, roleId)
        .execute();
    return id;
  }

  /** 프로젝트 key 충돌 방지용 고유 키 생성. */
  private String uniqueKey(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    String key = prefix + suffix;
    return key.substring(0, Math.min(10, key.length()));
  }
}
