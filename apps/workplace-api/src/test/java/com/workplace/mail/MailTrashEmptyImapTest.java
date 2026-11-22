package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.mail.ImapServerProbe.appendToServer;
import static com.workplace.mail.ImapServerProbe.isDeletedOnServer;
import static com.workplace.mail.ImapServerProbe.serverSubjects;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
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
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.MailTrashEmptyStatus;
import com.workplace.mail.exception.MailTrashException;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.service.ImapConnector;
import com.workplace.mail.service.MailAccountCredentials;
import com.workplace.mail.service.MailServerErrors;
import com.workplace.mail.service.MailSyncService;
import com.workplace.mail.service.folder.MailFolderService;
import com.workplace.mail.service.move.MailMoveService;
import com.workplace.mail.service.trash.ImapMailEraser;
import com.workplace.mail.service.trash.MailTrashEmptyProgress;
import com.workplace.mail.service.trash.MailTrashService;
import com.workplace.support.TestFixtures;
import jakarta.mail.FolderClosedException;
import jakarta.mail.Message;
import jakarta.mail.MessagingException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.eclipse.angus.mail.imap.IMAPFolder;
import org.eclipse.angus.mail.imap.IMAPStore;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.task.SyncTaskExecutor;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.annotation.Transactional;

/**
 * 휴지통 비우기(WP-1682) IMAP 통합 테스트 — GreenMail(MOVE·UIDPLUS 지원). 비우기는 앱이 가져오지 않은 옛 메일까지 서버 휴지통 바로 아래
 * 메일을 모두 지우고(받은편지함·보관은 그대로), 로컬 휴지통 행도 지우며 상태 DONE 으로 끝나는지 본다. 휴지통 이름이 바뀌었거나 UIDPLUS 가 없으면 FAILED
 * 이고 아무것도 지우지 않는다. 실행 중 다시 누르면 같은 작업, 시작 전 거절(휴지통 없음·UIDPLUS 없음 기록)도 본다.
 *
 * <p>실행기는 동기 실행기로 바꿔 {@code startEmpty} 가 끝난 상태를 바로 돌려주게 한다. 실행기·묶음 크기·서비스의 지우개는 모두 테스트 클래스가 공유하는
 * 싱글턴 빈의 필드라 {@link #restore()} 에서 원래 값으로 되돌린다.
 */
@Transactional
class MailTrashEmptyImapTest extends MailSyncTestSupport {

  @RegisterExtension
  static GreenMailExtension greenMail =
      new MailTestGreenMail()
          .withConfiguration(
              GreenMailConfiguration.aConfig().withUser("box@test.local", "box@test.local", "pw"));

  @Autowired DSLContext dsl;
  @Autowired MailSyncService syncService;
  @Autowired MailFolderService folderService;
  @Autowired MailMoveService moveService;
  @Autowired MailTrashService trashService;
  @Autowired MailTrashEmptyProgress progress;
  @Autowired ImapMailEraser imapMailEraser;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired EncryptionService encryption;
  @Autowired MailAccountCredentials credentials;
  @Autowired ImapConnector imapConnector;

  private Object originalExecutor;
  private Object originalErasers;
  private final List<Long> startedAccounts = new ArrayList<>();

  @BeforeEach
  void syncExecutor() {
    originalExecutor = ReflectionTestUtils.getField(trashService, "emptyExecutor");
    originalErasers = ReflectionTestUtils.getField(trashService, "erasers");
    ReflectionTestUtils.setField(trashService, "emptyExecutor", new SyncTaskExecutor());
  }

  @AfterEach
  void restore() {
    ReflectionTestUtils.setField(trashService, "emptyExecutor", originalExecutor);
    ReflectionTestUtils.setField(trashService, "erasers", originalErasers);
    ReflectionTestUtils.setField(imapMailEraser, "imapChunk", ImapMailEraser.IMAP_CHUNK);
    // 진행 상태도 싱글턴이다 — 이 클래스가 시작한 계정은 시작 전으로 되돌린다
    startedAccounts.forEach(progress::discardForTest);
  }

