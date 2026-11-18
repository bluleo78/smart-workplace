package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.mail.ImapServerProbe.appendToServer;
import static com.workplace.mail.ImapServerProbe.isDeletedOnServer;
import static com.workplace.mail.ImapServerProbe.markDeletedOnServer;
import static com.workplace.mail.ImapServerProbe.serverSubjects;
import static com.workplace.mail.ImapServerProbe.withStore;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.icegreen.greenmail.configuration.GreenMailConfiguration;
import com.icegreen.greenmail.junit5.GreenMailExtension;
import com.icegreen.greenmail.user.GreenMailUser;
import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.MailFolderResponse;
import com.workplace.mail.dto.MailMoveRequest;
import com.workplace.mail.dto.MailMoveRequest.Kind;
import com.workplace.mail.dto.MailMoveResponse;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.exception.MailTrashException;
import com.workplace.mail.outbound.MailChangeNotifier;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.ImapConnector;
import com.workplace.mail.service.MailAccountCredentials;
import com.workplace.mail.service.MailSyncService;
import com.workplace.mail.service.folder.MailFolderService;
import com.workplace.mail.service.move.MailMoveService;
import com.workplace.mail.service.trash.ImapMailEraser;
import com.workplace.mail.service.trash.MailTrashEmptyJob;
import com.workplace.mail.service.trash.MailTrashEmptyProgress;
import com.workplace.mail.service.trash.MailTrashService;
import com.workplace.support.TestFixtures;
import jakarta.mail.Flags;
import jakarta.mail.Folder;
import jakarta.mail.Message;
import java.util.ArrayList;
import java.util.List;
import org.eclipse.angus.mail.imap.IMAPFolder;
import org.eclipse.angus.mail.imap.IMAPStore;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.task.TaskExecutor;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;

/**
 * 휴지통 메일 한 통 완전히 삭제(WP-1682) IMAP 통합 테스트 — GreenMail(MOVE·UIDPLUS 지원). 앱이 휴지통으로 옮긴 메일을 완전히 삭제하면 서버
 * 휴지통에서 그 메일만 UID EXPUNGE 로 사라지고(같은 휴지통에 다른 클라이언트가 {@code \Deleted} 만 붙여 둔 메일도 남는다), 로컬 행·첨부 행이
 * 지워지는지 본다. 휴지통 밖 메일·UIDPLUS 없는 서버·UIDVALIDITY 불일치·휴지통 이름 바뀜·서버에서 이미 사라진 메일·남의 계정도 본다.
 */
@Transactional
class MailPermanentDeleteImapTest extends MailSyncTestSupport {

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
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EncryptionService encryption;
  @Autowired MailAccountCredentials credentials;
  @Autowired ImapConnector imapConnector;
  @Autowired PlatformTransactionManager txManager;
  @Autowired MailChangeNotifier notifier;
  @Autowired MailTrashEmptyProgress emptyProgress;
  @Autowired MailTrashEmptyJob emptyJob;

  @Autowired
  @Qualifier("mailTrashEmptyExecutor")
  TaskExecutor emptyExecutor;

