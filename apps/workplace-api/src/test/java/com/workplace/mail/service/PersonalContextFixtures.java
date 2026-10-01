package com.workplace.mail.service;

import static com.workplace.jooq.Tables.CONTENT_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.PROJECT_MEMBER;

import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.service.MailAnalysisFixtures.Box;
import java.time.OffsetDateTime;
import org.jooq.DSLContext;

/** WP-150 스레드 맥락·연결 이슈·첨부 통합 테스트 공용 시드(테넌트#1, 세션 GUC). */
public final class PersonalContextFixtures {

  /** 시드한 이슈 — id 와 "{프로젝트키}-1". */
  public record IssueSeed(long issueId, String key) {}

  private PersonalContextFixtures() {}

  /** 계정의 폴더(예: SENT, Archive). */
  public static long folder(DSLContext dsl, long accountId, String name) {
    return dsl.insertInto(EMAIL_FOLDER)
        .set(EMAIL_FOLDER.ACCOUNT_ID, accountId)
        .set(EMAIL_FOLDER.NAME, name)
        .set(EMAIL_FOLDER.TENANT_ID, 1L)
        .returning(EMAIL_FOLDER.ID)
        .fetchOne()
        .getId();
  }

  /** 지정 폴더·스레드·수신 시각의 적재 완료 사본(본문 평문 = body, 받는 사람 = box 주소). */
  public static long threadMail(
      DSLContext dsl,
      EmailContentRepository contentRepo,
      Box box,
      long folderId,
      String threadId,
      OffsetDateTime receivedAt,
      String from,
      String body) {
    // snippet 컬럼은 280자 상한이라 긴 본문은 앞부분만 넣는다
    long content =
        MailAnalysisFixtures.content(
            dsl, contentRepo, body, body.substring(0, Math.min(body.length(), 200)));
    long env =
        MailAnalysisFixtures.envelope(
            dsl, box.accountId(), folderId, content, from, box.address(), null);
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.THREAD_ID, threadId)
        .set(EMAIL_MESSAGE.RECEIVED_AT, receivedAt)
        .where(EMAIL_MESSAGE.ID.eq(env))
        .execute();
    return env;
  }

  /** 본문 미적재·미검증 사본으로 되돌린다(WP-130 — 공유 본문을 보여서는 안 되는 상태). */
  public static void markUnfetched(DSLContext dsl, long envelopeId) {
    dsl.update(EMAIL_MESSAGE)
        .setNull(EMAIL_MESSAGE.FETCHED_AT)
        .where(EMAIL_MESSAGE.ID.eq(envelopeId))
        .execute();
  }

  /** 사본에 첨부 1건(content 매니페스트 + 사본 행). */
  public static void attachment(
      DSLContext dsl,
      long envelopeId,
      int ordinal,
      String filename,
      String contentType,
      String mimeContentId) {
    long contentId =
        dsl.select(EMAIL_MESSAGE.CONTENT_ID)
            .from(EMAIL_MESSAGE)
            .where(EMAIL_MESSAGE.ID.eq(envelopeId))
            .fetchOne(EMAIL_MESSAGE.CONTENT_ID);
    long ca =
        dsl.insertInto(CONTENT_ATTACHMENT)
            .set(CONTENT_ATTACHMENT.TENANT_ID, 1L)
            .set(CONTENT_ATTACHMENT.CONTENT_ID, contentId)
            .set(CONTENT_ATTACHMENT.ORDINAL, ordinal)
            .set(CONTENT_ATTACHMENT.FILENAME, filename)
            .set(CONTENT_ATTACHMENT.CONTENT_TYPE, contentType)
            .set(CONTENT_ATTACHMENT.SIZE_BYTES, 10L)
            .set(CONTENT_ATTACHMENT.MIME_CONTENT_ID, mimeContentId)
            .returning(CONTENT_ATTACHMENT.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(EMAIL_ATTACHMENT)
        .set(EMAIL_ATTACHMENT.TENANT_ID, 1L)
        .set(EMAIL_ATTACHMENT.MESSAGE_ID, envelopeId)
        .set(EMAIL_ATTACHMENT.CONTENT_ATTACHMENT_ID, ca)
        .set(EMAIL_ATTACHMENT.ORDINAL, ordinal)
        .execute();
  }

  /** 새 프로젝트에 메일 출처(MAIL, envelopeId) 이슈 1건. */
  public static IssueSeed linkedIssue(
      DSLContext dsl, long reporterId, long envelopeId, String title, String status) {
    String key = "LK" + (System.nanoTime() % 1_000_000);
    long project =
        dsl.insertInto(PROJECT)
            .set(PROJECT.KEY, key)
            .set(PROJECT.NAME, "연결 이슈 테스트")
            .set(PROJECT.OWNER_ID, reporterId)
            .set(PROJECT.TENANT_ID, 1L)
            .returning(PROJECT.ID)
            .fetchOne()
            .getId();
    // 이슈 가시성은 프로젝트 멤버십 기준 — 보고자를 멤버로 둔다(멤버십이 없는 경우는 테스트가 행을 지워 만든다)
    dsl.insertInto(PROJECT_MEMBER)
        .set(PROJECT_MEMBER.PROJECT_ID, project)
        .set(PROJECT_MEMBER.USER_ID, reporterId)
        .set(PROJECT_MEMBER.ROLE, "OWNER")
        .execute();
    long type =
        dsl.insertInto(ISSUE_TYPE_DEF)
            .set(ISSUE_TYPE_DEF.PROJECT_ID, project)
            .set(ISSUE_TYPE_DEF.NAME, "TASK")
            .set(ISSUE_TYPE_DEF.COLOR_TOKEN, "BLUE")
            .set(ISSUE_TYPE_DEF.ICON, "Circle")
            .returning(ISSUE_TYPE_DEF.ID)
            .fetchOne()
            .getId();
    long issue =
        dsl.insertInto(ISSUE)
            .set(ISSUE.PROJECT_ID, project)
            .set(ISSUE.NUMBER, 1)
            .set(ISSUE.TITLE, title)
            .set(ISSUE.STATUS, status)
            .set(ISSUE.PRIORITY, "MID")
            .set(ISSUE.REPORTER_ID, reporterId)
            .set(ISSUE.TYPE_ID, type)
            .set(ISSUE.TENANT_ID, 1L)
            .set(ISSUE.SOURCE_TYPE, "MAIL")
            .set(ISSUE.SOURCE_ID, envelopeId)
            .returning(ISSUE.ID)
            .fetchOne()
            .getId();
    return new IssueSeed(issue, key + "-1");
  }
}
