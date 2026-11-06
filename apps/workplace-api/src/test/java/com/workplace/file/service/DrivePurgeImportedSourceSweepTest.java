// DrivePurgeImportedSourceSweepTest.java — 드라이브로 가져간 노트 첨부·이슈 본문 이미지가 드라이브 영구 삭제·정리 스윕 뒤에도
// 남는지(WP-1392)
package com.workplace.file.service;

import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.ISSUE_BODY_IMAGE;
import static com.workplace.jooq.Tables.WIKI_PAGE;
import static com.workplace.jooq.Tables.WIKI_PAGE_ATTACHMENT;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static com.workplace.jooq.Tables.WIKI_SPACE_MEMBER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.service.DriveFileService;
import com.workplace.drive.service.DriveLinkService;
import com.workplace.drive.service.DriveReferencedFileRetentionPolicy;
import com.workplace.drive.service.DriveSpaceService;
import com.workplace.drive.service.DriveTrashService;
import com.workplace.file.api.ExpiredFileRetentionPolicy;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.IssueBodyImageResponse;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.service.IssueBodyImageRetentionPolicy;
import com.workplace.issue.support.IssueSeeds;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.WikiAttachmentResponse;
import com.workplace.wiki.service.WikiAttachmentRetentionPolicy;
import com.workplace.wiki.service.WikiAttachmentService;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.TableField;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1392: 노트 첨부·이슈 본문 이미지도 「드라이브로 저장」하면 drive_file 이 같은 file 행을 가리킨다. 드라이브 쪽을 영구 삭제(휴지통 비우기·공간
 * 삭제처럼 file 에 만료를 거는 경로, 그리고 회귀로 개별 영구 삭제·보존기간 정리)해도 원래 자리에 아직 보이는(강등 안 된) 첨부의 file 에는 만료가 걸리지 않고,
 * 정리 스윕을 돌려도 첨부·file 행·디스크 원본이 남는다. 강등된(본문에서 뺀) 것은 보호하지 않는다 — 원래 도메인이 이미 회수로 넘긴 file 이다.
 *
 * <p>스윕은 package-private {@code cleanupExpiredForCurrentTenant} 를 같은 트랜잭션에서 직접
 * 부른다(FileCleanupServiceTest 와 같은 방식) — 그래서 이 테스트는 file.service 패키지에 둔다. 테넌트#1 트랜잭션 안에서 돌고 롤백된다.
 */
