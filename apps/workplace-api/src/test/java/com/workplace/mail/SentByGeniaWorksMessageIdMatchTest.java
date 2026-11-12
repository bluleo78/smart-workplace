package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.tables.EmailContent.EMAIL_CONTENT;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.ContentSource;
import com.workplace.mail.dto.OutgoingMail;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.MailContentShareGate;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.function.Consumer;
import java.util.stream.Collectors;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * WP-1364 후속: Exchange Online 이 X-Mailer 를 지워도, 같은 테넌트에서 우리 앱이 보낸 메일의 받은 사본은 Message-ID·보낸 사람으로 맞대
 * 「Gen:iA Works에서 보낸 메일」 표시가 선다.
 *
 * <p>보낸 사본은 실제 저장 경로({@link EmailMessageRepository#insertSentRow} — 꺾쇠 없는 Message-ID)로, 받은 사본은
 * 동기화처럼 findOrCreate + envelope(꺾쇠 있는 Message-ID)로 만든다. 받은 사본 쪽 판정은 본문 로더가 부르는 {@link
 * MailContentShareGate} 를 X-Mailer 없음(false)으로 불러 검증한다. 모든 데이터는 트랜잭션 롤백으로 정리한다.
 */
class SentByGeniaWorksMessageIdMatchTest extends IntegrationTestBase {

  private static final long TENANT = 1L;

  @Autowired DSLContext dsl;
  @Autowired EmailContentRepository contentRepo;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired MailContentShareGate shareGate;

  /** 본문 적재가 보낸 사본 저장 뒤면 — X-Mailer 가 없어도 Message-ID 로 표시된다. 다른 Message-ID 메일은 그대로다. */
  @Test
  void recordSentByGeniaWorks_whenXMailerStrippedButMatchesOwnSent_marksReceivedCopy() {
    inTenantTx(
        f -> {
          String bare = "own-" + System.nanoTime() + "@iacloud.kr";
          sent(f, bare, f.me);
          long received = received(f, "<" + bare + ">", f.me);
          long other = received(f, "<other-" + System.nanoTime() + "@x>", f.me);

          shareGate.recordSentByGeniaWorks(received, false);
          shareGate.recordSentByGeniaWorks(other, false);

          assertThat(marked(received)).isTrue();
          assertThat(marked(other)).isFalse();
        });
  }

  /** Message-ID 만 같고 보낸 사람이 다른 메일(외부인이 Message-ID 를 베껴 보낸 위조)에는 표시가 붙지 않는다. */
  @Test
  void recordSentByGeniaWorks_whenSameMessageIdButDifferentSender_doesNotMark() {
    inTenantTx(
        f -> {
          String bare = "forged-" + System.nanoTime() + "@iacloud.kr";
          sent(f, bare, f.me);
          long forged = received(f, "<" + bare + ">", "attacker@evil.example");

          shareGate.recordSentByGeniaWorks(forged, false);

          assertThat(marked(forged)).isFalse();
        });
  }

  /** 받은 사본 본문 적재가 보낸 사본 저장보다 먼저면 — 보낸 사본을 저장할 때 반대 방향으로 맞대 표시한다. */
  @Test
  void insertSentRow_whenReceivedCopyLoadedFirst_marksReceivedCopy() {
    inTenantTx(
        f -> {
          String bare = "race-" + System.nanoTime() + "@iacloud.kr";
          long received = received(f, "<" + bare + ">", f.me);
          shareGate.recordSentByGeniaWorks(received, false);
          assertThat(marked(received)).isFalse(); // 아직 보낸 사본이 없다

          sent(f, bare, f.me);

          assertThat(marked(received)).isTrue();
        });
  }

  /** V287 되돌려 채우기: 이미 받아 둔 사본도 표시되고, 다른 메일·위조 메일은 그대로다. */
  @Test
  void v287Backfill_marksOnlyExistingCopiesOfOwnSentMail() throws Exception {
    String sql =
        new ClassPathResource("db/migration/V287__email_content_sent_by_genia_works_message_id.sql")
            .getContentAsString(StandardCharsets.UTF_8);
    String noComments =
        Arrays.stream(sql.split("\n"))
            .filter(line -> !line.trim().startsWith("--"))
            .collect(Collectors.joining("\n"));
    inTenantTx(
        f -> {
          String bare = "backfill-" + System.nanoTime() + "@iacloud.kr";
          long sentContent = sent(f, bare, f.me);
          long received = received(f, "<" + bare + ">", f.me);
          long forged = received(f, "<" + bare + ">", "attacker@evil.example");
          // 마이그레이션 이전 상태 재현 — 보낸 사본 저장 때의 반대 방향 표시를 되돌린다
          dsl.update(EMAIL_CONTENT)
              .set(EMAIL_CONTENT.SENT_BY_GENIA_WORKS, false)
              .where(EMAIL_CONTENT.ID.in(received, forged))
              .execute();

          // 마이그레이션의 UPDATE 문만 실행한다(인덱스는 Flyway 가 이미 만들었다)
          for (String stmt : noComments.split(";")) {
            if (stmt.trim().startsWith("UPDATE")) {
              dsl.execute(stmt);
            }
          }

          assertThat(marked(sentContent)).isTrue();
          assertThat(marked(received)).isTrue();
          assertThat(marked(forged)).isFalse();
        });
  }

  // ---------------------------------------------------------------- 시드 헬퍼

  /** 한 사용자의 메일 계정과 보낸·받은 폴더. me = 계정 주소(보낸 사람). */
  private record Fixture(long accountId, long sentFolder, long inboxFolder, String me) {}

  /** 테넌트 1 트랜잭션 안에서 시드를 만들어 본문을 실행하고 롤백한다(RLS GUC 주입을 위해 TenantContext + TransactionTemplate). */
  private void inTenantTx(Consumer<Fixture> body) {
    TenantContext.set(TENANT);
    try {
      new TransactionTemplate(txManager)
          .execute(
              status -> {
                body.accept(seed());
                status.setRollbackOnly();
                return null;
              });
    } finally {
      TenantContext.clear();
    }
  }

  private Fixture seed() {
    long uid = TestFixtures.createHuman(dsl);
    String me = "me-" + System.nanoTime() + "@iacloud.kr";
    long accountId =
        dsl.insertInto(
                EMAIL_ACCOUNT,
                EMAIL_ACCOUNT.USER_ID,
                EMAIL_ACCOUNT.EMAIL_ADDRESS,
                EMAIL_ACCOUNT.TENANT_ID,
                EMAIL_ACCOUNT.AI_ENABLED)
            .values(uid, me, TENANT, false)
            .returning(EMAIL_ACCOUNT.ID)
            .fetchOne()
            .getId();
    return new Fixture(accountId, folder(accountId, "SENT"), folder(accountId, "INBOX"), me);
  }

  private long folder(long accountId, String name) {
    return dsl.insertInto(
            EMAIL_FOLDER, EMAIL_FOLDER.ACCOUNT_ID, EMAIL_FOLDER.NAME, EMAIL_FOLDER.TENANT_ID)
        .values(accountId, name, TENANT)
        .returning(EMAIL_FOLDER.ID)
        .fetchOne()
        .getId();
  }

  /** 앱이 보낼 때 저장하는 보낸 사본(꺾쇠 없는 Message-ID). 전용 content id 를 돌려준다. */
  private long sent(Fixture f, String bareMessageId, String from) {
    OutgoingMail m =
        new OutgoingMail(
            bareMessageId,
            bareMessageId,
            from,
            "나",
            List.of(f.me),
            List.of(),
            List.of(),
            "테스트 메일",
            "본문",
            null,
            null,
            null,
            "본문",
            Instant.now(),
            List.of(),
            List.of());
    return messageRepo.insertSentRow(f.accountId, f.sentFolder, m).contentId();
  }

  /** Outlook 에서 동기화된 받은 사본(꺾쇠 있는 Message-ID, 지문 있는 공유 content). content id 를 돌려준다. */
  private long received(Fixture f, String messageId, String from) {
    ParsedMessage pm =
        new ParsedMessage(
            System.nanoTime(),
            messageId,
            messageId,
            null,
            null,
            from,
            "보낸 사람",
            f.me,
            null,
            "테스트 메일",
            Instant.now(),
            Instant.now(),
            false,
            false,
            null,
            null,
            null,
            List.of());
    long contentId = contentRepo.findOrCreate(TENANT, pm, ContentSource.GRAPH);
    dsl.insertInto(
            EMAIL_MESSAGE,
            EMAIL_MESSAGE.ACCOUNT_ID,
            EMAIL_MESSAGE.FOLDER_ID,
            EMAIL_MESSAGE.THREAD_ID,
            EMAIL_MESSAGE.MESSAGE_ID,
            EMAIL_MESSAGE.FROM_ADDRESS,
            EMAIL_MESSAGE.SEEN,
            EMAIL_MESSAGE.HAS_ATTACHMENT,
            EMAIL_MESSAGE.CONTENT_ID,
            EMAIL_MESSAGE.TENANT_ID)
        .values(
            f.accountId, f.inboxFolder, messageId, messageId, from, false, false, contentId, TENANT)
        .execute();
    return contentId;
  }

  /** content 의 sent_by_genia_works 값. */
  private boolean marked(long contentId) {
    return Boolean.TRUE.equals(
        dsl.select(EMAIL_CONTENT.SENT_BY_GENIA_WORKS)
            .from(EMAIL_CONTENT)
            .where(EMAIL_CONTENT.ID.eq(contentId))
            .fetchOneInto(Boolean.class));
  }
}
