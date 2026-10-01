package com.workplace.mail.service;

import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.mail.service.MailAnalysisFixtures.LONG_BODY;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

import com.workplace.mail.dto.EmailMessageSummary;
import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.MailAnalysisFixtures.Box;
import com.workplace.support.IntegrationTestBase;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 회신필요 기간(WP-151 후속, 2일) — 기간 밖 메일은 회신필요로 세지도 내보내지도 않고, 선제 분석(③·④·재분석) 대상에서도 빠진다. 옛 메일에 LLM 을 쓰지
 * 않고, 데이터 상태와 무관하게 화면이 같은 기준을 보게 하는 것이 목적이다.
 */
@Transactional
class NeedsReplyWindowTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EmailContentRepository contentRepo;

  /** 새 흐름으로 회신필요 true 판정된 안 읽은 메일 하나(수신 daysAgo 일 전). */
  private long needsReplyMail(Box box, int daysAgo) {
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env = MailAnalysisFixtures.envelope(dsl, box, content, "a@x.com", box.address(), null);
    MailAnalysisFixtures.markPersonallyAnalyzed(dsl, env, true);
    MailAnalysisFixtures.receivedDaysAgo(dsl, env, daysAgo);
    return env;
  }

  /** 아직 아무 분석도 하지 않은 안 읽은 메일 하나(수신 daysAgo 일 전). */
  private long unanalyzedMail(Box box, int daysAgo) {
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    long env = MailAnalysisFixtures.envelope(dsl, box, content, "b@x.com", box.address(), null);
    MailAnalysisFixtures.receivedDaysAgo(dsl, env, daysAgo);
    return env;
  }

  @Test
  void count_andSummary_ignoreNeedsReplyOutsideWindow() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long recent = needsReplyMail(box, 1);
    long old = needsReplyMail(box, 3);

    assertThat(messageRepo.countNeedsReplyForAccount(box.accountId())).isEqualTo(1);
    assertThat(messageRepo.countNeedsReply(box.userId())).isEqualTo(1);
    // 요약 DTO 도 같은 기준 — 기간 밖 true 는 false 로 내보내 웹·홈 우선순위가 집계와 어긋나지 않는다
    assertThat(messageRepo.listRecentUnread(box.userId(), 10))
        .extracting(EmailMessageSummary::id, EmailMessageSummary::aiNeedsReply)
        .containsExactly(tuple(recent, true), tuple(old, false));
  }

  @Test
  void proactiveScans_skipMailOutsideWindow() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long recent = unanalyzedMail(box, 1);
    long old = unanalyzedMail(box, 3);

    assertThat(messageRepo.listRecentUnreadUnsummarizedIds(box.accountId(), 50))
        .contains(recent)
        .doesNotContain(old);
    assertThat(messageRepo.listRecentUnreadUnanalyzedIds(box.accountId(), 50))
        .contains(recent)
        .doesNotContain(old);
    assertThat(messageRepo.listReanalysisTargetIds(box.accountId(), 50))
        .contains(recent)
        .doesNotContain(old);
  }

  @Test
  void receivedAtNull_isOutsideWindow() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long env = needsReplyMail(box, 0);
    dsl.update(EMAIL_MESSAGE)
        .setNull(EMAIL_MESSAGE.RECEIVED_AT)
        .where(EMAIL_MESSAGE.ID.eq(env))
        .execute();

    assertThat(messageRepo.countNeedsReplyForAccount(box.accountId())).isZero();
  }
}
