package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.icegreen.greenmail.configuration.GreenMailConfiguration;
import com.icegreen.greenmail.junit5.GreenMailExtension;
import com.icegreen.greenmail.user.GreenMailUser;
import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.MailMoveRequest;
import com.workplace.mail.dto.MailMoveRequest.Kind;
import com.workplace.mail.dto.MailMoveResponse;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.exception.EmailFolderNotFoundException;
import com.workplace.mail.exception.EmailMessageNotFoundException;
import com.workplace.mail.exception.MailValidationException;
import com.workplace.mail.outbound.AiAgentMailClient;
import com.workplace.mail.outbound.MailChangeNotifier;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.ImapConnector;
import com.workplace.mail.service.MailAccountCredentials;
import com.workplace.mail.service.MailBackfillService;
import com.workplace.mail.service.MailMessageService;
import com.workplace.mail.service.MailSummaryBackfillService;
import com.workplace.mail.service.MailSyncService;
import com.workplace.mail.service.folder.MailFolderService;
import com.workplace.mail.service.move.ImapMailMover;
import com.workplace.mail.service.move.MailMoveService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import jakarta.mail.Flags;
import jakarta.mail.Folder;
import jakarta.mail.Message;
import jakarta.mail.Session;
import jakarta.mail.Store;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;
import org.eclipse.angus.mail.imap.IMAPStore;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;

/**
 * 메일 옮기기(WP-962) IMAP 통합 테스트 — GreenMail(MOVE·UIDPLUS 지원)로 보관·내 메일함·받은편지함·휴지통으로 옮기기가 서버에 반영되고, 로컬
 * 행이 같은 id·같은 본문(content)으로 새 메일함에 바로 보이며, 다음 동기화가 중복으로 넣지 않는지 본다. 반영 대기 읽음이 서버에 먼저 반영되는지, MOVE 가
 * 없는 서버의 COPY+UID EXPUNGE 대체 경로, 메일별 부분 실패, 권한·대상 검증(404·400)도 본다.
 */
@Transactional
class MailMoveImapTest extends ExternalClientMockedTestBase {

  @RegisterExtension
  static GreenMailExtension greenMail =
      new GreenMailExtension(MailTestPorts.SMTP_IMAP)
          .withConfiguration(
              GreenMailConfiguration.aConfig().withUser("box@test.local", "box@test.local", "pw"));

  @Autowired DSLContext dsl;
  @Autowired MailSyncService syncService;
  @Autowired MailFolderService folderService;
  @Autowired MailMessageService messageService;
  @Autowired MailMoveService moveService;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired com.workplace.mail.repository.EmailAttachmentRepository attachmentRepo;
  @Autowired EncryptionService encryption;
  @Autowired MailAccountCredentials credentials;
  @Autowired ImapConnector imapConnector;
  @Autowired PlatformTransactionManager txManager;

  @MockitoBean MailChangeNotifier notifier;
  @MockitoBean MailBackfillService backfillService;
  @MockitoBean MailSummaryBackfillService summaryBackfillService;
  @Autowired AiAgentMailClient mailClient;

