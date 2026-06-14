package com.workplace.wiki.repository;

import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WIKI_PAGE;
import static com.workplace.jooq.Tables.WIKI_REFERENCE;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.support.IntegrationTestBase;
import com.workplace.wiki.dto.WikiReferenceRow;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * WikiReferenceRepository 통합 검증 — diff-replace 적재 + 백링크 조회 + 테넌트 격리(RLS).
 *
 * <p>WikiRlsTest 와 동일하게 전체를 롤백되는 단일 트랜잭션으로 수행 → 공유 DB 무오염. 트랜잭션-로컬 GUC(app.tenant_id)를 직접 셋해 RLS
 * 컨텍스트를 만든다. 리포지토리의 주입 DSLContext 는 TransactionTemplate 의 커넥션을 공유하므로 GUC 가 보인다.
 */
class WikiReferenceRepositoryTest extends IntegrationTestBase {

  @Autowired private DSLContext dsl;
  @Autowired private PlatformTransactionManager txManager;
  @Autowired private WikiReferenceRepository repository;

  /** 트랜잭션-로컬 GUC 직접 설정 헬퍼. */
  private void setGuc(long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', true)");
  }

  /** 임시 user 생성(wiki_space.owner_id 용, 고유 username/email). */
  private long createOwner() {
    String suffix = String.valueOf(System.nanoTime() % 1_000_000_000);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "wikiref-" + suffix)
        .set(USER.NAME, "WikiRef Owner")
        .set(USER.EMAIL, "wikiref-" + suffix + "@example.com")
        .set(USER.KIND, "HUMAN")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** 현재 GUC 테넌트로 TEAM 공간 생성. */
  private long createSpace(long tenantId, long ownerId) {
    return dsl.insertInto(WIKI_SPACE)
        .set(WIKI_SPACE.TYPE, "TEAM")
        .set(WIKI_SPACE.NAME, "Ref 공간")
        .set(WIKI_SPACE.OWNER_ID, ownerId)
        .set(WIKI_SPACE.TENANT_ID, tenantId)
        .returning(WIKI_SPACE.ID)
        .fetchOne()
        .getId();
  }

  /** 현재 GUC 테넌트로 공간 루트 페이지 생성. */
  private long createPage(long tenantId, long spaceId, String title) {
    return dsl.insertInto(WIKI_PAGE)
        .set(WIKI_PAGE.SPACE_ID, spaceId)
        .set(WIKI_PAGE.TITLE, title)
        .set(WIKI_PAGE.TENANT_ID, tenantId)
        .returning(WIKI_PAGE.ID)
        .fetchOne()
        .getId();
  }

  /** replaceForSource: 기존 참조를 지우고 새 목록만 남긴다(PAGE_B → PAGE_C 교체). */
  @Test
  void replaceForSource_replacesExistingRefs() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              setGuc(1L);
              long owner = createOwner();
              long space = createSpace(1L, owner);
              long src = createPage(1L, space, "Source");
              long b = createPage(1L, space, "PageB");
              long c = createPage(1L, space, "PageC");

              // PAGE_B 참조 적재
              repository.replaceForSource(src, List.of(new WikiReferenceRow(src, "PAGE", b)));
              assertThat(repository.findBacklinkSourcePageIds("PAGE", b)).containsExactly(src);

              // PAGE_C 로 교체 → B 백링크 사라지고 C 만 남음
              repository.replaceForSource(src, List.of(new WikiReferenceRow(src, "PAGE", c)));
              assertThat(repository.findBacklinkSourcePageIds("PAGE", b)).isEmpty();
              assertThat(repository.findBacklinkSourcePageIds("PAGE", c)).containsExactly(src);

