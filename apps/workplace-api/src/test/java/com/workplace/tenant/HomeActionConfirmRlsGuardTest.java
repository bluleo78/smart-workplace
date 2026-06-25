package com.workplace.tenant;

import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.PERMISSION;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.ROLE_PERMISSION;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.calendar.dto.CalendarEventResponse;
import com.workplace.global.tenant.TenantContext;
import com.workplace.home.service.HomeActionService;
import com.workplace.support.IntegrationTestBase;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 홈/사이드패널 확인 카드 실행 경로의 비-트랜잭션 RLS fail-closed 회귀 가드 (#492).
 *
 * <p><b>방어 대상 버그</b>: 사이드 패널(글로벌 어시스턴트)에서 일정 등록을 요청하면 {@code calendar:write 권한 없음} (AccessDenied)이
 * 발생했다. 두 confirm 경로는 동일하게 {@code ConfirmActionDispatcher.confirm(callerId, ...)} → {@code
 * permissionChecker.hasPermission(callerId, "calendar:write")} 를 호출한다. 이 권한 조회는 RLS 가 걸린
 * role_permission / user_role 을 읽으므로 테넌트 GUC 가 필요하다. 채팅 경로({@code
 * MessagingProposalService.confirmWithBody})는 {@code @Transactional} 이라 {@code
 * TenantAwareTransactionManager.doBegin} 이 GUC 를 주입하지만, 홈 경로({@code HomeActionService.confirm})는
 * {@code @Transactional} 이 없어 GUC 가 비어 권한 행이 RLS 로 전부 걸러진다 → 빈 권한 → 거짓 AccessDenied.
 *
 * <p><b>왜 tenant#2 + 비-트랜잭션 테스트가 마스킹을 깨는가</b>: application-test.yml 이 풀 커넥션 세션 GUC 를 {@code
 * app.tenant_id=1} 로 박아 두므로, tenant#1 사용자는 GUC 가 없어도 권한이 보여 버그가 마스킹된다(기존 HomeActionServiceTest 가
 * 클래스 {@code @Transactional} + tenant#1 이라 거짓-통과하던 이유). 이 가드는 세션 디폴트(1)와 다른 tenant#2 에 사용자/역할/권한을
 * <b>커밋</b>해 두고, 주변 트랜잭션이 없는 상태로 {@code HomeActionService.confirm} 을 호출한다. 메서드에
 * {@code @Transactional} 이 있어야만 doBegin 이 GUC=2 를 LOCAL 주입해 권한이 보이고 일정이 생성된다. 어노테이션이 빠지면 세션 GUC=1 로
 * 읽어 tenant#2 권한을 못 봐 AccessDenied → CI 에서 red.
 *
 * <p><b>공유 DB 무오염</b>: 고정 슬러그 fixture 테넌트(app_tenant 는 tenant DELETE 불가, V46) 아래 커밋하고,
 * {@code @AfterEach} 가 GUC=2 컨텍스트에서 생성 일정/권한/역할/USER 를 모두 삭제한다.
 */
class HomeActionConfirmRlsGuardTest extends IntegrationTestBase {

  /** 세션 디폴트(1)와 다른, 가드용 고정-슬러그 fixture 테넌트. */
  private static final String FIXTURE_TENANT_SLUG = "rls-guard-home-confirm-tenant";

  @Autowired private DSLContext dsl;
  @Autowired private PlatformTransactionManager txManager;
  @Autowired private ObjectMapper om;
  @Autowired private HomeActionService service;

  // @AfterEach 정리용 — 시드에서 채운다.
  private Long tid2;
  private Long userId;
  private Long roleId;

  /**
   * calendar:write 를 가진 tenant#2 사용자가 사이드패널 확인 카드(calendar.create_event)를 승인하면, 주변 트랜잭션이 없어도 일정이
   * 생성돼야 한다(=HomeActionService.confirm 의 @Transactional 이 GUC=2 를 주입). 어노테이션이 빠지면 권한 조회가 세션 GUC=1 로
   * 비어 AccessDenied 가 난다.
   */
  @Test
  void confirm_calendarCreateEvent_seesTenant2Permission_whenServiceOpensOwnTx() throws Exception {
    seedFixture();

    // 호출 스레드에 주변 트랜잭션 없음 — 서비스의 @Transactional 이 GUC=2 를 LOCAL 주입해야만 권한이 보인다.
    TenantContext.set(tid2);
    JsonNode params =
        om.readTree(
            "{\"title\":\"사이드패널 미팅\",\"startsAt\":\"2026-06-26T01:00:00Z\",\"endsAt\":\"2026-06-26T02:00:00Z\",\"allDay\":false}");
    Object result = service.confirm(userId, "calendar.create_event", params);

    assertThat(result).isInstanceOf(CalendarEventResponse.class);
    assertThat(((CalendarEventResponse) result).title()).isEqualTo("사이드패널 미팅");
    assertThat(((CalendarEventResponse) result).id()).isPositive();
  }

  /** fixture 테넌트(tid2) 아래 USER + 전용 ROLE + calendar:read/write 권한 + USER_ROLE 을 커밋. */
  private void seedFixture() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              tid2 = ensureFixtureTenant();
              String suffix = String.valueOf(System.nanoTime() % 1_000_000_000L);
              // USER 는 전역(RLS 비대상) — GUC 무관하게 삽입.
              userId =
                  dsl.insertInto(USER)
                      .set(USER.USERNAME, "rls-home-confirm-" + suffix)
                      .set(USER.NAME, "Home Confirm RLS User")
                      .set(USER.EMAIL, "rls-home-confirm-" + suffix + "@example.com")
                      .set(USER.KIND, "HUMAN")
                      .returning(USER.ID)
                      .fetchOne()
                      .getId();

              // 이후 role/role_permission/user_role 은 RLS 대상 — GUC=2 로 tenant_id DEFAULT 가 채워지게 한다.
              setGuc(tid2);
              roleId =
                  dsl.insertInto(ROLE)
                      .set(ROLE.NAME, "rls-home-confirm-role-" + suffix)
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
        .set(TENANT.NAME, "RLS Guard Home Confirm Tenant")
        .set(TENANT.STATUS, "ACTIVE")
        .returning(TENANT.ID)
        .fetchOne()
        .getId();
  }

  /** 트랜잭션-로컬 GUC 직접 설정 헬퍼. */
  private void setGuc(Long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', true)");
  }

  /** 커밋된 일정/권한/역할/USER 를 GUC=2 컨텍스트에서 삭제(공유 DB 무오염). fixture 테넌트만 영구 잔존(V46). */
  @AfterEach
  void cleanup() {
    TenantContext.clear();
    if (tid2 == null) {
      return;
    }
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              setGuc(tid2); // 스코프 테이블은 RLS — GUC=2 에서만 보이고 삭제된다.
              if (userId != null) {
                dsl.deleteFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.OWNER_ID.eq(userId)).execute();
                dsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.eq(userId)).execute();
              }
              if (roleId != null) {
                dsl.deleteFrom(ROLE_PERMISSION).where(ROLE_PERMISSION.ROLE_ID.eq(roleId)).execute();
                dsl.deleteFrom(ROLE).where(ROLE.ID.eq(roleId)).execute();
              }
              if (userId != null) {
                dsl.deleteFrom(USER).where(USER.ID.eq(userId)).execute(); // USER 는 RLS 비대상
              }
              return null;
            });
    tid2 = null;
    userId = null;
    roleId = null;
  }
}