  /** [user, account] — 서버 메일함(Archive·Projects + 선택적으로 Trash)을 만들고 받은편지함 메일을 받은 뒤 동기화한다. */
  private long[] setup(boolean withTrash, String... subjects) throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.insertAccount(accountRepo, encryption, user, false);
    var mgr = greenMail.getManagers().getImapHostManager();
    mgr.createMailbox(boxUser(), "Archive");
    mgr.createMailbox(boxUser(), "Projects");
    if (withTrash) {
      mgr.createMailbox(boxUser(), "Trash");
    }
    for (String s : subjects) {
      MailTestPorts.sendText("box@test.local", "sender@test.local", s, "본문 " + s);
    }
    greenMail.waitForIncomingEmail(subjects.length);
    syncService.sync(user, accountId);
    // 보관함은 한 번 가져온 상태로 둔다(UIDVALIDITY 기록) — 가져오지 않은 메일함으로 옮기는 경우는 따로 본다
    folderService.syncFolder(user, accountId, folderId(accountId, "Archive"), false);
    return new long[] {user, accountId};
  }

  private static MailMoveRequest req(Kind kind, Long folderId, long... ids) {
    List<Long> list = new ArrayList<>();
    for (long id : ids) {
      list.add(id);
    }
    return new MailMoveRequest(list, new MailMoveRequest.Target(kind, folderId));
  }

  @Test
  void archive_movesOnServer_keepsSameRowAndContent_pushesPendingSeen_noDuplicateOnSync()
      throws Exception {
    long[] s = setup(false, "보관할 메일", "남길 메일");
    long archiveId = folderId(s[1], "Archive");
    long inboxId = folderId(s[1], "INBOX");
    long target = messageId(s[1], "보관할 메일");
    Long contentBefore = row(target).get(EMAIL_MESSAGE.CONTENT_ID);
    // 로컬에서 읽음 → 서버 반영 대기(테스트 트랜잭션이 커밋되지 않아 역동기화가 돌지 않는다)
    messageService.markRead(s[0], target);
    assertThat(row(target).get(EMAIL_MESSAGE.SEEN_PUSH_PENDING)).isTrue();
    setServerUnread(archiveId, 5);

    MailMoveResponse r = moveService.move(s[0], s[1], req(Kind.ARCHIVE, null, target));

    assertThat(r.results()).singleElement().satisfies(x -> assertThat(x.ok()).isTrue());
    // 서버: 보관함으로 옮겨졌고 읽음이 먼저 반영됐다
    assertThat(serverSubjects("INBOX")).containsExactly("남길 메일");
    assertThat(serverSubjects("Archive")).containsExactly("보관할 메일");
    assertThat(isServerSeen("Archive", "보관할 메일")).isTrue();
    // 로컬: 같은 id·같은 content 로 보관함에, 대기 표시는 풀렸다
    Record moved = row(target);
    assertThat(moved.get(EMAIL_MESSAGE.FOLDER_ID)).isEqualTo(archiveId);
    assertThat(moved.get(EMAIL_MESSAGE.CONTENT_ID)).isEqualTo(contentBefore);
    assertThat(moved.get(EMAIL_MESSAGE.IMAP_UID)).isEqualTo(serverUid("Archive", "보관할 메일"));
    assertThat(moved.get(EMAIL_MESSAGE.SEEN_PUSH_PENDING)).isFalse();
    // 읽은 메일이라 보관함 안 읽은 수는 그대로
    assertThat(serverUnread(archiveId)).isEqualTo(5);
    verify(notifier).mailChanged(eq(s[0]), eq(s[1]), eq(null), eq(s[0]));

    // 다음 동기화: 받은편지함은 지울 것이 없고(이미 옮김), 보관함은 새로 넣지 않는다
    assertThat(syncService.sync(s[0], s[1]).removed()).isZero();
    assertThat(folderService.syncFolder(s[0], s[1], archiveId, false).saved()).isZero();
    assertThat(countIn(s[1], archiveId)).isEqualTo(1);
    assertThat(countIn(s[1], inboxId)).isEqualTo(1);
  }

  @Test
  void moveToUserFolder_thenBackToInbox_adjustsUnreadCounts() throws Exception {
    long[] s = setup(false, "프로젝트 메일");
    long projects = folderId(s[1], "Projects");
    long inboxId = folderId(s[1], "INBOX");
    long id = messageId(s[1], "프로젝트 메일");
    folderService.syncFolder(s[0], s[1], projects, false); // UIDVALIDITY 기록(가져온 메일함)
    setServerUnread(projects, 2);

    assertThat(moveService.move(s[0], s[1], req(Kind.FOLDER, projects, id)).results().get(0).ok())
        .isTrue();
    assertThat(serverSubjects("Projects")).containsExactly("프로젝트 메일");
    assertThat(row(id).get(EMAIL_MESSAGE.FOLDER_ID)).isEqualTo(projects);
    assertThat(serverUnread(projects)).isEqualTo(3); // 안 읽은 메일이 들어왔다

    assertThat(moveService.move(s[0], s[1], req(Kind.INBOX, null, id)).results().get(0).ok())
        .isTrue();
    assertThat(serverSubjects("Projects")).isEmpty();
    assertThat(serverSubjects("INBOX")).containsExactly("프로젝트 메일");
    assertThat(row(id).get(EMAIL_MESSAGE.FOLDER_ID)).isEqualTo(inboxId);
    assertThat(row(id).get(EMAIL_MESSAGE.IMAP_UID)).isEqualTo(serverUid("INBOX", "프로젝트 메일"));
    assertThat(serverUnread(projects)).isEqualTo(2);
    // 받은편지함 다음 동기화가 중복으로 넣지 않는다
    syncService.sync(s[0], s[1]);
    assertThat(countIn(s[1], inboxId)).isEqualTo(1);
  }

  @Test
  void moveToNeverSyncedFolder_deletesLocalRow_andFolderSyncBringsItBack() throws Exception {
    long[] s = setup(false, "처음 메일함으로");
    long projects = folderId(s[1], "Projects");
    long id = messageId(s[1], "처음 메일함으로");

    assertThat(moveService.move(s[0], s[1], req(Kind.FOLDER, projects, id)).results().get(0).ok())
        .isTrue();
    assertThat(serverSubjects("Projects")).containsExactly("처음 메일함으로");
    // UIDVALIDITY 를 모르는 메일함 — 행을 옮기지 않고 지운 뒤 첫 동기화가 다시 넣는다
    assertThat(dsl.fetchExists(EMAIL_MESSAGE, EMAIL_MESSAGE.ID.eq(id))).isFalse();
    assertThat(folderService.syncFolder(s[0], s[1], projects, false).saved()).isEqualTo(1);
  }

  @Test
  void alreadyInTarget_isNoOp() throws Exception {
    long[] s = setup(false, "받은 메일");
    long id = messageId(s[1], "받은 메일");
    clearInvocations(notifier);

    MailMoveResponse r = moveService.move(s[0], s[1], req(Kind.INBOX, null, id));

    assertThat(r.results().get(0).ok()).isTrue();
    assertThat(serverSubjects("INBOX")).containsExactly("받은 메일");
    verify(notifier, never()).mailChanged(anyLong(), anyLong(), any(), any());
  }

  @Test
  void trash_movesToServerTrash_andDeletesLocally() throws Exception {
    long[] s = setup(true, "지울 메일");
    long id = messageId(s[1], "지울 메일");

    MailMoveResponse r = moveService.move(s[0], s[1], req(Kind.TRASH, null, id));

    assertThat(r.results().get(0).ok()).isTrue();
    assertThat(serverSubjects("Trash")).containsExactly("지울 메일"); // 영구 삭제가 아니다
    assertThat(serverSubjects("INBOX")).isEmpty();
    assertThat(dsl.fetchExists(EMAIL_MESSAGE, EMAIL_MESSAGE.ID.eq(id))).isFalse();
  }

  @Test
  void trash_withoutServerTrash_is400_andNothingMoves() throws Exception {
    long[] s = setup(false, "지울 메일");
    long id = messageId(s[1], "지울 메일");

    assertThatThrownBy(() -> moveService.move(s[0], s[1], req(Kind.TRASH, null, id)))
        .isInstanceOf(MailValidationException.class)
        .hasMessageContaining("휴지통");
    assertThat(serverSubjects("INBOX")).containsExactly("지울 메일");
  }

  @Test
  void partialFailure_reportsPerMessage_andKeepsFailedRow() throws Exception {
    long[] s = setup(false, "있는 메일", "사라진 메일");
    long ok = messageId(s[1], "있는 메일");
    long gone = messageId(s[1], "사라진 메일");
    long archiveId = folderId(s[1], "Archive");
    // 다른 앱에서 지운 메일(아직 동기화 전)
    withStore(
        store -> {
          Folder f = store.getFolder("INBOX");
          f.open(Folder.READ_WRITE);
          for (Message m : f.getMessages()) {
            if ("사라진 메일".equals(m.getSubject())) {
              m.setFlag(Flags.Flag.DELETED, true);
            }
          }
          f.close(true);
        });

    MailMoveResponse r = moveService.move(s[0], s[1], req(Kind.ARCHIVE, null, ok, gone));

    assertThat(r.results())
        .extracting(MailMoveResponse.Result::messageId, MailMoveResponse.Result::ok)
        .containsExactly(
            org.assertj.core.groups.Tuple.tuple(ok, true),
            org.assertj.core.groups.Tuple.tuple(gone, false));
    assertThat(r.results().get(1).error()).contains("찾을 수 없습니다");
    assertThat(row(ok).get(EMAIL_MESSAGE.FOLDER_ID)).isEqualTo(archiveId);
    assertThat(row(gone).get(EMAIL_MESSAGE.FOLDER_ID)).isEqualTo(folderId(s[1], "INBOX"));
  }

  @Test
  void copyFallback_withoutMove_usesCopyAndUidExpungeOnlyThoseMails() throws Exception {
    long[] s = setup(false, "옮길 메일", "다른 지운 표시 메일");
    long id = messageId(s[1], "옮길 메일");
    long archiveId = folderId(s[1], "Archive");
    // 같은 받은편지함에 다른 \Deleted 메일 — 일반 EXPUNGE 였다면 함께 사라진다
    withStore(
        store -> {
          Folder f = store.getFolder("INBOX");
          f.open(Folder.READ_WRITE);
          for (Message m : f.getMessages()) {
            if ("다른 지운 표시 메일".equals(m.getSubject())) {
              m.setFlag(Flags.Flag.DELETED, true);
            }
          }
          f.close(false); // expunge 하지 않는다
        });
    // MOVE 가 없는 서버처럼 보이게 하는 옮기기기 — 나머지 의존성은 실제 빈 그대로
    ImapMailMover noMove =
        new ImapMailMover(credentials, imapConnector) {
          @Override
          protected Capabilities capabilities(IMAPStore store) {
            return new Capabilities(false, true);
          }
        };
    MailMoveService service =
        new MailMoveService(
            accountRepo,
            folderRepo,
            messageRepo,
            attachmentRepo,
            List.of(noMove),
            notifier,
            txManager);

    MailMoveResponse r = service.move(s[0], s[1], req(Kind.ARCHIVE, null, id));

    assertThat(r.results().get(0).ok()).isTrue();
    assertThat(serverSubjects("Archive")).containsExactly("옮길 메일");
    assertThat(serverSubjects("INBOX")).containsExactly("다른 지운 표시 메일"); // 남의 \Deleted 는 그대로
    assertThat(row(id).get(EMAIL_MESSAGE.FOLDER_ID)).isEqualTo(archiveId);
    assertThat(row(id).get(EMAIL_MESSAGE.IMAP_UID)).isEqualTo(serverUid("Archive", "옮길 메일"));
  }

  @Test
  void neitherMoveNorUidPlus_failsWithoutTouchingServer() throws Exception {
    long[] s = setup(false, "옮길 메일");
    long id = messageId(s[1], "옮길 메일");
    ImapMailMover old =
        new ImapMailMover(credentials, imapConnector) {
          @Override
          protected Capabilities capabilities(IMAPStore store) {
            return new Capabilities(false, false);
          }
        };
    MailMoveService service =
        new MailMoveService(
            accountRepo,
            folderRepo,
            messageRepo,
            attachmentRepo,
            List.of(old),
            notifier,
            txManager);

    MailMoveResponse r = service.move(s[0], s[1], req(Kind.ARCHIVE, null, id));

    assertThat(r.results().get(0).ok()).isFalse();
    assertThat(serverSubjects("INBOX")).containsExactly("옮길 메일");
    assertThat(serverSubjects("Archive")).isEmpty();
  }

  @Test
  void uidValidityMismatch_failsWithoutTouchingServerOrLocalRow() throws Exception {
    long[] s = setup(false, "옮길 메일");
    long id = messageId(s[1], "옮길 메일");
    long inboxId = folderId(s[1], "INBOX");
    Long uidBefore = row(id).get(EMAIL_MESSAGE.IMAP_UID);
    // 서버에서 UIDVALIDITY 가 바뀐 것처럼 로컬 기록을 다른 값으로 — 저장된 UID 를 믿을 수 없다
    dsl.update(EMAIL_FOLDER)
        .set(EMAIL_FOLDER.UID_VALIDITY, 424242L)
        .where(EMAIL_FOLDER.ID.eq(inboxId))
        .execute();

    MailMoveResponse r = moveService.move(s[0], s[1], req(Kind.ARCHIVE, null, id));

    assertThat(r.results().get(0).ok()).isFalse();
    assertThat(r.results().get(0).error()).contains("메일함이 바뀌었습니다");
    assertThat(serverSubjects("INBOX")).containsExactly("옮길 메일");
    assertThat(serverSubjects("Archive")).isEmpty();
    assertThat(row(id).get(EMAIL_MESSAGE.FOLDER_ID)).isEqualTo(inboxId);
    assertThat(row(id).get(EMAIL_MESSAGE.IMAP_UID)).isEqualTo(uidBefore);
  }

  @Test
  void validation_404And400() throws Exception {
    long[] s = setup(false, "내 메일");
    long id = messageId(s[1], "내 메일");
    long other = TestFixtures.createHuman(dsl);

    // 남의 계정
    assertThatThrownBy(() -> moveService.move(other, s[1], req(Kind.ARCHIVE, null, id)))
        .isInstanceOf(EmailAccountNotFoundException.class);
    // 계정에 없는 메일
    assertThatThrownBy(
            () -> moveService.move(s[0], s[1], req(Kind.ARCHIVE, null, id, 999_999_999L)))
        .isInstanceOf(EmailMessageNotFoundException.class);
    // 계정에 없는 메일함
    assertThatThrownBy(() -> moveService.move(s[0], s[1], req(Kind.FOLDER, 999_999_999L, id)))
        .isInstanceOf(EmailFolderNotFoundException.class);
    // FOLDER 인데 메일함 없음·받은편지함 행(role 없음)
    assertThatThrownBy(() -> moveService.move(s[0], s[1], req(Kind.FOLDER, null, id)))
        .isInstanceOf(MailValidationException.class);
    long inboxId = folderId(s[1], "INBOX");
    assertThatThrownBy(() -> moveService.move(s[0], s[1], req(Kind.FOLDER, inboxId, id)))
        .isInstanceOf(MailValidationException.class);
    // 앱에서 보낸 기록(SENT)
    long sentFolder = folderRepo.ensureFolder(s[1], "SENT").id();
    long sent =
        dsl.insertInto(EMAIL_MESSAGE)
            .set(EMAIL_MESSAGE.ACCOUNT_ID, s[1])
            .set(EMAIL_MESSAGE.FOLDER_ID, sentFolder)
            .set(EMAIL_MESSAGE.THREAD_ID, "sent-thread")
            .set(EMAIL_MESSAGE.SEEN, true)
            .returning(EMAIL_MESSAGE.ID)
            .fetchOne()
            .getId();
    assertThatThrownBy(() -> moveService.move(s[0], s[1], req(Kind.ARCHIVE, null, sent)))
        .isInstanceOf(MailValidationException.class)
        .hasMessageContaining("보낸 메일");
    // 보관 메일함이 없는 계정
    dsl.deleteFrom(EMAIL_FOLDER)
        .where(EMAIL_FOLDER.ACCOUNT_ID.eq(s[1]))
        .and(EMAIL_FOLDER.ROLE.eq("ARCHIVE"))
        .execute();
    assertThatThrownBy(() -> moveService.move(s[0], s[1], req(Kind.ARCHIVE, null, id)))
        .isInstanceOf(MailValidationException.class)
        .hasMessageContaining("보관 메일함이 없습니다");
    // 아무것도 옮기지 않았다
    assertThat(serverSubjects("INBOX")).containsExactly("내 메일");
  }

  // ===== 헬퍼 =====

  private static GreenMailUser boxUser() {
    return greenMail.getUserManager().getUser("box@test.local");
  }

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

  private static List<String> serverSubjects(String folder) throws Exception {
    List<String> out = new ArrayList<>();
    withStore(
        store -> {
          Folder f = store.getFolder(folder);
          f.open(Folder.READ_ONLY);
          for (Message m : f.getMessages()) {
            out.add(m.getSubject());
          }
          f.close(false);
        });
    return out;
  }

  private static boolean isServerSeen(String folder, String subject) throws Exception {
    boolean[] seen = {false};
    withStore(
        store -> {
          Folder f = store.getFolder(folder);
          f.open(Folder.READ_ONLY);
          for (Message m : f.getMessages()) {
            if (subject.equals(m.getSubject())) {
              seen[0] = m.isSet(Flags.Flag.SEEN);
            }
          }
          f.close(false);
        });
    return seen[0];
  }

  private static long serverUid(String folder, String subject) throws Exception {
    long[] uid = {-1};
    withStore(
        store -> {
          Folder f = store.getFolder(folder);
          f.open(Folder.READ_ONLY);
          for (Message m : f.getMessages()) {
            if (subject.equals(m.getSubject())) {
              uid[0] = ((jakarta.mail.UIDFolder) f).getUID(m);
            }
          }
          f.close(false);
        });
    return uid[0];
  }

  private long folderId(long accountId, String name) {
    return dsl.select(EMAIL_FOLDER.ID)
        .from(EMAIL_FOLDER)
        .where(EMAIL_FOLDER.ACCOUNT_ID.eq(accountId))
        .and(EMAIL_FOLDER.NAME.eq(name))
        .fetchSingle(EMAIL_FOLDER.ID);
  }

  private long messageId(long accountId, String subject) {
    return dsl.select(EMAIL_MESSAGE.ID)
        .from(EMAIL_MESSAGE)
        .join(EMAIL_CONTENT)
        .on(EMAIL_CONTENT.ID.eq(EMAIL_MESSAGE.CONTENT_ID))
        .where(EMAIL_MESSAGE.ACCOUNT_ID.eq(accountId))
        .and(EMAIL_CONTENT.SUBJECT.eq(subject))
        .fetchSingle(EMAIL_MESSAGE.ID);
  }

  private Record row(long messageId) {
    return dsl.selectFrom(EMAIL_MESSAGE).where(EMAIL_MESSAGE.ID.eq(messageId)).fetchSingle();
  }

  private int countIn(long accountId, long folderId) {
    return dsl.fetchCount(
        EMAIL_MESSAGE,
        EMAIL_MESSAGE.ACCOUNT_ID.eq(accountId).and(EMAIL_MESSAGE.FOLDER_ID.eq(folderId)));
  }

  private Integer serverUnread(long folderId) {
    return dsl.select(EMAIL_FOLDER.SERVER_UNREAD)
        .from(EMAIL_FOLDER)
        .where(EMAIL_FOLDER.ID.eq(folderId))
        .fetchSingle(EMAIL_FOLDER.SERVER_UNREAD);
  }

  private void setServerUnread(long folderId, int value) {
    dsl.update(EMAIL_FOLDER)
        .set(EMAIL_FOLDER.SERVER_UNREAD, value)
        .where(EMAIL_FOLDER.ID.eq(folderId))
        .execute();
  }
}
