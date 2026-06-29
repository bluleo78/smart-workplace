package com.workplace.mail.service;

import static com.workplace.jooq.Tables.CONTENT_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.Tables.MAIL_ATTACHMENT_BLOB;
import static com.workplace.jooq.tables.EmailContent.EMAIL_CONTENT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.withSettings;

import com.workplace.global.security.EncryptionService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.exception.EmailAttachmentNotFoundException;
import com.workplace.mail.repository.ContentAttachmentRepository;
import com.workplace.mail.repository.MailAttachmentBlobRepository;
import com.workplace.mail.service.MailAttachmentService.AttachmentDownload;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import jakarta.mail.Folder;
import jakarta.mail.Message;
import jakarta.mail.Store;
import jakarta.mail.UIDFolder;
import java.util.Arrays;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * MailAttachmentService.download 캐시 로직 머지 게이트.
 *
 * <p>provider fetch 횟수에 teeth 를 두어 캐싱이 실제로 동작함을 검증한다. IMAP 경로로 통일하고 {@link ImapConnector} + {@link
 * MailMessageParser} 를 mock 해 fetch 횟수를 카운트한다.
 *
 * <p>max-cache-bytes=1024 로 낮춰 25MB knob 테스트(테스트5)에서 1KB 초과 바이트로 캐시 미저장을 검증한다. 테스트1~4 는 1024 바이트
 * 이하의 고정 페이로드를 사용해 정상 캐싱이 동작하도록 한다.
 */
@TestPropertySource(properties = "workplace.storage.mail.max-cache-bytes=1024")
class MailAttachmentDedupIntegrationTest extends IntegrationTestBase {

  // ─── mock 대상: IMAP 연결 + 파서 ───────────────────────────────────────────
  @MockitoBean ImapConnector imapConnector;
  @MockitoBean MailMessageParser parser;

  // ─── autowired 실 빈 ──────────────────────────────────────────────────────
  @Autowired MailAttachmentService attachmentService;
  @Autowired MailAttachmentBlobRepository blobRepo;
  @Autowired ContentAttachmentRepository contentAttachmentRepo;
  @Autowired EncryptionService encryption;
  @Autowired DSLContext dsl;

  // ─── 테스트 픽스처 ─────────────────────────────────────────────────────────
  /** 테스트용 테넌트 ID. seed 행이 모두 이 테넌트에 속한다. */
  private static final long T = 1L;

  /** 고정 페이로드 (<=1024B → 캐시 가능). */
  private static final byte[] SMALL_PAYLOAD = "Hello, dedup attachment!".getBytes();

  /** 25MB knob 테스트용 페이로드: max-cache-bytes(1024) 초과 → 캐시 불가. */
  private static final byte[] LARGE_PAYLOAD = new byte[2048];

  static {
    Arrays.fill(LARGE_PAYLOAD, (byte) 0x42);
  }

  // 두 사용자
  private long userA;
  private long userB;

  // 각 사용자의 계정·폴더·메시지·첨부
  private long accA;
  private long accB;
  private long msgA;
  private long msgB;
  private long attA;
  private long attB;

  // 공유 content_attachment id
  private long sharedCaId;

  // 공유 email_content id (tearDown 에서 정리)
  private long sharedContentId;

  // jakarta.mail mock 객체 (per-test)
  private Store mockStore;
  private Folder mockFolderA; // UIDFolder
  private Folder mockFolderB; // UIDFolder
  private Message mockMessage;

