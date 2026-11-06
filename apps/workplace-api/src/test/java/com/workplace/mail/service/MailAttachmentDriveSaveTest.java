package com.workplace.mail.service;

import static com.workplace.jooq.Tables.CONTENT_ATTACHMENT;
import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.TENANT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.BDDMockito.willAnswer;
import static org.mockito.BDDMockito.willReturn;
import static org.mockito.BDDMockito.willThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.dto.DriveSpaceResponse;
import com.workplace.drive.repository.DriveFileVersionRepository;
import com.workplace.drive.service.DriveFileService;
import com.workplace.drive.service.DriveFolderService;
import com.workplace.drive.service.DriveQuotaService;
import com.workplace.drive.service.DriveSpaceService;
import com.workplace.file.service.UploadSource;
import com.workplace.file.storage.FileStore;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.MailTestPorts;
import com.workplace.mail.repository.ContentAttachmentRepository;
import com.workplace.mail.repository.EmailAttachmentRepository.AttachmentDownloadContext;
import com.workplace.mail.repository.MailAttachmentBlobRepository;
import com.workplace.mail.service.MailAttachmentService.AttachmentDownload;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

/**
 * 메일 첨부를 드라이브에 저장(WP-1400) — {@code POST /api/v1/mail/attachments/{id}/save-to-drive} 가 내 첨부의 원본을
 * 받아 드라이브에 새 파일 + v1 을 만들고(이름·형식·크기, 한도 사용량 증가), 권한·같은 이름·한도·메일 서버 실패에서는 아무것도 남기지 않는지 본다.
 *
 * <p>원본 바이트는 공통 spy {@link MailAttachmentService#downloadForPreview}(캐시 크기 확인을 받는 3인자 형태)를 스텁해 메일
 * 서버에 붙지 않는다. 캐시 경로 테스트만 실제 경로를 타고, 메일 서버 접속({@link ImapConnector}, 공통 spy)이 없었는지 확인한다. 클래스 트랜잭션
 * 롤백으로 공유 DB 를 오염시키지 않는다.
 */
@Transactional
class MailAttachmentDriveSaveTest extends IntegrationTestBase {

  private static final long T = 1L;
  private static final byte[] PDF = "%PDF-1.4 save to drive".getBytes();

  @Autowired MailAttachmentService attachmentService;
  @Autowired ImapConnector imapConnector;
  @Autowired MailAttachmentBlobStore blobStore;
  @Autowired MailAttachmentBlobRepository blobRepo;
  @Autowired ContentAttachmentRepository contentAttachmentRepo;
  @Autowired DriveSpaceService spaceService;
  @Autowired DriveFolderService folderService;
  @Autowired DriveFileService driveFileService;
  @Autowired DriveQuotaService quotaService;
  @Autowired DriveFileVersionRepository versions;
  @Autowired FileStore fileStore;
  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;

  private long userA;
  private long userB;
  private long accA;
  private long contentId;
  private long msgA;
  private int ordinal;
  private DriveSpaceResponse space;

  /** 캐시 테스트가 저장소에 쓴 blob — 끝나면 지운다(DB 행은 롤백되지만 파일은 남으므로). */
  private String seededBlobRef;

  @BeforeEach
  void setUp() {
    TenantContext.set(T);
    userA = TestFixtures.createHuman(dsl);
    userB = TestFixtures.createHuman(dsl);
    TestFixtures.ensureActiveMember(dsl, userA, T);
    TestFixtures.ensureActiveMember(dsl, userB, T);
    long nano = System.nanoTime();
    accA = account(userA, "ds-" + nano);
    long fldA = folder(accA);
    String msgId = "<save-drive-" + nano + "@test.local>";
    contentId =
        dsl.insertInto(EMAIL_CONTENT)
            .set(EMAIL_CONTENT.MESSAGE_ID, msgId)
            .set(EMAIL_CONTENT.THREAD_ID, msgId)
            .set(EMAIL_CONTENT.TENANT_ID, T)
            .returning(EMAIL_CONTENT.ID)
            .fetchOne()
            .getId();
    msgA = message(accA, fldA, msgId);
    space = spaceService.createTeamSpace(userA, "메일저장-" + nano);
  }

  @AfterEach
  void tearDown() {
    if (seededBlobRef != null) {
      blobStore.deleteQuietly(seededBlobRef);
    }
    TenantContext.clear();
  }

