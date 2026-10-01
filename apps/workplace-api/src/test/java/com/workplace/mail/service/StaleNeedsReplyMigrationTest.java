package com.workplace.mail.service;

import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.mail.service.MailAnalysisFixtures.LONG_BODY;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.MailAnalysisFixtures.Box;
import com.workplace.support.IntegrationTestBase;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.transaction.annotation.Transactional;

/**
 * V147(WP-151 후속) — 새 흐름으로 다시 판정되지 않은 옛 기준 회신필요(true)를 판정 전(NULL)으로 되돌리는 데이터 정리.
 *
 * <p>Testcontainers 는 빈 DB 에서 마이그레이션을 돌려 정리 대상이 없으므로, 옛 상태 행을 시드한 뒤 같은 SQL 파일을 다시 실행해 결과를 확인한다. 정리
 * 뒤 회신필요 집계에서 빠지고 ④ 백필 대상으로 돌아오는지도 함께 본다.
 */
@Transactional
class StaleNeedsReplyMigrationTest extends IntegrationTestBase {

  private static final String MIGRATION =
      "db/migration/V147__email_message_clear_stale_needs_reply.sql";

  @Autowired DSLContext dsl;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EmailContentRepository contentRepo;

  /** 배포 전 기준 판정 흉내 — ai_needs_reply 만 있고 새 흐름 흔적(ai_analyzed_at)은 없다. */
  private void legacyVerdict(long envelopeId, boolean value) {
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.AI_NEEDS_REPLY, value)
        .where(EMAIL_MESSAGE.ID.eq(envelopeId))
        .execute();
  }

  private Boolean needsReply(long envelopeId) {
    return dsl.select(EMAIL_MESSAGE.AI_NEEDS_REPLY)
        .from(EMAIL_MESSAGE)
        .where(EMAIL_MESSAGE.ID.eq(envelopeId))
        .fetchOneInto(Boolean.class);
  }

  private void runMigration() throws IOException {
    dsl.execute(new ClassPathResource(MIGRATION).getContentAsString(StandardCharsets.UTF_8));
  }

  @Test
  void clearsOnlyLegacyTrue_andReturnsThemToBackfill() throws IOException {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    // 정리 대상: 옛 기준 true(안읽음)
    long legacyTrue =
        MailAnalysisFixtures.envelope(dsl, box, content, "a@x.com", box.address(), null);
    legacyVerdict(legacyTrue, true);
    // 유지: 옛 기준 false
    long legacyFalse =
        MailAnalysisFixtures.envelope(dsl, box, content, "b@x.com", box.address(), null);
    legacyVerdict(legacyFalse, false);
    // 유지: 새 흐름으로 판정된 true
    long analyzedTrue =
        MailAnalysisFixtures.envelope(dsl, box, content, "c@x.com", box.address(), null);
    MailAnalysisFixtures.markPersonallyAnalyzed(dsl, analyzedTrue, true);

    assertThat(messageRepo.countNeedsReplyForAccount(box.accountId())).isEqualTo(2);

    runMigration();

    assertThat(needsReply(legacyTrue)).isNull();
    assertThat(needsReply(legacyFalse)).isFalse();
    assertThat(needsReply(analyzedTrue)).isTrue();
    // 회신필요 집계는 새 기준 판정만 센다
    assertThat(messageRepo.countNeedsReplyForAccount(box.accountId())).isEqualTo(1);
    // 판정 전으로 돌아간 안읽음 행은 ④ 백필이 새 기준으로 다시 판정한다(옛 false 는 대상 아님)
    assertThat(messageRepo.listRecentUnreadUnanalyzedIds(box.accountId(), 50))
        .contains(legacyTrue)
        .doesNotContain(legacyFalse, analyzedTrue);
  }
}