  /** [user, account] — 서버 메일함(Archive·Trash)을 만들고 받은편지함 메일을 받은 뒤 동기화하고 휴지통을 한 번 가져온다. */
  private long[] setup(String... subjects) throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.insertAccount(accountRepo, encryption, user, false);
    startedAccounts.add(accountId);
    var mgr = greenMail.getManagers().getImapHostManager();
    mgr.createMailbox(boxUser(), "Archive");
    mgr.createMailbox(boxUser(), "Trash");
    for (String s : subjects) {
      MailTestPorts.sendText("box@test.local", "sender@test.local", s, "본문 " + s);
    }
    greenMail.waitForIncomingEmail(subjects.length);
    syncService.sync(user, accountId);
    folderService.syncFolder(user, accountId, trashId(accountId), false);
    return new long[] {user, accountId};
  }

  /** 앱에서 메일들을 옮긴다(휴지통·보관) — 같은 행이 대상 메일함 행으로 간다. */
  private void move(long[] s, Kind kind, long... ids) {
    List<Long> list = new ArrayList<>();
    for (long id : ids) {
      list.add(id);
    }
    MailMoveResponse r =
        moveService.move(
            s[0], s[1], new MailMoveRequest(list, new MailMoveRequest.Target(kind, null)));
    assertThat(r.results()).allSatisfy(x -> assertThat(x.ok()).isTrue());
  }

  /** 휴지통 2통(앱이 옮김) + 서버에만 있는 옛 메일 1통 + 받은편지함 1통 + 보관 1통을 만든다. */
  private long[] trashScenario() throws Exception {
    long[] s = setup("휴지통 하나", "휴지통 둘", "받은 메일", "보관 메일");
    move(s, Kind.TRASH, messageId(s[1], "휴지통 하나"), messageId(s[1], "휴지통 둘"));
    move(s, Kind.ARCHIVE, messageId(s[1], "보관 메일"));
    appendToServer("Trash", "옛 메일"); // 앱에 없는(30일 지난) 메일
    assertThat(countIn(s[1], trashId(s[1]))).isEqualTo(2);
    return s;
  }

  @Test
  void empty_clearsServerTrashIncludingUnfetchedOld_keepsOtherBoxes() throws Exception {
    long[] s = trashScenario();
    long trash = trashId(s[1]);
    ReflectionTestUtils.setField(imapMailEraser, "imapChunk", 2); // 여러 묶음(2 + 1)

    MailTrashEmptyStatus st = trashService.startEmpty(s[0], s[1]);

    assertThat(st.state()).isEqualTo("DONE");
    assertThat(st.total()).isEqualTo(3);
    assertThat(st.deleted()).isEqualTo(3);
    assertThat(st.failed()).isZero();
    assertThat(st.startedAt()).isNotNull();
    assertThat(st.finishedAt()).isNotNull();
    assertThat(serverSubjects("Trash")).isEmpty();
    assertThat(serverSubjects("INBOX")).containsExactly("받은 메일");
    assertThat(serverSubjects("Archive")).containsExactly("보관 메일");
    assertThat(countIn(s[1], trash)).isZero();
    assertThat(trashService.emptyStatus(s[0], s[1])).isEqualTo(st);
  }

  /** 저장된 비밀번호를 읽지 못하면 연결 실패가 아닌 자격증명 사유로 멈추고, 서버는 건드리지 않는다(WP-1907). */
  @Test
  void storedPasswordUnreadable_failsCredentialUnreadable_serverUntouched() throws Exception {
    long[] s = trashScenario();
    MailTestSupport.setStoredPassword(dsl, s[1], "not-encrypted");

    MailTrashEmptyStatus st = trashService.startEmpty(s[0], s[1]);

    assertThat(st.state()).isEqualTo("FAILED");
    assertThat(st.errorCode()).isEqualTo(MailTrashException.CREDENTIAL_UNREADABLE);
    assertThat(st.error()).isEqualTo(MailServerErrors.CREDENTIAL_UNREADABLE);
    assertThat(serverSubjects("Trash")).hasSize(3);
  }

  @Test
  void emptyTrash_isDoneWithZero() throws Exception {
    long[] s = setup("받은 메일");

    MailTrashEmptyStatus st = trashService.startEmpty(s[0], s[1]);

    assertThat(st.state()).isEqualTo("DONE");
    assertThat(st.total()).isZero();
    assertThat(st.deleted()).isZero();
    assertThat(serverSubjects("INBOX")).containsExactly("받은 메일");
  }

  @Test
  void trashRenamedSinceListing_failsTrashChanged_deletesNothing() throws Exception {
    long[] s = trashScenario();
    dsl.update(EMAIL_FOLDER)
        .set(EMAIL_FOLDER.NAME, "OldTrash")
        .where(EMAIL_FOLDER.ID.eq(trashId(s[1])))
        .execute();

    MailTrashEmptyStatus st = trashService.startEmpty(s[0], s[1]);

    assertThat(st.state()).isEqualTo("FAILED");
    assertThat(st.errorCode()).isEqualTo(MailTrashException.TRASH_CHANGED);
    assertThat(st.error()).isEqualTo("메일 서버 휴지통이 바뀌었습니다 — 새로 고친 뒤 다시 시도해 주세요");
    assertThat(st.total()).isNull();
    assertThat(st.deleted()).isZero();
    assertThat(serverSubjects("Trash")).containsExactlyInAnyOrder("휴지통 하나", "휴지통 둘", "옛 메일");
  }

  @Test
  void noUidPlus_failsAndRecords() throws Exception {
    long[] s = trashScenario();
    assertThat(accountRepo.findImapUidPlus(s[1])).isTrue();
    ImapMailEraser noUidPlus =
        new ImapMailEraser(credentials, imapConnector) {
          @Override
          protected boolean uidPlus(IMAPStore store) {
            return false;
          }
        };
    ReflectionTestUtils.setField(trashService, "erasers", Map.of(MailProvider.IMAP, noUidPlus));

    MailTrashEmptyStatus st = trashService.startEmpty(s[0], s[1]);

    assertThat(st.state()).isEqualTo("FAILED");
    assertThat(st.errorCode()).isEqualTo(MailTrashException.PERMANENT_DELETE_UNSUPPORTED);
    assertThat(st.error()).isEqualTo("이 메일 서버는 완전히 삭제를 지원하지 않습니다");
    assertThat(accountRepo.findImapUidPlus(s[1])).isFalse();
    assertThat(serverSubjects("Trash")).hasSize(3);
    assertThat(countIn(s[1], trashId(s[1]))).isEqualTo(2);
  }

  /** 한 묶음의 지우기 명령이 실패하면 그 묶음만 실패로 세고 다음 묶음을 이어 지운다(DONE, failed 있음). */
  @Test
  void chunkCommandFails_countsFailed_continuesNextChunk() throws Exception {
    long[] s = trashScenario();
    ImapMailEraser firstChunkFails =
        new ImapMailEraser(credentials, imapConnector) {
          private int calls;

          @Override
          protected void eraseMessages(long accountId, IMAPFolder folder, List<Message> msgs)
              throws MessagingException {
            if (calls++ == 0) {
              throw new MessagingException("NO 명령 실패");
            }
            super.eraseMessages(accountId, folder, msgs);
          }
        };
    ReflectionTestUtils.setField(firstChunkFails, "imapChunk", 2);
    ReflectionTestUtils.setField(
        trashService, "erasers", Map.of(MailProvider.IMAP, firstChunkFails));

    MailTrashEmptyStatus st = trashService.startEmpty(s[0], s[1]);

    assertThat(st.state()).isEqualTo("DONE");
    assertThat(st.total()).isEqualTo(3);
    assertThat(st.deleted()).isEqualTo(1);
    assertThat(st.failed()).isEqualTo(2);
    assertThat(serverSubjects("Trash")).hasSize(2);
  }

  /** 묶음 도중 연결이 끊기면 한 번 다시 접속해 같은 묶음부터 이어 지운다. */
  @Test
  void connectionDropped_reconnectsOnce_andFinishes() throws Exception {
    long[] s = trashScenario();
    ImapMailEraser dropsOnce =
        new ImapMailEraser(credentials, imapConnector) {
          private int calls;

          @Override
          protected void eraseMessages(long accountId, IMAPFolder folder, List<Message> msgs)
              throws MessagingException {
            if (calls++ == 0) {
              throw new FolderClosedException(folder, "연결 끊김");
            }
            super.eraseMessages(accountId, folder, msgs);
          }
        };
    ReflectionTestUtils.setField(dropsOnce, "imapChunk", 2);
    ReflectionTestUtils.setField(trashService, "erasers", Map.of(MailProvider.IMAP, dropsOnce));

    MailTrashEmptyStatus st = trashService.startEmpty(s[0], s[1]);

    assertThat(st.state()).isEqualTo("DONE");
    assertThat(st.deleted()).isEqualTo(3);
    assertThat(st.failed()).isZero();
    assertThat(serverSubjects("Trash")).isEmpty();
    assertThat(countIn(s[1], trashId(s[1]))).isZero();
  }

  /**
   * 한 묶음에서 {@code \Deleted} 를 붙인 뒤 UID EXPUNGE 가 실패하면 그 묶음 메일의 표시를 되돌리고 실패로 센다 — 표시가 남으면 다른 클라이언트의
   * 일반 EXPUNGE 가 「지우지 못했다」고 센 메일을 지운다. 다음 묶음은 이어 지운다.
   */
  @Test
  void chunkExpungeFails_clearsDeletedFlags_countsFailed() throws Exception {
    long[] s = trashScenario();
    ImapMailEraser firstExpungeFails =
        new ImapMailEraser(credentials, imapConnector) {
          private int calls;

          @Override
          protected void expungeFlagged(IMAPFolder folder, Message[] msgs)
              throws MessagingException {
            if (calls++ == 0) {
              throw new MessagingException("NO UID EXPUNGE 실패");
            }
            super.expungeFlagged(folder, msgs);
          }
        };
    ReflectionTestUtils.setField(firstExpungeFails, "imapChunk", 2);
    ReflectionTestUtils.setField(
        trashService, "erasers", Map.of(MailProvider.IMAP, firstExpungeFails));

    MailTrashEmptyStatus st = trashService.startEmpty(s[0], s[1]);

    assertThat(st.state()).isEqualTo("DONE");
    assertThat(st.deleted()).isEqualTo(1);
    assertThat(st.failed()).isEqualTo(2);
    List<String> left = serverSubjects("Trash");
    assertThat(left).hasSize(2);
    for (String subject : left) {
      assertThat(isDeletedOnServer("Trash", subject)).as(subject).isFalse();
    }
  }

  /**
   * 시작 확인 뒤 실행 전에 계정 연결이 해제되면(비밀번호 조회에 계정이 없다) 서버 연결 실패가 아니라 FAILED(ACCOUNT_GONE)이고 서버는 그대로다. 실행기가
   * 작업을 돌리기 직전에 계정을 해제한다.
   */
  @Test
  void accountDisconnectedBeforeRun_failsAccountGone() throws Exception {
    long[] s = trashScenario();
    SyncTaskExecutor sync = new SyncTaskExecutor();
    ReflectionTestUtils.setField(
        trashService,
        "emptyExecutor",
        (org.springframework.core.task.TaskExecutor)
            task -> {
              dsl.update(EMAIL_ACCOUNT)
                  .set(EMAIL_ACCOUNT.DISABLED_AT, java.time.OffsetDateTime.now())
                  .where(EMAIL_ACCOUNT.ID.eq(s[1]))
                  .execute();
              sync.execute(task);
            });

    MailTrashEmptyStatus st = trashService.startEmpty(s[0], s[1]);

    assertThat(st.state()).isEqualTo("FAILED");
    assertThat(st.errorCode()).isEqualTo(MailTrashException.ACCOUNT_GONE);
    assertThat(serverSubjects("Trash")).hasSize(3);
  }

  @Test
  void startWhileRunning_returnsSameRunningState_withoutTouchingServer() throws Exception {
    long[] s = trashScenario();
    assertThat(progress.tryStart(s[1])).isPresent(); // 이미 도는 작업
    clearInvocations(imapConnector);

    MailTrashEmptyStatus st = trashService.startEmpty(s[0], s[1]);

    assertThat(st.state()).isEqualTo("RUNNING");
    assertThat(st).isEqualTo(progress.snapshot(s[1]));
    verify(imapConnector, never()).connect(any(), anyString());
    assertThat(serverSubjects("Trash")).hasSize(3);
  }

  @Test
  void noTrashRow_is400NoTrash() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.insertAccount(accountRepo, encryption, user, false);

    assertThatThrownBy(() -> trashService.startEmpty(user, accountId))
        .isInstanceOfSatisfying(
            MailTrashException.class,
            e -> {
              assertThat(e.code()).isEqualTo(MailTrashException.NO_TRASH);
              assertThat(e.status().value()).isEqualTo(400);
            });
    assertThat(progress.snapshot(accountId).state()).isEqualTo("IDLE");
  }

  @Test
  void knownNoUidPlus_is400() throws Exception {
    long[] s = trashScenario();
    accountRepo.recordImapUidPlus(s[1], false);
    clearInvocations(imapConnector);

    assertThatThrownBy(() -> trashService.startEmpty(s[0], s[1]))
        .isInstanceOfSatisfying(
            MailTrashException.class,
            e -> assertThat(e.code()).isEqualTo(MailTrashException.PERMANENT_DELETE_UNSUPPORTED));
    verify(imapConnector, never()).connect(any(), anyString());
    assertThat(serverSubjects("Trash")).hasSize(3);
    assertThat(progress.snapshot(s[1]).state()).isEqualTo("IDLE");
  }

  // ===== 헬퍼 =====

  private static GreenMailUser boxUser() {
    return greenMail.getUserManager().getUser("box@test.local");
  }

  private long trashId(long accountId) {
    return folderRepo.findTrash(accountId).orElseThrow().id();
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

  /** 계정의 한 메일함 행에 남은 로컬 메일 수. */
  private int countIn(long accountId, long folderId) {
    return dsl.fetchCount(
        EMAIL_MESSAGE,
        EMAIL_MESSAGE.ACCOUNT_ID.eq(accountId).and(EMAIL_MESSAGE.FOLDER_ID.eq(folderId)));
  }
}