  @BeforeEach
  void setUp() throws Exception {
    // ─── TenantContext 설정 ────────────────────────────────────────────────
    TenantContext.set(T);

    // ─── 사용자 생성 ──────────────────────────────────────────────────────
    userA = TestFixtures.createHuman(baseDsl);
    userB = TestFixtures.createHuman(baseDsl);

    // ─── seed: IMAP 계정 + 폴더 + 공유 메시지 + 공유 content_attachment ──
    // 비-@Transactional 이므로 commit 이 필요 → TransactionTemplate.executeWithoutResult 사용
    // (setRollbackOnly 없음 = 실제 커밋).
    // 패턴: cleanupInTenant 와 동일 — TenantContext + TransactionTemplate.
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            status -> {
              long nano = System.nanoTime();
              String encPw = encryption.encrypt("pw");
              String sharedMsgId = "<dedup-attach-" + nano + "@test.local>";
              String threadId = "<thread-" + nano + "@test.local>";

              // 계정 A (IMAP, tenant=T)
              accA =
                  baseDsl
                      .insertInto(EMAIL_ACCOUNT)
                      .set(EMAIL_ACCOUNT.USER_ID, userA)
                      .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, "acca-" + nano + "@test.local")
                      .set(EMAIL_ACCOUNT.IMAP_HOST, "127.0.0.1")
                      .set(EMAIL_ACCOUNT.IMAP_PORT, 3143)
                      .set(EMAIL_ACCOUNT.IMAP_SECURITY, "NONE")
                      .set(EMAIL_ACCOUNT.IMAP_USERNAME, "acca-" + nano + "@test.local")
                      .set(EMAIL_ACCOUNT.ENCRYPTED_PASSWORD, encPw)
                      .set(EMAIL_ACCOUNT.AI_ENABLED, false)
                      .set(EMAIL_ACCOUNT.TENANT_ID, T)
                      .returning(EMAIL_ACCOUNT.ID)
                      .fetchOne()
                      .getId();

              // 계정 B (IMAP, tenant=T)
              accB =
                  baseDsl
                      .insertInto(EMAIL_ACCOUNT)
                      .set(EMAIL_ACCOUNT.USER_ID, userB)
                      .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, "accb-" + nano + "@test.local")
                      .set(EMAIL_ACCOUNT.IMAP_HOST, "127.0.0.1")
                      .set(EMAIL_ACCOUNT.IMAP_PORT, 3143)
                      .set(EMAIL_ACCOUNT.IMAP_SECURITY, "NONE")
                      .set(EMAIL_ACCOUNT.IMAP_USERNAME, "accb-" + nano + "@test.local")
                      .set(EMAIL_ACCOUNT.ENCRYPTED_PASSWORD, encPw)
                      .set(EMAIL_ACCOUNT.AI_ENABLED, false)
                      .set(EMAIL_ACCOUNT.TENANT_ID, T)
                      .returning(EMAIL_ACCOUNT.ID)
                      .fetchOne()
                      .getId();

              // 폴더 A, B
              long fldA =
                  baseDsl
                      .insertInto(EMAIL_FOLDER)
                      .set(EMAIL_FOLDER.ACCOUNT_ID, accA)
                      .set(EMAIL_FOLDER.NAME, "INBOX")
                      .set(EMAIL_FOLDER.TENANT_ID, T)
                      .returning(EMAIL_FOLDER.ID)
                      .fetchOne()
                      .getId();
              long fldB =
                  baseDsl
                      .insertInto(EMAIL_FOLDER)
                      .set(EMAIL_FOLDER.ACCOUNT_ID, accB)
                      .set(EMAIL_FOLDER.NAME, "INBOX")
                      .set(EMAIL_FOLDER.TENANT_ID, T)
                      .returning(EMAIL_FOLDER.ID)
                      .fetchOne()
                      .getId();

              // 공유 email_content (같은 message_id → 1행)
              long contentId =
                  baseDsl
                      .insertInto(EMAIL_CONTENT)
                      .set(EMAIL_CONTENT.MESSAGE_ID, sharedMsgId)
                      .set(EMAIL_CONTENT.THREAD_ID, threadId)
                      .set(EMAIL_CONTENT.TENANT_ID, T)
                      .returning(com.workplace.jooq.tables.EmailContent.EMAIL_CONTENT.ID)
                      .fetchOne()
                      .getId();
              sharedContentId = contentId;

              // email_message A (imap_uid=100)
              msgA =
                  baseDsl
                      .insertInto(EMAIL_MESSAGE)
                      .set(EMAIL_MESSAGE.ACCOUNT_ID, accA)
                      .set(EMAIL_MESSAGE.FOLDER_ID, fldA)
                      .set(EMAIL_MESSAGE.MESSAGE_ID, sharedMsgId)
                      .set(EMAIL_MESSAGE.THREAD_ID, threadId)
                      .set(EMAIL_MESSAGE.IMAP_UID, 100L)
                      .set(EMAIL_MESSAGE.SEEN, false)
                      .set(EMAIL_MESSAGE.HAS_ATTACHMENT, true)
                      .set(EMAIL_MESSAGE.CONTENT_ID, contentId)
                      .set(EMAIL_MESSAGE.TENANT_ID, T)
                      .returning(EMAIL_MESSAGE.ID)
                      .fetchOne()
                      .getId();

