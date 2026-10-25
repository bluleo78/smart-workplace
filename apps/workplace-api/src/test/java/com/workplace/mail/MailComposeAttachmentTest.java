package com.workplace.mail;

import static com.workplace.jooq.Tables.CONTENT_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.MAIL_ATTACHMENT_BLOB;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.icegreen.greenmail.configuration.GreenMailConfiguration;
import com.icegreen.greenmail.imap.ImapHostManager;
import com.icegreen.greenmail.junit5.GreenMailExtension;
import com.icegreen.greenmail.user.GreenMailUser;
import com.workplace.action.ConfirmActionDispatcher;
import com.workplace.file.api.StagedFileClaimer;
import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.ComposeAttachmentResponse;
import com.workplace.mail.dto.EmailAccountRequest;
import com.workplace.mail.dto.EmailAttachmentMeta;
import com.workplace.mail.dto.EmailMessageDetail;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.dto.MailSendRequest;
import com.workplace.mail.dto.MailSendRequest.InlineUploadRef;
import com.workplace.mail.dto.ParsedAttachment;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.dto.SendResult;
import com.workplace.mail.exception.MailSendException;
import com.workplace.mail.exception.MailValidationException;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailAttachmentRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.GraphTokenService;
import com.workplace.mail.service.MailAttachmentBlobGcSweeper;
import com.workplace.mail.service.MailAttachmentService;
import com.workplace.mail.service.MailAttachmentService.AttachmentDownload;
import com.workplace.mail.service.MailAttachmentService.GraphAttachment;
import com.workplace.mail.service.MailComposeAttachmentService;
import com.workplace.mail.service.MailComposeService;
import com.workplace.mail.service.MailMessageService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import jakarta.mail.BodyPart;
import jakarta.mail.Part;
import jakarta.mail.internet.MimeBodyPart;
import jakarta.mail.internet.MimeMessage;
import jakarta.mail.internet.MimeMultipart;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 메일 작성 첨부(WP-574) 통합 — 임시 업로드, 업로드·전달 첨부를 붙인 SMTP 발송(MIME 구조·한글 파일명·바이트), 남의·만료된 id 거절, 25MB 초과
 * 거절, 발송 성공 시 임시 업로드 만료·실패 시 유지.
 */
@Transactional
class MailComposeAttachmentTest extends IntegrationTestBase {

  @RegisterExtension
  static GreenMailExtension greenMail =
      new GreenMailExtension(MailTestPorts.SMTP_IMAP)
          .withConfiguration(
              GreenMailConfiguration.aConfig().withUser("me@test.local", "me@test.local", "pw"));

  @Autowired DSLContext dsl;
  @Autowired MailComposeService composeService;
  @Autowired MailComposeAttachmentService uploadService;
  @Autowired StagedFileClaimer claimer;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EmailAttachmentRepository attachmentRepo;
  @Autowired EncryptionService encryption;
  @Autowired MailAttachmentService attachmentService;
  @Autowired ConfirmActionDispatcher confirmDispatcher;
  @Autowired MailMessageService messageService;
  @Autowired ObjectMapper objectMapper;
  @Autowired MailAttachmentBlobGcSweeper blobGcSweeper;

  @MockitoBean GraphApiClient graphApiClient;
  @MockitoBean GraphTokenService graphTokenService;

  static final byte[] PDF = {'%', 'P', 'D', 'F', 0, 1, 2, (byte) 0xFF, 13, 10};
  static final byte[] TEXT = "첫 줄\r\n둘째 줄\n".getBytes(StandardCharsets.UTF_8);

  /** GreenMail 을 가리키는 IMAP/SMTP 계정. */
  long smtpAccount(long user) {
    EmailAccountRequest req =
        new EmailAccountRequest(
            "me@test.local",
            "나",
            "127.0.0.1",
            MailTestPorts.IMAP,
            MailSecurity.NONE,
            "me@test.local",
            "127.0.0.1",
            MailTestPorts.SMTP,
            MailSecurity.NONE,
            "me@test.local",
            "pw",
            false);
    return accountRepo.insert(user, req, encryption.encrypt("pw"));
  }

  ComposeAttachmentResponse upload(long user, String name, String type, byte[] bytes) {
    return uploadService.upload(user, new MockMultipartFile("file", name, type, bytes));
  }

  static MailSendRequest request(List<Long> attachmentIds, List<Long> forwardIds) {
    return new MailSendRequest(
        List.of("rcpt@test.local"),
        List.of(),
        List.of(),
        "첨부 메일",
        "<p>본문</p>",
        "본문",
        null,
        null,
        attachmentIds,
        forwardIds);
  }

