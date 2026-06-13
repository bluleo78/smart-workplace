package com.workplace.contacts;

import static com.workplace.jooq.Tables.CONTACT_ENTRY;
import static com.workplace.jooq.Tables.CONTACT_FAVORITE;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_GROUP;
import static com.workplace.jooq.Tables.USER_GROUP_MEMBER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.support.IntegrationTestBase;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * V59 contacts 도메인 RLS 격리 증명: tenant#2 의
 * contact_entry/contact_favorite/user_group/user_group_member 가 tenant#1 GUC 컨텍스트에서 비가시. 더불어
 * user_group SHARED code 유니크(idx_user_group_code_shared)가 테넌트별로 동작해 두 테넌트가 같은 SHARED code 그룹을 생성할 수
 * 있음을 확인한다. 단일 트랜잭션 + 롤백 → 공유 DB 무오염.
 */
class ContactsDomainRlsTest extends IntegrationTestBase {

  @Autowired private DSLContext dsl;
  @Autowired private PlatformTransactionManager txManager;

  private void setGuc(Long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', true)");
  }

  /** 현재 GUC 컨텍스트에 SHARED user_group(code 지정) + member + contact_entry + favorite 삽입. groupId 반환. */
  private long insertContactsChain(long tenantId, long ownerId, String sharedCode) {
    Long groupId =
        dsl.insertInto(USER_GROUP)
            .set(USER_GROUP.CODE, sharedCode)
            .set(USER_GROUP.NAME, "RLS Group")
            .set(USER_GROUP.VISIBILITY, "SHARED")
            .set(USER_GROUP.TENANT_ID, tenantId)
            .returning(USER_GROUP.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(USER_GROUP_MEMBER)
        .set(USER_GROUP_MEMBER.GROUP_ID, groupId)
        .set(USER_GROUP_MEMBER.TARGET_TYPE, "MEMBER")
        .set(USER_GROUP_MEMBER.TARGET_ID, ownerId)
        .set(USER_GROUP_MEMBER.TENANT_ID, tenantId)
        .execute();
    Long contactId =
        dsl.insertInto(CONTACT_ENTRY)
            .set(CONTACT_ENTRY.NAME, "RLS Contact")
            .set(CONTACT_ENTRY.OWNER_ID, ownerId)
            .set(CONTACT_ENTRY.VISIBILITY, "PERSONAL")
            .set(CONTACT_ENTRY.TENANT_ID, tenantId)
            .returning(CONTACT_ENTRY.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(CONTACT_FAVORITE)
        .set(CONTACT_FAVORITE.OWNER_ID, ownerId)
        .set(CONTACT_FAVORITE.TARGET_TYPE, "EXTERNAL")
        .set(CONTACT_FAVORITE.TARGET_ID, contactId)
        .set(CONTACT_FAVORITE.TENANT_ID, tenantId)
        .execute();
    return groupId;
  }

  @Test
  void contactsTables_areIsolatedAndSharedCodeUniquePerTenant() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              Long tid2 =
                  dsl.insertInto(TENANT)
                      .set(TENANT.SLUG, "rls-con-" + System.nanoTime())
                      .set(TENANT.NAME, "RLS-CON")
                      .set(TENANT.STATUS, "ACTIVE")
                      .returning(TENANT.ID)
                      .fetchOne()
                      .getId();

              String suffix = String.valueOf(System.nanoTime() % 1_000_000);
              Long ownerId =
                  dsl.insertInto(USER)
                      .set(USER.USERNAME, "rls-con-" + suffix)
                      .set(USER.NAME, "RLS Con User")
                      .set(USER.EMAIL, "rls-con-" + suffix + "@example.com")
                      .set(USER.KIND, "HUMAN")
                      .returning(USER.ID)
                      .fetchOne()
                      .getId();

              String sharedCode = "CODE-" + suffix;

              // 두 테넌트가 같은 SHARED code 그룹을 생성 — 유니크가 테넌트별이라 충돌 없이 성공해야 함.
              setGuc(1L);
              long group1 = insertContactsChain(1L, ownerId, sharedCode);
              setGuc(tid2);
              long group2 = insertContactsChain(tid2, ownerId, sharedCode);

              // tid2 컨텍스트: 자기 그룹/멤버만 가시, tenant#1 행 비가시
              assertThat(dsl.fetchCount(dsl.selectFrom(USER_GROUP).where(USER_GROUP.ID.eq(group2))))
                  .isEqualTo(1);
              assertThat(dsl.fetchCount(dsl.selectFrom(USER_GROUP).where(USER_GROUP.ID.eq(group1))))
                  .isZero();
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(USER_GROUP_MEMBER)
                              .where(USER_GROUP_MEMBER.GROUP_ID.eq(group1))))
                  .isZero();
              // contact_entry/favorite 도 tid2 컨텍스트에서 tenant#1 행 비가시
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(CONTACT_ENTRY).where(CONTACT_ENTRY.OWNER_ID.eq(ownerId))))
                  .isEqualTo(1); // tid2 자기 행 1건만
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(CONTACT_FAVORITE)
                              .where(CONTACT_FAVORITE.OWNER_ID.eq(ownerId))))
                  .isEqualTo(1);

              // tenant#1 컨텍스트: 반대로 자기 그룹만 가시
              setGuc(1L);
              assertThat(dsl.fetchCount(dsl.selectFrom(USER_GROUP).where(USER_GROUP.ID.eq(group1))))
                  .isEqualTo(1);
              assertThat(dsl.fetchCount(dsl.selectFrom(USER_GROUP).where(USER_GROUP.ID.eq(group2))))
                  .isZero();

              status.setRollbackOnly();
              return null;
            });
  }

  /**
   * V60 회귀: contact_favorite 의 MEMBER 즐겨찾기는 owner_id·target_id 가 둘 다 전역 user.id 라, 같은 유저가 두 테넌트에서
   * 같은 멤버를 즐겨찾기하면 옛 PK(owner_id, target_type, target_id)로는 충돌한다. PK 에 tenant_id 를 포함(V60)했으므로 두
   * 테넌트에서 모두 삽입돼야 한다.
   */
  @Test
  void contactFavorite_memberTarget_allowedAcrossTenants() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              Long tid2 =
                  dsl.insertInto(TENANT)
                      .set(TENANT.SLUG, "rls-fav-" + System.nanoTime())
                      .set(TENANT.NAME, "RLS-FAV")
                      .set(TENANT.STATUS, "ACTIVE")
                      .returning(TENANT.ID)
                      .fetchOne()
                      .getId();

              String suffix = String.valueOf(System.nanoTime() % 1_000_000);
              Long ownerId =
                  dsl.insertInto(USER)
                      .set(USER.USERNAME, "rls-fav-" + suffix)
                      .set(USER.NAME, "RLS Fav User")
                      .set(USER.EMAIL, "rls-fav-" + suffix + "@example.com")
                      .set(USER.KIND, "HUMAN")
                      .returning(USER.ID)
                      .fetchOne()
                      .getId();

              // 동일 (owner_id, 'MEMBER', target_id) 를 두 테넌트에 각각 삽입 — V60 PK 덕에 충돌 없이 성공해야 함.
              setGuc(1L);
              int r1 =
                  dsl.insertInto(CONTACT_FAVORITE)
                      .set(CONTACT_FAVORITE.OWNER_ID, ownerId)
                      .set(CONTACT_FAVORITE.TARGET_TYPE, "MEMBER")
                      .set(CONTACT_FAVORITE.TARGET_ID, ownerId)
                      .set(CONTACT_FAVORITE.TENANT_ID, 1L)
                      .execute();
              setGuc(tid2);
              int r2 =
                  dsl.insertInto(CONTACT_FAVORITE)
                      .set(CONTACT_FAVORITE.OWNER_ID, ownerId)
                      .set(CONTACT_FAVORITE.TARGET_TYPE, "MEMBER")
                      .set(CONTACT_FAVORITE.TARGET_ID, ownerId)
                      .set(CONTACT_FAVORITE.TENANT_ID, tid2)
                      .execute();

              assertThat(r1).isEqualTo(1);
              assertThat(r2).isEqualTo(1);

              status.setRollbackOnly();
              return null;
            });
  }
}
