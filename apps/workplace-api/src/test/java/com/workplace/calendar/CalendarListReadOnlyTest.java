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