  /**
   * Graph 계정 받은 메일 + 첨부 1건 시드. 바이트는 Graph 단건 조회 스텁이 준다(캐시 없음 → 원본 서버에서 즉시 받는 경로). @return
   * email_attachment.id
   */
  long seedForwardSource(long user, String pmid, String filename, String type, byte[] bytes) {
    // 같은 사용자의 원본을 여러 건 시드하면 Graph 계정은 하나를 재사용한다(사용자·주소 유일 제약)
    Long existing =
        dsl.select(EMAIL_ACCOUNT.ID)
            .from(EMAIL_ACCOUNT)
            .where(EMAIL_ACCOUNT.USER_ID.eq(user))
            .and(EMAIL_ACCOUNT.PROVIDER.eq("M365_GRAPH"))
            .fetchOne(EMAIL_ACCOUNT.ID);
    long accountId =
        existing != null ? existing : MailTestSupport.seedGraphAccount(dsl, encryption, user);
    when(graphTokenService.getAccessToken(eq(user), eq(accountId))).thenReturn("FAKE_TOKEN");
    long folderId = folderRepo.ensureFolder(accountId, "INBOX").id();
    ParsedMessage m =
        new ParsedMessage(
            0L,
            "src-" + pmid + "@x",
            "t-" + pmid,
            null,
            null,
            "a@x.com",
            "A",
            "me@x.com",
            null,
            "원본",
            Instant.now(),
            Instant.now(),
            true,
            true,
            null,
            null,
            null,
            List.of());
    messageRepo.upsertByProviderId(accountId, folderId, m, pmid, true);
    long messageId = messageRepo.findByProviderId(accountId, folderId, pmid).orElseThrow();
    long contentId = messageRepo.findBodyTarget(accountId, messageId).orElseThrow().contentId();
    attachmentRepo.insert(
        messageId,
        contentId,
        0,
        new ParsedAttachment(filename, type, bytes.length, null, "ATT-" + pmid));
    when(graphApiClient.get(
            any(), contains(pmid + "/attachments/ATT-" + pmid), eq(GraphAttachment.class)))
        .thenReturn(new GraphAttachment(filename, type, Base64.getEncoder().encodeToString(bytes)));
    return dsl.select(EMAIL_ATTACHMENT.ID)
        .from(EMAIL_ATTACHMENT)
        .where(EMAIL_ATTACHMENT.MESSAGE_ID.eq(messageId))
        .fetchOne(EMAIL_ATTACHMENT.ID);
  }

  OffsetDateTime expiresAt(long fileId) {
    return dsl.select(FILE.EXPIRES_AT)
        .from(FILE)
        .where(FILE.ID.eq(fileId))
        .fetchOne(FILE.EXPIRES_AT);
  }

  // ---- 업로드 ----

  @Test
  void upload_storesTemporaryStagedFileOwnedByCaller() {
    long user = TestFixtures.createHuman(dsl);

    ComposeAttachmentResponse res = upload(user, "보고서.pdf", "application/pdf", PDF);

    assertThat(res.id()).isPositive();
    assertThat(res.name()).isEqualTo("보고서.pdf");
    assertThat(res.size()).isEqualTo(PDF.length);
    assertThat(res.mimeType()).isEqualTo("application/pdf");
    assertThat(res.expiresAt()).isAfter(OffsetDateTime.now().plusHours(23));
    var row = dsl.selectFrom(FILE).where(FILE.ID.eq(res.id())).fetchOne();
    assertThat(row.getUploadedBy()).isEqualTo(user);
    assertThat(row.getCategory()).isEqualTo(StagedFileClaimer.CATEGORY_ATTACHMENT);
    // 메일 캐시 GC 의 고아 백스톱(tenant-*/mail)에 걸리지 않는 staged 경로
    assertThat(row.getStoragePath()).contains("/staged/");
    // 스테이징 규칙으로 클레임 가능 = 발송에 쓸 수 있다
    assertThat(
            claimer.requireClaimable(
                user, List.of(res.id()), StagedFileClaimer.Retention.PERMANENT))
        .hasSize(1);
  }

  @Test
  void upload_over25mb_rejected() {
    long user = TestFixtures.createHuman(dsl);
    byte[] big = new byte[25 * 1024 * 1024 + 1];

    assertThatThrownBy(() -> upload(user, "big.bin", "application/octet-stream", big))
        .isInstanceOf(MailValidationException.class)
        .hasMessageContaining("25MB");
  }

  @Test
  void upload_malformedBrowserType_fallsBackToOctetStream() {
    long user = TestFixtures.createHuman(dsl);

    ComposeAttachmentResponse res = upload(user, "x.unknownext", "*/*", PDF);

    assertThat(res.mimeType()).isEqualTo("application/octet-stream");
  }

  // ---- 발송 ----

  /** 업로드 첨부 2개(한글 파일명 포함) → multipart/mixed, 파일명·타입·바이트 일치, 발송 성공 뒤 임시 업로드는 만료된다. */
  @Test
  void send_withUploads_smtpMixedMimeWithKoreanNameAndExactBytes() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = smtpAccount(user);
    var pdf = upload(user, "견적서 최종.pdf", "application/pdf", PDF);
    var txt = upload(user, "메모.txt", "text/plain", TEXT);

