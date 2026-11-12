package com.workplace.wiki.report;

import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.when;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.outbound.AiAgentIssueClient;
import com.workplace.issue.outbound.dto.PersonalReportAiResult;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.report.PersonalReportGenerator.Outcome;
import com.workplace.wiki.report.PersonalReportRepository.ReportRow;
import com.workplace.wiki.report.PersonalReportService.CreateResult;
import com.workplace.wiki.report.PersonalReportSettingRepository.SettingRow;
import com.workplace.wiki.report.dto.CreatePersonalReportRequest;
import com.workplace.wiki.report.dto.UpdatePersonalReportSettingsRequest;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.function.Supplier;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 여러 워크스페이스에 속한 사람의 개인 보고(WP-1486) — 멤버십·개인 공간이 워크스페이스마다 따로이므로 설정 행·회차도 워크스페이스마다 따로다. 같은 사람이 두
 * 테넌트에서 일일 보고를 켜고, 같은 회차를 수동으로 만들고, 자동 일일을 돌려도 서로 부딪치지 않고(PK·부분 unique 에 tenant_id) 각 테넌트에 제 설정·보고가
 * 남는다.
 *
 * <p>비-@Transactional — 수동 만들기는 커밋 뒤 실행기 스레드에서 돈다. 「지금」은 2026-11-12(목) 09:00 KST, 수동은 11/10, 자동은
 * 11/11.
 */
class PersonalReportMultiTenantTest extends ExternalClientMockedTestBase {

  private static final OffsetDateTime NOW = OffsetDateTime.parse("2026-11-12T09:00:00+09:00");
  private static final LocalDate MANUAL_DAY = LocalDate.parse("2026-11-10");
  private static final LocalDate AUTO_DAY = LocalDate.parse("2026-11-11");

  @Autowired DSLContext dsl;
  @Autowired PersonalReportSettingsService settingsService;
  @Autowired PersonalReportSettingRepository settings;
  @Autowired PersonalReportService service;
  @Autowired PersonalReportRepository reports;
  @Autowired PersonalReportGenerator generator;
  @Autowired AssistantResolver assistantResolver;
  @Autowired AiAgentIssueClient client;

  private long tenantA;
  private long tenantB;
  private long me;

  @BeforeEach
  void seed() {
    tenantA = defaultTenantId();
    tenantB = ensureFixtureTenant("personal-report-multi");
    me = callInTenant(tenantA, () -> TestFixtures.createHuman(dsl));
    for (long t : List.of(tenantA, tenantB)) {
      callInTenant(
          t,
          () -> {
            TestFixtures.ensureActiveMember(dsl, me, t);
            return null;
          });
    }
    when(assistantResolver.resolveOrEmpty(anyLong()))
        .thenReturn(Optional.of(new AssistantSpec(1L, "m", "low", 4, 60_000)));
    when(client.writePersonalReport(any()))
        .thenReturn(new PersonalReportAiResult("## 한 줄\n\n일을 했습니다.\n"));
  }

  @AfterEach
  void cleanup() {
    for (long t : List.of(tenantA, tenantB)) {
      cleanupInTenant(
          t,
          () -> {
            dsl.deleteFrom(table(name("personal_report")))
                .where(field(name("user_id"), Long.class).eq(me))
                .execute();
            dsl.deleteFrom(table(name("personal_report_setting")))
                .where(field(name("user_id"), Long.class).eq(me))
                .execute();
            dsl.deleteFrom(WIKI_SPACE)
                .where(WIKI_SPACE.OWNER_ID.eq(me))
                .and(WIKI_SPACE.TYPE.eq("PERSONAL"))
                .execute();
          });
    }
    cleanupInTenant(tenantA, () -> dsl.deleteFrom(USER).where(USER.ID.eq(me)).execute());
    TenantContext.clear();
  }

  /** TenantContext 를 세운 채(트랜잭션 없이) 서비스·생성기를 부른다 — 그들이 스스로 짧은 트랜잭션을 연다. */
  private <T> T as(long tenantId, Supplier<T> body) {
    TenantContext.set(tenantId);
    try {
      return body.get();
    } finally {
      TenantContext.clear();
    }
  }

