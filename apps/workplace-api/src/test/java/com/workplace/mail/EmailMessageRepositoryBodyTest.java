package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.BodyTarget;
import com.workplace.mail.dto.EmailAccountRequest;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * EmailMessageRepository 본문 적재 메서드 통합 테스트 — 메타만 저장된 메시지를 미적재 대상으로 잡고(updateBody 전), updateBody 후
 * body_fetched_at 이 채워져 대상에서 빠지는지 검증한다. imap_uid/folderName 매핑도 함께 확인.
 */
@Transactional
class EmailMessageRepositoryBodyTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EncryptionService encryption;

  /** MailSyncServiceTest.insertAccount 패턴 복제 — box@test.local 계정을 직접 삽입하고 accountId 반환. */
  private long insertAccount(long userId) {
    EmailAccountRequest req =
        new EmailAccountRequest(
            "box@test.local",
            "테스트박스",
            "127.0.0.1",
            3143,
            MailSecurity.NONE,
            "box@test.local",
            "127.0.0.1",
            3025,
            MailSecurity.NONE,
            "box@test.local",
            "pw",
            false);
    return accountRepo.insert(userId, req, encryption.encrypt("pw"));
  }

  /** body/snippet 이 비어있는 메타 전용 ParsedMessage(동기화 1단계 결과 모사). */
  private ParsedMessage meta(long uid, String msgId) {
    return new ParsedMessage(
        uid,
        msgId,
        msgId,
        null,
        null,
        "a@x.com",
        "A",
        "box@test.local",
        null,
        "제목" + uid,
        Instant.now(),
        Instant.now(),
        false,
        false,
        null,
        null,
        null,
        List.of());
  }

  @Test
  void updateBody_setsBodyAndFetchedAt() {
    long user = TestFixtures.createHuman(dsl);
    long account = insertAccount(user);
    long folderId = folderRepo.ensureFolder(account, "INBOX").id();
    long id = messageRepo.insertIgnoreConflict(account, folderId, meta(1, "<m1@x>")).orElseThrow();

    // 적재 전: 미적재 대상으로 잡힘
    List<BodyTarget> pending = messageRepo.listMissingBody(account, 10);
    assertThat(pending).extracting(BodyTarget::messageId).contains(id);
    assertThat(messageRepo.countMissingBody(account)).isEqualTo(1);

    messageRepo.updateBody(id, "본문", null, "본문", false);

    // 적재 후: 대상에서 빠짐
    assertThat(messageRepo.countMissingBody(account)).isEqualTo(0);
    Optional<BodyTarget> t = messageRepo.findBodyTarget(account, id);
    assertThat(t).isPresent();
    assertThat(t.get().bodyFetchedAt()).isNotNull();
    assertThat(t.get().imapUid()).isEqualTo(1L);
    assertThat(t.get().folderName()).isEqualTo("INBOX");
  }
}
