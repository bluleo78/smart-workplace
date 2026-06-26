package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.Tables.USER;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.service.GraphTokenService;
import com.workplace.mail.service.MailMessageService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * 읽음 역동기화 E2E 흐름 통합 테스트.
 *
 * <p>Graph 계정 메시지(seen=false)를 시드한 뒤 {@link MailMessageService#get}을 호출해 seen=true 로 전이시키면,
 * AFTER_COMMIT @Async 리스너가 {@link GraphApiClient#patch}를 호출하는지 검증한다.
 *
 * <p><b>@Transactional 금지</b>: markSeen 은 내부 짧은 트랜잭션으로 커밋하므로, 테스트 메서드가 @Transactional 이면
 * AFTER_COMMIT 이벤트가 발화하지 않는다. 대신 @AfterEach 에서 시드된 데이터를 명시적으로 삭제한다(#512 non-tx 격리 패턴).
 *
 * <p>비동기 검증: Awaitility 의존이 없으므로 Mockito 내장 {@code timeout(ms)} 로 최대 5초 대기한다.
 */
class MailReadSyncFlowTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired MailMessageService messageService;

  /** Graph HTTP 호출 차단 + 호출 검증 대상. */
  @MockitoBean GraphApiClient graphApiClient;

  /** 실제 token 교환 차단 — FAKE_TOKEN 을 반환하도록 stubbing. */
  @MockitoBean GraphTokenService graphTokenService;

  private Long seededUser;
  private Long seededAccount;
  private Long seededMessage;

  // ── 세션 GUC 헬퍼 ──────────────────────────────────────────────────────────

  /** 세션 GUC 설정(is_local=false) — 트랜잭션 밖 시드/정리용. */
  private void setSessionGuc(long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', false)");
  }

  @AfterEach
  void cleanup() {
    // RLS-safe 삭제: cleanupInTenant 헬퍼로 GUC 주입 후 account CASCADE 삭제(folder/message 포함)
    if (seededAccount != null) {
      cleanupInTenant(
          1L,
          () -> {
            dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(seededAccount)).execute();
          });
    }
    if (seededUser != null) {
      setSessionGuc(1L);
      dsl.deleteFrom(USER).where(USER.ID.eq(seededUser)).execute();
    }
    TenantContext.clear();
  }

  /**
   * 첫 열람(seen false→true) 후 Graph PATCH 가 호출되는지 검증한다.
   *
   * <p>흐름: seedUnseenGraphMessage → TenantContext.set(1) → messageService.get() → markSeen 커밋 →
   * AFTER_COMMIT 이벤트 → @Async 리스너 → MailReadSyncDispatcher(@Transactional) → GraphReadSyncer →
   * GraphApiClient.patch (Mockito timeout 검증).
   */
  @Test
  void firstRead_graphAccount_syncsIsReadToServer() {
    // 시드: tenant 1 컨텍스트에서 사용자·Graph 계정·미읽음 메시지를 커밋
    setSessionGuc(1L);
    seededUser = TestFixtures.createHuman(dsl);
    seededAccount = MailTestSupport.seedGraphAccount(dsl, seededUser);
    seededMessage = MailTestSupport.seedUnseenGraphMessage(dsl, seededAccount, "AAGRAPHID");

    // GraphTokenService 모킹: accountId 스코프 토큰 반환
    when(graphTokenService.getAccessToken(seededUser, seededAccount)).thenReturn("FAKE_TOKEN");

    // 서비스 호출: 테넌트 컨텍스트를 세팅해 RLS GUC 주입이 동작하도록 한다
    TenantContext.set(1L);
    messageService.get(seededUser, seededMessage); // seen false→true 커밋 → AFTER_COMMIT 이벤트

    // 비동기 리스너가 Graph PATCH 를 호출하는지 최대 5초 대기
    verify(graphApiClient, org.mockito.Mockito.timeout(5_000))
        .patch(eq("FAKE_TOKEN"), eq("/me/messages/AAGRAPHID"), contains("isRead"));
  }

  /**
   * 두 번째 열람(already seen=true)에서는 이벤트가 발행되지 않아 PATCH 가 추가 호출되지 않는다.
   *
   * <p>seen=true 로 이미 DB에 있으면 markSeen 분기에 진입하지 않으므로, GraphApiClient 호출 횟수는 첫 열람의 1회에서 증가하지 않는다.
   */
  @Test
  void secondRead_alreadySeen_doesNotSyncAgain() {
    setSessionGuc(1L);
    seededUser = TestFixtures.createHuman(dsl);
    seededAccount = MailTestSupport.seedGraphAccount(dsl, seededUser);
    // seen=true 로 직접 삽입 — 첫 열람이 없었던 것처럼 시드
    long folderId =
        dsl.insertInto(EMAIL_FOLDER)
            .set(EMAIL_FOLDER.ACCOUNT_ID, seededAccount)
            .set(EMAIL_FOLDER.NAME, "INBOX")
            .returning(EMAIL_FOLDER.ID)
            .fetchOne()
            .getId();
    seededMessage =
        dsl.insertInto(EMAIL_MESSAGE)
            .set(EMAIL_MESSAGE.ACCOUNT_ID, seededAccount)
            .set(EMAIL_MESSAGE.FOLDER_ID, folderId)
            .set(EMAIL_MESSAGE.PROVIDER_MESSAGE_ID, "AAGRAPHID_SEEN")
            .set(EMAIL_MESSAGE.THREAD_ID, "thread-seen")
            .set(EMAIL_MESSAGE.SEEN, true) // 이미 읽음
            .returning(EMAIL_MESSAGE.ID)
            .fetchOne()
            .getId();

    TenantContext.set(1L);
    messageService.get(seededUser, seededMessage); // seen=true 이미라 markSeen 분기 미진입

    // PATCH 가 호출되지 않아야 한다(짧은 대기 후 0건 검증)
    org.mockito.Mockito.verifyNoInteractions(graphApiClient);
  }
}