    composeService.send(user, accountId, request(List.of(pdf.id(), txt.id()), null));

    MimeMessage received = greenMail.getReceivedMessages()[0];
    assertThat(received.isMimeType("multipart/mixed")).isTrue();
    MimeMultipart mixed = (MimeMultipart) received.getContent();
    assertThat(mixed.getCount()).isEqualTo(3);
    assertThat(mixed.getBodyPart(0).isMimeType("multipart/alternative")).isTrue();
    BodyPart a = mixed.getBodyPart(1);
    assertThat(a.getDisposition()).isEqualToIgnoringCase(Part.ATTACHMENT);
    assertThat(a.getFileName()).isEqualTo("견적서 최종.pdf");
    assertThat(a.isMimeType("application/pdf")).isTrue();
    assertThat(a.getInputStream().readAllBytes()).isEqualTo(PDF);
    BodyPart b = mixed.getBodyPart(2);
    assertThat(b.getFileName()).isEqualTo("메모.txt");
    assertThat(b.getInputStream().readAllBytes()).isEqualTo(TEXT);

    // 발송 성공 → 임시 업로드 만료(다시 쓸 수 없고 만료 스윕이 지운다)
    assertThat(expiresAt(pdf.id())).isBeforeOrEqualTo(OffsetDateTime.now());
    assertThatThrownBy(() -> composeService.send(user, accountId, request(List.of(pdf.id()), null)))
        .isInstanceOf(MailValidationException.class);
  }

  // ---- 본문에 붙여 넣은 이미지(WP-947) ----

  static final byte[] PNG = {(byte) 0x89, 'P', 'N', 'G', 13, 10, 26, 10, 0, 0, 0, 13};

  /** 업로드 + 그 가운데 본문 인라인으로 쓸 것. 본문은 cid 로 참조한다. */
  static MailSendRequest inlineRequest(List<Long> attachmentIds, List<InlineUploadRef> inline) {
    return new MailSendRequest(
        List.of("rcpt@test.local"),
        List.of(),
        List.of(),
        "캡처 붙여넣기",
        "<p>화면입니다</p><img src=\"cid:paste-1@genia\">",
        "화면입니다",
        null,
        null,
        attachmentIds,
        null,
        null,
        inline);
  }

  /** 붙여 넣은 이미지는 일반 첨부가 아니라 related 안의 인라인 파트(같은 Content-ID)로 가고, 나머지 업로드는 그대로 첨부다. */
  @Test
  void send_withInlineUpload_goesAsCidInlinePartNotAttachment() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = smtpAccount(user);
    var png = upload(user, "image.png", "image/png", PNG);
    var pdf = upload(user, "견적서.pdf", "application/pdf", PDF);

    composeService.send(
        user,
        accountId,
        inlineRequest(
            List.of(png.id(), pdf.id()), List.of(new InlineUploadRef(png.id(), "paste-1@genia"))));

    MimeMultipart mixed = (MimeMultipart) greenMail.getReceivedMessages()[0].getContent();
    // mixed[ related[ alternative, 인라인 png ], pdf ] — png 는 첨부 목록에 없다
    assertThat(mixed.getCount()).isEqualTo(2);
    assertThat(mixed.getBodyPart(0).isMimeType("multipart/related")).isTrue();
    MimeMultipart related = (MimeMultipart) mixed.getBodyPart(0).getContent();
    assertThat(related.getCount()).isEqualTo(2);
    MimeBodyPart image = (MimeBodyPart) related.getBodyPart(1);
    assertThat(image.getContentID()).isEqualTo("<paste-1@genia>");
    assertThat(image.getDisposition()).isEqualToIgnoringCase(Part.INLINE);
    assertThat(image.isMimeType("image/png")).isTrue();
    assertThat(image.getInputStream().readAllBytes()).isEqualTo(PNG);
    assertThat(mixed.getBodyPart(1).getFileName()).isEqualTo("견적서.pdf");
    // 붙여 넣은 이미지도 업로드라 발송 뒤 만료된다
    assertThat(expiresAt(png.id())).isBeforeOrEqualTo(OffsetDateTime.now());
  }

  /** attachmentIds 에 없는 업로드를 인라인으로 지목하면 거절 — 클레임·소비 경로를 건너뛰지 못하게. */
  @Test
  void send_inlineUploadNotInAttachmentIds_rejected() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = smtpAccount(user);
    var png = upload(user, "image.png", "image/png", PNG);

    assertThatThrownBy(
            () ->
                composeService.send(
                    user,
                    accountId,
                    inlineRequest(
                        List.of(), List.of(new InlineUploadRef(png.id(), "paste-1@genia")))))
        .isInstanceOf(MailValidationException.class)
        .hasMessageContaining("본문 이미지");
    assertThat(greenMail.getReceivedMessages()).isEmpty();
  }

  /** 이미지가 아닌 업로드·잘못된 Content-ID 는 인라인으로 보내지 않는다. */
  @Test
  void send_inlineUploadNotImageOrBadContentId_rejected() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = smtpAccount(user);
    var pdf = upload(user, "a.pdf", "application/pdf", PDF);
    var png = upload(user, "image.png", "image/png", PNG);

    assertThatThrownBy(
            () ->
                composeService.send(
                    user,
                    accountId,
                    inlineRequest(
                        List.of(pdf.id()),
                        List.of(new InlineUploadRef(pdf.id(), "paste-1@genia")))))
        .isInstanceOf(MailValidationException.class)
        .hasMessageContaining("이미지 파일이 아닙니다");
    assertThatThrownBy(
            () ->
                composeService.send(
                    user,
                    accountId,
                    inlineRequest(
                        List.of(png.id()), List.of(new InlineUploadRef(png.id(), "a b<c>")))))
        .isInstanceOf(MailValidationException.class)
        .hasMessageContaining("본문 이미지 참조");
    assertThat(greenMail.getReceivedMessages()).isEmpty();
  }

  /** SVG 같은 활성 내용 형식은 image/* 라도 본문 이미지로 받지 않는다 — 웹 작성창과 같은 4형식만. */
  @Test
  void send_inlineUploadSvg_rejected() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = smtpAccount(user);
    var svg = upload(user, "a.svg", "image/svg+xml", "<svg/>".getBytes(StandardCharsets.UTF_8));

    assertThatThrownBy(
            () ->
                composeService.send(
                    user,
                    accountId,
                    inlineRequest(
                        List.of(svg.id()),
                        List.of(new InlineUploadRef(svg.id(), "paste-1@genia")))))
        .isInstanceOf(MailValidationException.class)
        .hasMessageContaining("이미지 파일이 아닙니다");
  }

  /** 전달 원본 첨부 — 캐시에 없으면 원본 서버(Graph)에서 즉시 받아 일반 첨부로 붙인다. */
  @Test
  void send_withForwardAttachment_fetchesOriginalAndAttaches() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = smtpAccount(user);
    long fwd = seedForwardSource(user, "F1", "원본 계약서.pdf", "application/pdf", PDF);
    var txt = upload(user, "추가.txt", "text/plain", TEXT);

    composeService.send(user, accountId, request(List.of(txt.id()), List.of(fwd)));

    MimeMultipart mixed = (MimeMultipart) greenMail.getReceivedMessages()[0].getContent();
    assertThat(mixed.getCount()).isEqualTo(3);
    // 전달 원본이 먼저, 업로드가 다음
    assertThat(mixed.getBodyPart(1).getFileName()).isEqualTo("원본 계약서.pdf");
    assertThat(mixed.getBodyPart(1).getInputStream().readAllBytes()).isEqualTo(PDF);
    assertThat(mixed.getBodyPart(2).getFileName()).isEqualTo("추가.txt");
  }

  @Test
  void send_otherUsersUpload_rejected() {
    long owner = TestFixtures.createHuman(dsl);
    long me = TestFixtures.createHuman(dsl);
    long accountId = smtpAccount(me);
    var theirs = upload(owner, "a.pdf", "application/pdf", PDF);

    assertThatThrownBy(
            () -> composeService.send(me, accountId, request(List.of(theirs.id()), null)))
        .isInstanceOf(MailValidationException.class)
        .hasMessageContaining("다시 올려");
    assertThatThrownBy(
            () ->
                composeService.validateSendable(me, accountId, request(List.of(theirs.id()), null)))
        .isInstanceOf(MailValidationException.class);
    assertThat(greenMail.getReceivedMessages()).isEmpty();
  }

  @Test
  void send_expiredUpload_rejected() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = smtpAccount(user);
    var up = upload(user, "a.pdf", "application/pdf", PDF);
    dsl.update(FILE)
        .set(FILE.EXPIRES_AT, OffsetDateTime.now().minusMinutes(1))
        .where(FILE.ID.eq(up.id()))
        .execute();

    assertThatThrownBy(() -> composeService.send(user, accountId, request(List.of(up.id()), null)))
        .isInstanceOf(MailValidationException.class);
    assertThat(greenMail.getReceivedMessages()).isEmpty();
  }

  @Test
  void send_otherUsersForwardAttachment_rejected() {
    long owner = TestFixtures.createHuman(dsl);
    long me = TestFixtures.createHuman(dsl);
    long accountId = smtpAccount(me);
    long theirs = seedForwardSource(owner, "F2", "x.pdf", "application/pdf", PDF);

    assertThatThrownBy(() -> composeService.send(me, accountId, request(null, List.of(theirs))))
        .isInstanceOf(MailValidationException.class)
        .hasMessageContaining("원본 첨부");
    assertThat(greenMail.getReceivedMessages()).isEmpty();
  }

  /** 메타 합계로 25MB 를 넘으면 바이트를 읽기 전에(사전검증 포함) 거절한다. */
  @Test
  void send_totalOver25mbByMeta_rejectedBeforeSend() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = smtpAccount(user);
    var a = upload(user, "a.bin", "application/octet-stream", PDF);
    var b = upload(user, "b.bin", "application/octet-stream", PDF);
    // 디스크 바이트 없이 메타 크기만 키운다 — 사전검증이 메타로 거르는지 본다
    dsl.update(FILE)
        .set(FILE.SIZE_BYTES, 13L * 1024 * 1024)
        .where(FILE.ID.in(a.id(), b.id()))
        .execute();

    assertThatThrownBy(
            () ->
                composeService.validateSendable(
                    user, accountId, request(List.of(a.id(), b.id()), null)))
        .isInstanceOf(MailValidationException.class)
        .hasMessageContaining("25MB");
    assertThatThrownBy(
            () -> composeService.send(user, accountId, request(List.of(a.id(), b.id()), null)))
        .isInstanceOf(MailValidationException.class)
        .hasMessageContaining("25MB");
    assertThat(greenMail.getReceivedMessages()).isEmpty();
  }

  /** 메타 크기는 작아도(IMAP 추정·0) 실제 바이트가 25MB 를 넘으면 전송 전에 거절한다. */
  @Test
  void send_totalOver25mbByActualBytes_rejectedBeforeSend() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = smtpAccount(user);
    byte[] big = new byte[25 * 1024 * 1024 + 10];
    long fwd = seedForwardSource(user, "F3", "big.bin", "application/octet-stream", big);
    dsl.execute(
        "UPDATE content_attachment SET size_bytes = 1 WHERE id = (SELECT content_attachment_id"
            + " FROM email_attachment WHERE id = "
            + fwd
            + ")");

    assertThatThrownBy(() -> composeService.send(user, accountId, request(null, List.of(fwd))))
        .isInstanceOf(MailValidationException.class)
        .hasMessageContaining("25MB");
    assertThat(greenMail.getReceivedMessages()).isEmpty();
  }

  /** 메타 크기가 0(미상)인 큰 전달 원본 — 받은 바이트로 25MB 를 넘는 즉시 중단하고, 뒤 원본은 받지 않는다. */
  @Test
  void send_forwardWithZeroMetaSize_abortsAtFirstOverflowWithoutFetchingRest() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = smtpAccount(user);
    long big =
        seedForwardSource(
            user, "F6", "big.bin", "application/octet-stream", new byte[25 * 1024 * 1024 + 1]);
    long next = seedForwardSource(user, "F7", "next.pdf", "application/pdf", PDF);
    dsl.execute(
        "UPDATE content_attachment SET size_bytes = 0 WHERE id IN (SELECT content_attachment_id"
            + " FROM email_attachment WHERE id IN ("
            + big
            + ","
            + next
            + "))");

    assertThatThrownBy(
            () -> composeService.send(user, accountId, request(null, List.of(big, next))))
        .isInstanceOf(MailValidationException.class)
        .hasMessageContaining("25MB");
    verify(graphApiClient, never())
        .get(any(), contains("F7/attachments/ATT-F7"), eq(GraphAttachment.class));
    assertThat(greenMail.getReceivedMessages()).isEmpty();
  }

  /** 캐시에 있는 원본은 그 실제 크기로 받기 전에 판정한다 — 메타가 0 이어도 원본 서버에서 받지 않고 거절. */
  @Test
  void send_cachedForwardOverBudget_rejectedBeforeDownload() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = smtpAccount(user);
    long fwd =
        seedForwardSource(
            user, "F8", "cached.bin", "application/octet-stream", new byte[10 * 1024 * 1024]);
    attachmentService.download(user, fwd); // 캐시 등록(실제 크기 10MB 기록)
    dsl.execute(
        "UPDATE content_attachment SET size_bytes = 0 WHERE id = (SELECT content_attachment_id"
            + " FROM email_attachment WHERE id = "
            + fwd
            + ")");
    var up = upload(user, "big.bin", "application/octet-stream", new byte[20 * 1024 * 1024]);
    clearInvocations(graphApiClient);

    assertThatThrownBy(
            () -> composeService.send(user, accountId, request(List.of(up.id()), List.of(fwd))))
        .isInstanceOf(MailValidationException.class)
        .hasMessageContaining("25MB");
    verify(graphApiClient, never()).get(any(), any(), eq(GraphAttachment.class));
  }

  /** 전송이 실패하면 트랜잭션이 롤백돼 임시 업로드는 그대로 남는다 — 같은 id 로 다시 보낼 수 있다. */
  @Test
  void send_transmitFails_uploadStaysClaimableForRetry() {
    long user = TestFixtures.createHuman(dsl);
    // 같은 사용자의 원본을 여러 건 시드하면 Graph 계정은 하나를 재사용한다(사용자·주소 유일 제약)
    Long existing =
        dsl.select(EMAIL_ACCOUNT.ID)
            .from(EMAIL_ACCOUNT)
            .where(EMAIL_ACCOUNT.USER_ID.eq(user))
            .and(EMAIL_ACCOUNT.PROVIDER.eq("M365_GRAPH"))
            .fetchOne(EMAIL_ACCOUNT.ID);
    long accountId =
        existing != null ? existing : MailTestSupport.seedGraphAccount(dsl, encryption, user);
    when(graphTokenService.getAccessToken(eq(user), anyLong())).thenReturn("FAKE_TOKEN");
    doThrow(new MailSendException("Graph sendMail 실패: 503"))
        .when(graphApiClient)
        .sendMail(any(), any());
    var up = upload(user, "a.pdf", "application/pdf", PDF);
    OffsetDateTime before = expiresAt(up.id());

    // 세이브포인트(NESTED)로 감싸 send 의 롤백을 이 테스트 트랜잭션 안에서 재현한다.
    TransactionTemplate nested = new TransactionTemplate(txManager);
    nested.setPropagationBehavior(TransactionDefinition.PROPAGATION_NESTED);
    assertThatThrownBy(
            () ->
                nested.executeWithoutResult(
                    s -> composeService.send(user, accountId, request(List.of(up.id()), null))))
        .isInstanceOf(MailSendException.class);

    assertThat(expiresAt(up.id())).isEqualTo(before);
    assertThat(
            claimer.requireClaimable(user, List.of(up.id()), StagedFileClaimer.Retention.PERMANENT))
        .hasSize(1);
  }

  /** 새 필드 없이 보내는 기존 경로 — 첨부 없는 multipart/alternative 그대로(AI 확인카드 등 기존 호출처 회귀). */
  @Test
  void send_withoutNewFields_keepsAlternativeOnly() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = smtpAccount(user);
    MailSendRequest legacy =
        new MailSendRequest(
            List.of("rcpt@test.local"), List.of(), List.of(), "기존", "<p>x</p>", "x", null);

    composeService.validateSendable(user, accountId, legacy);
    composeService.send(user, accountId, legacy);

    assertThat(greenMail.getReceivedMessages()[0].isMimeType("multipart/alternative")).isTrue();
  }

  // ---- 보낸 메일 첨부 기록(insertSent) ----

  /** 로컬 SENT 행의 첨부 id 를 순서대로. */
  List<Long> sentAttachmentIds(long localMessageId) {
    return dsl.select(EMAIL_ATTACHMENT.ID)
        .from(EMAIL_ATTACHMENT)
        .where(EMAIL_ATTACHMENT.MESSAGE_ID.eq(localMessageId))
        .orderBy(EMAIL_ATTACHMENT.ORDINAL)
        .fetch(EMAIL_ATTACHMENT.ID);
  }

  /** email_attachment 의 content_hash(첨부 캐시 키). */
  String hashOf(long attachmentId) {
    return dsl.select(CONTENT_ATTACHMENT.CONTENT_HASH)
        .from(EMAIL_ATTACHMENT)
        .join(CONTENT_ATTACHMENT)
        .on(CONTENT_ATTACHMENT.ID.eq(EMAIL_ATTACHMENT.CONTENT_ATTACHMENT_ID))
        .where(EMAIL_ATTACHMENT.ID.eq(attachmentId))
        .fetchOne(CONTENT_ATTACHMENT.CONTENT_HASH);
  }

  /** 보낸 메일도 받은 메일처럼 첨부 목록(이름·크기·타입)이 남고, 원본 서버 없이 바로 내려받을 수 있다. */
  @Test
  void send_recordsSentAttachments_downloadableLikeReceived() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = smtpAccount(user);
    long fwd = seedForwardSource(user, "F4", "원본.pdf", "application/pdf", PDF);
    var txt = upload(user, "메모.txt", "text/plain", TEXT);

    SendResult res = composeService.send(user, accountId, request(List.of(txt.id()), List.of(fwd)));

    assertThat(
            dsl.select(EMAIL_MESSAGE.HAS_ATTACHMENT)
                .from(EMAIL_MESSAGE)
                .where(EMAIL_MESSAGE.ID.eq(res.localMessageId()))
                .fetchOne(EMAIL_MESSAGE.HAS_ATTACHMENT))
        .isTrue();
    List<Long> ids = sentAttachmentIds(res.localMessageId());
    assertThat(ids).hasSize(2);
    var metas =
        dsl.select(
                CONTENT_ATTACHMENT.FILENAME,
                CONTENT_ATTACHMENT.CONTENT_TYPE,
                CONTENT_ATTACHMENT.SIZE_BYTES,
                CONTENT_ATTACHMENT.CONTENT_HASH)
            .from(EMAIL_ATTACHMENT)
            .join(CONTENT_ATTACHMENT)
            .on(CONTENT_ATTACHMENT.ID.eq(EMAIL_ATTACHMENT.CONTENT_ATTACHMENT_ID))
            .where(EMAIL_ATTACHMENT.MESSAGE_ID.eq(res.localMessageId()))
            .orderBy(EMAIL_ATTACHMENT.ORDINAL)
            .fetch();
    assertThat(metas.get(0).value1()).isEqualTo("원본.pdf");
    assertThat(metas.get(0).value3()).isEqualTo(PDF.length);
    assertThat(metas.get(1).value1()).isEqualTo("메모.txt");
    assertThat(metas.get(1).value2()).isEqualTo("text/plain");
    assertThat(metas.get(1).value3()).isEqualTo(TEXT.length);
    assertThat(metas).allSatisfy(r -> assertThat(r.value4()).hasSize(64));

    // 보낸편지함 상세(웹이 부르는 경로)가 첨부 목록을 돌려준다 — id 는 다운로드 경로와 같은 email_attachment.id
    EmailMessageDetail detail = messageService.get(user, res.localMessageId(), false);
    assertThat(detail.attachments())
        .extracting(
            EmailAttachmentMeta::id, EmailAttachmentMeta::filename, EmailAttachmentMeta::sizeBytes)
        .containsExactly(
            org.assertj.core.groups.Tuple.tuple(ids.get(0), "원본.pdf", (long) PDF.length),
            org.assertj.core.groups.Tuple.tuple(ids.get(1), "메모.txt", (long) TEXT.length));

    AttachmentDownload a = attachmentService.download(user, ids.get(0));
    assertThat(a.content()).isEqualTo(PDF);
    assertThat(a.filename()).isEqualTo("원본.pdf");
    AttachmentDownload b = attachmentService.download(user, ids.get(1));
    assertThat(b.content()).isEqualTo(TEXT);
    assertThat(b.contentType()).isEqualTo("text/plain");
  }

  /** 오래 열지 않아도(TTL 지남) 보낸 메일 첨부 blob 은 GC 가 지우지 않는다 — 다시 받을 원본 서버 좌표가 없는 유일한 사본이다. */
  @Test
  void sentAttachmentBlob_survivesTtlSweep() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = smtpAccount(user);
    var txt = upload(user, "보관.txt", "text/plain", TEXT);
    SendResult res = composeService.send(user, accountId, request(List.of(txt.id()), null));
    long attId = sentAttachmentIds(res.localMessageId()).get(0);
    // 이 첨부의 blob 만 늙힌다 — 공유 테스트 DB 의 다른 blob 파일을 스윕이 지우지 않게.
    dsl.update(MAIL_ATTACHMENT_BLOB)
        .set(MAIL_ATTACHMENT_BLOB.LAST_ACCESSED_AT, OffsetDateTime.now().minusDays(365))
        .where(MAIL_ATTACHMENT_BLOB.CONTENT_HASH.eq(hashOf(attId)))
        .execute();

    blobGcSweeper.sweepTenant();

    assertThat(attachmentService.download(user, attId).content()).isEqualTo(TEXT);
  }

  /** 받은 메일 캐시 blob 은 그대로 TTL 로 퇴거된다(원본 서버에서 다시 받으면 된다) — 보낸 메일 예외가 일반 캐시로 번지지 않는지. */
  @Test
  void receivedCacheBlob_stillEvictedByTtl() {
    long user = TestFixtures.createHuman(dsl);
    long fwd = seedForwardSource(user, "F5", "r.pdf", "application/pdf", PDF);
    attachmentService.download(user, fwd); // 캐시 등록
    String hash = hashOf(fwd);
    dsl.update(MAIL_ATTACHMENT_BLOB)
        .set(MAIL_ATTACHMENT_BLOB.LAST_ACCESSED_AT, OffsetDateTime.now().minusDays(365))
        .where(MAIL_ATTACHMENT_BLOB.CONTENT_HASH.eq(hash))
        .execute();

    blobGcSweeper.sweepTenant();

    assertThat(dsl.fetchExists(MAIL_ATTACHMENT_BLOB, MAIL_ATTACHMENT_BLOB.CONTENT_HASH.eq(hash)))
        .isFalse();
  }

  /** IMAP 계정은 같은 MIME 을 서버 Sent 폴더에 APPEND 한다 — 첨부가 들어 있는지 확인한다. */
  @Test
  void send_imapAppendToSentFolder_includesAttachments() throws Exception {
    GreenMailUser gmUser = greenMail.getUserManager().getUser("me@test.local");
    ImapHostManager imap = greenMail.getManagers().getImapHostManager();
    imap.createMailbox(gmUser, "Sent");
    long user = TestFixtures.createHuman(dsl);
    long accountId = smtpAccount(user);
    var pdf = upload(user, "한글 첨부.pdf", "application/pdf", PDF);

    composeService.send(user, accountId, request(List.of(pdf.id()), null));

    var sent = imap.getFolder(gmUser, "Sent").getMessages();
    assertThat(sent).hasSize(1);
    MimeMessage appended = sent.get(0).getMimeMessage();
    assertThat(appended.isMimeType("multipart/mixed")).isTrue();
    BodyPart att = ((MimeMultipart) appended.getContent()).getBodyPart(1);
    assertThat(att.getFileName()).isEqualTo("한글 첨부.pdf");
    assertThat(att.getInputStream().readAllBytes()).isEqualTo(PDF);
  }

  // ---- AI 확인카드(mail.send) 경로 ----

  /** 새 필드 없는 AI 확인카드 params — 사전검증·승인 실행이 지금처럼 첨부 없이 보낸다(회귀). */
  @Test
  void confirmCard_mailSend_withoutNewFields_sendsAsBefore() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = smtpAccount(user);
    ObjectNode p = objectMapper.createObjectNode();
    p.put("accountId", accountId);
    p.putArray("to").add("rcpt@test.local");
    p.put("subject", "AI 카드");
    p.put("bodyHtml", "<p>본문</p>");
    p.put("bodyText", "본문");

    confirmDispatcher.validate(user, "mail.send", p);
    confirmDispatcher.confirm(user, "mail.send", p);

    MimeMessage received = greenMail.getReceivedMessages()[0];
    assertThat(received.getSubject()).isEqualTo("AI 카드");
    assertThat(received.isMimeType("multipart/alternative")).isTrue();
  }

  /**
   * AI 확인카드 mail.send 는 첨부 필드를 받지 않는다 — 확인카드가 첨부를 보여 주지 않아, 메일에 심은 지시로 AI 가 민감한 첨부를 몰래 붙여 내보내는 길을
   * 막는다(모르는 필드로 사전검증에서 400).
   */
  @Test
  void confirmCard_mailSend_rejectsAttachmentFields() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = smtpAccount(user);
    var mine = upload(user, "a.pdf", "application/pdf", PDF);
    long fwd = seedForwardSource(user, "F9", "민감.pdf", "application/pdf", PDF);

    for (String field : List.of("attachmentIds", "forwardAttachmentIds")) {
      ObjectNode p = objectMapper.createObjectNode();
      p.put("accountId", accountId);
      p.putArray("to").add("rcpt@test.local");
      p.put("subject", "x");
      p.put("bodyText", "x");
      p.putArray(field).add(field.equals("attachmentIds") ? mine.id() : fwd);

      assertThatThrownBy(() -> confirmDispatcher.validate(user, "mail.send", p))
          .isInstanceOf(IllegalArgumentException.class)
          .hasMessageContaining(field);
      assertThatThrownBy(() -> confirmDispatcher.confirm(user, "mail.send", p))
          .isInstanceOf(IllegalArgumentException.class);
    }
    assertThat(greenMail.getReceivedMessages()).isEmpty();
  }

  /** AI 확인카드 mail.send 는 인용문 이미지(inlineImages)도 받지 않는다 — 카드에 보이지 않는 이미지 첨부를 cid 파트로 내보내는 길을 막는다. */
  @Test
  void confirmCard_mailSend_rejectsInlineImages() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = smtpAccount(user);
    long img = seedForwardSource(user, "F10", "사진.png", "image/png", PDF);
    ObjectNode p = objectMapper.createObjectNode();
    p.put("accountId", accountId);
    p.putArray("to").add("rcpt@test.local");
    p.put("subject", "x");
    p.put("bodyHtml", "<img src=\"cid:x.png\">");
    p.put("bodyText", "x");
    ObjectNode ref = p.putArray("inlineImages").addObject();
    ref.put("attachmentId", img);
    ref.put("contentId", "x.png");

    assertThatThrownBy(() -> confirmDispatcher.validate(user, "mail.send", p))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("inlineImages");
    assertThatThrownBy(() -> confirmDispatcher.confirm(user, "mail.send", p))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(greenMail.getReceivedMessages()).isEmpty();
  }

  /** Graph 초안 경로에서 Exchange 가 붙인 Message-ID 로 로컬 SENT 행과 응답을 남긴다(받는 사람 답장이 스레드로 묶이게). */
  @Test
  void send_graphLargeMail_recordsExchangeMessageId() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.seedGraphAccount(dsl, encryption, user);
    when(graphTokenService.getAccessToken(eq(user), anyLong())).thenReturn("FAKE_TOKEN");
    when(graphApiClient.createDraftFromMime(any(), any()))
        .thenReturn(new GraphApiClient.DraftRef("D9", "<EX-9@prod.outlook.com>"));
    var big = upload(user, "big.bin", "application/octet-stream", new byte[4 * 1024 * 1024]);

    SendResult res = composeService.send(user, accountId, request(List.of(big.id()), null));

    assertThat(res.messageId()).isEqualTo("EX-9@prod.outlook.com");
    var row =
        dsl.select(EMAIL_MESSAGE.MESSAGE_ID, EMAIL_MESSAGE.THREAD_ID)
            .from(EMAIL_MESSAGE)
            .where(EMAIL_MESSAGE.ID.eq(res.localMessageId()))
            .fetchOne();
    assertThat(row.value1()).isEqualTo("EX-9@prod.outlook.com");
    assertThat(row.value2()).isEqualTo("EX-9@prod.outlook.com"); // 새 스레드 루트도 실제 값
    verify(graphApiClient, never()).sendMail(any(), any());
  }
}
