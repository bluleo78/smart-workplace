package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;

import com.icegreen.greenmail.configuration.GreenMailConfiguration;
import com.icegreen.greenmail.junit5.GreenMailExtension;
import com.icegreen.greenmail.util.GreenMailUtil;
import com.icegreen.greenmail.util.ServerSetupTest;
import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.EmailMessageDetail;
import com.workplace.mail.dto.MailSyncStatus;
import com.workplace.mail.outbound.AiAgentMailClient;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.MailMessageService;
import com.workplace.mail.service.MailSyncService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

/**
 * MailMessageService 통합 테스트 — 상세 조회의 OnDemand 본문 적재와 sync-status 스냅샷을 검증한다.
 *
 * <p>sync 는 메타만 저장(본문 null)하므로 get() 이 IMAP 에서 본문을 적재해 반환해야 한다. 테스트 클래스가 @Transactional 이라 get() 의
 * 적재 쓰기가 같은 테스트 트랜잭션에 묶여 재조회로 보인다(비동기 백필은 별도 트랜잭션이라 inert).
 */
@Transactional
class MailMessageServiceTest extends IntegrationTestBase {

  @RegisterExtension
  static GreenMailExtension greenMail =
      new GreenMailExtension(ServerSetupTest.SMTP_IMAP)
          .withConfiguration(
              GreenMailConfiguration.aConfig().withUser("box@test.local", "box@test.local", "pw"));

  @Autowired DSLContext dsl;
  @Autowired MailSyncService syncService;
  @Autowired MailMessageService messageService;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EncryptionService encryption;

  /** ai-agent 실호출 차단. */
  @MockitoBean AiAgentMailClient mailClient;

  /** 상세 조회 시 본문 미적재면 OnDemand 로 IMAP 에서 적재 후 반환한다. */
  @Test
  void get_loadsBodyOnDemand_whenMissing() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.insertAccount(accountRepo, encryption, user, false);
    GreenMailUtil.sendTextEmailTest("box@test.local", "a@x.com", "제목", "온디맨드 본문");
    greenMail.waitForIncomingEmail(1);
    syncService.sync(user, accountId); // 메타만
    long id = messageRepo.listByAccount(accountId, "INBOX", null, 10).get(0).id();

    EmailMessageDetail d = messageService.get(user, id); // OnDemand 적재 후 반환

    assertThat(d.bodyText()).contains("온디맨드 본문");
    assertThat(messageRepo.findBodyTarget(accountId, id).orElseThrow().bodyFetchedAt()).isNotNull();
  }

  /** get() 호출 시 seen=false → true 로 자동 업데이트(읽음 처리) + 반환 DTO 도 seen=true. */
  @Test
  void get_marksSeen_whenUnseen() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.insertAccount(accountRepo, encryption, user, false);
    GreenMailUtil.sendTextEmailTest("box@test.local", "a@x.com", "읽음처리 테스트", "본문");
    greenMail.waitForIncomingEmail(1);
    syncService.sync(user, accountId);
    long id = messageRepo.listByAccount(accountId, "INBOX", null, 10).get(0).id();

    // 동기화 직후 seen=false 이어야 함
    assertThat(messageRepo.listByAccount(accountId, "INBOX", null, 10).get(0).seen()).isFalse();

    EmailMessageDetail d = messageService.get(user, id);

    // 반환 DTO 에도 seen=true 반영
    assertThat(d.seen()).isTrue();
    // DB 도 seen=true 로 업데이트됨
    assertThat(messageRepo.listByAccount(accountId, "INBOX", null, 10).get(0).seen()).isTrue();
  }

  /** get() 재호출 시 이미 읽은 메시지는 중복 업데이트 없이 정상 반환. */
  @Test
  void get_idempotent_whenAlreadySeen() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.insertAccount(accountRepo, encryption, user, false);
    GreenMailUtil.sendTextEmailTest("box@test.local", "a@x.com", "이미읽음 테스트", "본문");
    greenMail.waitForIncomingEmail(1);
    syncService.sync(user, accountId);
    long id = messageRepo.listByAccount(accountId, "INBOX", null, 10).get(0).id();

    messageService.get(user, id); // 1회 → seen=true
    EmailMessageDetail d2 = messageService.get(user, id); // 2회 → 정상 반환

    assertThat(d2.seen()).isTrue();
  }

  /** #466: unreadOnly=true 면 seen=false 메일만 반환. read 처리된 메일은 제외된다. */
  @Test
  void listByAccount_unreadOnly_returnsOnlyUnseen() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.insertAccount(accountRepo, encryption, user, false);
    GreenMailUtil.sendTextEmailTest("box@test.local", "a@x.com", "안읽음1", "본문");
    GreenMailUtil.sendTextEmailTest("box@test.local", "b@x.com", "곧읽음", "본문");
    greenMail.waitForIncomingEmail(2);
    syncService.sync(user, accountId);

    // 한 건을 get() 으로 읽음 처리(seen=true)
    long readId =
        messageRepo.listByAccount(accountId, "INBOX", "곧읽음", 10).get(0).id();
    messageService.get(user, readId);

    // unreadOnly=true → 읽음 처리한 "곧읽음" 은 빠지고 "안읽음1" 만 남는다
    var unread = messageRepo.listByAccount(accountId, "INBOX", null, true, 10);
    assertThat(unread).extracting(s -> s.subject()).containsExactly("안읽음1");
    assertThat(unread).allMatch(s -> !s.seen());

    // unreadOnly=false(기존 4-arg) → 두 건 모두
    assertThat(messageRepo.listByAccount(accountId, "INBOX", null, 10)).hasSize(2);
  }

  /** #466: service.list 가 unread=true 를 repo 로 관통한다. */
  @Test
  void list_unread_passesThroughToRepo() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.insertAccount(accountRepo, encryption, user, false);
    GreenMailUtil.sendTextEmailTest("box@test.local", "a@x.com", "남을것", "본문");
    GreenMailUtil.sendTextEmailTest("box@test.local", "b@x.com", "읽을것", "본문");
    greenMail.waitForIncomingEmail(2);
    syncService.sync(user, accountId);
    long readId = messageRepo.listByAccount(accountId, "INBOX", "읽을것", 10).get(0).id();
    messageService.get(user, readId);

    var unread = messageService.list(user, accountId, "INBOX", null, true, 10);
    assertThat(unread).extracting(s -> s.subject()).containsExactly("남을것");

    var all = messageService.list(user, accountId, "INBOX", null, false, 10);
    assertThat(all).hasSize(2);
  }

  /** 동기화 진행 상태 스냅샷(미동기화 계정은 IDLE). 소유 검증 통과. */
  @Test
  void syncStatus_returnsSnapshot() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.insertAccount(accountRepo, encryption, user, false);

    MailSyncStatus s = messageService.syncStatus(user, accountId);

    assertThat(s.phase()).isEqualTo("IDLE");
    assertThat(s.running()).isFalse();
  }
}