              // email_message B (imap_uid=200)
              msgB =
                  baseDsl
                      .insertInto(EMAIL_MESSAGE)
                      .set(EMAIL_MESSAGE.ACCOUNT_ID, accB)
                      .set(EMAIL_MESSAGE.FOLDER_ID, fldB)
                      .set(EMAIL_MESSAGE.MESSAGE_ID, sharedMsgId)
                      .set(EMAIL_MESSAGE.THREAD_ID, threadId)
                      .set(EMAIL_MESSAGE.IMAP_UID, 200L)
                      .set(EMAIL_MESSAGE.SEEN, false)
                      .set(EMAIL_MESSAGE.HAS_ATTACHMENT, true)
                      .set(EMAIL_MESSAGE.CONTENT_ID, contentId)
                      .set(EMAIL_MESSAGE.TENANT_ID, T)
                      .returning(EMAIL_MESSAGE.ID)
                      .fetchOne()
                      .getId();

              // 공유 content_attachment (ordinal=0)
              sharedCaId =
                  contentAttachmentRepo.findOrCreate(
                      contentId, 0, "file.txt", "text/plain", 24L, null);

              // email_attachment A → sharedCaId
              attA =
                  baseDsl
                      .insertInto(EMAIL_ATTACHMENT)
                      .set(EMAIL_ATTACHMENT.MESSAGE_ID, msgA)
                      .set(EMAIL_ATTACHMENT.ORDINAL, 0)
                      .set(EMAIL_ATTACHMENT.CONTENT_ATTACHMENT_ID, sharedCaId)
                      .set(EMAIL_ATTACHMENT.TENANT_ID, T)
                      .returning(EMAIL_ATTACHMENT.ID)
                      .fetchOne()
                      .getId();

