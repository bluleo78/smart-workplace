package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.when;

import com.workplace.file.api.StagedFileClaimer;
import com.workplace.file.service.FileCleanupService;
import com.workplace.file.storage.FileStore;
import com.workplace.global.security.EncryptionService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.ComposeAttachmentResponse;
import com.workplace.mail.dto.MailSendRequest;
import com.workplace.mail.dto.SendResult;
import com.workplace.mail.exception.MailSendException;
import com.workplace.mail.exception.MailValidationException;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.service.GraphTokenService;
import com.workplace.mail.service.MailComposeAttachmentService;
import com.workplace.mail.service.MailComposeService;
import com.workplace.mail.service.MailSentAttachmentRecorder;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

/**
 * 발송 트랜잭션 분리(WP-574) — 실제 커밋 경계를 봐야 하므로 테스트 트랜잭션 없이(커밋) 돈다. 시드는 {@link #cleanup} 에서 지운다.
 *
 * <ul>
 *   <li>전송 뒤 기록(SENT 행·첨부)이 실패해도 메일은 이미 나갔으므로 발송은 성공으로 응답한다(중복 발송 방지).
 *   <li>업로드 클레임은 전송 전에 커밋되고 잠금을 전송 내내 쥐지 않는다 — 같은 업로드로 동시에 보내는 두 번째 요청은 기다리지 않고 바로 거절된다.
 *   <li>전송이 실패하면 클레임을 되돌려 같은 업로드로 다시 보낼 수 있다.
 * </ul>
 */
class MailComposeSendIsolationTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired MailComposeService composeService;
  @Autowired MailComposeAttachmentService uploadService;
  @Autowired StagedFileClaimer claimer;
  @Autowired EncryptionService encryption;
  @Autowired FileCleanupService fileCleanupService;
  @Autowired FileStore fileStore;

  @MockitoBean GraphApiClient graphApiClient;
  @MockitoBean GraphTokenService graphTokenService;
  @MockitoSpyBean MailSentAttachmentRecorder recorder;

  private final List<Long> users = new ArrayList<>();
  private final List<Long> accounts = new ArrayList<>();
  private final List<Long> files = new ArrayList<>();

  @BeforeEach
  void tenant() {
    TenantContext.set(1L);
    when(graphTokenService.getAccessToken(anyLong(), anyLong())).thenReturn("FAKE_TOKEN");
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          if (!files.isEmpty()) {
            dsl.deleteFrom(FILE).where(FILE.ID.in(files)).execute();
          }
          if (!accounts.isEmpty()) {
            // email_message·email_folder 는 계정 삭제에 CASCADE
            dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.in(accounts)).execute();
          }
          if (!users.isEmpty()) {
            dsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
          }
        });
    TenantContext.clear();
  }

  /** Graph 계정 하나를 커밋해 둔다(전송은 GraphApiClient 목). */
  private long[] seedUserAndAccount() {
    long user = TestFixtures.createHuman(dsl);
    users.add(user);
    long accountId = MailTestSupport.seedGraphAccount(dsl, encryption, user);
    accounts.add(accountId);
    return new long[] {user, accountId};
  }

  private ComposeAttachmentResponse upload(long user) {
    ComposeAttachmentResponse res =
        uploadService.upload(
            user,
            new MockMultipartFile("file", "보고서.pdf", "application/pdf", new byte[] {1, 2, 3}));
    files.add(res.id());
    return res;
  }

  private static MailSendRequest request(long uploadId) {
    return new MailSendRequest(
        List.of("peer@example.com"),
        List.of(),
        List.of(),
        "첨부",
        "<p>본문</p>",
        "본문",
        null,
        null,
        List.of(uploadId),
        null);
  }

  private OffsetDateTime expiresAt(long fileId) {
    return dsl.select(FILE.EXPIRES_AT)
        .from(FILE)
        .where(FILE.ID.eq(fileId))
        .fetchOne(FILE.EXPIRES_AT);
  }

  /** 메일이 나간 뒤 보낸편지함 기록이 실패해도 발송은 성공 — 롤백돼 실패로 보이면 사용자가 다시 보내 같은 메일이 두 번 나간다. */
  @Test
  void recordFailureAfterTransmit_stillReportsSuccess() {
    long[] ua = seedUserAndAccount();
    var up = upload(ua[0]);
    doThrow(new IllegalStateException("기록 실패 주입"))
        .when(recorder)
        .record(anyLong(), anyLong(), any());

    SendResult res = composeService.send(ua[0], ua[1], request(up.id()));

    assertThat(res.messageId()).isNotBlank();
    assertThat(res.localMessageId()).isZero(); // 기록 실패 표시
    org.mockito.Mockito.verify(graphApiClient).sendMail(anyString(), anyString());
    // 기록 트랜잭션만 롤백 — SENT 행 없음, 업로드는 (클레임 트랜잭션에서 이미 커밋된) 만료 상태 그대로
    assertThat(dsl.fetchCount(EMAIL_MESSAGE, EMAIL_MESSAGE.ACCOUNT_ID.eq(ua[1]))).isZero();
    assertThat(expiresAt(up.id())).isBeforeOrEqualTo(OffsetDateTime.now());
  }

  /**
   * 첫 요청이 전송 중(클레임 커밋 뒤)일 때 같은 업로드로 보낸 두 번째 요청은 잠금을 기다리지 않고 바로 거절된다 — 이중 발송 차단 + 전송 동안 FILE 잠금 없음.
   */
  @Test
  void concurrentSendWithSameUpload_secondRejectedWhileFirstTransmits() throws Exception {
    long[] ua = seedUserAndAccount();
    var up = upload(ua[0]);
    CountDownLatch inTransmit = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    doAnswer(
            inv -> {
              inTransmit.countDown();
              release.await(30, TimeUnit.SECONDS);
              return null;
            })
        .when(graphApiClient)
        .sendMail(anyString(), anyString());

    CompletableFuture<SendResult> first =
        CompletableFuture.supplyAsync(
            () -> {
              TenantContext.set(1L);
              try {
                return composeService.send(ua[0], ua[1], request(up.id()));
              } finally {
                TenantContext.clear();
              }
            });
    try {
      assertThat(inTransmit.await(30, TimeUnit.SECONDS)).isTrue();
      // 전송 중(보류) 만료 스윕이 돌아도 업로드 행·파일은 남는다 — 실패하면 같은 업로드로 다시 보낼 수 있어야 한다
      fileCleanupService.cleanupExpiredFiles();
      var held = dsl.selectFrom(FILE).where(FILE.ID.eq(up.id())).fetchOne();
      assertThat(held).isNotNull();
      assertThat(held.getCategory()).isEqualTo(StagedFileClaimer.CATEGORY_HELD);
      assertThat(fileStore.exists(held.getStoragePath())).isTrue();

      long started = System.nanoTime();
      assertThatThrownBy(() -> composeService.send(ua[0], ua[1], request(up.id())))
          .isInstanceOf(MailValidationException.class);
      // 첫 요청이 전송에 묶여 있는 동안 기다리지 않고 거절됐다(잠금 대기였다면 release 전까지 막힌다)
      assertThat(TimeUnit.NANOSECONDS.toSeconds(System.nanoTime() - started)).isLessThan(10);
    } finally {
      release.countDown();
    }
    assertThat(first.get(30, TimeUnit.SECONDS).localMessageId()).isPositive();
    // 성공 뒤 사용 완료 — 보류(HELD) 그대로 지금 만료(다시 쓸 수 없고 스윕이 지운다)
    var consumed = dsl.selectFrom(FILE).where(FILE.ID.eq(up.id())).fetchOne();
    assertThat(consumed.getCategory()).isEqualTo(StagedFileClaimer.CATEGORY_HELD);
    assertThat(consumed.getExpiresAt()).isBeforeOrEqualTo(OffsetDateTime.now());
  }

  /** 전송이 실패하면 커밋된 클레임을 되돌려 같은 업로드로 다시 보낼 수 있다. */
  @Test
  void transmitFailure_reopensUploadForRetry() {
    long[] ua = seedUserAndAccount();
    var up = upload(ua[0]);
    doThrow(new MailSendException("Graph sendMail 실패: 503"))
        .when(graphApiClient)
        .sendMail(anyString(), anyString());

    assertThatThrownBy(() -> composeService.send(ua[0], ua[1], request(up.id())))
        .isInstanceOf(MailSendException.class);

    assertThat(expiresAt(up.id())).isAfter(OffsetDateTime.now().plusHours(23));
    assertThat(
            claimer.requireClaimable(
                ua[0], List.of(up.id()), StagedFileClaimer.Retention.PERMANENT))
        .hasSize(1);
    assertThat(dsl.fetchCount(EMAIL_MESSAGE, EMAIL_MESSAGE.ACCOUNT_ID.eq(ua[1]))).isZero();
  }
}
