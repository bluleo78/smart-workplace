package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.EmailAccountRequest;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.repository.EmailMessageRepository.InboxPushCandidate;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * EmailMessageRepository — 새 메일 푸시 쿼리(maxInboxId·findNewUnreadInbox) 파라미터 통합 테스트(WP-1739, Task 3 에서
 * 이관).
 *
 * <p>진짜 DB 에 email_folder·email_message·email_content 행을 넣고 경계(afterId)·folderScope(INBOX + 서버
 * 보낸편지함 제외)·SEEN·계정 범위·limit·id 내림차순 정렬·프로젝션(제목·분류·자동발송 판정값)이 쿼리 파라미터대로 동작하는지 검증한다 — 목 스텁은 파라미터 자체를
 * 확인할 수 없어 통합 테스트가 필요하다.
 */
@Transactional
class EmailMessageRepositoryPushQueryTest extends IntegrationTestBase {

  /** imapUid·messageId 공용 시퀀스 — (계정, 폴더, uid) 유니크 제약과 content 공유 지문을 벗어나게 하려고 한다. */
  private static final AtomicInteger SEQ = new AtomicInteger();

  @Autowired DSLContext dsl;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EncryptionService encryption;

  /** 테스트용 이메일 계정 생성 — EmailMessageRepositoryTest 와 같은 픽스처. */
  private long createAccount(long userId, String email) {
    EmailAccountRequest req =
        new EmailAccountRequest(
            email,
            "표시명",
            "127.0.0.1",
            MailTestPorts.IMAP,
            MailSecurity.NONE,
            email,
            "127.0.0.1",
            MailTestPorts.SMTP,
            MailSecurity.NONE,
            email,
            "pw",
            false);
    return accountRepo.insert(userId, req, encryption.encrypt("pw"));
  }

  /**
   * 픽스처 — EmailMessageRepositoryTest.seedMessage 와 같은 경로(insertIgnoreConflict + content 연결)로 메시지를
   * 지정 폴더에 넣고 생성된 id 를 돌려준다. 발신자·제목은 프로젝션 단언용으로 고정한다.
   *
   * @param seen true=읽음, false=안읽음
   */
  private long seedMessage(long accountId, long folderId, boolean seen) {
    int n = SEQ.incrementAndGet();
    ParsedMessage parsed =
        new ParsedMessage(
            n,
            "push-query-" + n + "@test.local",
            "thread-push-query-" + n,
            null,
            null,
            "sender@example.com",
            "발신자",
            null,
            null,
            "테스트 제목",
            Instant.now(),
            Instant.now(),
            seen,
            false,
            null,
            null,
            null,
            List.of());
    long envId = messageRepo.insertIgnoreConflict(accountId, folderId, parsed).orElseThrow();
    // WP-130: 분류 등 본문 유래 값은 적재된 envelope 에만 노출 — 프로젝션(유효 분류) 조건을 만족시킨다.
    TestFixtures.markMailFetched(dsl, envId);
    return envId;
  }

  /** 후보 목록 → id 목록(id 내림차순 그대로) — 단언을 읽기 쉽게 한다. */
  private static List<Long> ids(List<InboxPushCandidate> candidates) {
    return candidates.stream().map(InboxPushCandidate::id).toList();
  }

  /** 메시지의 content id — email_content 에 직접 쓰는 단언용. */
  private Long contentIdOf(long messageId) {
    return dsl.select(EMAIL_MESSAGE.CONTENT_ID)
        .from(EMAIL_MESSAGE)
        .where(EMAIL_MESSAGE.ID.eq(messageId))
        .fetchOne(EMAIL_MESSAGE.CONTENT_ID);
  }

  /** maxInboxId — 받은편지함에 행이 없으면 0(경계 시작점). */
  @Test
  void maxInboxId_행이_없으면_0이다() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccount(userId, "push-empty@test.local");

