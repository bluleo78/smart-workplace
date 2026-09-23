package com.workplace.action;

import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.PERMISSION;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.ROLE_PERMISSION;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 사전검증(validate) 경로의 비-트랜잭션 RLS fail-closed 회귀 가드 (#842, #492 패턴).
 *
 * <p>무엇을·왜: {@code ActionService.validate} 의 {@code @Transactional} 이 빠지면 RLS GUC 가 주입되지 않아 권한
 * 행(role_permission/user_role)이 전부 걸러지고 <b>거짓 AccessDenied</b> 가 난다 — 승인 전에 사용자가 실제로 가진 권한을 "없다"고
 * 잘못 알려주는 최악의 오검증이다. {@link com.workplace.tenant.ActionConfirmRlsGuardTest} 와 같은 수법으로, 세션 디폴트
 * GUC(=1)와 다른 테넌트에 사용자/권한을 커밋해 두고 주변 트랜잭션 없이 호출해 마스킹을 깬다.
 *
 * <p>덤으로, 사전검증이 자체 트랜잭션에서 돌고 난 뒤에도(=테스트 트랜잭션 밖에서 재조회) 일정 행이 없음을 확인한다 — prepare 가 아무것도 쓰지 않는다는 사실을
 * 커밋 경계 밖에서 다시 한 번 고정한다.
 */
class ActionValidateRlsGuardTest extends IntegrationTestBase {

  /** 세션 디폴트(1)와 다른, 가드용 고정-슬러그 fixture 테넌트. 다른 가드 테스트와 슬러그를 공유하지 않는다(프로세스 병렬 실행). */
  private static final String FIXTURE_TENANT_SLUG = "rls-guard-action-validate-tenant";

  @Autowired private DSLContext dsl;
  @Autowired private ObjectMapper om;
  @Autowired private ActionService actionService;

  private Long tid2;
  private Long userId;
  private Long roleId;

  @Test
  @DisplayName("사전검증도 자체 트랜잭션에서 실행돼 거짓 403 을 내지 않고, 아무 행도 남기지 않는다")
  void validate_calendarCreateEvent_seesTenant2Permission_andLeavesNoRow() throws Exception {
    // 무엇을·왜: calendarId 를 생략해 validateCreatable 을 RBAC 권한 조회(=RLS 표면)로 환원시킨 뒤,
    // 주변 트랜잭션 없이 호출한다. GUC 가 주입되지 않으면 calendar:write 가 안 보여 AccessDenied 가 난다.
    seedFixture();

    TenantContext.set(tid2);
    JsonNode params =
        om.readTree(
            "{\"title\":\"사전검증 미팅\",\"startsAt\":\"2026-06-26T01:00:00Z\",\"endsAt\":\"2026-06-26T02:00:00Z\",\"allDay\":false}");

    assertThatCode(() -> actionService.validate(userId, "calendar.create_event", params))
        .doesNotThrowAnyException();

    // dry-run 은 자체 트랜잭션이 끝난 뒤에도 흔적을 남기지 않아야 한다 — 별도 트랜잭션에서 재조회해 확인.
    Integer created =
        new TransactionTemplate(txManager)
            .execute(
                status -> {
                  setGuc(tid2);
                  return dsl.selectCount()
                      .from(CALENDAR_EVENT)
                      .where(CALENDAR_EVENT.OWNER_ID.eq(userId))
                      .fetchOne(0, Integer.class);
                });
    assertThat(created).isZero();
  }

  /** fixture 테넌트(tid2) 아래 USER + 전용 ROLE + calendar:read/write 권한 + USER_ROLE 을 커밋. */
  private void seedFixture() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              tid2 = ensureFixtureTenant();
              // USER 는 전역(RLS 비대상) — GUC 무관하게 삽입.
              userId = TestFixtures.createHuman(dsl);

              // role/role_permission/user_role 은 RLS 대상 — GUC=2 로 tenant_id DEFAULT 가 채워지게 한다.
              setGuc(tid2);
              roleId =
                  dsl.insertInto(ROLE)
                      .set(ROLE.NAME, "rls-action-validate-role-" + userId)
                      .returning(ROLE.ID)
                      .fetchOne()
                      .getId();
              for (String code : new String[] {"calendar:read", "calendar:write"}) {
                Long permId =
                    dsl.select(PERMISSION.ID)
                        .from(PERMISSION)
                        .where(PERMISSION.CODE.eq(code))
                        .fetchOne(PERMISSION.ID);
                dsl.insertInto(ROLE_PERMISSION)
                    .set(ROLE_PERMISSION.ROLE_ID, roleId)
                    .set(ROLE_PERMISSION.PERMISSION_ID, permId)
                    .execute();
              }
              dsl.insertInto(USER_ROLE)
                  .set(USER_ROLE.USER_ID, userId)
                  .set(USER_ROLE.ROLE_ID, roleId)
                  .execute();
              return null; // 커밋(롤백 안 함)
            });
  }

  /** 고정 슬러그로 fixture 테넌트를 find-or-create(커밋). app_tenant 는 tenant DELETE 불가(V46) → 1행 누적 방지. */
  private long ensureFixtureTenant() {
    Long existing =
        dsl.select(TENANT.ID)
            .from(TENANT)
            .where(TENANT.SLUG.eq(FIXTURE_TENANT_SLUG))
            .fetchOne(TENANT.ID);
    if (existing != null) {
      return existing;
    }
    return dsl.insertInto(TENANT)
        .set(TENANT.SLUG, FIXTURE_TENANT_SLUG)
        .set(TENANT.NAME, "RLS Guard Action Validate Tenant")
        .set(TENANT.STATUS, "ACTIVE")
        .returning(TENANT.ID)
        .fetchOne()
        .getId();
  }

  /** 트랜잭션-로컬 GUC 직접 설정 헬퍼. */
  private void setGuc(Long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', true)");
  }

  /** 커밋된 권한/역할/USER 를 GUC=2 컨텍스트에서 삭제(공유 DB 무오염). fixture 테넌트만 영구 잔존(V46). */
  @AfterEach
  void cleanup() {
    TenantContext.clear();
    if (tid2 == null) {
      return;
    }
    final Long uid = userId;
    final Long rid = roleId;
    cleanupInTenant(
        tid2,
        () -> {
          if (uid != null) {
            dsl.deleteFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.OWNER_ID.eq(uid)).execute();
            dsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.eq(uid)).execute();
          }
          if (rid != null) {
            dsl.deleteFrom(ROLE_PERMISSION).where(ROLE_PERMISSION.ROLE_ID.eq(rid)).execute();
            dsl.deleteFrom(ROLE).where(ROLE.ID.eq(rid)).execute();
          }
          if (uid != null) {
            dsl.deleteFrom(USER).where(USER.ID.eq(uid)).execute(); // USER 는 RLS 비대상
          }
        });
    tid2 = null;
    userId = null;
    roleId = null;
  }
}
