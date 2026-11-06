package com.workplace.drive;

import static com.workplace.jooq.Tables.CHANNEL;
import static com.workplace.jooq.Tables.CHAT_MESSAGE;
import static com.workplace.jooq.Tables.CHAT_MESSAGE_ATTACHMENT;
import static com.workplace.jooq.Tables.CHAT_THREAD;
import static com.workplace.jooq.Tables.CONTENT_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.HOME_MESSAGE;
import static com.workplace.jooq.Tables.HOME_MESSAGE_ATTACHMENT;
import static com.workplace.jooq.Tables.HOME_SESSION;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ATTACHMENT;
import static com.workplace.jooq.Tables.ISSUE_BODY_IMAGE;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static com.workplace.jooq.Tables.MAIL_ATTACHMENT_BLOB;
import static com.workplace.jooq.Tables.MAIL_DRAFT;
import static com.workplace.jooq.Tables.MAIL_DRAFT_ATTACHMENT;
import static com.workplace.jooq.Tables.MESSAGE;
import static com.workplace.jooq.Tables.MESSAGE_ATTACHMENT;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.WIKI_PAGE;
import static com.workplace.jooq.Tables.WIKI_PAGE_ATTACHMENT;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.drive.dto.DriveSpaceResponse;
import com.workplace.drive.repository.DriveFileRepository;
import com.workplace.drive.repository.DriveQuotaRepository;
import com.workplace.drive.repository.DriveQuotaRepository.Kind;
import com.workplace.drive.service.DriveFileService;
import com.workplace.drive.service.DriveSpaceService;
import com.workplace.file.api.InternalFileCategories;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import java.util.EnumMap;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.annotation.Transactional;

/**
 * 저장 공간 사용량 집계(WP-1391) — file 전체에서 내부 카테고리만 빼고 로컬 보낸 메일 blob 을 더한다. 종류별 내역은 한 file 을 한 종류에만 넣어 내역
 * 합이 합계와 같다.
 *
 * <p>공유 테스트 DB 에 다른 테스트가 남긴 행이 있을 수 있어 모든 단언은 「시드 전후 차이」로 한다. 테넌트#1 테스트 트랜잭션 안에서 돌고 롤백된다.
 */
@Transactional
class DriveQuotaRepositoryTest extends IntegrationTestBase {

  @Autowired DriveQuotaRepository quota;
  @Autowired DSLContext dsl;
  @Autowired DriveSpaceService spaceService;
  @Autowired DriveFileService driveFileService;
  @Autowired DriveFileRepository driveFileRepo;

  private long me;

