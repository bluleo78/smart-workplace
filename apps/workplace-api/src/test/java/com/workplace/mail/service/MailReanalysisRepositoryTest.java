package com.workplace.mail.service;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.mail.service.MailAnalysisFixtures.LONG_BODY;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.mail.dto.AiAccountRef;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.MailAnalysisFixtures.Box;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-151 재분석 리포지토리 술어 — 버전 미만 AI 계정 수집, 조건부 UPDATE 선점(1회만)·되돌리기, 재분석 대상 메일(안읽음 INBOX · 적재 · 새 흐름
 * 미분석 · 최신순 · 상한).
 */
@Transactional
class MailReanalysisRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EmailContentRepository contentRepo;

  private int version(long accountId) {
    return dsl.select(EMAIL_ACCOUNT.AI_CLASSIFY_VERSION)
        .from(EMAIL_ACCOUNT)
        .where(EMAIL_ACCOUNT.ID.eq(accountId))
        .fetchOneInto(Integer.class);
  }

  private void setVersion(long accountId, int v) {
    dsl.update(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.AI_CLASSIFY_VERSION, v)
        .where(EMAIL_ACCOUNT.ID.eq(accountId))
        .execute();
  }

  /** 수신 시각을 고정한다(최신순 정렬 검증). */
  private void receivedAt(long envelopeId, OffsetDateTime at) {
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.RECEIVED_AT, at)
        .where(EMAIL_MESSAGE.ID.eq(envelopeId))
        .execute();
  }

  @Test
  void newAccount_defaultsToZero() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    assertThat(version(box.accountId())).isZero();
  }

  @Test
  void claim_onlyOnce() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);

    assertThat(accountRepo.claimClassifyVersion(box.accountId(), 1)).isTrue();
    assertThat(accountRepo.claimClassifyVersion(box.accountId(), 1)).isFalse(); // 이미 선점됨
    assertThat(version(box.accountId())).isEqualTo(1);
  }

  @Test
  void claim_aiDisabled_false() {
    Box box = MailAnalysisFixtures.mailbox(dsl, false);

    assertThat(accountRepo.claimClassifyVersion(box.accountId(), 1)).isFalse();
    assertThat(version(box.accountId())).isZero();
  }

  @Test
  void claim_disabledAccount_false() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    dsl.update(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.DISABLED_AT, OffsetDateTime.now())
        .where(EMAIL_ACCOUNT.ID.eq(box.accountId()))
        .execute();

    assertThat(accountRepo.claimClassifyVersion(box.accountId(), 1)).isFalse();
  }

  @Test
  void release_revertsOnlyClaimedVersion() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    accountRepo.claimClassifyVersion(box.accountId(), 1);

    accountRepo.releaseClassifyVersion(box.accountId(), 1);
    assertThat(version(box.accountId())).isZero();

    // 선점 값이 아니면(이미 0) 아무것도 바꾸지 않는다 — 음수로 내려가지 않음
    accountRepo.releaseClassifyVersion(box.accountId(), 1);
    assertThat(version(box.accountId())).isZero();
  }

  @Test
  void listBelowVersion_filters() {
    Box outdated = MailAnalysisFixtures.mailbox(dsl, true);
    Box current = MailAnalysisFixtures.mailbox(dsl, true);
    setVersion(current.accountId(), 1);
    Box aiOff = MailAnalysisFixtures.mailbox(dsl, false);
    Box disabled = MailAnalysisFixtures.mailbox(dsl, true);
    dsl.update(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.DISABLED_AT, OffsetDateTime.now())
        .where(EMAIL_ACCOUNT.ID.eq(disabled.accountId()))
        .execute();

    List<AiAccountRef> refs = accountRepo.listAiEnabledAccountsBelowClassifyVersion(1);

    // 같은 테넌트에 다른 테스트의 계정이 있을 수 있어 포함/미포함만 단언한다
    assertThat(refs).contains(new AiAccountRef(outdated.userId(), outdated.accountId()));
    assertThat(refs)
        .extracting(AiAccountRef::accountId)
        .doesNotContain(current.accountId(), aiOff.accountId(), disabled.accountId());
  }

  @Test
  void targets_filtersAndOrders() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    OffsetDateTime now = OffsetDateTime.now();
    // 포함: 옛 기준으로 분류된 행(ai_needs_reply 있음, 새 흐름 미분석)
    long legacy = MailAnalysisFixtures.envelope(dsl, box, content, "a@x.com", box.address(), null);
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.AI_NEEDS_REPLY, true)
        .where(EMAIL_MESSAGE.ID.eq(legacy))
        .execute();
    receivedAt(legacy, now.minusMinutes(1));
    // 포함: 아직 분류되지 않은 행(가장 최근)
    long fresh = MailAnalysisFixtures.envelope(dsl, box, content, "b@x.com", box.address(), null);
    receivedAt(fresh, now);
    // 포함하되 상한 밖: 더 오래된 옛 분류 행
    long older = MailAnalysisFixtures.envelope(dsl, box, content, "c@x.com", box.address(), null);
    receivedAt(older, now.minusMinutes(5));
    // 제외: 읽음
    long read = MailAnalysisFixtures.envelope(dsl, box, content, "d@x.com", box.address(), null);
    MailAnalysisFixtures.markSeen(dsl, read);
    // 제외: 새 흐름으로 이미 분석됨
    long analyzed =
        MailAnalysisFixtures.envelope(dsl, box, content, "e@x.com", box.address(), null);
    MailAnalysisFixtures.markPersonallyAnalyzed(dsl, analyzed, false);
    // 제외: 미적재
    long unfetched =
        MailAnalysisFixtures.envelope(dsl, box, content, "f@x.com", box.address(), null);
    dsl.update(EMAIL_MESSAGE)
        .setNull(EMAIL_MESSAGE.FETCHED_AT)
        .where(EMAIL_MESSAGE.ID.eq(unfetched))
        .execute();
    // 제외: INBOX 아님
    long archiveFolder =
        dsl.insertInto(
                EMAIL_FOLDER, EMAIL_FOLDER.ACCOUNT_ID, EMAIL_FOLDER.NAME, EMAIL_FOLDER.TENANT_ID)
            .values(box.accountId(), "Archive", 1L)
            .returning(EMAIL_FOLDER.ID)
            .fetchOne()
            .getId();
    long archived =
        MailAnalysisFixtures.envelope(
            dsl, box.accountId(), archiveFolder, content, "g@x.com", box.address(), null);

    assertThat(messageRepo.listReanalysisTargetIds(box.accountId(), 2))
        .containsExactly(fresh, legacy);
    assertThat(messageRepo.listReanalysisTargetIds(box.accountId(), 50))
        .containsExactly(fresh, legacy, older)
        .doesNotContain(read, analyzed, unfetched, archived);
  }
}
