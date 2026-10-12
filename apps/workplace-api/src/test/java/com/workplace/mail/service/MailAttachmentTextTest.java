package com.workplace.mail.service;

import static com.workplace.jooq.Tables.CONTENT_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.MailTestPorts;
import com.workplace.mail.exception.EmailAttachmentNotFoundException;
import com.workplace.mail.repository.ContentAttachmentRepository;
import com.workplace.mail.service.MailAttachmentService.AttachmentDownload;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * 메일 첨부 추출 텍스트(WP-358) — 첫 요청에 바이트를 가져와 평문 사본 file + 추출 요청(PENDING), 이후 요청은 fetch 없이 공용 구간 읽기. 바이트
 * 확보는 {@link MailAttachmentService} 를 mock 해 provider fetch 횟수를 센다(캐시·IMAP 경로는
 * MailAttachmentDedupIntegrationTest 가 검증). 클래스 트랜잭션 롤백으로 공유 DB 를 오염시키지 않는다.
 */
@Transactional
class MailAttachmentTextTest extends IntegrationTestBase {

  @MockitoBean MailAttachmentService attachmentService;

  @Autowired MailAttachmentTextService textService;
  @Autowired ContentAttachmentRepository contentAttachmentRepo;
  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;

  private static final long T = 1L;

  private long userA;
  private long userB;
  private long attA;
  private long attB;
  private long caId;
  private long contentId;
  private long fldA;
  private long accA;

  @BeforeEach
  void setUp() {
    TenantContext.set(T); // FilePathBuilder 가 테넌트 컨텍스트로 사본 경로를 만든다
    userA = TestFixtures.createHuman(dsl);
    userB = TestFixtures.createHuman(dsl);
    long nano = System.nanoTime();
    accA = account(userA, "a-" + nano);
    long accB = account(userB, "b-" + nano);
    fldA = folder(accA);
    long fldB = folder(accB);
    String msgId = "<text-" + nano + "@test.local>";
    contentId =
        dsl.insertInto(EMAIL_CONTENT)
            .set(EMAIL_CONTENT.MESSAGE_ID, msgId)
            .set(EMAIL_CONTENT.THREAD_ID, msgId)
            .set(EMAIL_CONTENT.TENANT_ID, T)
            .returning(EMAIL_CONTENT.ID)
            .fetchOne()
            .getId();
    // 같은 메일을 받은 두 사용자가 content_attachment(manifest) 1행을 공유한다.
    caId =
        contentAttachmentRepo.findOrCreate(contentId, 0, "spec.pdf", "application/pdf", 100L, null);
    attA = attachment(message(accA, fldA, msgId, 100L), caId);
    attB = attachment(message(accB, fldB, msgId, 200L), caId);
    given(attachmentService.download(anyLong(), anyLong()))
        .willReturn(
            new AttachmentDownload("%PDF-1.4 test".getBytes(), "spec.pdf", "application/pdf"));
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  private long account(long userId, String tag) {
    return dsl.insertInto(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.USER_ID, userId)
        .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, tag + "@test.local")
        .set(EMAIL_ACCOUNT.IMAP_HOST, "127.0.0.1")
        .set(EMAIL_ACCOUNT.IMAP_PORT, MailTestPorts.IMAP)
        .set(EMAIL_ACCOUNT.IMAP_SECURITY, "NONE")
        .set(EMAIL_ACCOUNT.IMAP_USERNAME, tag + "@test.local")
        .set(EMAIL_ACCOUNT.ENCRYPTED_PASSWORD, "x")
        .set(EMAIL_ACCOUNT.AI_ENABLED, false)
        .set(EMAIL_ACCOUNT.TENANT_ID, T)
        .returning(EMAIL_ACCOUNT.ID)
        .fetchOne()
        .getId();
  }

  private long folder(long accountId) {
    return dsl.insertInto(EMAIL_FOLDER)
        .set(EMAIL_FOLDER.ACCOUNT_ID, accountId)
        .set(EMAIL_FOLDER.NAME, "INBOX")
        .set(EMAIL_FOLDER.TENANT_ID, T)
        .returning(EMAIL_FOLDER.ID)
        .fetchOne()
        .getId();
  }

  private long message(long accountId, long folderId, String msgId, long uid) {
    return dsl.insertInto(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.ACCOUNT_ID, accountId)
        .set(EMAIL_MESSAGE.FOLDER_ID, folderId)
        .set(EMAIL_MESSAGE.MESSAGE_ID, msgId)
        .set(EMAIL_MESSAGE.THREAD_ID, msgId)
        .set(EMAIL_MESSAGE.IMAP_UID, uid)
        .set(EMAIL_MESSAGE.SEEN, false)
        .set(EMAIL_MESSAGE.HAS_ATTACHMENT, true)
        .set(EMAIL_MESSAGE.CONTENT_ID, contentId)
        .set(EMAIL_MESSAGE.TENANT_ID, T)
        .returning(EMAIL_MESSAGE.ID)
        .fetchOne()
        .getId();
  }

  private long attachment(long messageId, Long contentAttachmentId) {
    return dsl.insertInto(EMAIL_ATTACHMENT)
        .set(EMAIL_ATTACHMENT.MESSAGE_ID, messageId)
        .set(EMAIL_ATTACHMENT.ORDINAL, 0)
        .set(EMAIL_ATTACHMENT.CONTENT_ATTACHMENT_ID, contentAttachmentId)
        .set(EMAIL_ATTACHMENT.TENANT_ID, T)
        .returning(EMAIL_ATTACHMENT.ID)
        .fetchOne()
        .getId();
  }