  /** [user, account] — 서버 메일함(Archive·Trash)을 만들고 받은편지함 메일을 받은 뒤 동기화하고 휴지통을 한 번 가져온다. */
  private long[] setup(String... subjects) throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.insertAccount(accountRepo, encryption, user, false);
    var mgr = greenMail.getManagers().getImapHostManager();
    mgr.createMailbox(boxUser(), "Archive");
    mgr.createMailbox(boxUser(), "Trash");
    for (String s : subjects) {
      MailTestPorts.sendText("box@test.local", "sender@test.local", s, "본문 " + s);
    }
    greenMail.waitForIncomingEmail(subjects.length);
    syncService.sync(user, accountId);
    // 휴지통을 한 번 가져온 상태(UIDVALIDITY 기록)
    folderService.syncFolder(user, accountId, trashId(accountId), false);
    return new long[] {user, accountId};
  }

  /** 앱에서 「삭제」(서버 휴지통으로 옮기기) — 같은 행이 휴지통 행으로 간다. */
  private void toTrash(long[] s, long... ids) {
    List<Long> list = new ArrayList<>();
    for (long id : ids) {
      list.add(id);
    }
    MailMoveResponse r =
        moveService.move(
            s[0], s[1], new MailMoveRequest(list, new MailMoveRequest.Target(Kind.TRASH, null)));
    assertThat(r.results()).allSatisfy(x -> assertThat(x.ok()).isTrue());
  }

  @Test
  void erase_removesOnlyThatMail_keepsOtherTrashMailAndForeignDeletedFlag() throws Exception {
    long[] s = setup("지울 메일", "남길 메일");
    long target = messageId(s[1], "지울 메일");
    long kept = messageId(s[1], "남길 메일");
    toTrash(s, target, kept);
    dsl.insertInto(EMAIL_ATTACHMENT)
        .set(EMAIL_ATTACHMENT.MESSAGE_ID, target)
        .set(EMAIL_ATTACHMENT.ORDINAL, 0)
        .execute();
    // 다른 클라이언트가 같은 휴지통에 지울 표시만 해 둔 메일 — 일반 EXPUNGE 였다면 함께 사라진다
    appendToServer("Trash", "남의 지운 표시");
    markDeletedOnServer("Trash", "남의 지운 표시");
    clearInvocations(notifier);

    MailMoveResponse r = trashService.permanentDelete(s[0], s[1], List.of(target));

    assertThat(r.results())
        .singleElement()
        .satisfies(
            x -> {
              assertThat(x.messageId()).isEqualTo(target);
              assertThat(x.ok()).isTrue();
              assertThat(x.error()).isNull();
            });
    assertThat(serverSubjects("Trash")).containsExactlyInAnyOrder("남길 메일", "남의 지운 표시");
    assertThat(isDeletedOnServer("Trash", "남의 지운 표시")).isTrue();
    assertThat(isDeletedOnServer("Trash", "남길 메일")).isFalse();
    assertThat(rowExists(target)).isFalse();
    assertThat(attachmentRowsOf(target)).isZero(); // ON DELETE CASCADE
    assertThat(rowExists(kept)).isTrue();
    verify(notifier).mailChanged(s[0], s[1], null, s[0]);
  }

  @Test
  void notInTrash_is400_andNothingChanges() throws Exception {
    long[] s = setup("휴지통 메일", "받은 메일");
    long trashed = messageId(s[1], "휴지통 메일");
    long inbox = messageId(s[1], "받은 메일");
    toTrash(s, trashed);
    clearInvocations(imapConnector, notifier);

    assertThatThrownBy(() -> trashService.permanentDelete(s[0], s[1], List.of(trashed, inbox)))
        .isInstanceOfSatisfying(
            MailTrashException.class,
            e -> {
              assertThat(e.code()).isEqualTo(MailTrashException.NOT_IN_TRASH);
              assertThat(e.getMessage()).isEqualTo("휴지통에 있는 메일만 완전히 삭제할 수 있습니다");
            });

    verify(imapConnector, never()).connect(any(), anyString());
    assertThat(serverSubjects("Trash")).containsExactly("휴지통 메일");
    assertThat(serverSubjects("INBOX")).containsExactly("받은 메일");
    assertThat(rowExists(trashed)).isTrue();
    assertThat(rowExists(inbox)).isTrue();
    verify(notifier, never()).mailChanged(anyLong(), anyLong(), any(), any());
  }

  @Test
  void noUidPlus_is400_recordsFalse_touchesNoFlag() throws Exception {
    long[] s = setup("지울 메일");
    long id = messageId(s[1], "지울 메일");
    toTrash(s, id);
    assertThat(accountRepo.findImapUidPlus(s[1])).isTrue(); // 목록 갱신이 GreenMail 의 UIDPLUS 를 적었다
    // UIDPLUS 가 없는 서버처럼 보이게 하는 지우개 — 나머지 의존성은 실제 빈 그대로
    ImapMailEraser noUidPlus =
        new ImapMailEraser(credentials, imapConnector) {
          @Override
          protected boolean uidPlus(IMAPStore store) {
            return false;
          }
        };
    MailTrashService service = serviceWith(List.of(noUidPlus));

    assertThatThrownBy(() -> service.permanentDelete(s[0], s[1], List.of(id)))
        .isInstanceOfSatisfying(
            MailTrashException.class,
            e -> {
              assertThat(e.code()).isEqualTo(MailTrashException.PERMANENT_DELETE_UNSUPPORTED);
              assertThat(e.getMessage()).isEqualTo("이 메일 서버는 완전히 삭제를 지원하지 않습니다");
            });

    assertThat(serverSubjects("Trash")).containsExactly("지울 메일");
    assertThat(isDeletedOnServer("Trash", "지울 메일")).isFalse();
    assertThat(rowExists(id)).isTrue();
    assertThat(accountRepo.findImapUidPlus(s[1])).isFalse();
    MailFolderResponse trash =
        folderService.list(s[0], s[1]).stream()
            .filter(f -> "TRASH".equals(f.role()))
            .findFirst()
            .orElseThrow();
    assertThat(trash.permanentDeleteUnsupported()).isTrue();
  }

  @Test
  void knownNoUidPlus_is400_withoutConnecting() throws Exception {
    long[] s = setup("지울 메일");
    long id = messageId(s[1], "지울 메일");
    toTrash(s, id);
    accountRepo.recordImapUidPlus(s[1], false);
    clearInvocations(imapConnector);

    assertThatThrownBy(() -> trashService.permanentDelete(s[0], s[1], List.of(id)))
        .isInstanceOfSatisfying(
            MailTrashException.class,
            e -> assertThat(e.code()).isEqualTo(MailTrashException.PERMANENT_DELETE_UNSUPPORTED));

    verify(imapConnector, never()).connect(any(), anyString());
    assertThat(serverSubjects("Trash")).containsExactly("지울 메일");
    assertThat(rowExists(id)).isTrue();
  }

  @Test
  void alreadyGoneOnServer_isOk_andLocalRowDeleted() throws Exception {
    long[] s = setup("이미 지운 메일");
    long id = messageId(s[1], "이미 지운 메일");
    toTrash(s, id);
    // 다른 클라이언트가 먼저 완전히 지웠다(그 메일만 UID EXPUNGE)
    withStore(
        store -> {
          IMAPFolder f = (IMAPFolder) store.getFolder("Trash");
          f.open(Folder.READ_WRITE);
          List<Message> target = new ArrayList<>();
          for (Message m : f.getMessages()) {
            if ("이미 지운 메일".equals(m.getSubject())) {
              target.add(m);
            }
          }
          Message[] arr = target.toArray(Message[]::new);
          f.setFlags(arr, new Flags(Flags.Flag.DELETED), true);
          f.expunge(arr);
          f.close(false);
        });
    assertThat(serverSubjects("Trash")).isEmpty();

    MailMoveResponse r = trashService.permanentDelete(s[0], s[1], List.of(id));

    assertThat(r.results()).singleElement().satisfies(x -> assertThat(x.ok()).isTrue());
    assertThat(rowExists(id)).isFalse();
  }

  @Test
  void uidValidityMismatch_failsPerMail_noChange() throws Exception {
    long[] s = setup("지울 메일");
    long id = messageId(s[1], "지울 메일");
    toTrash(s, id);
    // 서버에서 UIDVALIDITY 가 바뀐 것처럼 휴지통 행 기록을 다른 값으로 — 저장된 UID 를 믿을 수 없다
    dsl.update(EMAIL_FOLDER)
        .set(EMAIL_FOLDER.UID_VALIDITY, 424242L)
        .where(EMAIL_FOLDER.ID.eq(trashId(s[1])))
        .execute();
    clearInvocations(notifier);

    MailMoveResponse r = trashService.permanentDelete(s[0], s[1], List.of(id));

    assertThat(r.results())
        .singleElement()
        .satisfies(
            x -> {
              assertThat(x.ok()).isFalse();
              assertThat(x.error()).isEqualTo("메일함이 바뀌었습니다 — 동기화 후 다시 시도해 주세요");
            });
    assertThat(serverSubjects("Trash")).containsExactly("지울 메일");
    assertThat(isDeletedOnServer("Trash", "지울 메일")).isFalse();
    assertThat(rowExists(id)).isTrue();
    verify(notifier, never()).mailChanged(anyLong(), anyLong(), any(), any());
  }

  /**
   * {@code \Deleted} 를 붙인 뒤 UID EXPUNGE 가 실패하면 그 표시를 되돌린다 — 표시가 남으면 다른 클라이언트의 일반 EXPUNGE 가 앱이 「지우지
   * 못했다」고 알린 메일을 지운다. 결과는 메일별 실패이고 서버·로컬 모두 그대로다.
   */
  @Test
  void expungeFails_clearsDeletedFlag_andFailsPerMail() throws Exception {
    long[] s = setup("지울 메일");
    long id = messageId(s[1], "지울 메일");
    toTrash(s, id);
    ImapMailEraser expungeFails =
        new ImapMailEraser(credentials, imapConnector) {
          @Override
          protected void expungeFlagged(IMAPFolder folder, Message[] msgs)
              throws jakarta.mail.MessagingException {
            assertThat(msgs[0].isSet(Flags.Flag.DELETED)).isTrue(); // 표시는 붙은 뒤다
            throw new jakarta.mail.MessagingException("NO UID EXPUNGE 실패");
          }
        };
    MailTrashService service = serviceWith(List.of(expungeFails));

    MailMoveResponse r = service.permanentDelete(s[0], s[1], List.of(id));

    assertThat(r.results())
        .singleElement()
        .satisfies(
            x -> {
              assertThat(x.ok()).isFalse();
              assertThat(x.error()).isEqualTo("메일 서버에서 지우지 못했습니다");
            });
    assertThat(serverSubjects("Trash")).containsExactly("지울 메일");
    assertThat(isDeletedOnServer("Trash", "지울 메일")).isFalse();
    assertThat(rowExists(id)).isTrue();
  }

  @Test
  void trashRenamedSinceListing_failsPerMail() throws Exception {
    long[] s = setup("지울 메일");
    long id = messageId(s[1], "지울 메일");
    toTrash(s, id);
    // 지난 목록 갱신 때의 휴지통 이름 — 지금 서버의 휴지통은 「Trash」다
    dsl.update(EMAIL_FOLDER)
        .set(EMAIL_FOLDER.NAME, "OldTrash")
        .where(EMAIL_FOLDER.ID.eq(trashId(s[1])))
        .execute();

    MailMoveResponse r = trashService.permanentDelete(s[0], s[1], List.of(id));

    assertThat(r.results())
        .singleElement()
        .satisfies(
            x -> {
              assertThat(x.ok()).isFalse();
              assertThat(x.error()).isEqualTo("메일 서버 휴지통이 바뀌었습니다 — 새로 고친 뒤 다시 시도해 주세요");
            });
    assertThat(serverSubjects("Trash")).containsExactly("지울 메일");
    assertThat(isDeletedOnServer("Trash", "지울 메일")).isFalse();
    assertThat(rowExists(id)).isTrue();
  }

  @Test
  void duplicateIds_areErasedOnce() throws Exception {
    long[] s = setup("지울 메일");
    long id = messageId(s[1], "지울 메일");
    toTrash(s, id);

    MailMoveResponse r = trashService.permanentDelete(s[0], s[1], List.of(id, id));

    assertThat(r.results())
        .singleElement()
        .satisfies(
            x -> {
              assertThat(x.messageId()).isEqualTo(id);
              assertThat(x.ok()).isTrue();
            });
    assertThat(serverSubjects("Trash")).isEmpty();
    assertThat(rowExists(id)).isFalse();
  }

  @Test
  void othersAccount_is404() throws Exception {
    long[] s = setup("내 메일");
    long id = messageId(s[1], "내 메일");
    toTrash(s, id);
    long other = TestFixtures.createHuman(dsl);

    assertThatThrownBy(() -> trashService.permanentDelete(other, s[1], List.of(id)))
        .isInstanceOf(EmailAccountNotFoundException.class);

    assertThat(serverSubjects("Trash")).containsExactly("내 메일");
    assertThat(rowExists(id)).isTrue();
  }

  /** 계정 공급자의 지우개가 없으면(새 공급자를 더했는데 지우개가 없는 등) null 조회로 500 이 아니라 지원하지 않음 400 이다. */
  @Test
  void noEraserForProvider_isUnsupported_withoutConnecting() throws Exception {
    long[] s = setup("지울 메일");
    long id = messageId(s[1], "지울 메일");
    toTrash(s, id);
    clearInvocations(imapConnector);
    MailTrashService service = serviceWith(List.of());

    assertThatThrownBy(() -> service.permanentDelete(s[0], s[1], List.of(id)))
        .isInstanceOfSatisfying(
            MailTrashException.class,
            e -> assertThat(e.code()).isEqualTo(MailTrashException.PERMANENT_DELETE_UNSUPPORTED));

    verify(imapConnector, never()).connect(any(), anyString());
    assertThat(serverSubjects("Trash")).containsExactly("지울 메일");
    assertThat(rowExists(id)).isTrue();
    // 서버가 막은 것이 아니므로 계정의 UIDPLUS 기록은 그대로
    assertThat(accountRepo.findImapUidPlus(s[1])).isTrue();
  }

  // ===== 헬퍼 =====

  private MailTrashService serviceWith(List<com.workplace.mail.service.trash.MailEraser> erasers) {
    return new MailTrashService(
        accountRepo,
        folderRepo,
        messageRepo,
        erasers,
        notifier,
        txManager,
        emptyProgress,
        emptyJob,
        emptyExecutor);
  }

  private static GreenMailUser boxUser() {
    return greenMail.getUserManager().getUser("box@test.local");
  }

  /** 계정의 휴지통 행 id(목록 갱신이 role TRASH 로 넣는다). */
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

  private boolean rowExists(long messageId) {
    return dsl.fetchExists(EMAIL_MESSAGE, EMAIL_MESSAGE.ID.eq(messageId));
  }

  private int attachmentRowsOf(long messageId) {
    return dsl.fetchCount(EMAIL_ATTACHMENT, EMAIL_ATTACHMENT.MESSAGE_ID.eq(messageId));
  }
}
