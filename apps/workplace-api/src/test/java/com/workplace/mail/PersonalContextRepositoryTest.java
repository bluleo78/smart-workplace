package com.workplace.mail;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.PROJECT_MEMBER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.service.IssueLookupService;
import com.workplace.mail.outbound.MailAiMessages.IssueRef;
import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.repository.PersonalContextRepository;
import com.workplace.mail.repository.PersonalContextRepository.AttachmentRow;
import com.workplace.mail.repository.PersonalContextRepository.PriorMailRow;
import com.workplace.mail.service.MailAnalysisFixtures;
import com.workplace.mail.service.MailAnalysisFixtures.Box;
import com.workplace.mail.service.PersonalContextFixtures;
import com.workplace.mail.service.PersonalContextFixtures.IssueSeed;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** WP-150 스레드 맥락(같은 계정·스레드·INBOX+SENT·적재 완료·이전 2건) · 첨부 행 · 연결 이슈 조회. */
@Transactional
class PersonalContextRepositoryTest extends IntegrationTestBase {

  @Autowired PersonalContextRepository repo;
  @Autowired DSLContext dsl;
  @Autowired EmailContentRepository contentRepo;
  @Autowired IssueLookupService issueLookup;

  private static final OffsetDateTime T0 = OffsetDateTime.parse("2026-09-28T00:00:00Z");

  /** 연결 이슈 조회 — 가시성은 issue 모듈의 공개 조회 서비스가 판정한다(PersonalContextLoader 와 같은 호출). */
  private Optional<IssueRef> linked(long userId, long messageId) {
    return issueLookup
        .findVisibleSourceIssue(userId, "MAIL", messageId)
        .map(r -> new IssueRef(r.key(), r.title(), r.status()));
  }

  private long mail(Box box, long folderId, String thread, int hour, String from, String body) {
    return PersonalContextFixtures.threadMail(
        dsl, contentRepo, box, folderId, thread, T0.plusHours(hour), from, body);
  }

  @Test
  void priorThread_sameAccountAndThread_inboxAndSent_latestTwoOldestFirst() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long sent = PersonalContextFixtures.folder(dsl, box.accountId(), "SENT");
    long archive = PersonalContextFixtures.folder(dsl, box.accountId(), "Archive");
    String th = "th-" + System.nanoTime();
    mail(box, box.folderId(), th, 0, "a@x.com", "첫 메일"); // 3번째로 오래됨 — 2건 상한으로 빠짐
    mail(box, sent, th, 1, box.address(), "내 답장"); // 이 앱에서 보낸 메일
    mail(box, box.folderId(), th, 2, "a@x.com", "둘째");
    mail(box, archive, th, 3, "a@x.com", "보관함"); // 폴더 제외
    long unfetched = mail(box, box.folderId(), th, 4, "a@x.com", "미검증");
    PersonalContextFixtures.markUnfetched(dsl, unfetched); // WP-130 제외
    long cur = mail(box, box.folderId(), th, 5, "a@x.com", "현재");
    mail(box, box.folderId(), th, 6, "a@x.com", "나중"); // 이후 메일 제외
    mail(box, box.folderId(), "other-" + System.nanoTime(), 3, "a@x.com", "다른 스레드");
    Box other = MailAnalysisFixtures.mailbox(dsl, true);
    mail(other, other.folderId(), th, 4, "a@x.com", "다른 계정");

    List<PriorMailRow> rows = repo.listPriorThreadMails(box.userId(), cur, 2);

    assertThat(rows).extracting(PriorMailRow::bodyText).containsExactly("내 답장", "둘째");
    assertThat(rows.get(0).fromAddress()).isEqualTo(box.address());
  }

  @Test
  void priorThread_otherUsersMessage_empty() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    Box stranger = MailAnalysisFixtures.mailbox(dsl, true);
    String th = "th-" + System.nanoTime();
    mail(box, box.folderId(), th, 0, "a@x.com", "이전");
    long cur = mail(box, box.folderId(), th, 1, "a@x.com", "현재");

    assertThat(repo.listPriorThreadMails(stranger.userId(), cur, 2)).isEmpty();
  }

  @Test
  void attachments_inOrdinalOrder() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long env = mail(box, box.folderId(), "th-" + System.nanoTime(), 0, "a@x.com", "본문");
    PersonalContextFixtures.attachment(dsl, env, 1, "회의록.docx", "application/msword", null);
    PersonalContextFixtures.attachment(dsl, env, 0, "image001.png", "image/png", "img001@x");

    List<AttachmentRow> rows = repo.listAttachments(env);

    assertThat(rows)
        .containsExactly(
            new AttachmentRow("image001.png", "image/png", "img001@x"),
            new AttachmentRow("회의록.docx", "application/msword", null));
  }

  @Test
  void linkedIssue_latestNonDeleted() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long env = mail(box, box.folderId(), "th-" + System.nanoTime(), 0, "a@x.com", "본문");
    IssueSeed live =
        PersonalContextFixtures.linkedIssue(dsl, box.userId(), env, "배포 일정 확정", "IN_PROGRESS");
    IssueSeed deleted = PersonalContextFixtures.linkedIssue(dsl, box.userId(), env, "삭제됨", "TODO");
    dsl.update(ISSUE)
        .set(ISSUE.DELETED_AT, OffsetDateTime.now())
        .where(ISSUE.ID.eq(deleted.issueId()))
        .execute();

    Optional<IssueRef> ref = linked(box.userId(), env);

    assertThat(ref).contains(new IssueRef(live.key(), "배포 일정 확정", "IN_PROGRESS"));
    assertThat(linked(box.userId(), env + 999_999)).isEmpty();
  }

  @Test
  void linkedIssue_requiresProjectMembership() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long env = mail(box, box.folderId(), "th-" + System.nanoTime(), 0, "a@x.com", "본문");
    IssueSeed seed = PersonalContextFixtures.linkedIssue(dsl, box.userId(), env, "비공개 일정", "TODO");
    long projectId =
        dsl.select(ISSUE.PROJECT_ID)
            .from(ISSUE)
            .where(ISSUE.ID.eq(seed.issueId()))
            .fetchOne(ISSUE.PROJECT_ID);

    assertThat(linked(box.userId(), env)).isPresent(); // 멤버 — 보인다

    // 프로젝트에서 빠지면 보이지 않는다
    dsl.deleteFrom(PROJECT_MEMBER)
        .where(PROJECT_MEMBER.PROJECT_ID.eq(projectId))
        .and(PROJECT_MEMBER.USER_ID.eq(box.userId()))
        .execute();
    assertThat(linked(box.userId(), env)).isEmpty();
  }
}
