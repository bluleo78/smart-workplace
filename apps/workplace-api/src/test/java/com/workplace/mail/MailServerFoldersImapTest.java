package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.icegreen.greenmail.configuration.GreenMailConfiguration;
import com.icegreen.greenmail.junit5.GreenMailExtension;
import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailFolderResponse;
import com.workplace.mail.dto.MailSyncResult;
import com.workplace.mail.exception.MailSyncException;
import com.workplace.mail.outbound.AiAgentMailClient;
import com.workplace.mail.outbound.MailChangeNotifier;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.service.MailBackfillService;
import com.workplace.mail.service.MailSummaryBackfillService;
import com.workplace.mail.service.MailSyncService;
import com.workplace.mail.service.folder.ImapFolderLister;
import com.workplace.mail.service.folder.MailFolderService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import jakarta.mail.Flags;
import jakarta.mail.Folder;
import jakarta.mail.Message;
import jakarta.mail.Session;
import jakarta.mail.Store;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

/**
 * 서버 메일함 목록(WP-960) IMAP 통합 테스트 — GreenMail(구분자 '.', SPECIAL-USE 속성 없음)에 보관·시스템·한글 계층 폴더를 만들고 동기화가
 * 보관·사용자 폴더만 저장하는지, 계층·안 읽은 수가 맞는지, 서버에서 지운 폴더가 메일과 함께 지워지는지, 목록 실패 때 아무것도 지우지 않는지 본다.
 */
@Transactional
class MailServerFoldersImapTest extends ExternalClientMockedTestBase {

  @RegisterExtension
  static GreenMailExtension greenMail =
      new GreenMailExtension(MailTestPorts.SMTP_IMAP)
          .withConfiguration(
              GreenMailConfiguration.aConfig().withUser("box@test.local", "box@test.local", "pw"));

  @Autowired DSLContext dsl;
  @Autowired MailSyncService syncService;
  @Autowired MailFolderService folderService;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired EncryptionService encryption;

  /** 목록 실패를 흉내 낼 때만 예외를 심는다(기본은 실제 동작). */
  @Autowired ImapFolderLister imapFolderLister;

  /** 동기화 뒤 알림 발행 여부만 본다. */
  @MockitoBean MailChangeNotifier notifier;

  @MockitoBean MailBackfillService backfillService;
  @MockitoBean MailSummaryBackfillService summaryBackfillService;
  @Autowired AiAgentMailClient mailClient;

  /** 서버 쪽 폴더 구성: 보관(안 읽음 1/전체 2) · 보낸편지함 · 휴지통 · 한글 계층(고객사 > A사, 안 읽음 1). */
  private void seedServerFolders() throws Exception {
    withStore(
        store -> {
          append(create(store, "Archive"), "보관 1", true);
          append(store.getFolder("Archive"), "보관 2", false);
          create(store, "Sent");
          create(store, "Trash");
          create(store, "고객사");
          append(create(store, "고객사.A사"), "A사 견적", false);
        });
  }

  @Test
  void sync_savesOnlyArchiveAndUserFolders_withHierarchyAndCounts() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.insertAccount(accountRepo, encryption, user, false);
    seedServerFolders();

    MailSyncResult result = syncService.sync(user, accountId);

    assertThat(result.saved()).isZero(); // 받은편지함은 비어 있다 — 알림은 폴더 변화 때문
    List<MailFolderResponse> folders = folderService.list(user, accountId);
    // 보관 먼저(이름 사이 순서는 DB 정렬 규칙을 따른다). Sent·Trash·INBOX 는 없다.
    assertThat(folders).first().extracting(MailFolderResponse::displayName).isEqualTo("Archive");
    assertThat(folders)
        .extracting(MailFolderResponse::displayName)
        .containsExactlyInAnyOrder("Archive", "A사", "고객사");
    Map<String, MailFolderResponse> byName =
        folders.stream()
            .collect(Collectors.toMap(MailFolderResponse::displayName, Function.identity()));
    assertThat(byName.get("Archive").role()).isEqualTo("ARCHIVE");
    assertThat(byName.get("Archive").unreadCount()).isEqualTo(1);
    assertThat(byName.get("Archive").totalCount()).isEqualTo(2);
    assertThat(byName.get("Archive").parentId()).isNull();
    assertThat(byName.get("고객사").role()).isEqualTo("USER");
    assertThat(byName.get("고객사").unreadCount()).isZero();
    assertThat(byName.get("A사").parentId()).isEqualTo(byName.get("고객사").id());
    assertThat(byName.get("A사").unreadCount()).isEqualTo(1);
    assertThat(folders).allMatch(MailFolderResponse::selectable);
    assertThat(folders).allMatch(f -> f.syncedSince() == null && f.folderSyncedAt() == null);