              // email_attachment B → sharedCaId
              attB =
                  baseDsl
                      .insertInto(EMAIL_ATTACHMENT)
                      .set(EMAIL_ATTACHMENT.MESSAGE_ID, msgB)
                      .set(EMAIL_ATTACHMENT.ORDINAL, 0)
                      .set(EMAIL_ATTACHMENT.CONTENT_ATTACHMENT_ID, sharedCaId)
                      .set(EMAIL_ATTACHMENT.TENANT_ID, T)
                      .returning(EMAIL_ATTACHMENT.ID)
                      .fetchOne()
                      .getId();
            });

    // ─── Mock jakarta.mail 스택 ─────────────────────────────────────────────
    mockStore = mock(Store.class);
    mockMessage = mock(Message.class);

    // Folder 는 UIDFolder 인터페이스를 추가로 구현해야 `((UIDFolder) folder)` 캐스트를 통과한다.
    mockFolderA = mock(Folder.class, withSettings().extraInterfaces(UIDFolder.class));
    mockFolderB = mock(Folder.class, withSettings().extraInterfaces(UIDFolder.class));

    // imapConnector.connect 는 항상 mockStore 반환
    given(imapConnector.connect(any(), anyString())).willReturn(mockStore);

    // store.getFolder → 각 폴더 mock (폴더 이름 무관하게 같은 mock 반환)
    given(mockStore.getFolder(anyString()))
        .willReturn(mockFolderA) // 첫 번째 호출 = A
        .willReturn(mockFolderB) // 두 번째 호출 = B
        .willReturn(mockFolderA) // 이후 반복
        .willReturn(mockFolderB);

    // UIDFolder.getMessageByUID → mockMessage
    given(((UIDFolder) mockFolderA).getMessageByUID(anyLong())).willReturn(mockMessage);
    given(((UIDFolder) mockFolderB).getMessageByUID(anyLong())).willReturn(mockMessage);

    // folder.isOpen → false (closeQuietly 에서 close 생략)
    given(mockFolderA.isOpen()).willReturn(false);
    given(mockFolderB.isOpen()).willReturn(false);

    // 기본 parser stub: SMALL_PAYLOAD 반환
    given(parser.extractAttachmentBytes(any(), anyInt())).willReturn(SMALL_PAYLOAD);
  }

  @AfterEach
  void tearDown() {
    // ─── FK 역순 정리: email_attachment → email_message → email_folder
    //     → email_account → content_attachment → email_content
    //     → mail_attachment_blob (tenant_id GUC 필요 — cleanupInTenant 사용)
    cleanupInTenant(
        T,
        () -> {
          baseDsl.deleteFrom(EMAIL_ATTACHMENT).where(EMAIL_ATTACHMENT.ID.in(attA, attB)).execute();
          baseDsl.deleteFrom(EMAIL_MESSAGE).where(EMAIL_MESSAGE.ID.in(msgA, msgB)).execute();
          baseDsl.deleteFrom(EMAIL_FOLDER).where(EMAIL_FOLDER.ACCOUNT_ID.in(accA, accB)).execute();
          baseDsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.in(accA, accB)).execute();
          baseDsl
              .deleteFrom(CONTENT_ATTACHMENT)
              .where(CONTENT_ATTACHMENT.ID.eq(sharedCaId))
              .execute();
          // email_content: content_attachment FK 삭제 후 제거 가능
          baseDsl.deleteFrom(EMAIL_CONTENT).where(EMAIL_CONTENT.ID.eq(sharedContentId)).execute();
          // mail_attachment_blob: content_hash 기반 정리
          baseDsl.deleteFrom(MAIL_ATTACHMENT_BLOB).execute(); // 테스트 격리 — 테넌트 전체 삭제(GUC 스코프)
        });

    TenantContext.clear();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 테스트 1: dedup N→1 — 두 수신자(A, B)가 같은 첨부를 요청해도 provider fetch 1회
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * 같은 메일을 받은 두 사용자 A·B 가 첨부를 다운로드할 때, provider fetch 는 첫 번째 다운로드(A)에서만 1회 발생하고 B 는 캐시에서 서빙된다.
   *
   * <p>teeth: {@code verify(parser, times(1)).extractAttachmentBytes(any(), anyInt())}.
   */
  @Test
  void dedup_N_to_1_provider_fetch_1회만() throws Exception {
    // A 다운로드 → provider fetch 1회, blob 생성
    AttachmentDownload a = attachmentService.download(userA, attA);
    // B 다운로드 → fetch 추가 없이 캐시 서빙
    AttachmentDownload b = attachmentService.download(userB, attB);

    assertThat(b.content()).isEqualTo(a.content());
    // teeth: provider fetch 는 딱 1회
    verify(parser, times(1)).extractAttachmentBytes(any(), anyInt());

    // blob 행 수 확인 — 같은 hash → 1행
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            status -> {
              long blobCount =
                  baseDsl.selectCount().from(MAIL_ATTACHMENT_BLOB).fetchOneInto(long.class);
              assertThat(blobCount).as("content_hash 공유 → blob 1행").isEqualTo(1L);
              status.setRollbackOnly();
            });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 테스트 2: cache-twice — A 가 두 번 다운로드해도 fetch 총 1회
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * 같은 사용자 A 가 동일 첨부를 두 번 다운로드할 때, 두 번째 요청은 캐시에서 즉시 서빙되어 provider fetch 는 총 1회에 그친다.
   *
   * <p>teeth: {@code verify(parser, times(1)).extractAttachmentBytes(any(), anyInt())}.
   */
  @Test
  void cache_twice_두번째_다운로드는_fetch_없음() throws Exception {
    attachmentService.download(userA, attA); // 1회 fetch + blob 저장
    attachmentService.download(userA, attA); // 캐시 hit → fetch 없음

    // teeth: 두 번 다운로드해도 provider fetch 는 1회
    verify(parser, times(1)).extractAttachmentBytes(any(), anyInt());
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 테스트 3: 비소유자 거부 — B 가 A 의 attachmentId 로 download 시 404
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * userB 가 userA 의 email_attachment(attA)를 요청하면 소유 검증(RLS + userId 필터)에 의해 {@link
   * EmailAttachmentNotFoundException} 이 던져져야 한다.
   */
  @Test
  void 비소유자는_타인_attachmentId_다운로드_불가() throws Exception {
    assertThatThrownBy(() -> attachmentService.download(userB, attA))
        .isInstanceOf(EmailAttachmentNotFoundException.class);

    // fetch 가 시도되지 않았음을 확인 — 소유 검증 먼저 통과 실패
    verify(parser, times(0)).extractAttachmentBytes(any(), anyInt());
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 테스트 4: TTL evict 후 요청자 좌표로 재fetch
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * A 가 첨부를 다운로드해 blob 이 생성된 후, blob 행과 파일만 삭제해 evict 를 시뮬레이션한다. content_hash 는 유지한다.
   *
   * <p>이후 B 가 다운로드하면: hash 존재 → cache 블록 진입 → findByHash empty(blob 없음) → provider 재fetch(evict
   * 분기). B 의 IMAP 좌표로 재fetch 가 발생해 총 2회 fetch 가 검증된다.
   *
   * <p>teeth: {@code verify(parser, times(2)).extractAttachmentBytes(any(), anyInt())}.
   */
  @Test
  void TTL_evict후_요청자좌표로_재fetch() throws Exception {
    // 1차 다운로드: A → fetch 1회, blob 저장
    attachmentService.download(userA, attA);

    // evict 시뮬레이션: blob 행 + 파일 삭제
    cleanupInTenant(
        T,
        () -> {
          // 현재 blob 조회 후 파일 삭제
          baseDsl
              .select(MAIL_ATTACHMENT_BLOB.FILE_REF)
              .from(MAIL_ATTACHMENT_BLOB)
              .fetch()
              .forEach(
                  r -> {
                    try {
                      // 스토어에서 파일 삭제 (best-effort)
                      var blobStore =
                          getField(attachmentService, "blobStore", MailAttachmentBlobStore.class);
                      blobStore.delete(r.get(MAIL_ATTACHMENT_BLOB.FILE_REF));
                    } catch (Exception ignored) {
                      // 파일이 없어도 행 삭제는 계속
                    }
                  });
          // blob 행만 삭제 — content_hash 는 유지해야 진짜 evict 분기를 통과함.
          // (hash 있음 → cache 블록 진입 → findByHash empty → provider 재fetch)
          baseDsl.deleteFrom(MAIL_ATTACHMENT_BLOB).execute();
        });

    // 2차 다운로드: B → miss → B 좌표로 재fetch
    // store.getFolder 는 셋업에서 A-B-A-B 순서로 설정됨 → 두 번째 imapConnector.connect 는 B 계정으로
    AttachmentDownload again = attachmentService.download(userB, attB);
    assertThat(again.content()).isNotEmpty();

    // teeth: 총 2회 fetch(첫 A + evict 후 B)
    verify(parser, times(2)).extractAttachmentBytes(any(), anyInt());
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 테스트 5: 25MB knob — 페이로드 > max-cache-bytes 이면 blob 미생성, 매번 fetch
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * max-cache-bytes=1024(테스트 속성) 조건에서 2048B 페이로드를 반환하도록 stub 을 덮어쓴다. 첫 다운로드 후 blob 행이 없어야 하고, 두 번째
   * 다운로드도 provider 를 재호출해 총 2회 fetch 가 발생해야 한다.
   *
   * <p>teeth: {@code verify(parser, times(2)).extractAttachmentBytes(any(), anyInt())}, blob 0행.
   */
  @Test
  void 크기_초과_첨부는_캐시_안함() throws Exception {
    // LARGE_PAYLOAD(2048B > max-cache-bytes 1024)를 반환하도록 stub 재설정
    Mockito.reset(parser);
    given(parser.extractAttachmentBytes(any(), anyInt())).willReturn(LARGE_PAYLOAD);

    // 1차 다운로드 — 크기 초과 → blob 미저장
    AttachmentDownload first = attachmentService.download(userA, attA);
    assertThat(first.content()).hasSize(2048);

    // blob 행 없음 검증
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            status -> {
              long blobCount =
                  baseDsl.selectCount().from(MAIL_ATTACHMENT_BLOB).fetchOneInto(long.class);
              assertThat(blobCount).as("크기 초과 → blob 미저장 → 0행").isEqualTo(0L);
              status.setRollbackOnly();
            });

    // 2차 다운로드 — 캐시 없으므로 또 fetch
    attachmentService.download(userA, attA);

    // teeth: 캐시가 없으므로 두 번 모두 fetch
    verify(parser, times(2)).extractAttachmentBytes(any(), anyInt());
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 헬퍼
  // ─────────────────────────────────────────────────────────────────────────

  /** 리플렉션으로 private final 필드를 꺼낸다. TTL evict 시뮬레이션에서 blobStore.delete 를 호출하기 위해 사용한다. */
  @SuppressWarnings("unchecked")
  private static <T> T getField(Object target, String fieldName, Class<T> type) {
    try {
      var field = target.getClass().getDeclaredField(fieldName);
      field.setAccessible(true);
      return type.cast(field.get(target));
    } catch (Exception e) {
      throw new RuntimeException("리플렉션 필드 접근 실패: " + fieldName, e);
    }
  }
}
