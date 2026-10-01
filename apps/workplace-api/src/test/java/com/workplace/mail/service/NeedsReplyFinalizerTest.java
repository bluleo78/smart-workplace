package com.workplace.mail.service;

import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.mail.service.MailAnalysisFixtures.LONG_BODY;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.service.MailAnalysisFixtures.Box;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** WP-150 ⑤ 재계산의 "나" 주소 — ④ 와 같은 출처(계정 주소 + user.email)를 쓰는지, 형제 사본은 각 소유자 주소로 보는지. */
@Transactional
class NeedsReplyFinalizerTest extends IntegrationTestBase {

  @Autowired NeedsReplyFinalizer finalizer;
  @Autowired DSLContext dsl;
  @Autowired EmailContentRepository contentRepo;

  /** ④ 원판정 true 만 있고 최종값은 아직 없는 사본. */
  private long analyzedEnvelope(Box box, long content, String from, String to) {
    long env = MailAnalysisFixtures.envelope(dsl, box, content, from, to, null);
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.AI_NEEDS_REPLY_RAW, true)
        .setNull(EMAIL_MESSAGE.AI_NEEDS_REPLY)
        .set(EMAIL_MESSAGE.AI_ANALYZED_AT, OffsetDateTime.now())
        .where(EMAIL_MESSAGE.ID.eq(env))
        .execute();
    return env;
  }

  private Boolean finalValue(long env) {
    return dsl.select(EMAIL_MESSAGE.AI_NEEDS_REPLY)
        .from(EMAIL_MESSAGE)
        .where(EMAIL_MESSAGE.ID.eq(env))
        .fetchOneInto(Boolean.class);
  }

  @Test
  void recompute_toUserEmailOnly_countsAsMe() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    String userEmail = MailPeopleFixtures.userEmail(dsl, box.userId());
    long env = analyzedEnvelope(box, content, "minsu@acme.com", userEmail.toUpperCase());

    finalizer.recompute(env);

    assertThat(finalValue(env)).isTrue();
  }

  @Test
  void recompute_fromUserEmail_isSelf() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    String userEmail = MailPeopleFixtures.userEmail(dsl, box.userId());
    long env = analyzedEnvelope(box, content, userEmail, box.address());

    finalizer.recompute(env);

    assertThat(finalValue(env)).isFalse();
  }

  @Test
  void recomputeForContent_usesEachOwnersOwnAddresses() {
    Box a = MailAnalysisFixtures.mailbox(dsl, true);
    Box b = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    String aEmail = MailPeopleFixtures.userEmail(dsl, a.userId());
    long envA = analyzedEnvelope(a, content, "minsu@acme.com", aEmail);
    long envB = analyzedEnvelope(b, content, "minsu@acme.com", aEmail); // b 는 To/CC 에 없음

    finalizer.recomputeForContent(content);

    assertThat(finalValue(envA)).isTrue();
    assertThat(finalValue(envB)).isFalse();
  }
}
