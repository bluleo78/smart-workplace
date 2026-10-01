package com.workplace.mail.service;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.when;

import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * WP-151 재분석 스케줄러 — 테넌트별 GUC 로 "AI 사용 + 버전 낮음" 계정만 모으고, 실행 단계에서 그 테넌트의 TenantContext 를 주입해 계정별 재분석을
 * 호출하는지 검증한다. 서비스는 mock(LLM 차단). 공유 테스트 DB 에 다른 테스트의 계정이 남아 있을 수 있어 시드한 계정에 대해서만 단언하고, 그 외 계정은
 * false(미선점)를 돌려 실행당 상한을 쓰지 않게 한다.
 */
@DisplayName("재분석 스케줄러 — 버전 낮은 AI 계정만, 테넌트 컨텍스트 주입")
class MailReanalysisSchedulerIT extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired MailReanalysisScheduler scheduler;

  @MockitoBean MailReanalysisService reanalysis;

  /** 시드한 메일함 {userId, accountId, folderId}. */
  private final List<long[]> seeded = new ArrayList<>();

  private record Call(long userId, long accountId, Long ctx) {}

  private final List<Call> calls = Collections.synchronizedList(new ArrayList<>());

  /** 테넌트 1(세션 GUC — IntegrationTestBase 가 매 테스트 전에 1 로 맞춤)에 메일함을 커밋 시드. */
  private long[] seed(boolean aiEnabled, int version) {
    long[] m = TestFixtures.seedMailbox(dsl, "reanalysis-" + System.nanoTime() + "@test.local");
    dsl.update(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.AI_ENABLED, aiEnabled)
        .set(EMAIL_ACCOUNT.AI_CLASSIFY_VERSION, version)
        .where(EMAIL_ACCOUNT.ID.eq(m[1]))
        .execute();
    seeded.add(m);
    return m;
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          for (long[] m : seeded) {
            dsl.deleteFrom(EMAIL_FOLDER).where(EMAIL_FOLDER.ACCOUNT_ID.eq(m[1])).execute();
            dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(m[1])).execute();
            dsl.deleteFrom(USER).where(USER.ID.eq(m[0])).execute();
          }
        });
  }

  @Test
  void runPendingNow_dispatchesOnlyOutdatedAiAccounts_withTenantContext() {
    long[] outdated = seed(true, 0);
    long[] current = seed(true, MailReanalysisService.CURRENT_CLASSIFY_VERSION);
    long[] aiOff = seed(false, 0);
    when(reanalysis.reanalyzeAccountNow(anyLong(), anyLong()))
        .thenAnswer(
            inv -> {
              long accountId = inv.getArgument(1);
              calls.add(new Call(inv.getArgument(0), accountId, TenantContext.get()));
              return accountId == outdated[1]; // 시드 외 계정은 미선점 → 상한에 안 셈
            });

    scheduler.runPendingNow();

    assertThat(calls).contains(new Call(outdated[0], outdated[1], 1L));
    assertThat(calls).extracting(Call::accountId).doesNotContain(current[1], aiOff[1]);
    assertThat(TenantContext.get()).isNull(); // 실행 후 컨텍스트 누수 없음
  }
}