  @Test
  void 저장하면_새_드라이브_파일과_버전1이_생기고_한도_사용량이_는다() throws Exception {
    long att = attachment("report.pdf", "application/pdf", null);
    givenDownload(PDF);
    long usedBefore = quotaService.usedBytes();

    save(att, space.id(), null)
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.name").value("report.pdf"))
        .andExpect(jsonPath("$.mimeType").value("application/pdf"))
        .andExpect(jsonPath("$.sizeBytes").value(PDF.length))
        .andExpect(jsonPath("$.versionCount").value(1))
        .andExpect(jsonPath("$.folderId").doesNotExist())
        .andExpect(jsonPath("$.id").isNumber())
        .andExpect(jsonPath("$.fileId").isNumber())
        .andExpect(jsonPath("$.available").value(true));

    var df = dsl.selectFrom(DRIVE_FILE).where(DRIVE_FILE.SPACE_ID.eq(space.id())).fetchSingle();
    assertThat(df.getName()).isEqualTo("report.pdf");
    var vs = versions.listForDriveFile(df.getId());
    assertThat(vs).hasSize(1);
    var file = dsl.selectFrom(FILE).where(FILE.ID.eq(df.getFileId())).fetchSingle();
    assertThat(file.getSizeBytes()).isEqualTo(PDF.length);
    assertThat(file.getUploadedBy()).isEqualTo(userA);
    // 드라이브 파일은 영구 — 업로드 기본 24시간 만료가 풀려야 한다.
    assertThat(file.getExpiresAt()).isNull();
    assertThat(quotaService.usedBytes()).isEqualTo(usedBefore + PDF.length);
  }

  @Test
  void 폴더를_지정하면_그_폴더에_저장한다() throws Exception {
    long att = attachment("in-folder.pdf", "application/pdf", null);
    givenDownload(PDF);
    long folderId = folderService.create(userA, space.id(), null, "받은 첨부").id();

    save(att, space.id(), folderId)
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.folderId").value(folderId));
  }

  @Test
  void 남의_첨부는_404_원본을_받지_않고_아무것도_만들지_않는다() throws Exception {
    long att = attachment("secret.pdf", "application/pdf", null);
    givenDownload(PDF);
    // userB 도 공간 EDITOR 여서 404 의 이유가 첨부 소유뿐이게 한다.
    spaceService.addMember(userA, space.id(), userB, "EDITOR");

    saveAs(userB, att, space.id(), null).andExpect(status().isNotFound());

    verify(attachmentService, never()).downloadForPreview(anyLong(), any(), any());
    assertThat(driveFileCount()).isZero();
  }

  @Test
  void 비활성_계정의_첨부는_404() throws Exception {
    long att = attachment("off.pdf", "application/pdf", null);
    givenDownload(PDF);
    dsl.update(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.DISABLED_AT, OffsetDateTime.now())
        .where(EMAIL_ACCOUNT.ID.eq(accA))
        .execute();

    save(att, space.id(), null).andExpect(status().isNotFound());

    verify(attachmentService, never()).downloadForPreview(anyLong(), any(), any());
    assertThat(driveFileCount()).isZero();
  }

  @Test
  void 대상_공간_EDITOR_가_아니면_403_원본을_받지_않는다() throws Exception {
    DriveSpaceResponse others = spaceService.createTeamSpace(userB, "남의공간-" + System.nanoTime());
    spaceService.addMember(userB, others.id(), userA, "VIEWER");
    long att = attachment("viewer.pdf", "application/pdf", null);
    givenDownload(PDF);

    save(att, others.id(), null).andExpect(status().isForbidden());

    verify(attachmentService, never()).downloadForPreview(anyLong(), any(), any());
    assertThat(dsl.fetchCount(DRIVE_FILE, DRIVE_FILE.SPACE_ID.eq(others.id()))).isZero();
  }

  @Test
  void 다른_공간의_폴더는_400() throws Exception {
    DriveSpaceResponse other = spaceService.createTeamSpace(userA, "다른공간-" + System.nanoTime());
    long otherFolder = folderService.create(userA, other.id(), null, "f").id();
    long att = attachment("x.pdf", "application/pdf", null);
    givenDownload(PDF);

    save(att, space.id(), otherFolder).andExpect(status().isBadRequest());

    verify(attachmentService, never()).downloadForPreview(anyLong(), any(), any());
  }

