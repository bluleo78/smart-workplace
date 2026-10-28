package com.workplace.mail.service;

import static com.workplace.jooq.Tables.CONTENT_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.Tables.MAIL_ATTACHMENT_BLOB;
import static com.workplace.jooq.Tables.MAIL_ATTACHMENT_PREVIEW;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.withSettings;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import com.workplace.filepreview.outbound.ConvertOutcome;
import com.workplace.filepreview.outbound.ConverterClient;
import com.workplace.filepreview.repository.PreviewStateStore.Row;
import com.workplace.global.security.EncryptionService;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.MailTestPorts;
import com.workplace.mail.repository.ContentAttachmentRepository;
import com.workplace.mail.repository.MailAttachmentPreviewRepository;
import com.workplace.mail.repository.MailPreviewKey;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.PreviewAwait;
import com.workplace.support.TestFixtures;
import jakarta.mail.Folder;
import jakarta.mail.Message;
import jakarta.mail.Store;
import jakarta.mail.UIDFolder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Supplier;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 메일 첨부 미리보기(WP-432) 통합 테스트 공용 픽스처 — 첨부 캐시 상한만 다른 두 테스트 클래스가 같은 시드·정리·IMAP 스텁을 쓴다.
 *
 * <p>변환은 실행기 스레드에서 돌므로 클래스 {@code @Transactional} 없이 기본 테넌트(1)가 아닌 fixture 테넌트에 커밋한다(WP-417 — 세션 기본
 * GUC=1 이 비동기 GUC 누락을 가리지 않게). 정리는 {@code @AfterEach} 에서 자기 행·파일만 지운다 — 첨부 바이트마다 UUID 를 넣어 해시(상태
 * 키)가 다른 테스트와 겹치지 않게 한다.
 *
 * <p>provider 는 {@link ImapConnector}·{@link MailMessageParser} 목으로 스텁하고, 원본 받기 횟수는 parser 호출(=IMAP
 * fetch)과 {@link MailAttachmentService} 스파이의 {@code download} 호출로 센다.
 */
@TestPropertySource(properties = "workplace.converter.enabled=true")
abstract class MailAttachmentPreviewTestSupport extends ExternalClientMockedTestBase {

  private static final String FIXTURE_TENANT_SLUG = "mail-preview-fixture-tenant";

  /** 메일마다 다른 IMAP uid — 목 폴더가 uid 로 메시지를 찾는다. */
  private static final AtomicLong UID_SEQ = new AtomicLong(1000);

  static final String HWP = "application/x-hwp";

  @Autowired ConverterClient converter;
  @MockitoBean ImapConnector imapConnector;
  @MockitoBean MailMessageParser parser;
  @Autowired MailAttachmentService attachmentService;
  // 스파이 — 304·판정이 미리보기를 복호화하지 않는지 보는 테스트용(그 밖엔 실제 동작 그대로).
  @Autowired MailAttachmentBlobStore blobStore;

  @Autowired DSLContext dsl;
  @Autowired MockMvc mvc;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired EncryptionService encryption;
  @Autowired ContentAttachmentRepository contentAttachmentRepo;
  @Autowired MailAttachmentPreviewRepository previewRepo;

  Long tid;
  long userA;
  long userB;
  private long accA;
  private long accB;
  private long fldA;
  private long fldB;

  /** 정리 대상 — 시드한 행 id 와 첨부 바이트 해시. */
  private final List<Long> contentIds = new ArrayList<>();

  private final List<Long> caIds = new ArrayList<>();
  private final List<Long> messageIds = new ArrayList<>();
  private final List<Long> attachmentIds = new ArrayList<>();
  private final Set<String> hashes = ConcurrentHashMap.newKeySet();

  /** uid → 목 IMAP 메시지, 메시지 → 첨부 바이트(없으면 provider 장애로 던진다). */
  private final Map<Long, Message> messagesByUid = new ConcurrentHashMap<>();

  private final Map<Message, byte[]> payloads = new ConcurrentHashMap<>();

  /** 첨부 id → IMAP uid — provider 에서 메일이 사라진 상황을 만들 때 쓴다. */
  private final Map<Long, Long> uidByAttachment = new ConcurrentHashMap<>();