    // 서버 키는 전체 경로, INBOX 행은 remote_id 만 기록되고 역할은 없다.
    assertThat(
            dsl.select(EMAIL_FOLDER.NAME)
                .from(EMAIL_FOLDER)
                .where(EMAIL_FOLDER.ACCOUNT_ID.eq(accountId))
                .and(EMAIL_FOLDER.ROLE.isNotNull())
                .fetch(EMAIL_FOLDER.NAME))
        .containsExactlyInAnyOrder("Archive", "고객사", "고객사.A사");
    var inbox =
        dsl.selectFrom(EMAIL_FOLDER)
            .where(EMAIL_FOLDER.ACCOUNT_ID.eq(accountId))
            .and(EMAIL_FOLDER.NAME.eq("INBOX"))
            .fetchOne();
    assertThat(inbox.getRemoteId()).isEqualTo("INBOX");
    assertThat(inbox.getRole()).isNull();

    // 목록이 바뀌었으니 동기화 트랜잭션에서 계정 단위 알림이 나간다.
    verify(notifier).mailChanged(eq(user), eq(accountId), isNull(), isNull());
  }

  @Test
  void secondSync_withoutChanges_doesNotNotify_butCountChangeDoes() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.insertAccount(accountRepo, encryption, user, false);
    seedServerFolders();
    syncService.sync(user, accountId);
    clearInvocations(notifier);

    syncService.sync(user, accountId);
    verify(notifier, never()).mailChanged(anyLong(), anyLong(), any(), any());

    // 다른 앱에서 보관함 메일을 읽으면 안 읽은 수가 바뀌어 알림이 나간다.
    withStore(
        store -> {
          Folder archive = store.getFolder("Archive");
          archive.open(Folder.READ_WRITE);
          for (Message m : archive.getMessages()) {
            m.setFlag(Flags.Flag.SEEN, true);
          }
          archive.close(false);
        });
    syncService.sync(user, accountId);
    verify(notifier).mailChanged(eq(user), eq(accountId), isNull(), isNull());
    assertThat(folderService.list(user, accountId))
        .filteredOn(f -> f.displayName().equals("Archive"))
        .singleElement()
        .satisfies(f -> assertThat(f.unreadCount()).isZero());
  }

  @Test
  void folderDeletedOnServer_removesRowAndItsMessages_keepsInboxAndSent() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.insertAccount(accountRepo, encryption, user, false);
    seedServerFolders();
    syncService.sync(user, accountId);

    long aFolder = folderIdByName(accountId, "고객사.A사");
    long customer = folderIdByName(accountId, "고객사");
    long sent = folderRepo.ensureFolder(accountId, "SENT").id();
    long aMessage = seedMessage(accountId, aFolder);
    long sentMessage = seedMessage(accountId, sent);

    withStore(store -> store.getFolder("고객사.A사").delete(true));
    syncService.sync(user, accountId);

    assertThat(folderIdExists(aFolder)).isFalse();
    assertThat(messageExists(aMessage)).isFalse();
    assertThat(folderIdExists(customer)).isTrue();
    assertThat(folderIdExists(sent)).isTrue();
    assertThat(messageExists(sentMessage)).isTrue();
    assertThat(folderService.list(user, accountId))
        .extracting(MailFolderResponse::displayName)
        .containsExactly("Archive", "고객사");
  }

  @Test
  void listingFailure_keepsStoredFolders_andSyncStillSucceeds() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.insertAccount(accountRepo, encryption, user, false);
    seedServerFolders();
    syncService.sync(user, accountId);
    long aFolder = folderIdByName(accountId, "고객사.A사");
    long aMessage = seedMessage(accountId, aFolder);

    // 서버에서 폴더가 사라졌어도 목록 조회가 실패하면 아무것도 지우지 않는다.
    withStore(store -> store.getFolder("고객사.A사").delete(true));
    doThrow(new MailSyncException("LIST 실패"))
        .when(imapFolderLister)
        .list(anyLong(), anyLong(), any());
    clearInvocations(notifier);

    MailSyncResult result = syncService.sync(user, accountId); // 예외 없이 끝난다

    assertThat(result).isNotNull();
    assertThat(folderIdExists(aFolder)).isTrue();
    assertThat(messageExists(aMessage)).isTrue();
    verify(notifier, never()).mailChanged(anyLong(), anyLong(), any(), any());
  }

  @Test
  void refresh_unreachableServer_throwsAndDeletesNothing() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.insertAccount(accountRepo, encryption, user, false);
    seedServerFolders();
    syncService.sync(user, accountId);
    EmailAccountResponse account = accountRepo.findByIdAndUser(user, accountId).orElseThrow();
    // 닫힌 포트를 가리키는 계정 — 연결 단계에서 실패한다.
    EmailAccountResponse dead =
        new EmailAccountResponse(
            account.id(),
            account.emailAddress(),
            account.displayName(),
            account.imapHost(),
            1,
            account.imapSecurity(),
            account.imapUsername(),
            account.smtpHost(),
            account.smtpPort(),
            account.smtpSecurity(),
            account.smtpUsername(),
            account.lastTestedAt(),
            account.createdAt(),
            account.updatedAt(),
            account.aiEnabled(),
            account.lastSyncedAt(),
            account.provider());

    assertThatThrownBy(() -> folderService.refresh(user, accountId, dead))
        .isInstanceOf(MailSyncException.class);
    assertThat(folderService.list(user, accountId)).hasSize(3);
  }

  // ---- 헬퍼 ----

  /** GreenMail 계정에 IMAP 클라이언트로 붙어 작업한다. */
  private interface StoreWork {
    void run(Store store) throws Exception;
  }

  private static void withStore(StoreWork work) throws Exception {
    Properties props = new Properties();
    props.put("mail.store.protocol", "imap");
    Store store = Session.getInstance(props).getStore("imap");
    store.connect("127.0.0.1", MailTestPorts.IMAP, "box@test.local", "pw");
    try {
      work.run(store);
    } finally {
      store.close();
    }
  }

  private static Folder create(Store store, String fullName) throws Exception {
    Folder f = store.getFolder(fullName);
    if (!f.exists()) {
      f.create(Folder.HOLDS_MESSAGES);
    }
    return f;
  }

  private static void append(Folder folder, String subject, boolean seen) throws Exception {
    MimeMessage m = new MimeMessage(Session.getInstance(new Properties()));
    m.setFrom(new InternetAddress("sender@example.com"));
    m.setRecipients(Message.RecipientType.TO, "box@test.local");
    m.setSubject(subject, "UTF-8");
    m.setText("본문", "UTF-8");
    m.setFlag(Flags.Flag.SEEN, seen);
    folder.appendMessages(new Message[] {m});
  }

  private long folderIdByName(long accountId, String name) {
    return dsl.select(EMAIL_FOLDER.ID)
        .from(EMAIL_FOLDER)
        .where(EMAIL_FOLDER.ACCOUNT_ID.eq(accountId))
        .and(EMAIL_FOLDER.NAME.eq(name))
        .fetchSingle(EMAIL_FOLDER.ID);
  }

  private boolean folderIdExists(long folderId) {
    return dsl.fetchExists(EMAIL_FOLDER, EMAIL_FOLDER.ID.eq(folderId));
  }

  private boolean messageExists(long messageId) {
    return dsl.fetchExists(EMAIL_MESSAGE, EMAIL_MESSAGE.ID.eq(messageId));
  }

  /** 폴더에 메일 envelope 한 통을 직접 넣는다(서버 폴더 메일 동기화는 다음 단계라 시드로 대신). */
  private long seedMessage(long accountId, long folderId) {
    return dsl.insertInto(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.ACCOUNT_ID, accountId)
        .set(EMAIL_MESSAGE.FOLDER_ID, folderId)
        .set(EMAIL_MESSAGE.IMAP_UID, System.nanoTime())
        .set(EMAIL_MESSAGE.THREAD_ID, "thread-" + System.nanoTime())
        .set(EMAIL_MESSAGE.SEEN, false)
        .returning(EMAIL_MESSAGE.ID)
        .fetchOne()
        .getId();
  }
}