  @Test
  void spaceId_가_없으면_400() throws Exception {
    long att = attachment("x.pdf", "application/pdf", null);
    mvc.perform(
            post(url(att))
                .header("Authorization", bearer(userA))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"folderId\":null}"))
        .andExpect(status().isBadRequest());
  }

  @Test
  void 같은_폴더에_같은_이름이_있으면_409_새_버전을_만들지_않는다() throws Exception {
    DriveFileResponse existing =
        driveFileService.upload(
            userA,
            space.id(),
            null,
            UploadSource.ofBytes("dup.pdf", "application/pdf", "old".getBytes()));
    long att = attachment("dup.pdf", "application/pdf", null);
    givenDownload(PDF);

    save(att, space.id(), null)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.message").value("같은 폴더에 이미 'dup.pdf' 이름이 있습니다."));

    // 받기 전에 거절한다 — 메일 서버에 가지 않는다.
    verify(attachmentService, never()).downloadForPreview(anyLong(), any(), any());
    assertThat(versions.listForDriveFile(existing.id())).hasSize(1);
    assertThat(driveFileCount()).isEqualTo(1);
  }

  @Test
  void 받는_사이_같은_이름이_생겨도_새_버전으로_덮지_않고_409() throws Exception {
    long att = attachment("race.pdf", "application/pdf", null);
    // 사전 검사는 통과한 뒤, 원본을 받는 동안 같은 이름 파일이 생긴 경합을 흉내 낸다.
    long[] existingId = new long[1];
    willAnswer(
            inv -> {
              existingId[0] =
                  driveFileService
                      .upload(
                          userA,
                          space.id(),
                          null,
                          UploadSource.ofBytes("race.pdf", "application/pdf", "old".getBytes()))
                      .id();
              return new AttachmentDownload(PDF, "race.pdf", "application/pdf");
            })
        .given(attachmentService)
        .downloadForPreview(anyLong(), any(AttachmentDownloadContext.class), any());

    save(att, space.id(), null).andExpect(status().isConflict());

    assertThat(versions.listForDriveFile(existingId[0])).hasSize(1);
    assertThat(driveFileCount()).isEqualTo(1);
  }

  @Test
  void 한도를_넘으면_409_file_행도_저장소_파일도_남지_않는다() throws Exception {
    long att = attachment("big.pdf", "application/pdf", null);
    givenDownload(PDF);
    dsl.update(TENANT).set(TENANT.QUOTA_BYTES, 0L).where(TENANT.ID.eq(T)).execute();
    int filesBefore = fileRowCount();
    Set<Path> storeBefore = storeFiles();

    save(att, space.id(), null).andExpect(status().isConflict());

    assertThat(driveFileCount()).isZero();
    assertThat(fileRowCount()).isEqualTo(filesBefore);
    assertThat(storeFiles()).isEqualTo(storeBefore);
  }

  @Test
  void 메일_서버에서_받지_못하면_오류이고_아무것도_만들지_않는다() throws Exception {
    long att = attachment("fail.pdf", "application/pdf", null);
    willThrow(new RuntimeException("첨부 파일 다운로드에 실패했습니다"))
        .given(attachmentService)
        .downloadForPreview(anyLong(), any(AttachmentDownloadContext.class), any());
    int filesBefore = fileRowCount();

    save(att, space.id(), null).andExpect(status().is5xxServerError());

    assertThat(driveFileCount()).isZero();
    assertThat(fileRowCount()).isEqualTo(filesBefore);
  }

  @Test
  void 원본이_메일_서버에_없으면_404() throws Exception {
    long att = attachment("gone.pdf", "application/pdf", null);
    willThrow(new com.workplace.mail.exception.EmailAttachmentNotFoundException(att))
        .given(attachmentService)
        .downloadForPreview(anyLong(), any(AttachmentDownloadContext.class), any());

    save(att, space.id(), null).andExpect(status().isNotFound());

    assertThat(driveFileCount()).isZero();
  }

  @Test
  void 캐시에_있으면_메일_서버를_부르지_않고_캐시_바이트로_저장한다() throws Exception {
    String hash = MailAttachmentService.sha256Hex(PDF);
    seededBlobRef = blobStore.store(T, hash, PDF);
    blobRepo.insertIfAbsent(hash, seededBlobRef, PDF.length);
    long att = attachment("cached.pdf", "application/pdf", hash);

    save(att, space.id(), null)
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.sizeBytes").value(PDF.length));

    verify(imapConnector, never()).connect(any(), anyString());
    long fileId =
        dsl.select(DRIVE_FILE.FILE_ID)
            .from(DRIVE_FILE)
            .where(DRIVE_FILE.SPACE_ID.eq(space.id()))
            .fetchSingle(DRIVE_FILE.FILE_ID);
    String path =
        dsl.select(FILE.STORAGE_PATH)
            .from(FILE)
            .where(FILE.ID.eq(fileId))
            .fetchSingle(FILE.STORAGE_PATH);
    assertThat(Files.readAllBytes(fileStore.resolve(path))).isEqualTo(PDF);
  }

  @Test
  void 이름이_없으면_attachment_id_이름과_octet_stream_으로_저장한다() throws Exception {
    long att = attachment("", null, null);
    givenDownload(PDF);

    save(att, space.id(), null)
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.name").value("attachment-" + att))
        .andExpect(jsonPath("$.mimeType").value("application/octet-stream"));
  }

  @Test
  void 대문자_파라미터가_붙은_형식도_정규화해_PDF_로_저장한다() throws Exception {
    long att = attachment("upper.pdf", "APPLICATION/PDF", null);
    givenDownload(PDF);

    save(att, space.id(), null)
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.mimeType").value("application/pdf"));

    long fileId =
        dsl.select(DRIVE_FILE.FILE_ID)
            .from(DRIVE_FILE)
            .where(DRIVE_FILE.SPACE_ID.eq(space.id()))
            .fetchSingle(DRIVE_FILE.FILE_ID);
    var file = dsl.selectFrom(FILE).where(FILE.ID.eq(fileId)).fetchSingle();
    assertThat(file.getMimeType()).isEqualTo("application/pdf");
    assertThat(file.getCategory()).isEqualTo("PDF");
  }

  @Test
  void 형식에_파라미터와_대소문자가_섞여도_기본형으로_저장한다() throws Exception {
    long att = attachment("note.txt", "Text/Plain; charset=UTF-8", null);
    givenDownload("hello".getBytes());

    save(att, space.id(), null)
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.mimeType").value("text/plain"));
  }

  @Test
  void 첨부_크기가_상한을_넘으면_메일_서버에_가지_않고_400() throws Exception {
    long att = attachment("huge.pdf", "application/pdf", null);
    // IMAP manifest 크기는 base64 기준이라 여유(4/3)를 두고 본다 — 그 여유로도 PDF 상한(100MB)을 넘는 크기.
    setManifestSize(att, 500L * 1024 * 1024);
    givenDownload(PDF);

    save(att, space.id(), null).andExpect(status().isBadRequest());

    verify(attachmentService, never()).downloadForPreview(anyLong(), any(), any());
    assertThat(driveFileCount()).isZero();
  }

  @Test
  void 저장_한도가_거의_찼고_manifest_크기가_남은_한도를_넘으면_메일_서버에_가지_않고_409() throws Exception {
    long att = attachment("full.pdf", "application/pdf", null);
    // IMAP manifest 크기는 base64 기준 — 여유(4/3)를 빼고도 남은 한도(1MB)를 넘는 크기(실제 약 7.5MB).
    setManifestSize(att, 10L * 1024 * 1024);
    dsl.update(TENANT)
        .set(TENANT.QUOTA_BYTES, quotaService.usedBytes() + 1024 * 1024)
        .where(TENANT.ID.eq(T))
        .execute();
    givenDownload(PDF);

    save(att, space.id(), null).andExpect(status().isConflict());

    verify(attachmentService, never()).downloadForPreview(anyLong(), any(), any());
    verify(imapConnector, never()).connect(any(), anyString());
    assertThat(driveFileCount()).isZero();
  }

  // ── 픽스처 ──

  private ResultActions save(long attachmentId, long spaceId, Long folderId) throws Exception {
    return saveAs(userA, attachmentId, spaceId, folderId);
  }

  private ResultActions saveAs(long uid, long attachmentId, long spaceId, Long folderId)
      throws Exception {
    return mvc.perform(
        post(url(attachmentId))
            .header("Authorization", bearer(uid))
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"spaceId\":" + spaceId + ",\"folderId\":" + folderId + "}"));
  }

  private static String url(long attachmentId) {
    return "/api/v1/mail/attachments/" + attachmentId + "/save-to-drive";
  }

  /** 첨부 manifest(content_attachment) 크기를 바꾼다 — 받기 전 사전 판정용. */
  private void setManifestSize(long attachmentId, long sizeBytes) {
    dsl.update(CONTENT_ATTACHMENT)
        .set(CONTENT_ATTACHMENT.SIZE_BYTES, sizeBytes)
        .where(
            CONTENT_ATTACHMENT.ID.eq(
                dsl.select(EMAIL_ATTACHMENT.CONTENT_ATTACHMENT_ID)
                    .from(EMAIL_ATTACHMENT)
                    .where(EMAIL_ATTACHMENT.ID.eq(attachmentId))
                    .fetchSingle(EMAIL_ATTACHMENT.CONTENT_ATTACHMENT_ID)))
        .execute();
  }

  /** 원본 받기를 data 로 스텁한다(메일 서버에 붙지 않는다). */
  private void givenDownload(byte[] data) {
    willReturn(new AttachmentDownload(data, "ignored", "ignored"))
        .given(attachmentService)
        .downloadForPreview(anyLong(), any(AttachmentDownloadContext.class), any());
  }

  private int driveFileCount() {
    return dsl.fetchCount(DRIVE_FILE, DRIVE_FILE.SPACE_ID.eq(space.id()));
  }

  /** 요청자(userA)가 올린 file 행 수 — 다른 테스트 fork 가 커밋한 행에 흔들리지 않게 좁힌다. */
  private int fileRowCount() {
    return dsl.fetchCount(FILE, FILE.UPLOADED_BY.eq(userA));
  }

  /** 저장소 루트 아래 모든 파일 — 요청 전후를 비교해 고아 blob 이 남지 않았는지 본다. */
  private Set<Path> storeFiles() throws Exception {
    Path root = fileStore.rootDir();
    if (!Files.exists(root)) return Set.of();
    try (Stream<Path> s = Files.walk(root)) {
      return s.filter(Files::isRegularFile).collect(Collectors.toSet());
    }
  }

  private String bearer(long uid) {
    TestFixtures.ensureActiveMember(dsl, uid, T);
    return "Bearer " + jwtTokenProvider.generateAccessToken(uid, "user-" + uid, T);
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

  private long message(long accountId, long folderId, String msgId) {
    return dsl.insertInto(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.ACCOUNT_ID, accountId)
        .set(EMAIL_MESSAGE.FOLDER_ID, folderId)
        .set(EMAIL_MESSAGE.MESSAGE_ID, msgId)
        .set(EMAIL_MESSAGE.THREAD_ID, msgId)
        .set(EMAIL_MESSAGE.IMAP_UID, 100L)
        .set(EMAIL_MESSAGE.SEEN, false)
        .set(EMAIL_MESSAGE.HAS_ATTACHMENT, true)
        .set(EMAIL_MESSAGE.CONTENT_ID, contentId)
        .set(EMAIL_MESSAGE.TENANT_ID, T)
        .returning(EMAIL_MESSAGE.ID)
        .fetchOne()
        .getId();
  }

  /** userA 메일에 첨부(manifest 포함) 하나를 단다 — contentHash 를 주면 캐시 키가 미리 채워진 첨부다. */
  private long attachment(String filename, String contentType, String contentHash) {
    int ord = ordinal++;
    long caId =
        contentAttachmentRepo.findOrCreate(
            contentId, ord, filename, contentType, (long) PDF.length, null, contentHash);
    return dsl.insertInto(EMAIL_ATTACHMENT)
        .set(EMAIL_ATTACHMENT.MESSAGE_ID, msgA)
        .set(EMAIL_ATTACHMENT.ORDINAL, ord)
        .set(EMAIL_ATTACHMENT.CONTENT_ATTACHMENT_ID, caId)
        .set(EMAIL_ATTACHMENT.TENANT_ID, T)
        .returning(EMAIL_ATTACHMENT.ID)
        .fetchOne()
        .getId();
  }
}
