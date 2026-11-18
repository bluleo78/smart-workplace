package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.mail.ImapServerProbe.appendToServer;
import static com.workplace.mail.ImapServerProbe.serverSubjects;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.icegreen.greenmail.configuration.GreenMailConfiguration;
import com.icegreen.greenmail.junit5.GreenMailExtension;
import com.icegreen.greenmail.user.GreenMailUser;
import com.workplace.global.security.EncryptionService;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.mail.dto.EmailAccountRequest;
import com.workplace.mail.dto.MailMoveRequest;
import com.workplace.mail.dto.MailMoveRequest.Kind;
import com.workplace.mail.dto.MailMoveResponse;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.dto.MailTrashCountResponse;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.exception.MailSyncException;
import com.workplace.mail.exception.MailTrashException;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.service.MailSyncService;
import com.workplace.mail.service.folder.FolderRole;
import com.workplace.mail.service.folder.MailFolderService;
import com.workplace.mail.service.move.MailMoveService;
import com.workplace.mail.service.trash.MailTrashService;
import com.workplace.support.TestFixtures;
import java.util.ArrayList;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * 휴지통 메일 수 실시간 조회(WP-1708) IMAP 통합 테스트 — GreenMail. 휴지통 비우기 확인 창의 수는 로컬 목록의 낡은 값이 아니라 서버 휴지통의 실제 메일
 * 수다 — 다른 클라이언트가 넣은(앱이 모르는) 메일도 센다. 남의 계정은 404, 휴지통 행이 없는 계정은 400 NO_TRASH, 서버에 접속할 수 없으면 502(로컬
 * 값으로 대신하지 않는다).
 */
@Transactional
class MailTrashCountImapTest extends MailSyncTestSupport {

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
  @Autowired EncryptionService encryption;
  @Autowired MockMvc mvc;
  @Autowired JwtTokenProvider jwtTokenProvider;

  /**
   * 확인 창의 수는 서버 휴지통의 실제 수다 — 앱이 옮긴 메일 1통에 다른 클라이언트가 넣은(앱이 모르는) 메일이 섞여 있어도 서버 수를 그대로 돌려주고 로컬 행은
   * 그대로다. 컨트롤러 정상 경로도 같은 값을 응답한다(응답 필드 {@code $.count}).
   */
  @Test
  void trashCount_returnsServerActualCount_notLocalRows() throws Exception {
    long[] s = setup("휴지통으로", "받은 메일");
    move(s, Kind.TRASH, messageId(s[1], "휴지통으로"));
    appendToServer("Trash", "앱이 모르는 메일"); // 다른 클라이언트가 넣은 메일 — 앱 목록에는 없다

    assertThat(serverSubjects("Trash")).hasSize(2); // 서버 휴지통
    assertThat(countIn(s[1], trashId(s[1]))).isEqualTo(1); // 로컬 휴지통 행 — 앱이 아는 것만
    assertThat(trashService.trashCount(s[0], s[1])).isEqualTo(new MailTrashCountResponse(2));

    mvc.perform(
            get("/api/v1/mail/accounts/{a}/trash/count", s[1]).header("Authorization", token(s[0])))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.count").value(2));
  }

  /** 남의 계정은 소유 확인에서 404 — 서버에 접속하지 않는다. */
  @Test
  void trashCount_othersAccount_isNotFound() throws Exception {
    long[] s = setup("받은 메일");
    long other = TestFixtures.createHuman(dsl);

    assertThatThrownBy(() -> trashService.trashCount(other, s[1]))
        .isInstanceOf(EmailAccountNotFoundException.class);
  }

  /** 휴지통 행이 없는 계정은 접속도 하지 않고 400 NO_TRASH. */
  @Test
  void trashCount_noTrashRow_is400NoTrash() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.insertAccount(accountRepo, encryption, user, false);

    assertThatThrownBy(() -> trashService.trashCount(user, accountId))
        .isInstanceOfSatisfying(
            MailTrashException.class,
            e -> {
              assertThat(e.code()).isEqualTo(MailTrashException.NO_TRASH);
              assertThat(e.status().value()).isEqualTo(400);
            });
  }

  /** 서버에 접속할 수 없으면 수를 얻지 못했다 — 502(MailSyncException), 로컬 값으로 대신하지 않는다. */
  @Test
  void trashCount_unreachableServer_is502() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = unreachableAccount(user);

    assertThatThrownBy(() -> trashService.trashCount(user, accountId))
        .isInstanceOf(MailSyncException.class);

    mvc.perform(
            get("/api/v1/mail/accounts/{a}/trash/count", accountId)
                .header("Authorization", token(user)))
        .andExpect(status().isBadGateway());
  }

  // ===== 헬퍼 =====

  /** [user, account] — 서버 휴지통 메일함을 만들고 메일을 받은 뒤 동기화하고 휴지통을 한 번 가져온다. */
  private long[] setup(String... subjects) throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.insertAccount(accountRepo, encryption, user, false);
    greenMail.getManagers().getImapHostManager().createMailbox(boxUser(), "Trash");
    for (String s : subjects) {
      MailTestPorts.sendText("box@test.local", "sender@test.local", s, "본문 " + s);
    }
    greenMail.waitForIncomingEmail(subjects.length);
    syncService.sync(user, accountId);
    folderService.syncFolder(user, accountId, trashId(accountId), false);
    return new long[] {user, accountId};
  }

  /** 앱에서 메일을 휴지통으로 옮긴다 — 로컬 행 이동과 서버 MOVE 가 함께 이뤄진다. */
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

  /** 아무도 듣지 않는 서버(127.0.0.1:1)의 계정 — 휴지통 행은 로컬에 만들어 둔다. 접속 시도는 즉시 거절되어 서버 접속 실패 경로를 실제로 거친다. */
  private long unreachableAccount(long user) {
    EmailAccountRequest req =
        new EmailAccountRequest(
            "down@test.local",
            "끊긴 서버",
            "127.0.0.1",
            1,
            MailSecurity.NONE,
            "down@test.local",
            "127.0.0.1",
            1,
            MailSecurity.NONE,
            "down@test.local",
            "pw",
            false);
    long accountId = accountRepo.insert(user, req, encryption.encrypt("pw"));
    long trash = folderRepo.ensureFolder(accountId, "Trash").id();
    dsl.update(EMAIL_FOLDER)
        .set(EMAIL_FOLDER.ROLE, FolderRole.TRASH.name())
        .where(EMAIL_FOLDER.ID.eq(trash))
        .execute();
    return accountId;
  }

  private String token(long userId) {
    return "Bearer " + jwtTokenProvider.generateAccessToken(userId, "user-" + userId);
  }

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