  /** RLS(app.tenant_id) GUC 설정 — INSERT/SELECT 모두 테넌트#1 스코프. */
  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
    me = TestFixtures.createHuman(dsl);
  }

  /** ThreadLocal 누수 방지. */
  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  @Test
  void 드라이브_업로드는_DRIVE_휴지통에_넣으면_TRASH_로_옮겨지고_합계는_그대로() throws Exception {
    long usedBefore = quota.sumUsedBytes();
    Map<Kind, Long> before = quota.breakdown();
    DriveSpaceResponse sp = spaceService.createTeamSpace(me, "팀");
    var uploaded =
        driveFileService.upload(
            me,
            sp.id(),
            null,
            new MockMultipartFile("file", "a.txt", "text/plain", "hello world".getBytes()));

    assertThat(quota.sumUsedBytes() - usedBefore).isEqualTo(11L);
    assertThat(diff(before, quota.breakdown()))
        .containsEntry(Kind.DRIVE, 11L)
        .containsEntry(Kind.TRASH, 0L);

    // 휴지통도 디스크를 먹으므로 합계에서 빠지지 않는다 — 내역에서 종류만 바뀐다.
    driveFileService.delete(me, uploaded.id());

    assertThat(quota.sumUsedBytes() - usedBefore).isEqualTo(11L);
    assertThat(diff(before, quota.breakdown()))
        .containsEntry(Kind.DRIVE, 0L)
        .containsEntry(Kind.TRASH, 11L);
  }

  @Test
  void 첨부에서_가져온_드라이브_파일은_버전_행이_없어도_DRIVE_휴지통이면_TRASH() throws Exception {
    // 첨부 가져오기(DriveLinkService.importAttachment)는 버전 행 없이 같은 file 을 가리키는 drive_file 만 만든다 —
    // drive_file.file_id 도 봐야 이슈 첨부가 아니라 드라이브로, 휴지통에 넣으면 휴지통으로 잡힌다.
    long usedBefore = quota.sumUsedBytes();
    Map<Kind, Long> before = quota.breakdown();
    long projectId = seedProject();
    long fileId = seedFile(53, "ATTACHMENT", null);
    dsl.insertInto(ISSUE_ATTACHMENT)
        .set(ISSUE_ATTACHMENT.FILE_ID, fileId)
        .set(ISSUE_ATTACHMENT.ISSUE_ID, seedIssue(projectId))
        .set(ISSUE_ATTACHMENT.ATTACHED_BY, me)
        .execute();
    DriveSpaceResponse sp = spaceService.createTeamSpace(me, "가져오기");
    long driveFileId = driveFileRepo.insert(sp.id(), null, fileId, "imported.txt");

    assertThat(diff(before, quota.breakdown()))
        .containsEntry(Kind.DRIVE, 53L)
        .containsEntry(Kind.TRASH, 0L)
        .containsEntry(Kind.ISSUE, 0L);

    driveFileService.delete(me, driveFileId);

    assertThat(diff(before, quota.breakdown()))
        .containsEntry(Kind.DRIVE, 0L)
        .containsEntry(Kind.TRASH, 53L)
        .containsEntry(Kind.ISSUE, 0L);
    // 같은 file 하나라 합계에는 한 번만 들어간다.
    assertThat(quota.sumUsedBytes() - usedBefore).isEqualTo(53L);
  }

  @Test
  void 종류별_첨부가_합계와_내역에_한_번씩_잡히고_내부_카테고리는_빠진다() {
    long usedBefore = quota.sumUsedBytes();
    Map<Kind, Long> before = quota.breakdown();
    OffsetDateTime future = OffsetDateTime.now().plusHours(24);

    long projectId = seedProject();
    long issueId = seedIssue(projectId);

    // 노트 첨부 13
    long wikiFile = seedFile(13, "ATTACHMENT", null);
    dsl.insertInto(WIKI_PAGE_ATTACHMENT)
        .set(WIKI_PAGE_ATTACHMENT.FILE_ID, wikiFile)
        .set(WIKI_PAGE_ATTACHMENT.PAGE_ID, seedWikiPage())
        .set(WIKI_PAGE_ATTACHMENT.ATTACHED_BY, me)
        .execute();
    // 이슈 첨부 17 + 본문 이미지 19
    dsl.insertInto(ISSUE_ATTACHMENT)
        .set(ISSUE_ATTACHMENT.FILE_ID, seedFile(17, "ATTACHMENT", null))
        .set(ISSUE_ATTACHMENT.ISSUE_ID, issueId)
        .set(ISSUE_ATTACHMENT.ATTACHED_BY, me)
        .execute();
    dsl.insertInto(ISSUE_BODY_IMAGE)
        .set(ISSUE_BODY_IMAGE.FILE_ID, seedFile(19, "ATTACHMENT", null))
        .set(ISSUE_BODY_IMAGE.PROJECT_ID, projectId)
        .set(ISSUE_BODY_IMAGE.ISSUE_ID, issueId)
        .set(ISSUE_BODY_IMAGE.UPLOADED_BY, me)
        .execute();
    // 이슈챗 첨부 23
    long chatMessageId = seedChatMessage(issueId);
    dsl.insertInto(CHAT_MESSAGE_ATTACHMENT)
        .set(CHAT_MESSAGE_ATTACHMENT.FILE_ID, seedFile(23, "ATTACHMENT", null))
        .set(CHAT_MESSAGE_ATTACHMENT.MESSAGE_ID, chatMessageId)
        .set(CHAT_MESSAGE_ATTACHMENT.ATTACHED_BY, me)
        .execute();
    // 채팅 29 · 홈 31 · 메일 초안 37
    dsl.insertInto(MESSAGE_ATTACHMENT)
        .set(MESSAGE_ATTACHMENT.FILE_ID, seedFile(29, "ATTACHMENT", null))
        .set(MESSAGE_ATTACHMENT.MESSAGE_ID, seedChannelMessage())
        .set(MESSAGE_ATTACHMENT.ATTACHED_BY, me)
        .execute();
    dsl.insertInto(HOME_MESSAGE_ATTACHMENT)
        .set(HOME_MESSAGE_ATTACHMENT.FILE_ID, seedFile(31, "ATTACHMENT", null))
        .set(HOME_MESSAGE_ATTACHMENT.MESSAGE_ID, seedHomeMessage())
        .set(HOME_MESSAGE_ATTACHMENT.ATTACHED_BY, me)
        .execute();
    long accountId = seedAccount();
    long draftId =
        dsl.insertInto(MAIL_DRAFT)
            .set(MAIL_DRAFT.USER_ID, me)
            .set(MAIL_DRAFT.ACCOUNT_ID, accountId)
            .returning(MAIL_DRAFT.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(MAIL_DRAFT_ATTACHMENT)
        .set(MAIL_DRAFT_ATTACHMENT.DRAFT_ID, draftId)
        .set(MAIL_DRAFT_ATTACHMENT.FILE_ID, seedFile(37, "ATTACHMENT", future))
        .execute();
    // 어디에도 안 묶인 임시 업로드 41
    seedFile(41, "ATTACHMENT", future);
    // 내부 카테고리(메일 추출 사본) 43 — 사용량에도 내역에도 들어가지 않는다.
    seedFile(43, InternalFileCategories.MAIL_EXTRACT, future);
    // 이슈 첨부이면서 이슈챗에도 묶인 47 — 우선순위가 앞인 ISSUE 에 한 번만 센다.
    long shared = seedFile(47, "ATTACHMENT", null);
    dsl.insertInto(ISSUE_ATTACHMENT)
        .set(ISSUE_ATTACHMENT.FILE_ID, shared)
        .set(ISSUE_ATTACHMENT.ISSUE_ID, issueId)
        .set(ISSUE_ATTACHMENT.ATTACHED_BY, me)
        .execute();
    dsl.insertInto(CHAT_MESSAGE_ATTACHMENT)
        .set(CHAT_MESSAGE_ATTACHMENT.FILE_ID, shared)
        .set(CHAT_MESSAGE_ATTACHMENT.MESSAGE_ID, chatMessageId)
        .set(CHAT_MESSAGE_ATTACHMENT.ATTACHED_BY, me)
        .execute();

    Map<Kind, Long> d = diff(before, quota.breakdown());
    assertThat(d)
        .containsEntry(Kind.DRIVE, 0L)
        .containsEntry(Kind.TRASH, 0L)
        .containsEntry(Kind.WIKI, 13L)
        .containsEntry(Kind.ISSUE, 17L + 19L + 47L)
        .containsEntry(Kind.ISSUE_CHAT, 23L)
        .containsEntry(Kind.OTHER_ATTACHMENTS, 29L + 31L + 37L)
        .containsEntry(Kind.UNLINKED, 41L);
    long expectedTotal = 13 + 17 + 19 + 47 + 23 + 29 + 31 + 37 + 41;
    assertThat(quota.sumUsedBytes() - usedBefore).isEqualTo(expectedTotal);
    // 내역 합 = 합계(시드 전후 모두) — 화면의 숫자가 서로 맞는다.
    assertThat(sum(quota.breakdown())).isEqualTo(quota.sumUsedBytes());
  }

  @Test
  void 로컬_보낸_메일_blob_은_합계에_들어가고_받은_메일_캐시는_메일_캐시에만_잡힌다() {
    long usedBefore = quota.sumUsedBytes();
    long cacheBefore = quota.sumMailCacheBytes();
    Map<Kind, Long> before = quota.breakdown();

    long accountId = seedAccount();
    long folderId =
        dsl.insertInto(EMAIL_FOLDER)
            .set(EMAIL_FOLDER.ACCOUNT_ID, accountId)
            .set(EMAIL_FOLDER.NAME, "Sent")
            .returning(EMAIL_FOLDER.ID)
            .fetchOne()
            .getId();
    String sentHash = hash("sent");
    String receivedHash = hash("recv");
    // 로컬 보낸 메일 — imap_uid·provider_message_id 모두 NULL(다시 받을 원본 없음).
    seedMailWithAttachment(accountId, folderId, null, sentHash);
    // 받은 메일 — 서버 좌표(imap_uid)가 있어 캐시가 지워져도 다시 받는다.
    seedMailWithAttachment(accountId, folderId, 7L, receivedHash);
    seedBlob(sentHash, 100);
    seedBlob(receivedHash, 200);

    assertThat(quota.sumUsedBytes() - usedBefore).isEqualTo(100L);
    assertThat(quota.sumMailCacheBytes() - cacheBefore).isEqualTo(200L);
    assertThat(diff(before, quota.breakdown()))
        .containsEntry(Kind.OTHER_ATTACHMENTS, 100L)
        .containsEntry(Kind.UNLINKED, 0L);
    assertThat(sum(quota.breakdown())).isEqualTo(quota.sumUsedBytes());
  }

  // ---------------------------------------------------------------------------------------------

  /** 시드 후 내역 − 시드 전 내역(종류별). */
  private static Map<Kind, Long> diff(Map<Kind, Long> before, Map<Kind, Long> after) {
    Map<Kind, Long> d = new EnumMap<>(Kind.class);
    for (Kind k : Kind.values()) {
      d.put(k, after.get(k) - before.get(k));
    }
    return d;
  }

  private static long sum(Map<Kind, Long> breakdown) {
    return breakdown.values().stream().mapToLong(Long::longValue).sum();
  }

  /** 64자 해시 흉내 — 테스트마다 달라 공유 DB 의 다른 blob 과 겹치지 않는다. */
  private static String hash(String prefix) {
    String raw = prefix + UUID.randomUUID().toString().replace("-", "") + "0".repeat(64);
    return raw.substring(0, 64);
  }

  /** FILE 행 직접 시드 — 집계는 행만 보므로 디스크 blob 은 만들지 않는다. */
  private long seedFile(long size, String category, OffsetDateTime expiresAt) {
    String stored = "quota-" + UUID.randomUUID();
    return dsl.insertInto(FILE)
        .set(FILE.ORIGINAL_NAME, "a.txt")
        .set(FILE.STORED_NAME, stored)
        .set(FILE.STORAGE_PATH, "tenant-1/test/" + stored)
        .set(FILE.MIME_TYPE, "text/plain")
        .set(FILE.SIZE_BYTES, size)
        .set(FILE.CATEGORY, category)
        .set(FILE.UPLOADED_BY, me)
        .set(FILE.EXPIRES_AT, expiresAt)
        .returning(FILE.ID)
        .fetchOne()
        .getId();
  }

  private long seedProject() {
    return dsl.insertInto(PROJECT)
        .set(PROJECT.KEY, "DQR" + (System.nanoTime() % 100000))
        .set(PROJECT.NAME, "쿼터 프로젝트")
        .set(PROJECT.OWNER_ID, me)
        .set(PROJECT.TENANT_ID, 1L)
        .returning(PROJECT.ID)
        .fetchOne()
        .getId();
  }

  private long seedIssue(long projectId) {
    long typeId =
        dsl.insertInto(ISSUE_TYPE_DEF)
            .set(ISSUE_TYPE_DEF.PROJECT_ID, projectId)
            .set(ISSUE_TYPE_DEF.NAME, "TASK")
            .set(ISSUE_TYPE_DEF.COLOR_TOKEN, "BLUE")
            .set(ISSUE_TYPE_DEF.ICON, "Circle")
            .returning(ISSUE_TYPE_DEF.ID)
            .fetchOne()
            .getId();
    return dsl.insertInto(ISSUE)
        .set(ISSUE.PROJECT_ID, projectId)
        .set(ISSUE.STATUS_ID, TestFixtures.defaultStatusId(projectId, "TODO"))
        .set(ISSUE.NUMBER, 1)
        .set(ISSUE.TITLE, "쿼터 이슈")
        .set(ISSUE.STATUS, "TODO")
        .set(ISSUE.PRIORITY, "MID")
        .set(ISSUE.REPORTER_ID, me)
        .set(ISSUE.TYPE_ID, typeId)
        .set(ISSUE.TENANT_ID, 1L)
        .returning(ISSUE.ID)
        .fetchOne()
        .getId();
  }

  private long seedWikiPage() {
    long spaceId =
        dsl.insertInto(WIKI_SPACE)
            .set(WIKI_SPACE.TYPE, "TEAM")
            .set(WIKI_SPACE.NAME, "쿼터 공간")
            .set(WIKI_SPACE.OWNER_ID, me)
            .set(WIKI_SPACE.TENANT_ID, 1L)
            .returning(WIKI_SPACE.ID)
            .fetchOne()
            .getId();
    return dsl.insertInto(WIKI_PAGE)
        .set(WIKI_PAGE.SPACE_ID, spaceId)
        .set(WIKI_PAGE.TITLE, "쿼터 페이지")
        .set(WIKI_PAGE.TENANT_ID, 1L)
        .returning(WIKI_PAGE.ID)
        .fetchOne()
        .getId();
  }

  private long seedChatMessage(long issueId) {
    long threadId =
        dsl.insertInto(CHAT_THREAD)
            .set(CHAT_THREAD.ISSUE_ID, issueId)
            .returning(CHAT_THREAD.ID)
            .fetchOne()
            .getId();
    return dsl.insertInto(CHAT_MESSAGE)
        .set(CHAT_MESSAGE.THREAD_ID, threadId)
        .set(CHAT_MESSAGE.AUTHOR_ID, me)
        .set(CHAT_MESSAGE.BODY, "첨부")
        .returning(CHAT_MESSAGE.ID)
        .fetchOne()
        .getId();
  }

  private long seedChannelMessage() {
    long channelId =
        dsl.insertInto(CHANNEL)
            .set(CHANNEL.KIND, "CHANNEL")
            .set(CHANNEL.VISIBILITY, "PUBLIC")
            .set(CHANNEL.CREATED_BY, me)
            .set(CHANNEL.TENANT_ID, 1L)
            .returning(CHANNEL.ID)
            .fetchOne()
            .getId();
    return dsl.insertInto(MESSAGE)
        .set(MESSAGE.CHANNEL_ID, channelId)
        .set(MESSAGE.AUTHOR_ID, me)
        .set(MESSAGE.BODY, "첨부")
        .set(MESSAGE.TENANT_ID, 1L)
        .returning(MESSAGE.ID)
        .fetchOne()
        .getId();
  }

  private long seedHomeMessage() {
    UUID sessionId =
        dsl.insertInto(HOME_SESSION)
            .set(HOME_SESSION.USER_ID, me)
            .returning(HOME_SESSION.ID)
            .fetchOne()
            .getId();
    return dsl.insertInto(HOME_MESSAGE)
        .set(HOME_MESSAGE.SESSION_ID, sessionId)
        .set(HOME_MESSAGE.ROLE, "USER")
        .set(HOME_MESSAGE.CONTENT, "첨부")
        .returning(HOME_MESSAGE.ID)
        .fetchOne()
        .getId();
  }

  private long seedAccount() {
    return dsl.insertInto(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.USER_ID, me)
        .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, "quota-" + me + "@test.local")
        .returning(EMAIL_ACCOUNT.ID)
        .fetchOne()
        .getId();
  }

  /**
   * 메일 1통(email_content + email_message) + 첨부 manifest(content_hash) 시드. imapUid null 이면 로컬 보낸 메일.
   */
  private void seedMailWithAttachment(long accountId, long folderId, Long imapUid, String hash) {
    String thread = "thread-" + hash.substring(0, 12);
    long contentId =
        dsl.insertInto(EMAIL_CONTENT)
            .set(EMAIL_CONTENT.TENANT_ID, 1L)
            .set(EMAIL_CONTENT.THREAD_ID, thread)
            .returning(EMAIL_CONTENT.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.ACCOUNT_ID, accountId)
        .set(EMAIL_MESSAGE.FOLDER_ID, folderId)
        .set(EMAIL_MESSAGE.IMAP_UID, imapUid)
        .set(EMAIL_MESSAGE.THREAD_ID, thread)
        .set(EMAIL_MESSAGE.CONTENT_ID, contentId)
        .execute();
    dsl.insertInto(CONTENT_ATTACHMENT)
        .set(CONTENT_ATTACHMENT.CONTENT_ID, contentId)
        .set(CONTENT_ATTACHMENT.ORDINAL, 0)
        .set(CONTENT_ATTACHMENT.CONTENT_HASH, hash)
        .execute();
  }

  private void seedBlob(String hash, long size) {
    dsl.insertInto(MAIL_ATTACHMENT_BLOB)
        .set(MAIL_ATTACHMENT_BLOB.CONTENT_HASH, hash)
        .set(MAIL_ATTACHMENT_BLOB.FILE_REF, "tenant-1/mail/" + hash)
        .set(MAIL_ATTACHMENT_BLOB.SIZE_BYTES, size)
        .execute();
  }
}
