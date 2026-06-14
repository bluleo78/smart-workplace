package com.workplace.wiki;

import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static com.workplace.jooq.Tables.WIKI_SPACE_MEMBER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.support.IntegrationTestBase;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * V68 위키 도메인 RLS 격리 증명: tenant#1 에서 만든 wiki_space / wiki_space_member 가 다른 테넌트 GUC 컨텍스트에서 비가시.
 * 전체를 롤백되는 단일 트랜잭션으로 수행 → 공유 DB 무오염 (IssueDomainRlsTest / CalendarDomainRlsTest 패턴).
 *
 * <p>WikiSpaceService.createTeamSpace / listMySpaces 를 직접 호출하지 않는 이유: 각 서비스 메서드는 @Transactional 이라
 * 커밋되어 공유 DB 를 오염시키고, listMySpaces 는 ensurePersonalSpace 의 INSERT 로 미커밋 tenant#2 에 대한 FK 를 건드린다.
 * 모든 형제 도메인 RLS 테스트와 동일하게 정책(USING/WITH CHECK) 자체를 직접 jOOQ 로 검증한다.
 */
class WikiRlsTest extends IntegrationTestBase {

  @Autowired private DSLContext dsl;
  @Autowired private PlatformTransactionManager txManager;

  /** 트랜잭션-로컬 GUC 직접 설정 헬퍼. */
  private void setGuc(Long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', true)");
  }

  @Test
  void wikiSpace_createdInTenant1_isInvisibleInTenant2() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              // 신규 테넌트(tid2) — 같은 트랜잭션 내 FK 대상(미커밋)
              Long tid2 =
                  dsl.insertInto(TENANT)
                      .set(TENANT.SLUG, "rls-wiki-" + System.nanoTime())
                      .set(TENANT.NAME, "RLS-WIKI")
                      .set(TENANT.STATUS, "ACTIVE")
                      .returning(TENANT.ID)
                      .fetchOne()
                      .getId();

              // wiki_space.owner_id 용 임시 user (kind 기본값 HUMAN, 고유 username/email)
              String suffix = String.valueOf(System.nanoTime() % 1_000_000);
              Long ownerId =
                  dsl.insertInto(USER)
                      .set(USER.USERNAME, "rls-wiki-" + suffix)
                      .set(USER.NAME, "RLS Wiki Owner")
                      .set(USER.EMAIL, "rls-wiki-" + suffix + "@example.com")
                      .set(USER.KIND, "HUMAN")
                      .returning(USER.ID)
                      .fetchOne()
                      .getId();

              // tenant#1 컨텍스트에서 TEAM 공간 + OWNER 멤버 삽입 (RLS WITH CHECK 통과)
              setGuc(1L);
              Long spaceId =
                  dsl.insertInto(WIKI_SPACE)
                      .set(WIKI_SPACE.TYPE, "TEAM")
                      .set(WIKI_SPACE.NAME, "T1 위키")
                      .set(WIKI_SPACE.OWNER_ID, ownerId)
                      .set(WIKI_SPACE.TENANT_ID, 1L)
                      .returning(WIKI_SPACE.ID)
                      .fetchOne()
                      .getId();
              dsl.insertInto(WIKI_SPACE_MEMBER)
                  .set(WIKI_SPACE_MEMBER.SPACE_ID, spaceId)
                  .set(WIKI_SPACE_MEMBER.USER_ID, ownerId)
                  .set(WIKI_SPACE_MEMBER.ROLE, "OWNER")
                  .set(WIKI_SPACE_MEMBER.TENANT_ID, 1L)
                  .execute();

              // tenant#1 컨텍스트에서는 가시 (양성 대조 — 행이 실제로 삽입됐음을 보장)
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(WIKI_SPACE).where(WIKI_SPACE.ID.eq(spaceId))))
                  .isEqualTo(1);
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(WIKI_SPACE_MEMBER)
                              .where(WIKI_SPACE_MEMBER.SPACE_ID.eq(spaceId))))
                  .isEqualTo(1);
              // 실제 조회 경로(findMySpaces) 와 동일한 멤버 조인 — tenant#1 에서 "T1 위키" 가 보임
              assertThat(myWikiSpaceNames(ownerId)).contains("T1 위키");

              // tenant#2 컨텍스트로 전환 → tenant#1 의 공간/멤버는 비가시 (RLS USING 차단)
              setGuc(tid2);
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(WIKI_SPACE).where(WIKI_SPACE.ID.eq(spaceId))))
                  .isZero();
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(WIKI_SPACE_MEMBER)
                              .where(WIKI_SPACE_MEMBER.SPACE_ID.eq(spaceId))))
                  .isZero();
              // tenant#2 의 "내 공간 목록" 에는 tenant#1 의 "T1 위키" 가 절대 포함되지 않음
              assertThat(myWikiSpaceNames(ownerId)).doesNotContain("T1 위키");

              status.setRollbackOnly(); // 공유 DB 무오염
              return null;
            });
  }

  /** findMySpaces 와 동일한 space↔member 조인으로 현재 GUC 컨텍스트에서 보이는 공간 이름들. */
  private java.util.List<String> myWikiSpaceNames(Long userId) {
    return dsl.select(WIKI_SPACE.NAME)
        .from(WIKI_SPACE)
        .join(WIKI_SPACE_MEMBER)
        .on(WIKI_SPACE_MEMBER.SPACE_ID.eq(WIKI_SPACE.ID).and(WIKI_SPACE_MEMBER.USER_ID.eq(userId)))
        .fetch(WIKI_SPACE.NAME);
  }
}