    assertThat(messageRepo.maxInboxId(accountId)).isZero();
  }

  /** maxInboxId — 같은 계정 INBOX 의 최대 id(읽음·안 읽음 모두 경계에 포함 — 경계는 읽음 여부를 세지 않는다). */
  @Test
  void maxInboxId_같은_계정_INBOX_최대_id() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccount(userId, "push-max@test.local");
    long inbox = folderRepo.ensureFolder(accountId, "INBOX").id();
    long m1 = seedMessage(accountId, inbox, false);
    long m2 = seedMessage(accountId, inbox, true);

    assertThat(messageRepo.maxInboxId(accountId)).isEqualTo(m2);
    assertThat(m2).isGreaterThan(m1);
  }

  /** maxInboxId — 다른 폴더·다른 계정의 더 큰 id 는 경계에 오지 않는다(folderScope + accountId 범위). */
  @Test
  void maxInboxId_다른_폴더와_다른_계정은_경계에_없다() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccount(userId, "push-scope@test.local");
    long otherUserId = TestFixtures.createHuman(dsl);
    long otherAccountId = createAccount(otherUserId, "push-other@test.local");
    long inbox = folderRepo.ensureFolder(accountId, "INBOX").id();
    long mine = seedMessage(accountId, inbox, false);
    long archive = folderRepo.ensureFolder(accountId, "Archive").id();
    long otherFolder = seedMessage(accountId, archive, false);
    long otherAccount =
        seedMessage(otherAccountId, folderRepo.ensureFolder(otherAccountId, "INBOX").id(), false);

    assertThat(otherFolder).isGreaterThan(mine);
    assertThat(otherAccount).isGreaterThan(mine);
    assertThat(messageRepo.maxInboxId(accountId)).isEqualTo(mine);
  }

  /**
   * maxInboxId·findNewUnreadInbox — 이름은 INBOX 이지만 SERVER_SENT 로 표시된 폴더는 folderScope("INBOX") 밖(앱
   * 발송본의 서버 사본을 받은편지함으로 세지 않기 위한 판정).
   */
  @Test
  void server_보낸편지함으로_표시된_INBOX는_경계와_후보_모두에_없다() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccount(userId, "push-sent-inbox@test.local");
    long folderId =
        dsl.insertInto(EMAIL_FOLDER)
            .set(EMAIL_FOLDER.ACCOUNT_ID, accountId)
            .set(EMAIL_FOLDER.NAME, "INBOX")
            .set(EMAIL_FOLDER.SERVER_SENT, true)
            .returning(EMAIL_FOLDER.ID)
            .fetchOne()
            .getId();
    long hidden = seedMessage(accountId, folderId, false);

    assertThat(messageRepo.maxInboxId(accountId)).isZero();
    assertThat(messageRepo.findNewUnreadInbox(accountId, 0, 10)).isEmpty();
    assertThat(hidden).isPositive();
  }

  /** findNewUnreadInbox — afterId 경계: 그 뒤의 안 읽은 메일만, id 내림차순. 경계가 최대 id 면 후보 없음. */
  @Test
  void findNewUnreadInbox_afterId_경계_이후와_정렬() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccount(userId, "push-boundary@test.local");
    long inbox = folderRepo.ensureFolder(accountId, "INBOX").id();
    long m1 = seedMessage(accountId, inbox, false);
    long m2 = seedMessage(accountId, inbox, false);
    long m3 = seedMessage(accountId, inbox, false);

    assertThat(ids(messageRepo.findNewUnreadInbox(accountId, m1, 10))).containsExactly(m3, m2);
    assertThat(ids(messageRepo.findNewUnreadInbox(accountId, 0, 10))).containsExactly(m3, m2, m1);
    assertThat(messageRepo.findNewUnreadInbox(accountId, m3, 10)).isEmpty();
  }

  /** findNewUnreadInbox — 이미 읽은 메일·다른 폴더 메일은 후보가 아니다(SEEN + folderScope 필터). */
  @Test
  void findNewUnreadInbox_읽은_메일과_다른_폴더는_후보가_아니다() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccount(userId, "push-filters@test.local");
    long inbox = folderRepo.ensureFolder(accountId, "INBOX").id();
    long archive = folderRepo.ensureFolder(accountId, "Archive").id();
    long unreadInbox = seedMessage(accountId, inbox, false);
    long readInbox = seedMessage(accountId, inbox, true);
    long unreadArchive = seedMessage(accountId, archive, false);

    assertThat(ids(messageRepo.findNewUnreadInbox(accountId, 0, 10))).containsExactly(unreadInbox);
    assertThat(readInbox).isPositive();
    assertThat(unreadArchive).isPositive();
  }

  /** findNewUnreadInbox — accountId 로만 범위가 고정돼야 한다: 다른 계정의(경계보다 큰) 메일은 섞이지 않는다. */
  @Test
  void findNewUnreadInbox_다른_계정_메일은_후보가_아니다() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccount(userId, "push-mine@test.local");
    long otherUserId = TestFixtures.createHuman(dsl);
    long otherAccountId = createAccount(otherUserId, "push-theirs@test.local");
    long mine = seedMessage(accountId, folderRepo.ensureFolder(accountId, "INBOX").id(), false);
    long theirs =
        seedMessage(otherAccountId, folderRepo.ensureFolder(otherAccountId, "INBOX").id(), false);

    assertThat(theirs).isGreaterThan(mine);
    assertThat(ids(messageRepo.findNewUnreadInbox(accountId, 0, 10))).containsExactly(mine);
    assertThat(ids(messageRepo.findNewUnreadInbox(otherAccountId, 0, 10))).containsExactly(theirs);
  }

  /** findNewUnreadInbox — limit 은 최신(큰 id)부터 잘라 내림차순으로 돌려준다. */
  @Test
  void findNewUnreadInbox_limit_최신부터_id_내림차순() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccount(userId, "push-limit@test.local");
    long inbox = folderRepo.ensureFolder(accountId, "INBOX").id();
    long m1 = seedMessage(accountId, inbox, false);
    long m2 = seedMessage(accountId, inbox, false);
    long m3 = seedMessage(accountId, inbox, false);
    long m4 = seedMessage(accountId, inbox, false);
    long m5 = seedMessage(accountId, inbox, false);

    assertThat(ids(messageRepo.findNewUnreadInbox(accountId, 0, 2))).containsExactly(m5, m4);
    assertThat(messageRepo.findNewUnreadInbox(accountId, 0, 0)).isEmpty();
    assertThat(m1).isLessThan(m5);
    assertThat(m3).isBetween(m1, m5);
  }

  /**
   * findNewUnreadInbox — 프로젝션: 제목(email_content)·발신자·유효 분류(effectiveCategory)·자동발송 저장 판정값이 함께 읽혀야
   * MailPushService 판정(notifies)이 쓸 수 있다. 미분류 메일은 category null 로 남는다.
   */
  @Test
  void findNewUnreadInbox_프로젝션은_제목_분류_자동발송을_함께_읽는다() {
    long userId = TestFixtures.createHuman(dsl);
    long accountId = createAccount(userId, "push-projection@test.local");
    long inbox = folderRepo.ensureFolder(accountId, "INBOX").id();
    long classified = seedMessage(accountId, inbox, false);
    long unclassified = seedMessage(accountId, inbox, false);
    MailTestSupport.classify(dsl, classified, "업무", true);
    dsl.update(EMAIL_CONTENT)
        .set(EMAIL_CONTENT.AUTO_GENERATED, true)
        .where(EMAIL_CONTENT.ID.eq(contentIdOf(classified)))
        .execute();

    List<InboxPushCandidate> candidates = messageRepo.findNewUnreadInbox(accountId, 0, 10);
    assertThat(ids(candidates)).containsExactly(unclassified, classified); // id 내림차순

    InboxPushCandidate first = candidates.get(1); // classified (오래된 쪽)
    assertThat(first.id()).isEqualTo(classified);
    assertThat(first.senderName()).isEqualTo("발신자");
    assertThat(first.senderAddress()).isEqualTo("sender@example.com");
    assertThat(first.subject()).isEqualTo("테스트 제목");
    assertThat(first.category()).isEqualTo("업무");
    assertThat(first.autoGenerated()).isTrue();

    assertThat(candidates.get(0).category()).isNull(); // 미분류는 null — notifies 는 애매하면 보낸다
    assertThat(candidates.get(0).autoGenerated()).isFalse();
  }
}