  /** provider 에서 첨부 바이트를 받는 순간마다 활성 트랜잭션이 있었는지(=DB 연결을 쥐고 있었는지). */
  final List<Boolean> txActiveDuringFetch = new CopyOnWriteArrayList<>();

  /** 변환 목이 받은 원본 경로와 그 순간의 권한·내용(임시 파일 검증용). */
  final List<Path> convertedSources = new CopyOnWriteArrayList<>();

  final Map<Path, String> sourcePermissions = new ConcurrentHashMap<>();
  final Map<Path, byte[]> sourceContents = new ConcurrentHashMap<>();

  @BeforeEach
  void seedBase() throws Exception {
    inTenantTx(
        () -> {
          userA = TestFixtures.createHuman(dsl);
          userB = TestFixtures.createHuman(dsl);
          TestFixtures.ensureActiveMember(dsl, userA, tid);
          TestFixtures.ensureActiveMember(dsl, userB, tid);
          String encPw = encryption.encrypt("pw");
          accA = account(userA, encPw);
          accB = account(userB, encPw);
          fldA = folder(accA);
          fldB = folder(accB);
          return null;
        });

    // provider 스텁 — 연결·폴더는 하나, 메시지는 uid 로, 바이트는 메시지로 찾는다.
    Store store = mock(Store.class);
    Folder folder = mock(Folder.class, withSettings().extraInterfaces(UIDFolder.class));
    given(imapConnector.connect(any(), anyString())).willReturn(store);
    given(store.getFolder(anyString())).willReturn(folder);
    given(folder.isOpen()).willReturn(false);
    given(((UIDFolder) folder).getMessageByUID(anyLong()))
        .willAnswer(inv -> messagesByUid.get(inv.<Long>getArgument(0)));
    given(parser.extractAttachmentBytes(any(), anyInt()))
        .willAnswer(
            inv -> {
              txActiveDuringFetch.add(
                  TransactionSynchronizationManager.isActualTransactionActive());
              byte[] bytes = payloads.get(inv.<Message>getArgument(0));
              if (bytes == null) {
                throw new IllegalStateException("IMAP 장애(테스트)");
              }
              return bytes;
            });

    // 기본 변환 목 — 원본을 담은 PDF. 받은 원본 경로·권한·내용을 기록한다.
    when(converter.convertPdf(any(), anyString()))
        .thenAnswer(inv -> new ConvertOutcome.Success(pdfOf(recordSource(inv.getArgument(0))), 1));
  }

