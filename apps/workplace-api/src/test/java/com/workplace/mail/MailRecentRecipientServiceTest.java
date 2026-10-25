package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.EmailAccountRequest;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.dto.OutgoingMail;
import com.workplace.mail.dto.RecentRecipient;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.MailRecentRecipientService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 받는사람 자동완성의 최근 수신인(WP-945) — 보낸편지함에서 사람 단위로 모으기·순서·개수·깨진 헤더·내 주소 제외·남의 메일 격리. */
@Transactional
class MailRecentRecipientServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EncryptionService encryption;
  @Autowired MailRecentRecipientService service;

  private long account(long user, String address) {
    EmailAccountRequest req =
        new EmailAccountRequest(
            address,
            "나",
            "127.0.0.1",
            MailTestPorts.IMAP,
            MailSecurity.NONE,
            address,
            "127.0.0.1",
            MailTestPorts.SMTP,
            MailSecurity.NONE,
            address,
            "pw",
            false);
    return accountRepo.insert(user, req, encryption.encrypt("pw"));
  }

  /** 계정의 보낸편지함에 한 통 — 보낸 시각 순서를 정하려고 sentAt 을 받는다. */
  private void sent(
      long accountId, Instant sentAt, List<String> to, List<String> cc, List<String> bcc) {
    long folderId = folderRepo.ensureFolder(accountId, "SENT").id();
    String id = "m" + sentAt.toEpochMilli() + "@test.local";
    messageRepo.insertSent(
        accountId,
        folderId,
        new OutgoingMail(
            id,
            id,
            "me@test.local",
            "나",
            to,
            cc,
            bcc,
            "제목",
            "본문",
            "<p>본문</p>",
            null,
            null,
            "본문",
            sentAt,
            List.of(),
            List.of()));
  }

  @Test
  void list_groupsByPerson_newestFirst_excludesOwnAddress() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = account(user, "me@test.local");
    Instant t0 = Instant.parse("2026-10-20T00:00:00Z");
    sent(accountId, t0, List.of("앨리스 <Alice@Example.com>"), List.of(), List.of());
    sent(
        accountId,
        t0.plusSeconds(60),
        List.of("bob@example.com", "me@test.local"),
        List.of("alice@example.com"),
        List.of("\"김, 철수\" <kim@example.com>"));

    List<RecentRecipient> out = service.list(user, 10);

    // 두 번째 메일이 가장 최근 — 그 안에서는 두 통에 다 든 앨리스가 먼저, 나머지는 헤더 순(받는사람 → 숨은참조). 내 주소는 빠진다.
    assertThat(out)
        .extracting(RecentRecipient::address)
        .containsExactly("alice@example.com", "bob@example.com", "kim@example.com");
    RecentRecipient alice = out.get(0);
    assertThat(alice.sentCount()).isEqualTo(2);
    // 마지막 메일에는 이름이 없었으므로 앞선 메일의 이름으로 채운다.
    assertThat(alice.name()).isEqualTo("앨리스");
    assertThat(out.get(2).name()).isEqualTo("김, 철수");
  }

  @Test
  void list_capsLimit_andKeepsNamesWhenOneEntryIsBroken() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = account(user, "me@test.local");
    Instant t0 = Instant.parse("2026-10-20T00:00:00Z");
    sent(accountId, t0, List.of("carol@example.com"), List.of(), List.of());
    // 깨진 항목이 섞인 헤더 — 앞 사람의 이름은 지킨다.
    sent(
        accountId,
        t0.plusSeconds(60),
        List.of("앨리스 <alice@example.com>", "broken<@"),
        List.of(),
        List.of());

    List<RecentRecipient> out = service.list(user, 10);
    assertThat(out).extracting(RecentRecipient::address).startsWith("alice@example.com");
    assertThat(out.get(0).name()).isEqualTo("앨리스");
    assertThat(service.list(user, 1))
        .extracting(RecentRecipient::address)
        .containsExactly("alice@example.com");
  }

  @Test
  void list_ignoresOtherUsersSentMail() {
    long me = TestFixtures.createHuman(dsl);
    long other = TestFixtures.createHuman(dsl);
    account(me, "me@test.local");
    long otherAccount = account(other, "other@test.local");
    sent(otherAccount, Instant.now(), List.of("secret@example.com"), List.of(), List.of());

    assertThat(service.list(me, 10)).isEmpty();
  }
}