  private Long extractFileId() {
    return dsl.select(CONTENT_ATTACHMENT.EXTRACT_FILE_ID)
        .from(CONTENT_ATTACHMENT)
        .where(CONTENT_ATTACHMENT.ID.eq(caId))
        .fetchOne(CONTENT_ATTACHMENT.EXTRACT_FILE_ID);
  }

  private void markDone(long fileId, String text) {
    dsl.update(FILE_EXTRACTION)
        .set(FILE_EXTRACTION.STATUS, "DONE")
        .set(FILE_EXTRACTION.EXTRACTED_TEXT, text)
        .set(FILE_EXTRACTION.CHAR_COUNT, text.codePointCount(0, text.length()))
        .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
        .execute();
  }

  @Test
  void 첫_요청은_사본을_만들고_PENDING_응답_fileId_는_attachmentId() {
    var s = textService.readText(userA, attA, 0, 100);

    assertThat(s.status()).isEqualTo("PENDING");
    assertThat(s.fileId()).isEqualTo(attA);
    Long fileId = extractFileId();
    assertThat(fileId).isNotNull();
    var file =
        dsl.select(FILE.MIME_TYPE, FILE.EXPIRES_AT, FILE.STORAGE_PATH)
            .from(FILE)
            .where(FILE.ID.eq(fileId))
            .fetchOne();
    assertThat(file.get(FILE.MIME_TYPE)).isEqualTo("application/pdf");
    // 만료가 달린 사본 — FileCleanupService 가 회수한다. 메일 blob GC 고아 스윕(tenant-*/mail) 밖에 저장한다.
    assertThat(file.get(FILE.EXPIRES_AT)).isAfter(OffsetDateTime.now().plusDays(6));
    assertThat(file.get(FILE.STORAGE_PATH)).startsWith("tenant-1/mail-extract/");
    verify(attachmentService, times(1)).download(userA, attA);
  }

  @Test
  void 두번째_요청과_같은_메일을_받은_다른_사용자는_fetch_없이_읽는다() {
    textService.readText(userA, attA, 0, 100);
    textService.readText(userA, attA, 0, 100);
    var other = textService.readText(userB, attB, 0, 100);

    assertThat(other.status()).isEqualTo("PENDING");
    assertThat(other.fileId()).isEqualTo(attB);
    verify(attachmentService, times(1)).download(anyLong(), anyLong());
  }

  @Test
  void 추출이_끝나면_구간_읽기() {
    textService.readText(userA, attA, 0, 100);
    markDone(extractFileId(), "가나다라마");

    var s = textService.readText(userA, attA, 1, 2);
    assertThat(s.status()).isEqualTo("READY");
    assertThat(s.fileId()).isEqualTo(attA);
    assertThat(s.text()).isEqualTo("나다");
    assertThat(s.totalChars()).isEqualTo(5);
    assertThat(s.nextOffset()).isEqualTo(3);
  }

  @Test
  void 타인_첨부는_404() {
    assertThatThrownBy(() -> textService.readText(userB, attA, 0, 10))
        .isInstanceOf(EmailAttachmentNotFoundException.class);
    verify(attachmentService, never()).download(anyLong(), anyLong());
  }

  @Test
  void manifest_없는_레거시_첨부는_NONE() {
    long legacy =
        attachment(message(accA, fldA, "<legacy-" + System.nanoTime() + "@t>", 300L), null);
    var s = textService.readText(userA, legacy, 0, 10);
    assertThat(s.status()).isEqualTo("NONE");
    verify(attachmentService, never()).download(anyLong(), anyLong());
  }

  @Test
  void 추출_불가_형식은_fetch_없이_SKIPPED() {
    long imgCa =
        contentAttachmentRepo.findOrCreate(contentId, 1, "photo.png", "image/png", 10L, null);
    long img = attachment(message(accA, fldA, "<img-" + System.nanoTime() + "@t>", 400L), imgCa);

    var s = textService.readText(userA, img, 0, 10);
    assertThat(s.status()).isEqualTo("SKIPPED");
    assertThat(s.reasonCode()).isEqualTo("IMAGE");
    verify(attachmentService, never()).download(anyLong(), anyLong());
  }

  @Test
  void 파라미터가_붙은_대문자_Content_Type_도_정규화() {
    assertThat(MailAttachmentTextService.normalizeMime("a.pdf", "Application/PDF; name=\"a.pdf\""))
        .isEqualTo("application/pdf");
    assertThat(MailAttachmentTextService.normalizeMime("보고서.hwp", "application/octet-stream"))
        .isEqualTo("application/x-hwp");
  }

  @Test
  void 엔드포인트는_ExtractedTextSlice_를_돌려주고_타인은_404() throws Exception {
    String url = "/api/v1/mail/attachments/" + attA + "/text";
    mvc.perform(get(url).header("Authorization", "Bearer " + tokenFor(userA)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.fileId").value(attA))
        .andExpect(jsonPath("$.status").value("PENDING"));
    mvc.perform(get(url).header("Authorization", "Bearer " + tokenFor(userB)))
        .andExpect(status().isNotFound());
  }

  private String tokenFor(long uid) {
    return jwtTokenProvider.generateAccessToken(uid, "user-" + uid, T);
  }
}