              status.setRollbackOnly();
              return null;
            });
  }

  /** findBacklinkSourcePageIds: 대상을 가리키는 여러 source 페이지를 모두 반환. */
  @Test
  void findBacklinkSourcePageIds_returnsAllSources() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              setGuc(1L);
              long owner = createOwner();
              long space = createSpace(1L, owner);
              long target = createPage(1L, space, "Target");
              long src1 = createPage(1L, space, "Src1");
              long src2 = createPage(1L, space, "Src2");

              repository.replaceForSource(
                  src1, List.of(new WikiReferenceRow(src1, "PAGE", target)));
              repository.replaceForSource(
                  src2, List.of(new WikiReferenceRow(src2, "PAGE", target)));

              assertThat(repository.findBacklinkSourcePageIds("PAGE", target))
                  .containsExactlyInAnyOrder(src1, src2);

              status.setRollbackOnly();
              return null;
            });
  }

  /** PAGE 와 ISSUE 타입 혼재 적재 시 타입별 조회가 정확히 분리된다. */
  @Test
  void findBacklinkSourcePageIds_distinguishesTargetType() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              setGuc(1L);
              long owner = createOwner();
              long space = createSpace(1L, owner);
              long src = createPage(1L, space, "Source");
              long pageTarget = createPage(1L, space, "PageTarget");
              long issueTarget = 4242L; // issue.id (전역 PK, FK 없음)

              repository.replaceForSource(
                  src,
                  List.of(
                      new WikiReferenceRow(src, "PAGE", pageTarget),
                      new WikiReferenceRow(src, "ISSUE", issueTarget)));

              // PAGE 타입 조회는 페이지 대상만, ISSUE 타입 조회는 이슈 대상만
              assertThat(repository.findBacklinkSourcePageIds("PAGE", pageTarget))
                  .containsExactly(src);
              assertThat(repository.findBacklinkSourcePageIds("ISSUE", issueTarget))
                  .containsExactly(src);
              // 동일 target_id 라도 타입이 다르면 매칭 안 됨(혼동 방지)
              assertThat(repository.findBacklinkSourcePageIds("ISSUE", pageTarget)).isEmpty();

              status.setRollbackOnly();
              return null;
            });
  }

  /** 같은 (source,type,target) 중복 적재해도 UNIQUE 위반 없이 1행(onConflictDoNothing). */
  @Test
  void replaceForSource_duplicateRowsCollapseToOne() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              setGuc(1L);
              long owner = createOwner();
              long space = createSpace(1L, owner);
              long src = createPage(1L, space, "Source");
              long target = createPage(1L, space, "Target");

              // 동일 참조를 두 번 — onConflictDoNothing 으로 1행만
              repository.replaceForSource(
                  src,
                  List.of(
                      new WikiReferenceRow(src, "PAGE", target),
                      new WikiReferenceRow(src, "PAGE", target)));

              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(WIKI_REFERENCE)
                              .where(WIKI_REFERENCE.SOURCE_PAGE_ID.eq(src))))
                  .isEqualTo(1);
              assertThat(repository.findBacklinkSourcePageIds("PAGE", target)).containsExactly(src);

              status.setRollbackOnly();
              return null;
            });
  }

  /** 테넌트 격리: tenant#1 의 참조는 다른 테넌트 컨텍스트에서 백링크 조회에 안 섞인다(RLS USING). */
  @Test
  void findBacklinkSourcePageIds_isTenantIsolated() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              // 신규 테넌트(tid2) — 같은 트랜잭션 내 FK 대상(미커밋)
              long tid2 =
                  dsl.insertInto(TENANT)
                      .set(TENANT.SLUG, "rls-wikiref-" + System.nanoTime())
                      .set(TENANT.NAME, "RLS-WIKIREF")
                      .set(TENANT.STATUS, "ACTIVE")
                      .returning(TENANT.ID)
                      .fetchOne()
                      .getId();

              setGuc(1L);
              long owner = createOwner();
              long space = createSpace(1L, owner);
              long src = createPage(1L, space, "Source");
              long target = createPage(1L, space, "Target");
              repository.replaceForSource(src, List.of(new WikiReferenceRow(src, "PAGE", target)));

              // tenant#1 에서는 가시(양성 대조)
              assertThat(repository.findBacklinkSourcePageIds("PAGE", target)).containsExactly(src);

              // tenant#2 컨텍스트로 전환 → tenant#1 의 참조는 비가시
              setGuc(tid2);
              assertThat(repository.findBacklinkSourcePageIds("PAGE", target)).isEmpty();

              status.setRollbackOnly();
              return null;
            });
  }
}
