package com.workplace.calendar;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.calendar.dto.CalendarResponse;
import com.workplace.calendar.repository.ExternalCalendarRepository;
import com.workplace.calendar.service.CalendarService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * CalendarService.list() 가 isReadOnly 필드를 올바르게 반환하는지 검증.
 *
 * <p>외부 컨테이너(is_read_only=true)와 로컬 기본 캘린더(is_read_only=false)를 동시에 생성해 두 값 모두 확인한다.
 */
class CalendarListReadOnlyTest extends IntegrationTestBase {

  @Autowired private CalendarService calendarService;
  @Autowired private ExternalCalendarRepository externalCalendarRepo;
  @Autowired private DSLContext dsl;

  private static final long TENANT_ID = 1L;

  @BeforeEach
  void setUp() {
    TenantContext.set(TENANT_ID);
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  /**
   * email_account 픽스처 생성 — ExternalCalendarRepository FK(external_account_id) 충족용.
   *
   * @param userId email_account.user_id
   * @return email_account.id
   */
  private long emailAccount(long userId) {
    long nano = System.nanoTime();
    return dsl.insertInto(
            EMAIL_ACCOUNT,
            EMAIL_ACCOUNT.USER_ID,
            EMAIL_ACCOUNT.EMAIL_ADDRESS,
            EMAIL_ACCOUNT.TENANT_ID,
            EMAIL_ACCOUNT.AI_ENABLED)
        .values(userId, "readonly-test-" + nano + "@test.local", TENANT_ID, false)
        .returning(EMAIL_ACCOUNT.ID)
        .fetchOne()
        .getId();
  }

  /**
   * 연동 캘린더는 accountEmail/provider 를 노출하고, 로컬 캘린더는 둘 다 null 이어야 한다. email_account JOIN 이 테넌트 RLS GUC
   * 아래에서 행을 보이게 하는지까지 함께 검증한다 (accountEmail 이 null 로 떨어지면 연동 캘린더가 로컬로 오분류된다).
   */
  @Test
  void list_exposes_accountEmail_and_provider_for_synced_and_null_for_local() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              long ownerId = TestFixtures.createHuman(dsl);
              String email = "synced-" + System.nanoTime() + "@iacloud.kr";
              long accountId =
                  dsl.insertInto(
                          EMAIL_ACCOUNT,
                          EMAIL_ACCOUNT.USER_ID,
                          EMAIL_ACCOUNT.EMAIL_ADDRESS,
                          EMAIL_ACCOUNT.PROVIDER,
                          EMAIL_ACCOUNT.TENANT_ID,
                          EMAIL_ACCOUNT.AI_ENABLED)
                      .values(ownerId, email, "M365_GRAPH", TENANT_ID, false)
                      .returning(EMAIL_ACCOUNT.ID)
                      .fetchOne()
                      .getId();

              // 쓰기 가능 연동 캘린더(readOnly=false) — 로컬과 isReadOnly 로는 구분 불가한 케이스
              externalCalendarRepo.upsertExternalCalendar(
                  ownerId, accountId, "extCal1", "M365 달력", "blue", false);

              List<CalendarResponse> cals = calendarService.list(ownerId);

              CalendarResponse synced =
                  cals.stream()
                      .filter(c -> c.accountEmail() != null)
                      .findFirst()
                      .orElseThrow(() -> new AssertionError("연동 캘린더를 찾지 못함 — accountEmail 이 null"));
              assertThat(synced.accountEmail()).isEqualTo(email);
              assertThat(synced.provider()).isEqualTo("M365_GRAPH");
              // readOnly=false 연동 캘린더 — isReadOnly 축과 출처 축이 섞이지 않음을 검증
              assertThat(synced.isReadOnly()).isFalse();

              CalendarResponse local =
                  cals.stream().filter(CalendarResponse::isDefault).findFirst().orElseThrow();
              assertThat(local.accountEmail()).isNull();
              assertThat(local.provider()).isNull();

              status.setRollbackOnly();
              return null;
            });
  }

  /** 외부 컨테이너는 isReadOnly=true, 로컬 기본 캘린더는 isReadOnly=false 를 반환해야 한다. */
  @Test
  void list_returns_isReadOnly_true_for_external_container_and_false_for_local() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              long ownerId = TestFixtures.createHuman(dsl);
              long accountId = emailAccount(ownerId);

              // 외부 컨테이너 생성 (is_read_only=true)
              externalCalendarRepo.upsertExternalCalendar(
                  ownerId, accountId, "extCal1", "M365 달력", "blue", true);

              // list() 호출 — 기본 캘린더 lazy 생성 + 외부 컨테이너 포함
              List<CalendarResponse> cals = calendarService.list(ownerId);

              assertThat(cals).hasSizeGreaterThanOrEqualTo(2);

              // 외부 컨테이너: isReadOnly=true
              assertThat(cals.stream().filter(CalendarResponse::isReadOnly).findFirst())
                  .as("외부 컨테이너가 isReadOnly=true 로 반환돼야 한다")
                  .isPresent();

              // 로컬 기본 캘린더: isReadOnly=false
              assertThat(cals.stream().filter(c -> c.isDefault() && !c.isReadOnly()).findFirst())
                  .as("로컬 기본 캘린더가 isReadOnly=false 로 반환돼야 한다")
                  .isPresent();

              status.setRollbackOnly();
              return null;
            });
  }
}