  @AfterEach
  void cleanupBase() {
    TenantContext.clear();
    if (tid == null) {
      return;
    }
    List<String> blobRefs = new ArrayList<>();
    cleanupInTenant(
        tid,
        () -> {
          if (!hashes.isEmpty()) {
            blobRefs.addAll(
                dsl.select(MAIL_ATTACHMENT_BLOB.FILE_REF)
                    .from(MAIL_ATTACHMENT_BLOB)
                    .where(MAIL_ATTACHMENT_BLOB.CONTENT_HASH.in(hashes))
                    .fetch(MAIL_ATTACHMENT_BLOB.FILE_REF));
            dsl.deleteFrom(MAIL_ATTACHMENT_BLOB)
                .where(MAIL_ATTACHMENT_BLOB.CONTENT_HASH.in(hashes))
                .execute();
            dsl.deleteFrom(MAIL_ATTACHMENT_PREVIEW)
                .where(MAIL_ATTACHMENT_PREVIEW.CONTENT_HASH.in(hashes))
                .execute();
          }
          dsl.deleteFrom(EMAIL_ATTACHMENT).where(EMAIL_ATTACHMENT.ID.in(attachmentIds)).execute();
          dsl.deleteFrom(EMAIL_MESSAGE).where(EMAIL_MESSAGE.ID.in(messageIds)).execute();
          dsl.deleteFrom(CONTENT_ATTACHMENT).where(CONTENT_ATTACHMENT.ID.in(caIds)).execute();
          dsl.deleteFrom(EMAIL_CONTENT).where(EMAIL_CONTENT.ID.in(contentIds)).execute();
          dsl.deleteFrom(EMAIL_FOLDER).where(EMAIL_FOLDER.ACCOUNT_ID.in(accA, accB)).execute();
          dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.in(accA, accB)).execute();
          // 사용자·멤버십은 남긴다 — 앱 롤은 membership 삭제 권한이 없다(다른 메일 테스트와 같음).
        });
    for (String ref : blobRefs) {
      deleteQuietly(blobStore.resolve(ref));
    }
    for (String h : hashes) {
      deleteQuietly(blobStore.resolve(new MailPreviewKey(tid, h).previewRef()));
    }
    for (Path p : convertedSources) {
      deleteQuietly(p);
    }
  }

  // ── 시드 ──

  /** 이 테스트만의 첨부 바이트 — UUID 를 넣어 해시가 다른 테스트와 겹치지 않게 한다. */
  static byte[] uniquePayload(String label) {
    return (label + "-" + UUID.randomUUID()).getBytes(StandardCharsets.UTF_8);
  }

  /** 사용자 A 의 새 메일에 첨부 하나(manifest 포함)를 단다. */
  long attachmentOfA(String filename, String contentType, long sizeBytes, byte[] payload) {
    return attachment(accA, fldA, filename, contentType, sizeBytes, payload, true);
  }

  /** 사용자 B 의 새 메일에 첨부 하나(manifest 포함)를 단다. */
  long attachmentOfB(String filename, String contentType, long sizeBytes, byte[] payload) {
    return attachment(accB, fldB, filename, contentType, sizeBytes, payload, true);
  }

  /** 사용자 A 의 새 메일에 manifest 없는 레거시 첨부(V100 이전 동기화)를 단다. */
  long legacyAttachmentOfA(byte[] payload) {
    return attachment(accA, fldA, null, null, 0, payload, false);
  }

  /**
   * 메일 한 통(고유 message-id·uid)과 첨부 하나를 커밋한다. payload 가 null 이면 provider 가 이 메일의 첨부를 받을 때 실패한다.
   *
   * @param withManifest false 면 content_attachment 없이 email_attachment 만(레거시)
   */
  private long attachment(
      long accountId,
      long folderId,
      String filename,
      String contentType,
      long sizeBytes,
      byte[] payload,
      boolean withManifest) {
    long uid = UID_SEQ.incrementAndGet();
    Message msg = mock(Message.class);
    messagesByUid.put(uid, msg);
    if (payload != null) {
      payloads.put(msg, payload);
      hashes.add(MailAttachmentService.sha256Hex(payload));
    }
    return inTenantTx(
        () -> {
          String messageId = "<preview-" + UUID.randomUUID() + "@test.local>";
          long contentId =
              dsl.insertInto(EMAIL_CONTENT)
                  .set(EMAIL_CONTENT.MESSAGE_ID, messageId)
                  .set(EMAIL_CONTENT.THREAD_ID, messageId)
                  .set(EMAIL_CONTENT.TENANT_ID, tid)
                  .returning(EMAIL_CONTENT.ID)
                  .fetchOne()
                  .getId();
          contentIds.add(contentId);
          long msgId =
              dsl.insertInto(EMAIL_MESSAGE)
                  .set(EMAIL_MESSAGE.ACCOUNT_ID, accountId)
                  .set(EMAIL_MESSAGE.FOLDER_ID, folderId)
                  .set(EMAIL_MESSAGE.MESSAGE_ID, messageId)
                  .set(EMAIL_MESSAGE.THREAD_ID, messageId)
                  .set(EMAIL_MESSAGE.IMAP_UID, uid)
                  .set(EMAIL_MESSAGE.SEEN, false)
                  .set(EMAIL_MESSAGE.HAS_ATTACHMENT, true)
                  .set(EMAIL_MESSAGE.CONTENT_ID, contentId)
                  .set(EMAIL_MESSAGE.TENANT_ID, tid)
                  .returning(EMAIL_MESSAGE.ID)
                  .fetchOne()
                  .getId();
          messageIds.add(msgId);
          Long caId = null;
          if (withManifest) {
            caId =
                contentAttachmentRepo.findOrCreate(
                    contentId, 0, filename, contentType, sizeBytes, null);
            caIds.add(caId);
          }
          long attId =
              dsl.insertInto(EMAIL_ATTACHMENT)
                  .set(EMAIL_ATTACHMENT.MESSAGE_ID, msgId)
                  .set(EMAIL_ATTACHMENT.ORDINAL, 0)
                  .set(EMAIL_ATTACHMENT.CONTENT_ATTACHMENT_ID, caId)
                  .set(EMAIL_ATTACHMENT.TENANT_ID, tid)
                  .returning(EMAIL_ATTACHMENT.ID)
                  .fetchOne()
                  .getId();
          attachmentIds.add(attId);
          uidByAttachment.put(attId, uid);
          return attId;
        });
  }

  /** provider 에서 이 첨부의 메일이 사라지게 한다(삭제·이동 — 받으면 EmailAttachmentNotFoundException). */
  void dropFromProvider(long attachmentId) {
    messagesByUid.remove(uidByAttachment.get(attachmentId));
  }

  /** 첨부의 manifest 에 해시를 미리 기록한다(이전 /content 다운로드가 채운 상태 — 캐시 blob 은 없음). */
  void presetContentHash(long attachmentId, String hash) {
    hashes.add(hash);
    inTenantTx(
        () ->
            dsl.update(CONTENT_ATTACHMENT)
                .set(CONTENT_ATTACHMENT.CONTENT_HASH, hash)
                .where(
                    CONTENT_ATTACHMENT.ID.eq(
                        dsl.select(EMAIL_ATTACHMENT.CONTENT_ATTACHMENT_ID)
                            .from(EMAIL_ATTACHMENT)
                            .where(EMAIL_ATTACHMENT.ID.eq(attachmentId))))
                .execute());
  }

  private long account(long userId, String encPw) {
    String tag = "pv-" + UUID.randomUUID().toString().substring(0, 8);
    return dsl.insertInto(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.USER_ID, userId)
        .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, tag + "@test.local")
        .set(EMAIL_ACCOUNT.IMAP_HOST, "127.0.0.1")
        .set(EMAIL_ACCOUNT.IMAP_PORT, MailTestPorts.IMAP)
        .set(EMAIL_ACCOUNT.IMAP_SECURITY, "NONE")
        .set(EMAIL_ACCOUNT.IMAP_USERNAME, tag + "@test.local")
        .set(EMAIL_ACCOUNT.ENCRYPTED_PASSWORD, encPw)
        .set(EMAIL_ACCOUNT.AI_ENABLED, false)
        .set(EMAIL_ACCOUNT.TENANT_ID, tid)
        .returning(EMAIL_ACCOUNT.ID)
        .fetchOne()
        .getId();
  }

  private long folder(long accountId) {
    return dsl.insertInto(EMAIL_FOLDER)
        .set(EMAIL_FOLDER.ACCOUNT_ID, accountId)
        .set(EMAIL_FOLDER.NAME, "INBOX")
        .set(EMAIL_FOLDER.TENANT_ID, tid)
        .returning(EMAIL_FOLDER.ID)
        .fetchOne()
        .getId();
  }

  // ── 요청·조회 ──

  /** {@code GET /mail/attachments/{id}/preview} — start 가 null 이면 파라미터 없이(폴링). */
  ResultActions preview(long attachmentId, Boolean start, long asUser) throws Exception {
    String url = "/api/v1/mail/attachments/" + attachmentId + "/preview";
    if (start != null) {
      url += "?start=" + start;
    }
    return mvc.perform(get(url).header("Authorization", bearer(asUser)));
  }

  String bearer(long uid) {
    return "Bearer " + jwtTokenProvider.generateAccessToken(uid, "user-" + uid, tid);
  }

  Row row(String hash) {
    return inTenantTx(() -> previewRepo.find(new MailPreviewKey(tid, hash)).orElse(null));
  }

  int previewRowCount(String hash) {
    return inTenantTx(
        () ->
            dsl.fetchCount(MAIL_ATTACHMENT_PREVIEW, MAIL_ATTACHMENT_PREVIEW.CONTENT_HASH.eq(hash)));
  }

  int blobRowCount(String hash) {
    return inTenantTx(
        () -> dsl.fetchCount(MAIL_ATTACHMENT_BLOB, MAIL_ATTACHMENT_BLOB.CONTENT_HASH.eq(hash)));
  }

  /** 첨부 manifest 의 content_hash(없으면 null). */
  String contentHashOf(long attachmentId) {
    return inTenantTx(
        () ->
            dsl.select(CONTENT_ATTACHMENT.CONTENT_HASH)
                .from(CONTENT_ATTACHMENT)
                .join(EMAIL_ATTACHMENT)
                .on(EMAIL_ATTACHMENT.CONTENT_ATTACHMENT_ID.eq(CONTENT_ATTACHMENT.ID))
                .where(EMAIL_ATTACHMENT.ID.eq(attachmentId))
                .fetchOne(CONTENT_ATTACHMENT.CONTENT_HASH));
  }

  /** 미리보기 결과 파일(암호화) 절대 경로. */
  Path previewFile(String hash) {
    return blobStore.resolve(new MailPreviewKey(tid, hash).previewRef());
  }

  /** 비동기 변환이 목표 상태에 이를 때까지 기다린다. */
  void awaitStatus(String hash, String status) {
    PreviewAwait.awaitStatus(
        () -> {
          Row r = row(hash);
          return r == null ? null : r.status();
        },
        status);
  }

  /** IMAP 에서 첨부 바이트를 받은 횟수(=provider fetch). */
  long providerFetches() {
    return Mockito.mockingDetails(parser).getInvocations().stream()
        .filter(i -> i.getMethod().getName().equals("extractAttachmentBytes"))
        .count();
  }

  /**
   * {@link MailAttachmentService} 의 원본 받기({@code download}·{@code downloadForPreview}) 호출 횟수(캐시 hit
   * 포함).
   */
  long downloadCalls() {
    return Mockito.mockingDetails(attachmentService).getInvocations().stream()
        .filter(i -> i.getMethod().getName().startsWith("download"))
        .count();
  }

  /**
   * 변환 목의 응답을 바꾼다. {@code when(converter.convertPdf(...))} 로 다시 스텁하면 기존 응답이 null 인자로 불려 깨지므로 {@code
   * doAnswer} 를 쓴다.
   */
  void onConvert(org.mockito.stubbing.Answer<?> answer) {
    Mockito.doAnswer(answer).when(converter).convertPdf(any(), anyString());
  }

  /** 변환 목이 받은 원본을 기록하고 그 경로를 돌려준다. */
  Path recordSource(Path source) throws Exception {
    convertedSources.add(source);
    try {
      sourcePermissions.put(
          source,
          java.nio.file.attribute.PosixFilePermissions.toString(
              Files.getPosixFilePermissions(source)));
    } catch (UnsupportedOperationException ignored) {
      // POSIX 가 아닌 파일 시스템 — 권한 검증은 건너뛴다.
    }
    sourceContents.put(source, Files.readAllBytes(source));
    return source;
  }

  /** 변환 목 결과 — 원본 내용을 담아 첨부마다 다른 PDF 바이트를 만든다. */
  static byte[] pdfOf(Path source) throws Exception {
    return pdfBytes(Files.readAllBytes(source));
  }

  static byte[] pdfBytes(byte[] original) {
    byte[] head = "%PDF-1.7 ".getBytes(StandardCharsets.UTF_8);
    byte[] out = new byte[head.length + original.length];
    System.arraycopy(head, 0, out, 0, head.length);
    System.arraycopy(original, 0, out, head.length, original.length);
    return out;
  }

  static void sleep(long ms) {
    try {
      Thread.sleep(ms);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException(e);
    }
  }

  private static void deleteQuietly(Path p) {
    try {
      Files.deleteIfExists(p);
    } catch (Exception ignored) {
      // 정리는 최선 노력.
    }
  }

  /** fixture 테넌트 GUC 를 심은 트랜잭션에서 실행하고 커밋한다. */
  <T> T inTenantTx(Supplier<T> body) {
    if (tid == null) {
      tid = ensureFixtureTenant(FIXTURE_TENANT_SLUG);
    }
    Long prev = TenantContext.get();
    TenantContext.set(tid);
    try {
      return new TransactionTemplate(txManager)
          .execute(
              status -> {
                dsl.execute("SELECT set_config('app.tenant_id', '" + tid + "', true)");
                return body.get();
              });
    } finally {
      if (prev == null) TenantContext.clear();
      else TenantContext.set(prev);
    }
  }
}
