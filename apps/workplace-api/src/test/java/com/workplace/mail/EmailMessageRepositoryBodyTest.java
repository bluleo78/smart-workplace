package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.security.EncryptionService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.BodyTarget;
import com.workplace.mail.dto.EmailAccountRequest;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailContentRepository;
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
 * EmailMessageRepository 본문 적재 메서드 통합 테스트 — 메타만 저장된 메시지를 미적재 대상으로 잡고(content.updateBody 전),
 * contentRepo.updateBody 후 content.body_fetched_at 이 채워져 대상에서 빠지는지 검증한다(Task5 멱등 가드).
 * imap_uid/folderName 매핑도 함께 확인.
 */
@Transactional
class EmailMessageRepositoryBodyTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EmailContentRepository contentRepo;
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

  /**
   * V97(per-envelope): 미적재 판정은 email_message.fetched_at IS NULL 기준으로 전환. contentRepo.updateBody
   * 만으로는 미적재 목록에서 제외되지 않는다 — markFetched(envelope) 까지 호출해야 제외된다. findBodyTarget.bodyFetchedAt 은
   * email_message.fetched_at 에서 읽는다. imap_uid/folderName 매핑도 함께 확인.
   *
   * <p>insertIgnoreConflict 는 TenantContext 에서 tenantId 를 읽으므로, connection-init-sql 이 tenant=1 로
   * 설정된 test 프로파일에서는 TenantContext 없이도 동작한다(requireTenantId fallback 경로).
   */
  @Test
  void contentUpdateBody_setsBodyFetchedAtAndDropsFromMissingList() {
    TenantContext.set(1L); // insertIgnoreConflict requireTenantId 보장
    try {
      long user = TestFixtures.createHuman(dsl);
      long account = insertAccount(user);
      long folderId = folderRepo.ensureFolder(account, "INBOX").id();
      long id =
          messageRepo
              .insertIgnoreConflict(account, folderId, meta(1, "<m1-task5@x>"))
              .orElseThrow();

      // 적재 전: 미적재 대상으로 잡힘(email_message.fetched_at IS NULL)
      List<BodyTarget> pending = messageRepo.listMissingBody(account, 10);
      assertThat(pending).extracting(BodyTarget::messageId).contains(id);
      assertThat(messageRepo.countMissingBody(account)).isEqualTo(1);

      // contentId 조회 후 content 에 본문 기록(V97: content.updateBody 만으로는 미적재 목록에서 제외되지 않음)
      BodyTarget before = messageRepo.findBodyTarget(account, id).orElseThrow();
      assertThat(before.contentId()).as("content_id 가 0 이면 안 된다").isGreaterThan(0L);
      contentRepo.updateBody(before.contentId(), "본문", null, "본문");

      // V97: content.body_fetched_at 설정 후에도 envelope.fetched_at = NULL → 여전히 목록에 포함
      assertThat(messageRepo.countMissingBody(account))
          .as("content.updateBody 만으로는 envelope 가 목록에서 제외되지 않아야 한다(per-envelope 게이트)")
          .isEqualTo(1);

      // per-envelope 마커 기록 → 이제 제외됨
      messageRepo.markFetched(id);
      assertThat(messageRepo.countMissingBody(account))
          .as("markFetched 후 envelope 는 미적재 목록에서 제외되어야 한다")
          .isEqualTo(0);

      Optional<BodyTarget> t = messageRepo.findBodyTarget(account, id);
      assertThat(t).isPresent();
      assertThat(t.get().bodyFetchedAt())
          .as("markFetched 후 bodyFetchedAt(email_message.fetched_at) 이 null 이면 안 된다")
          .isNotNull();
      assertThat(t.get().imapUid()).isEqualTo(1L);
      assertThat(t.get().folderName()).isEqualTo("INBOX");
    } finally {
      TenantContext.clear();
    }
  }
}