@Transactional
class DrivePurgeImportedSourceSweepTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired FileCleanupService cleanup;
  @Autowired DriveSpaceService spaceService;
  @Autowired DriveFileService driveFileService;
  @Autowired DriveTrashService trashService;
  @Autowired DriveLinkService linkService;
  @Autowired ProjectService projectService;
  @Autowired IssueRepository issueRepo;
  @Autowired WikiAttachmentService wikiAttachmentService;
  @Autowired WikiAttachmentRetentionPolicy wikiRetention;
  @Autowired IssueBodyImageRetentionPolicy bodyImageRetention;
  @Autowired DriveReferencedFileRetentionPolicy driveRetention;

  @TempDir Path tempDir;

  private long me;

  /** RLS GUC — 모든 시드·삭제를 테넌트#1 로. 호출자는 테스트마다 새 사람. */
  @BeforeEach
  void setUp() {
    TenantContext.set(1L);
    me = TestFixtures.createHuman(dsl);
  }

  /** ThreadLocal 누수 방지. */
  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  // ─── 드라이브 영구 삭제 + 정리 스윕 ─────────────────────────────────────

  /** 노트 첨부 → 드라이브 저장 → 팀 공간 삭제 → 스윕: 노트 첨부·file·원본 유지, 만료 없음. */
  @Test
  void 노트_첨부를_드라이브에_저장후_공간을_삭제하고_스윕해도_첨부가_남는다() throws IOException {
    long page = seedWikiPage();
    Path blob = blob();
    long fileId = seedPermanentFile(blob);
    seedWikiAttachment(fileId, page);
    long spaceId = newSpace();
    DriveFileResponse imported = linkService.importAttachment(me, spaceId, null, fileId);

    spaceService.deleteTeamSpace(me, spaceId);
    cleanup.cleanupExpiredForCurrentTenant();

    assertThat(dsl.fetchExists(DRIVE_FILE, DRIVE_FILE.ID.eq(imported.id()))).isFalse();
    assertKept(fileId, blob, WIKI_PAGE_ATTACHMENT.FILE_ID);
  }

  /**
   * 회귀 — 개별 영구 삭제·보존기간 지난 휴지통 정리(purgeExpired)는 원래부터 가져온 file 에 만료를 걸지 않는다(버전 행 기준 — 가져오기는 버전 행이
   * 없다). 노트 첨부·본문 이미지 모두 스윕 뒤에도 남는다.
   */
  @Test
  void 회귀_개별_영구삭제와_보존기간_정리도_가져온_노트_첨부와_본문_이미지를_남긴다() throws IOException {
    long page = seedWikiPage();
    Path wikiBlob = blob();
    long wikiFile = seedPermanentFile(wikiBlob);
    seedWikiAttachment(wikiFile, page);
    ProjectResponse proj = newProject();
    Path bodyBlob = blob();
    long bodyFile = seedPermanentFile(bodyBlob);
    seedBodyImage(bodyFile, proj.id(), seedIssue(proj, null));
    long spaceId = newSpace();
    DriveFileResponse wikiCopy = linkService.importAttachment(me, spaceId, null, wikiFile);
    DriveFileResponse bodyCopy = linkService.importAttachment(me, spaceId, null, bodyFile);

    driveFileService.delete(me, wikiCopy.id());
    trashService.purgeFile(me, wikiCopy.id());
    driveFileService.delete(me, bodyCopy.id());
    trashService.purgeExpired(OffsetDateTime.now(ZoneOffset.UTC).plusMinutes(1));
    cleanup.cleanupExpiredForCurrentTenant();

    assertThat(dsl.fetchExists(DRIVE_FILE, DRIVE_FILE.ID.in(wikiCopy.id(), bodyCopy.id())))
        .isFalse();
    assertKept(wikiFile, wikiBlob, WIKI_PAGE_ATTACHMENT.FILE_ID);
    assertKept(bodyFile, bodyBlob, ISSUE_BODY_IMAGE.FILE_ID);
  }

  /** 이슈 본문 이미지 → 드라이브 저장 → 휴지통 비우기 → 스윕: 본문 이미지·file·원본 유지, 만료 없음. */
  @Test
  void 본문_이미지를_드라이브에_저장후_휴지통을_비우고_스윕해도_이미지가_남는다() throws IOException {
    ProjectResponse proj = newProject();
    long issueId = seedIssue(proj, null);
    Path blob = blob();
    long fileId = seedPermanentFile(blob);
    seedBodyImage(fileId, proj.id(), issueId);
    long spaceId = newSpace();
    DriveFileResponse imported = linkService.importAttachment(me, spaceId, null, fileId);

    driveFileService.delete(me, imported.id());
    trashService.emptyTrash(me, spaceId);
    cleanup.cleanupExpiredForCurrentTenant();

    assertThat(dsl.fetchExists(DRIVE_FILE, DRIVE_FILE.ID.eq(imported.id()))).isFalse();
    assertKept(fileId, blob, ISSUE_BODY_IMAGE.FILE_ID);
  }

  /**
   * 대조 — 본문에서 뺀(강등 표시된) 노트 첨부는 보호하지 않는다: 드라이브 영구 삭제가 만료를 걸고 스윕이 file·원본·매핑을 회수한다. 드라이브가 쓰는 동안 강등은
   * 표시만 하고 만료를 걸지 않았으므로, 회수는 드라이브 영구 삭제가 맡는다.
   */
  @Test
  void 본문에서_뺀_노트_첨부는_드라이브_영구삭제_뒤_스윕이_회수한다() throws IOException {
    long page = seedWikiPage();
    Path blob = blob();
    long fileId = seedPermanentFile(blob);
    seedWikiAttachment(fileId, page);
    long spaceId = newSpace();
    DriveFileResponse imported = linkService.importAttachment(me, spaceId, null, fileId);
    wikiAttachmentService.syncReferences(page, "");
    assertThat(expiresAtOf(fileId)).as("드라이브가 쓰는 동안은 만료 없음").isNull();

    driveFileService.delete(me, imported.id());
    trashService.emptyTrash(me, spaceId);
    assertThat(expiresAtOf(fileId)).as("영구 삭제가 만료를 건다").isNotNull();
    cleanup.cleanupExpiredForCurrentTenant();

    assertThat(dsl.fetchExists(FILE, FILE.ID.eq(fileId))).isFalse();
    assertThat(dsl.fetchExists(WIKI_PAGE_ATTACHMENT, WIKI_PAGE_ATTACHMENT.FILE_ID.eq(fileId)))
        .isFalse();
    assertThat(blob).doesNotExist();
  }

  // ─── 보존 정책 순서 무관 ────────────────────────────────────────────────

  /**
   * 드라이브가 쓰는 file 에 (경합으로) 만료가 걸려 있고 원래 본문도 그 file 을 참조할 때, 보존 정책을 어떤 순서로 돌려도 결과가 같다 — 드라이브 정책이 만료를
   * 해제하고, 노트·본문 이미지 정책은 드라이브 몫 id 를 재무장하지 않는다.
   */
  @Test
  void 드라이브가_쓰는_file_은_보존_정책_순서와_무관하게_만료가_해제된다() throws IOException {
    long page = seedWikiPage();
    long wikiFile = seedPermanentFile(blob());
    seedWikiAttachment(wikiFile, page);
    dsl.update(WIKI_PAGE)
        .set(WIKI_PAGE.BODY, "![](" + WikiAttachmentResponse.urlOf(page, wikiFile) + ")")
        .where(WIKI_PAGE.ID.eq(page))
        .execute();
    ProjectResponse proj = newProject();
    long bodyFile = seedPermanentFile(blob());
    long issueId =
        seedIssue(proj, "![](" + IssueBodyImageResponse.urlOf(proj.key(), bodyFile) + ")");
    seedBodyImage(bodyFile, proj.id(), issueId);
    long spaceId = newSpace();
    linkService.importAttachment(me, spaceId, null, wikiFile);
    linkService.importAttachment(me, spaceId, null, bodyFile);
    List<Long> ids = List.of(wikiFile, bodyFile);

    List<List<ExpiredFileRetentionPolicy>> orders =
        List.of(
            List.of(wikiRetention, bodyImageRetention, driveRetention),
            List.of(driveRetention, wikiRetention, bodyImageRetention));
    for (List<ExpiredFileRetentionPolicy> order : orders) {
      // 경합으로 만료가 다시 걸린 상태
      dsl.update(FILE)
          .set(FILE.EXPIRES_AT, OffsetDateTime.now(ZoneOffset.UTC).minusMinutes(1))
          .where(FILE.ID.in(ids))
          .execute();
      Set<Long> retained = new HashSet<>();
      order.forEach(p -> retained.addAll(p.retain(ids)));

      assertThat(retained).as("순서 %s", order).containsExactlyInAnyOrderElementsOf(ids);
      assertThat(expiresAtOf(wikiFile)).as("노트 첨부, 순서 %s", order).isNull();
      assertThat(expiresAtOf(bodyFile)).as("본문 이미지, 순서 %s", order).isNull();
    }
    // 노트·본문 이미지 정책은 드라이브 몫을 아예 판정하지 않는다
    assertThat(wikiRetention.retain(ids)).isEmpty();
    assertThat(bodyImageRetention.retain(ids)).isEmpty();
  }

  // ─── 도우미 ────────────────────────────────────────────────────────────

  /** 정션 행·file 행·디스크 blob 이 남고 file 이 영구(expires_at NULL)인지. */
  private void assertKept(long fileId, Path blob, TableField<?, Long> junctionFileId) {
    assertThat(dsl.fetchExists(junctionFileId.getTable(), junctionFileId.eq(fileId))).isTrue();
    assertThat(dsl.fetchExists(FILE, FILE.ID.eq(fileId))).isTrue();
    assertThat(blob).exists();
    assertThat(expiresAtOf(fileId)).isNull();
  }

  /** file 행의 만료 시각(없으면 null). */
  private OffsetDateTime expiresAtOf(long fileId) {
    return dsl.select(FILE.EXPIRES_AT)
        .from(FILE)
        .where(FILE.ID.eq(fileId))
        .fetchOne(FILE.EXPIRES_AT);
  }

  /** 내가 OWNER 인 노트 공간의 페이지 하나. */
  private long seedWikiPage() {
    long space =
        dsl.insertInto(WIKI_SPACE)
            .set(WIKI_SPACE.TYPE, "TEAM")
            .set(WIKI_SPACE.NAME, "sw-" + suffix())
            .set(WIKI_SPACE.OWNER_ID, me)
            .returning(WIKI_SPACE.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(WIKI_SPACE_MEMBER)
        .set(WIKI_SPACE_MEMBER.SPACE_ID, space)
        .set(WIKI_SPACE_MEMBER.USER_ID, me)
        .set(WIKI_SPACE_MEMBER.ROLE, "OWNER")
        .execute();
    return dsl.insertInto(WIKI_PAGE)
        .set(WIKI_PAGE.SPACE_ID, space)
        .set(WIKI_PAGE.TITLE, "p")
        .returning(WIKI_PAGE.ID)
        .fetchOne()
        .getId();
  }

  /** 페이지에 붙은(강등 아님) 노트 첨부 매핑. */
  private void seedWikiAttachment(long fileId, long pageId) {
    dsl.insertInto(WIKI_PAGE_ATTACHMENT)
        .set(WIKI_PAGE_ATTACHMENT.FILE_ID, fileId)
        .set(WIKI_PAGE_ATTACHMENT.PAGE_ID, pageId)
        .set(WIKI_PAGE_ATTACHMENT.ATTACHED_BY, me)
        .execute();
  }

  /** 내가 소유한 프로젝트. */
  private ProjectResponse newProject() {
    String key = ("SW" + suffix().toUpperCase()).substring(0, 10);
    return projectService.create(me, new CreateProjectRequest(key, "P-sweep", "x"));
  }

  /** 프로젝트에 1번 이슈(본문 선택). */
  private long seedIssue(ProjectResponse proj, String body) {
    return IssueSeeds.insert(issueRepo, baseDsl, proj.id(), 1, "본문", body, "MID", null, me).id();
  }

  /** 이슈에 연결된(강등 아님) 본문 이미지 매핑. */
  private void seedBodyImage(long fileId, long projectId, long issueId) {
    dsl.insertInto(ISSUE_BODY_IMAGE)
        .set(ISSUE_BODY_IMAGE.FILE_ID, fileId)
        .set(ISSUE_BODY_IMAGE.PROJECT_ID, projectId)
        .set(ISSUE_BODY_IMAGE.ISSUE_ID, issueId)
        .set(ISSUE_BODY_IMAGE.UPLOADED_BY, me)
        .execute();
  }

  /** 본문에 실려 영구가 된 이미지 file 행(만료 없음) — 디스크 blob 을 가리킨다. */
  private long seedPermanentFile(Path blob) {
    return dsl.insertInto(FILE)
        .set(FILE.ORIGINAL_NAME, "img-" + suffix() + ".png")
        .set(FILE.STORED_NAME, blob.getFileName().toString())
        .set(FILE.STORAGE_PATH, blob.toString())
        .set(FILE.MIME_TYPE, "image/png")
        .set(FILE.SIZE_BYTES, 10L)
        .set(FILE.CATEGORY, "IMAGE")
        .set(FILE.UPLOADED_BY, me)
        .returning(FILE.ID)
        .fetchOne()
        .getId();
  }

  /** 디스크에 실제 blob 을 만든다(절대경로 — FileStore 가 레거시 경로로 다룬다). */
  private Path blob() throws IOException {
    Path p = tempDir.resolve("blob-" + suffix() + ".png");
    Files.writeString(p, "image");
    return p;
  }

  /** 내가 소유한 팀 드라이브 공간을 새로 만든다. */
  private long newSpace() {
    return spaceService.createTeamSpace(me, "sw-" + suffix()).id();
  }

  /** 이름·키 충돌을 피하는 8자 무작위 접미사. */
  private static String suffix() {
    return UUID.randomUUID().toString().replace("-", "").substring(0, 8);
  }
}