  /** 실행기 스레드가 수동 회차를 끝낼 때까지(최대 30초) 기다린 뒤 그 행. */
  private ReportRow awaitFinished(long tenantId, long id) throws InterruptedException {
    for (int i = 0; i < 300; i++) {
      ReportRow row = callInTenant(tenantId, () -> reports.find(me, id).orElseThrow());
      if (!"PENDING".equals(row.status())) return row;
      Thread.sleep(100);
    }
    throw new AssertionError("수동 보고가 30초 안에 끝나지 않았다 tenant=" + tenantId);
  }

  @Test
  void sameUserInTwoTenants_settingsAndReportsAreSeparate() throws Exception {
    UpdatePersonalReportSettingsRequest on =
        new UpdatePersonalReportSettingsRequest(true, "09:00", false);
    for (long t : List.of(tenantA, tenantB)) {
      as(t, () -> settingsService.update(me, on, NOW.minusDays(1)));
    }
    // 두 테넌트 모두 제 설정 행(켜짐·템플릿)을 갖는다.
    for (long t : List.of(tenantA, tenantB)) {
      SettingRow s = callInTenant(t, () -> settings.find(me).orElseThrow());
      assertThat(s.dailyEnabled()).isTrue();
      assertThat(s.dailyTemplatePageId()).isNotNull();
    }
    long templateA =
        callInTenant(tenantA, () -> settings.find(me).orElseThrow()).dailyTemplatePageId();
    long templateB =
        callInTenant(tenantB, () -> settings.find(me).orElseThrow()).dailyTemplatePageId();
    assertThat(templateA).isNotEqualTo(templateB);

    // 같은 회차(11/10) 수동 만들기 — A 의 PENDING 이 B 를 막지 않는다(둘 다 202).
    CreatePersonalReportRequest req =
        new CreatePersonalReportRequest("DAILY", MANUAL_DAY, null, null, false);
    CreateResult inA = as(tenantA, () -> service.create(me, req, NOW));
    CreateResult inB = as(tenantB, () -> service.create(me, req, NOW));
    ReportRow manualA = awaitFinished(tenantA, inA.id());
    ReportRow manualB = awaitFinished(tenantB, inB.id());
    assertThat(manualA.status()).isEqualTo("GENERATED");
    assertThat(manualB.status()).isEqualTo("GENERATED");
    assertThat(manualA.pageId()).isNotEqualTo(manualB.pageId());

    // 자동 일일(11/11) — 두 테넌트 모두 제 회차를 만든다(uq_personal_report_auto 가 테넌트끼리 부딪치지 않음).
    for (long t : List.of(tenantA, tenantB)) {
      callInTenant(
          t,
          () ->
              dsl.update(table(name("personal_report_setting")))
                  .set(field(name("next_run_at"), OffsetDateTime.class), NOW)
                  .where(field(name("user_id"), Long.class).eq(me))
                  .execute());
    }
    assertThat(as(tenantA, () -> generator.runDaily(me, NOW))).isEqualTo(Outcome.GENERATED);
    assertThat(as(tenantB, () -> generator.runDaily(me, NOW))).isEqualTo(Outcome.GENERATED);

    for (long t : List.of(tenantA, tenantB)) {
      List<String> rows =
          callInTenant(
              t,
              () ->
                  dsl.select(
                          field(name("trigger"), String.class),
                          field(name("period_start"), LocalDate.class),
                          field(name("status"), String.class))
                      .from(table(name("personal_report")))
                      .where(field(name("user_id"), Long.class).eq(me))
                      .orderBy(field(name("id")))
                      .fetch(r -> r.value1() + " " + r.value2() + " " + r.value3()));
      assertThat(rows)
          .containsExactly(
              "MANUAL " + MANUAL_DAY + " GENERATED", "AUTO " + AUTO_DAY + " GENERATED");
      assertThat(callInTenant(t, () -> settings.find(me).orElseThrow()).consecutiveFailures())
          .isZero();
    }
  }
}
