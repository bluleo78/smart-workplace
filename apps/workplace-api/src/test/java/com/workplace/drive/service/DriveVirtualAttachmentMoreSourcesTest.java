// DriveVirtualAttachmentMoreSourcesTest.java — 첨부 모아보기의 이슈 본문 이미지·노트·메일 출처 통합 테스트(WP-1392)
package com.workplace.drive.service;

import static com.workplace.jooq.Tables.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.drive.dto.VirtualAttachmentPage;
import com.workplace.drive.dto.VirtualAttachmentResponse;
import com.workplace.drive.exception.DriveForbiddenException;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.IssueBodyImageResponse;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.service.IssueBodyImageService;
import com.workplace.issue.support.IssueSeeds;
import com.workplace.jooq.tables.File;
import com.workplace.mail.service.MailAttachmentSourceProvider;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.wiki.service.WikiAttachmentService;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * DriveLinkService.virtualAttachments·importAttachment 의 새 출처(WP-1392) — 이슈 본문 이미지(ISSUE 출처,
 * kind=BODY_IMAGE), 노트 첨부(WIKI), 내 메일 첨부(MAIL). 권한 밖은 목록과 가져오기 모두에서 안 보이고, 메일 첨부 id 로는 진짜 file 을
 * 가져올 수 없다.
 *
 * <p>호출자는 테스트마다 새로 만든 사람이라 공유 테스트 DB 의 다른 행이 목록에 섞이지 않는다. 테넌트#1 트랜잭션 안에서 돌고 롤백된다.
 */
@Transactional
class DriveVirtualAttachmentMoreSourcesTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired DriveLinkService service;
  @Autowired ProjectService projectService;
  @Autowired IssueRepository issueRepo;
  @Autowired MailAttachmentSourceProvider mailProvider;
  @Autowired ProjectRepository projectRepo;
  @Autowired IssueBodyImageService bodyImageService;
  @Autowired WikiAttachmentService wikiAttachmentService;
  @Autowired DriveReferencedFileRetentionPolicy driveRetention;

  /** 시드 기준 시각 — 초 단위로 잘라 Instant 비교가 흔들리지 않게. */
  private final OffsetDateTime now =
      OffsetDateTime.now(ZoneOffset.UTC).truncatedTo(ChronoUnit.SECONDS);

  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  // ─── 이슈 본문 이미지 ─────────────────────────────────────────────

  /** 연결된 본문 이미지는 ISSUE 출처에 kind=BODY_IMAGE 로 보이고, 미연결·강등·다른 프로젝트 것은 목록·가져오기 모두에서 빠진다. */
  @Test
  void bodyImage_boundOnly_inIssueSource_andImportFollowsSameRule() {
    long caller = seedUser("bi");
    long stranger = seedUser("bis");
    long driveSpace = seedDriveSpace(caller);
    ProjectResponse proj = newProject(caller, "BI");
    IssueRow issue = seedIssue(proj, caller, "본문 이슈");
    ProjectResponse other = newProject(stranger, "BO");
    IssueRow otherIssue = seedIssue(other, stranger, "남의 이슈");

    long bound = seedFile(caller, "shot.png", null);
    seedBodyImage(bound, proj.id(), issue.id(), caller, now.minusMinutes(5), null);
    long unbound = seedFile(caller, "draft.png", now.plusDays(1));
    seedBodyImage(unbound, proj.id(), null, caller, now.minusMinutes(4), null);
    long demoted = seedFile(caller, "gone.png", now.plusDays(1));
    seedBodyImage(demoted, proj.id(), issue.id(), caller, now.minusMinutes(3), now);
    long foreign = seedFile(stranger, "theirs.png", null);
    seedBodyImage(foreign, other.id(), otherIssue.id(), stranger, now.minusMinutes(2), null);

    List<VirtualAttachmentResponse> items =
        service.virtualAttachments(caller, "ISSUE", null, null, 50).items();

    assertThat(items).extracting(VirtualAttachmentResponse::fileId).containsExactly(bound);
    VirtualAttachmentResponse r = items.get(0);
    assertThat(r.sourceType()).isEqualTo("ISSUE");
    assertThat(r.kind()).isEqualTo("BODY_IMAGE");
    assertThat(r.fileId()).isNotNull(); // file 행이 있어 드라이브로 가져올 수 있다
    assertThat(r.mailAttachmentId()).isNull();
    assertThat(r.sourceLabel()).isEqualTo(proj.key() + "-1 본문 이슈");
    assertThat(r.deepLink()).isEqualTo("/projects/" + proj.key() + "/issues/1");
    assertThat(r.downloadUrl())
        .isEqualTo("/api/v1/projects/" + proj.key() + "/issue-images/" + bound);

    // 가져오기 — 보이는 것만 된다
    assertThat(service.importAttachment(caller, driveSpace, null, bound).fileId()).isEqualTo(bound);
    for (long hidden : new long[] {unbound, demoted, foreign}) {
      assertThatThrownBy(() -> service.importAttachment(caller, driveSpace, null, hidden))
          .as("file %d", hidden)
          .isInstanceOf(DriveForbiddenException.class);
    }
  }

  /** 이슈 첨부와 본문 이미지가 한 출처 안에서 시각순으로 섞이고, 일반 첨부는 kind 가 없다. */
  @Test
  void issueSource_mergesAttachmentsAndBodyImagesByTime() {
    long caller = seedUser("bm");
    ProjectResponse proj = newProject(caller, "BM");
    IssueRow issue = seedIssue(proj, caller, "섞기");
    long a1 = seedFile(caller, "a1.txt", null);
    bindIssueAttachment(a1, issue.id(), caller, now.minusMinutes(10));
    long b1 = seedFile(caller, "b1.png", null);
    seedBodyImage(b1, proj.id(), issue.id(), caller, now.minusMinutes(8), null);
    long a2 = seedFile(caller, "a2.txt", null);
    bindIssueAttachment(a2, issue.id(), caller, now.minusMinutes(6));

    List<VirtualAttachmentResponse> items =
        service.virtualAttachments(caller, "ISSUE", null, null, 50).items();

    assertThat(items).extracting(VirtualAttachmentResponse::fileId).containsExactly(a2, b1, a1);
    assertThat(items)
        .extracting(VirtualAttachmentResponse::kind)
        .containsExactly(null, "BODY_IMAGE", null);
    assertThat(items).allMatch(i -> i.fileId() != null);
  }

  // ─── 노트 첨부 ──────────────────────────────────────────────────

  /** 멤버인 공간의 연결된 첨부만 WIKI 로 보인다 — 비멤버 공간·임시·강등 첨부는 목록·가져오기 모두에서 빠진다. */
  @Test
  void wiki_memberSpaceOnly_excludesTempAndDemoted() {
    long caller = seedUser("wk");
    long stranger = seedUser("wks");
    long driveSpace = seedDriveSpace(caller);
    long mySpace = seedWikiSpace(stranger, "팀 노트");
    addWikiMember(mySpace, caller, "VIEWER");
    long myPage = seedWikiPage(mySpace, "회의록");
    long theirSpace = seedWikiSpace(stranger, "비밀 노트");
    long theirPage = seedWikiPage(theirSpace, "비밀");

    long ok = seedFile(stranger, "diagram.png", null);
    seedWikiAttachment(ok, myPage, stranger, now.minusMinutes(5), null);
    long temp = seedFile(stranger, "temp.png", now.plusDays(1));
    seedWikiAttachment(temp, myPage, stranger, now.minusMinutes(4), null);
    long demoted = seedFile(stranger, "demoted.png", null);
    seedWikiAttachment(demoted, myPage, stranger, now.minusMinutes(3), now);
    long foreign = seedFile(stranger, "secret.png", null);
    seedWikiAttachment(foreign, theirPage, stranger, now.minusMinutes(2), null);

    List<VirtualAttachmentResponse> items =
        service.virtualAttachments(caller, "WIKI", null, null, 50).items();

    assertThat(items).extracting(VirtualAttachmentResponse::fileId).containsExactly(ok);
    VirtualAttachmentResponse r = items.get(0);
    assertThat(r.sourceType()).isEqualTo("WIKI");
    assertThat(r.kind()).isNull();
    assertThat(r.fileId()).isNotNull(); // file 행이 있어 드라이브로 가져올 수 있다
    assertThat(r.mailAttachmentId()).isNull();
    assertThat(r.sourceLabel()).isEqualTo("팀 노트 / 회의록");
    assertThat(r.deepLink()).isEqualTo("/wiki/spaces/" + mySpace + "/pages/" + myPage);
    assertThat(r.downloadUrl())
        .isEqualTo("/api/v1/wiki/pages/" + myPage + "/attachments/" + ok + "/content");
    assertThat(r.attachedAt()).isEqualTo(now.minusMinutes(5).toInstant());

    assertThat(service.importAttachment(caller, driveSpace, null, ok).fileId()).isEqualTo(ok);
    for (long hidden : new long[] {temp, demoted, foreign}) {
      assertThatThrownBy(() -> service.importAttachment(caller, driveSpace, null, hidden))
          .as("file %d", hidden)
          .isInstanceOf(DriveForbiddenException.class);
    }
  }

  // ─── 메일 첨부 ──────────────────────────────────────────────────

  /**
   * 내 활성 계정 메일의 첨부만 MAIL 로 보인다 — 남의 계정·내 비활성 계정은 빠진다. 본문이 참조하지 않는 첨부는 Content-ID 가 있어도 보인다(메일 화면과
   * 같다). 메일 행은 file 행이 없어 fileId 가 비고 mailAttachmentId 로 내려받는다.
   */
  @Test
  void mail_ownActiveAccountOnly() {
    long caller = seedUser("ml");
    long stranger = seedUser("mls");
    long myAccount = seedAccount(caller, false);
    long myDisabled = seedAccount(caller, true);
    long theirAccount = seedAccount(stranger, false);

    long msgId = seedMail(myAccount, "견적서 보냅니다", "홍길동", "hong@x.com", now.minusMinutes(5), null);
    long ok = seedMailAttachment(msgId, 0, "quote.pdf", null);
    // 빈 Content-ID 는 「확인했지만 없음」(WP-68) — 일반 첨부로 본다
    long okEmptyCid = seedMailAttachment(msgId, 1, "sheet.xlsx", "");
    // 본문이 참조하지 않는 Content-ID 첨부 — 메일 화면은 첨부로 보여 준다
    long okWithCid = seedMailAttachment(msgId, 2, "logo.png", "logo@cid");
    long disabledMsg = seedMail(myDisabled, "옛 계정", null, "old@x.com", now.minusMinutes(4), null);
    seedMailAttachment(disabledMsg, 0, "old.pdf", null);
    long theirMsg = seedMail(theirAccount, "남의 메일", null, "x@x.com", now.minusMinutes(3), null);
    seedMailAttachment(theirMsg, 0, "theirs.pdf", null);

    List<VirtualAttachmentResponse> items =
        service.virtualAttachments(caller, "MAIL", null, null, 50).items();

    assertThat(items)
        .extracting(VirtualAttachmentResponse::mailAttachmentId)
        .containsExactlyInAnyOrder(ok, okEmptyCid, okWithCid);
    VirtualAttachmentResponse r =
        items.stream().filter(i -> i.mailAttachmentId() == ok).findFirst().orElseThrow();
    assertThat(r.fileId()).isNull();
    assertThat(r.sourceType()).isEqualTo("MAIL");
    assertThat(r.kind()).isNull();
    assertThat(r.fileId()).isNull(); // file 행이 없어 드라이브로 가져올 수 없다
    assertThat(r.name()).isEqualTo("quote.pdf");
    assertThat(r.mimeType()).isEqualTo("application/pdf");
    assertThat(r.hasThumbnail()).isFalse();
    assertThat(r.sourceLabel()).isEqualTo("견적서 보냅니다 — 홍길동");
    assertThat(r.deepLink()).isEqualTo("/mail/" + myAccount + "?messageId=" + msgId);
    assertThat(r.downloadUrl()).isEqualTo("/api/v1/mail/attachments/" + ok + "/content");
    assertThat(r.attachedAt()).isEqualTo(now.minusMinutes(5).toInstant());
  }

  /** 받은 시각이 없으면 보낸 시각으로 정렬·표시하고, 보낸 사람 이름이 없으면 주소를 쓴다. */
  @Test
  void mail_fallsBackToSentAtAndAddress() {
    long caller = seedUser("mf");
    long account = seedAccount(caller, false);
    long msg = seedMail(account, "보낸 메일", null, "me@x.com", null, now.minusMinutes(7));
    seedMailAttachment(msg, 0, "sent.pdf", null);

    VirtualAttachmentResponse r =
        service.virtualAttachments(caller, "MAIL", null, null, 50).items().get(0);
    assertThat(r.attachedAt()).isEqualTo(now.minusMinutes(7).toInstant());
    assertThat(r.sourceLabel()).isEqualTo("보낸 메일 — me@x.com");
  }

  /**
   * 메일 첨부 id 로 가져오기를 부르면 그 숫자와 같은 id 의 진짜 file 이 있더라도 인가되지 않는다 — 메일 출처의 canAccessFile 은 항상 false.
   */
  @Test
  void importAttachment_withMailAttachmentId_neverAuthorizesRealFile() {
    long caller = seedUser("mi");
    long stranger = seedUser("mis");
    long driveSpace = seedDriveSpace(caller);
    long account = seedAccount(caller, false);
    long msg = seedMail(account, "메일", null, "a@x.com", now, null);
    long mailAttId = seedMailAttachment(msg, 0, "mine.pdf", null);
    // 같은 숫자의 file 행이 있게 한다(없으면 남의 파일로 만든다) — 메일 id 가 file id 로 새면 이 파일이 인가된다
    if (!dsl.fetchExists(FILE, FILE.ID.eq(mailAttId))) {
      seedFile(mailAttId, stranger, "collide.txt", null);
    }

    assertThat(mailProvider.canAccessFile(caller, mailAttId)).isFalse();
    assertThatThrownBy(() -> service.importAttachment(caller, driveSpace, null, mailAttId))
        .isInstanceOf(DriveForbiddenException.class);
  }

  // ─── 출처 병합·커서·검색 ────────────────────────────────────────────

  /** ALL 은 이슈(첨부·본문 이미지)·노트·메일을 시각 내림차순으로 섞고, 커서로 다음 페이지가 이어진다. */
  @Test
  void all_mergesIssueWikiMail_byTime_withCursor() {
    long caller = seedUser("al");
    ProjectResponse proj = newProject(caller, "AL");
    IssueRow issue = seedIssue(proj, caller, "전체");
    long wikiSpace = seedWikiSpace(caller, "내 노트");
    addWikiMember(wikiSpace, caller, "OWNER");
    long page = seedWikiPage(wikiSpace, "p");
    long account = seedAccount(caller, false);

    long mailMsg = seedMail(account, "메일", null, "a@x.com", now.minusHours(1), null);
    long mailAtt = seedMailAttachment(mailMsg, 0, "m.pdf", null);
    long wikiFile = seedFile(caller, "w.png", null);
    seedWikiAttachment(wikiFile, page, caller, now.minusHours(2), null);
    long issueFile = seedFile(caller, "i.txt", null);
    bindIssueAttachment(issueFile, issue.id(), caller, now.minusHours(3));
    long bodyFile = seedFile(caller, "b.png", null);
    seedBodyImage(bodyFile, proj.id(), issue.id(), caller, now.minusHours(4), null);

    VirtualAttachmentPage first = service.virtualAttachments(caller, "ALL", null, null, 2);
    assertThat(first.items())
        .extracting(VirtualAttachmentResponse::sourceType)
        .containsExactly("MAIL", "WIKI");
    assertThat(first.items().get(0).mailAttachmentId()).isEqualTo(mailAtt);
    assertThat(first.items().get(1).fileId()).isEqualTo(wikiFile);
    assertThat(first.nextCursor()).isNotNull();

    VirtualAttachmentPage second =
        service.virtualAttachments(caller, "ALL", null, first.nextCursor(), 2);
    assertThat(second.items())
        .extracting(VirtualAttachmentResponse::fileId)
        .containsExactly(issueFile, bodyFile);
    assertThat(second.items())
        .extracting(VirtualAttachmentResponse::kind)
        .containsExactly(null, "BODY_IMAGE");
    assertThat(second.nextCursor()).isNull();
  }

  /** 이름 검색(q)이 노트·메일·본문 이미지에도 걸린다. */
  @Test
  void nameSearch_appliesToWikiMailAndBodyImage() {
    long caller = seedUser("qs");
    ProjectResponse proj = newProject(caller, "QS");
    IssueRow issue = seedIssue(proj, caller, "검색");
    long wikiSpace = seedWikiSpace(caller, "검색 노트");
    addWikiMember(wikiSpace, caller, "OWNER");
    long page = seedWikiPage(wikiSpace, "p");
    long account = seedAccount(caller, false);
    long msg = seedMail(account, "메일", null, "a@x.com", now.minusMinutes(1), null);

    long bodyHit = seedFile(caller, "Needle-body.png", null);
    seedBodyImage(bodyHit, proj.id(), issue.id(), caller, now.minusMinutes(2), null);
    long bodyMiss = seedFile(caller, "hay-body.png", null);
    seedBodyImage(bodyMiss, proj.id(), issue.id(), caller, now.minusMinutes(2), null);
    long wikiHit = seedFile(caller, "wiki-NEEDLE.png", null);
    seedWikiAttachment(wikiHit, page, caller, now.minusMinutes(3), null);
    long wikiMiss = seedFile(caller, "wiki-hay.png", null);
    seedWikiAttachment(wikiMiss, page, caller, now.minusMinutes(3), null);
    long mailHit = seedMailAttachment(msg, 0, "mail-needle.pdf", null);
    seedMailAttachment(msg, 1, "mail-hay.pdf", null);

    List<VirtualAttachmentResponse> items =
        service.virtualAttachments(caller, "ALL", "needle", null, 50).items();

    assertThat(items).hasSize(3);
    assertThat(items)
        .filteredOn(i -> i.fileId() != null)
        .extracting(VirtualAttachmentResponse::fileId)
        .containsExactlyInAnyOrder(bodyHit, wikiHit);
    assertThat(items)
        .filteredOn(i -> i.fileId() == null)
        .extracting(VirtualAttachmentResponse::mailAttachmentId)
        .containsExactly(mailHit);
  }

  /**
   * 인라인 판정은 메일 화면(WP-65·WP-70)과 같다 — HTML 본문의 cid: 참조가 가리키는 이미지(Content-ID 일치, 없으면 파일명 일치)만 빠지고,
   * Content-ID 가 붙었어도 본문이 참조하지 않는 첨부(Apple Mail 은 모든 파트에 단다)는 보인다. 화면이 HTML 을 보이지 않는 메일(text 본문
   * 있음·미검증 본문)은 아무것도 빼지 않는다.
   */
  @Test
  void mail_inlineRule_matchesMailScreen() {
    long caller = seedUser("mn");
    long account = seedAccount(caller, false);
    String html =
        "<p>안녕하세요</p><img src=\"cid:logo%40acme\"><img src='CID:image001.png@01D9ABCD'>"
            + "<img data-src=\"cid:photo@apple\">";

    long msg = seedMail(account, "인라인", null, "a@x.com", now.minusMinutes(5), null);
    setBody(msg, html, null, true);
    long applePdf = seedMailAttachment(msg, 0, "report.pdf", "part1@apple", "application/pdf");
    long logo = seedMailAttachment(msg, 1, "logo.png", "<logo@acme>", "image/png");
    // Graph 경로 — Content-ID 가 없지만 cid 의 「@」 앞부분이 파일명
    long graphInline = seedMailAttachment(msg, 2, "image001.png", null, "image/png");
    // Content-ID 가 있지만 본문이 참조하지 않는(data-src 는 참조가 아니다) 사진 — 첨부로 보인다
    long photo = seedMailAttachment(msg, 3, "photo.jpg", "photo@apple", "image/jpeg");

    // text 본문이 있으면 화면은 HTML 을 보이지 않아 인라인 치환·숨김이 없다
    long textMsg = seedMail(account, "텍스트", null, "a@x.com", now.minusMinutes(6), null);
    setBody(textMsg, html, "plain text", true);
    long textLogo = seedMailAttachment(textMsg, 0, "logo.png", "logo@acme", "image/png");
    // 검증 전 본문(fetched_at 없음)은 화면에 보이지 않는다(WP-130) — 숨기지 않는다
    long unverified = seedMail(account, "미검증", null, "a@x.com", now.minusMinutes(7), null);
    setBody(unverified, html, null, false);
    long unverifiedLogo = seedMailAttachment(unverified, 0, "logo.png", "logo@acme", "image/png");

    List<VirtualAttachmentResponse> items =
        service.virtualAttachments(caller, "MAIL", null, null, 50).items();

    assertThat(items)
        .extracting(VirtualAttachmentResponse::mailAttachmentId)
        .containsExactly(photo, applePdf, textLogo, unverifiedLogo)
        .doesNotContain(logo, graphInline);
  }

  /** 걸러진 인라인 이미지가 많아도 한 페이지를 채우고, 다음 페이지가 남은 첨부를 빠짐없이 잇는다. */
  @Test
  void mail_inlineFiltered_pageStillFilled() {
    long caller = seedUser("mp");
    long account = seedAccount(caller, false);
    StringBuilder html = new StringBuilder();
    for (int i = 0; i < 30; i++) html.append("<img src=\"cid:i").append(i).append("@x\">");
    long msg = seedMail(account, "로고 많음", null, "a@x.com", now.minusMinutes(1), null);
    setBody(msg, html.toString(), null, true);
    // 실제 첨부를 먼저 넣어 id 가 작게 — 정렬(id 내림차순)상 인라인 30개가 앞에 와서 첫 후보 묶음을 다 차지한다
    long real1 = seedMailAttachment(msg, 0, "a.pdf", null, "application/pdf");
    long real2 = seedMailAttachment(msg, 1, "b.pdf", null, "application/pdf");
    for (int i = 0; i < 30; i++)
      seedMailAttachment(msg, 2 + i, "i" + i + ".png", "i" + i + "@x", "image/png");

    VirtualAttachmentPage first = service.virtualAttachments(caller, "MAIL", null, null, 1);
    assertThat(first.items())
        .extracting(VirtualAttachmentResponse::mailAttachmentId)
        .containsExactly(real2);
    assertThat(first.nextCursor()).isNotNull();
    VirtualAttachmentPage second =
        service.virtualAttachments(caller, "MAIL", null, first.nextCursor(), 1);
    assertThat(second.items())
        .extracting(VirtualAttachmentResponse::mailAttachmentId)
        .containsExactly(real1);
    assertThat(second.nextCursor()).isNull();
  }

  /** 휴지통·스팸으로 보이는 메일함의 메일은 빠진다 — 통합 검색과 같은 「모든 메일함」 범위(보관함·사용자 메일함은 보인다). */
  @Test
  void mail_excludesTrashAndJunkFolders() {
    long caller = seedUser("mt");
    long account = seedAccount(caller, false);
    long inbox =
        seedMailAttachment(
            seedMail(account, "받은", null, "a@x.com", now.minusMinutes(1), null), 0, "in.pdf", null);
    long archiveFolder = seedFolder(account, "Archive", "Archive", "ARCHIVE");
    long archived =
        seedMailAttachment(
            seedMailIn(account, archiveFolder, now.minusMinutes(2)), 0, "arc.pdf", null);
    long userFolder = seedFolder(account, "고객사", "고객사", "USER");
    long userBox =
        seedMailAttachment(
            seedMailIn(account, userFolder, now.minusMinutes(3)), 0, "usr.pdf", null);
    long trashFolder = seedFolder(account, "고객사/Trash", "Trash", "USER");
    seedMailAttachment(seedMailIn(account, trashFolder, now.minusMinutes(4)), 0, "trash.pdf", null);
    long junkFolder = seedFolder(account, "스팸메일함", "스팸메일함", "USER");
    seedMailAttachment(seedMailIn(account, junkFolder, now.minusMinutes(5)), 0, "junk.pdf", null);

    List<VirtualAttachmentResponse> items =
        service.virtualAttachments(caller, "MAIL", null, null, 50).items();

    assertThat(items)
        .extracting(VirtualAttachmentResponse::mailAttachmentId)
        .containsExactly(inbox, archived, userBox);
  }

  /**
   * manifest 가 없는 레거시 첨부(content_attachment_id NULL)도 보인다 — 내려받기가 서빙하는 행이라서. 이름·형식·크기는 메일 화면·내려받기와
   * 같은 대체값이고, 그 이름으로 검색된다.
   */
  @Test
  void mail_legacyRowWithoutManifest_included() {
    long caller = seedUser("mg");
    long account = seedAccount(caller, false);
    long msg = seedMail(account, "옛 메일", null, "a@x.com", now.minusMinutes(1), null);
    long legacy =
        dsl.insertInto(EMAIL_ATTACHMENT)
            .set(EMAIL_ATTACHMENT.MESSAGE_ID, msg)
            .set(EMAIL_ATTACHMENT.ORDINAL, 0)
            .returning(EMAIL_ATTACHMENT.ID)
            .fetchOne()
            .getId();

    List<VirtualAttachmentResponse> items =
        service.virtualAttachments(caller, "MAIL", null, null, 50).items();
    assertThat(items)
        .extracting(VirtualAttachmentResponse::mailAttachmentId)
        .containsExactly(legacy);
    VirtualAttachmentResponse r = items.get(0);
    assertThat(r.name()).isEqualTo("attachment-" + legacy);
    assertThat(r.mimeType()).isEqualTo("application/octet-stream");
    assertThat(r.sizeBytes()).isZero();
    assertThat(r.downloadUrl()).isEqualTo("/api/v1/mail/attachments/" + legacy + "/content");

    assertThat(service.virtualAttachments(caller, "MAIL", "attachment-" + legacy, null, 50).items())
        .extracting(VirtualAttachmentResponse::mailAttachmentId)
        .containsExactly(legacy);
  }

  // ─── 같은 시각 페이지 경계 ─────────────────────────────────────────

  /**
   * 한 메일의 첨부는 모두 같은 시각이다 — limit 1·2 로 넘겨도 MAIL 과 ALL 에서 하나도 빠지거나 겹치지 않는다. ALL 에는 같은 시각의 이슈 첨부·본문
   * 이미지·노트 첨부도 섞어 출처 간 경계도 본다.
   */
  @Test
  void equalTimestamps_pagedWithoutLossOrDuplicates() {
    long caller = seedUser("eq");
    long account = seedAccount(caller, false);
    OffsetDateTime t = now.minusMinutes(30);
    long msg = seedMail(account, "같은 시각", null, "a@x.com", t, null);
    long m1 = seedMailAttachment(msg, 0, "m1.pdf", null);
    long m2 = seedMailAttachment(msg, 1, "m2.pdf", null);
    long m3 = seedMailAttachment(msg, 2, "m3.pdf", null);

    ProjectResponse proj = newProject(caller, "EQ");
    IssueRow issue = seedIssue(proj, caller, "같은 시각");
    long i1 = seedFile(caller, "i1.txt", null);
    bindIssueAttachment(i1, issue.id(), caller, t);
    long i2 = seedFile(caller, "i2.txt", null);
    bindIssueAttachment(i2, issue.id(), caller, t);
    long b1 = seedFile(caller, "b1.png", null);
    seedBodyImage(b1, proj.id(), issue.id(), caller, t, null);
    long wikiSpace = seedWikiSpace(caller, "같은 시각 노트");
    addWikiMember(wikiSpace, caller, "OWNER");
    long w1 = seedFile(caller, "w1.png", null);
    seedWikiAttachment(w1, seedWikiPage(wikiSpace, "p"), caller, t, null);

    for (int limit : new int[] {1, 2}) {
      assertThat(pageAll(caller, "MAIL", limit))
          .as("MAIL limit=%d", limit)
          .containsExactlyInAnyOrder("M" + m1, "M" + m2, "M" + m3);
      assertThat(pageAll(caller, "ISSUE", limit))
          .as("ISSUE limit=%d", limit)
          .containsExactlyInAnyOrder("F" + i1, "F" + i2, "F" + b1);
      assertThat(pageAll(caller, "ALL", limit))
          .as("ALL limit=%d", limit)
          .containsExactlyInAnyOrder(
              "M" + m1, "M" + m2, "M" + m3, "F" + i1, "F" + i2, "F" + b1, "F" + w1);
    }
  }

  /** 예전 커서(ISO-8601 시각만)도 받는다 — 그 시각보다 엄격히 이전부터(예전 동작). */
  @Test
  void legacyIsoCursor_stillAccepted() {
    long caller = seedUser("lc");
    ProjectResponse proj = newProject(caller, "LC");
    IssueRow issue = seedIssue(proj, caller, "옛 커서");
    long newer = seedFile(caller, "new.txt", null);
    bindIssueAttachment(newer, issue.id(), caller, now.minusMinutes(1));
    long older = seedFile(caller, "old.txt", null);
    bindIssueAttachment(older, issue.id(), caller, now.minusMinutes(2));

    VirtualAttachmentPage page =
        service.virtualAttachments(
            caller, "ISSUE", null, now.minusMinutes(1).toInstant().toString(), 50);
    assertThat(page.items()).extracting(VirtualAttachmentResponse::fileId).containsExactly(older);
  }

  /** source 의 모든 페이지를 끝까지 넘기며 행 키(file 은 F, 메일은 M 접두)를 모은다 — 중복은 그대로 남아 검출된다. */
  private List<String> pageAll(long caller, String source, int limit) {
    List<String> keys = new java.util.ArrayList<>();
    String cursor = null;
    for (int guard = 0; guard < 50; guard++) {
      VirtualAttachmentPage p = service.virtualAttachments(caller, source, null, cursor, limit);
      for (var i : p.items()) {
        keys.add(i.fileId() != null ? "F" + i.fileId() : "M" + i.mailAttachmentId());
      }
      if (p.nextCursor() == null) return keys;
      cursor = p.nextCursor();
    }
    throw new AssertionError("페이지가 끝나지 않는다");
  }

  // ─── 드라이브로 가져간 본문 이미지·노트 첨부의 수명 ──────────────────────────

  /**
   * 드라이브로 가져간 본문 이미지는 본문에서 빠지거나 이슈가 지워져도 강등(만료 재무장)되지 않는다 — 가져오기는 같은 file 행을 공유하므로, 만료가 다시 걸리면 만료
   * 스윕이 드라이브 파일의 원본까지 지운다. 가져가지 않은 이미지는 그대로 강등된다.
   */
  @Test
  void importedBodyImage_notDemoted_whenRemovedFromIssue() {
    long caller = seedUser("dm");
    long driveSpace = seedDriveSpace(caller);
    ProjectResponse proj = newProject(caller, "DM");
    IssueRow issue = seedIssue(proj, caller, "강등");
    long imported = seedFile(caller, "keep.png", null);
    seedBodyImage(imported, proj.id(), issue.id(), caller, now.minusMinutes(2), null);
    long plain = seedFile(caller, "drop.png", null);
    seedBodyImage(plain, proj.id(), issue.id(), caller, now.minusMinutes(1), null);
    service.importAttachment(caller, driveSpace, null, imported);

    ProjectRow row = projectRepo.findByKey(proj.key()).orElseThrow();
    String before =
        IssueBodyImageResponse.urlOf(proj.key(), imported)
            + " "
            + IssueBodyImageResponse.urlOf(proj.key(), plain);
    bodyImageService.syncIssueImages(row, issue.id(), caller, before, "이미지 없음");

    assertThat(expiresAt(imported)).as("가져간 이미지").isNull();
    assertThat(demotedAtBody(imported)).isNull();
    assertThat(expiresAt(plain)).as("가져가지 않은 이미지").isNotNull();

    // 이슈 삭제의 일괄 강등도 같은 규칙
    bodyImageService.demoteAllOfIssues(List.of(issue.id()));
    assertThat(expiresAt(imported)).isNull();
  }

  /**
   * 드라이브로 가져간 노트 첨부는 본문에서 빠져도 강등되지 않고, 첨부 삭제·페이지 회수에서도 file 행이 남는다(드라이브가 쓰는 행 — 지우면 드라이브 파일 원본이
   * 사라지거나 FK 위반). 가져가지 않은 첨부는 그대로 강등·삭제된다.
   */
  @Test
  void importedWikiAttachment_survivesDemoteDeleteAndReclaim() {
    long caller = seedUser("wd");
    long driveSpace = seedDriveSpace(caller);
    long wikiSpace = seedWikiSpace(caller, "가져간 노트");
    addWikiMember(wikiSpace, caller, "OWNER");
    long page = seedWikiPage(wikiSpace, "p");
    long imported = seedFile(caller, "keep.png", null);
    seedWikiAttachment(imported, page, caller, now.minusMinutes(2), null);
    long plain = seedFile(caller, "drop.png", null);
    seedWikiAttachment(plain, page, caller, now.minusMinutes(1), null);
    service.importAttachment(caller, driveSpace, null, imported);

    wikiAttachmentService.syncReferences(page, "");
    assertThat(expiresAt(imported)).as("가져간 첨부").isNull();
    assertThat(expiresAt(plain)).as("가져가지 않은 첨부").isNotNull();

    // 첨부 삭제 — 연결만 끊고 file 행은 드라이브 몫으로 남긴다
    wikiAttachmentService.delete(caller, page, imported);
    assertThat(dsl.fetchExists(FILE, FILE.ID.eq(imported))).isTrue();
    assertThat(dsl.fetchExists(WIKI_PAGE_ATTACHMENT, WIKI_PAGE_ATTACHMENT.FILE_ID.eq(imported)))
        .isFalse();

    // 페이지 회수 — 가져간 것은 남기고 나머지만 지운다
    long imported2 = seedFile(caller, "keep2.png", null);
    seedWikiAttachment(imported2, page, caller, now, null);
    service.importAttachment(caller, driveSpace, null, imported2);
    wikiAttachmentService.reclaimPageTree(page);
    assertThat(dsl.fetchExists(FILE, FILE.ID.eq(imported2))).isTrue();
    assertThat(dsl.fetchExists(FILE, FILE.ID.eq(plain))).isFalse();
  }

  /**
   * 만료 스윕 안전망 — 어떤 경로로든 드라이브가 쓰는 file 에 만료가 걸려 있으면 스윕 직전 보존 정책이 남기고 만료를 해제한다(가져오기와 강등이 거의 동시에 커밋되는
   * 경합 대비). 드라이브가 쓰지 않는 만료 file 은 남기지 않는다.
   */
  @Test
  void retentionPolicy_keepsDriveReferencedExpiredFiles() {
    long caller = seedUser("rp");
    long driveSpace = seedDriveSpace(caller);
    ProjectResponse proj = newProject(caller, "RP");
    IssueRow issue = seedIssue(proj, caller, "보존");
    long imported = seedFile(caller, "keep.png", null);
    seedBodyImage(imported, proj.id(), issue.id(), caller, now, null);
    service.importAttachment(caller, driveSpace, null, imported);
    long orphan = seedFile(caller, "orphan.png", now.minusDays(1));
    // 경합으로 만료가 다시 걸린 상태를 만든다
    dsl.update(FILE).set(FILE.EXPIRES_AT, now.minusDays(1)).where(FILE.ID.eq(imported)).execute();

    assertThat(driveRetention.retain(List.of(imported, orphan))).containsExactly(imported);
    assertThat(expiresAt(imported)).isNull();
    assertThat(expiresAt(orphan)).isNotNull();
  }

  private OffsetDateTime expiresAt(long fileId) {
    return dsl.select(FILE.EXPIRES_AT)
        .from(FILE)
        .where(FILE.ID.eq(fileId))
        .fetchOne(FILE.EXPIRES_AT);
  }

  private OffsetDateTime demotedAtBody(long fileId) {
    return dsl.select(ISSUE_BODY_IMAGE.DEMOTED_AT)
        .from(ISSUE_BODY_IMAGE)
        .where(ISSUE_BODY_IMAGE.FILE_ID.eq(fileId))
        .fetchOne(ISSUE_BODY_IMAGE.DEMOTED_AT);
  }

  // ─── 시드 ──────────────────────────────────────────────────────

  private long seedUser(String prefix) {
    String s = UUID.randomUUID().toString().substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, prefix + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, prefix)
        .set(USER.EMAIL, prefix + s + "@x.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** caller 가 EDITOR 인 드라이브 공간 — 가져오기 대상. */
  private long seedDriveSpace(long owner) {
    long space =
        dsl.insertInto(DRIVE_SPACE)
            .set(DRIVE_SPACE.TYPE, "TEAM")
            .set(DRIVE_SPACE.NAME, "VA-" + UUID.randomUUID().toString().substring(0, 6))
            .set(DRIVE_SPACE.OWNER_ID, owner)
            .returning(DRIVE_SPACE.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(DRIVE_SPACE_MEMBER)
        .set(DRIVE_SPACE_MEMBER.SPACE_ID, space)
        .set(DRIVE_SPACE_MEMBER.USER_ID, owner)
        .set(DRIVE_SPACE_MEMBER.ROLE, "EDITOR")
        .execute();
    return space;
  }

  private ProjectResponse newProject(long ownerId, String prefix) {
    String suffix = UUID.randomUUID().toString().replace("-", "").toUpperCase().substring(0, 4);
    return projectService.create(
        ownerId, new CreateProjectRequest(prefix + suffix, "P-" + prefix, "x"));
  }

  private long seedFile(long uploaderId, String name, OffsetDateTime expiresAt) {
    return seedFile(null, uploaderId, name, expiresAt);
  }

  /** file 행을 넣는다. id 를 주면 그 id 로(메일 첨부 id 와 같은 숫자의 file 을 만들 때), null 이면 시퀀스로. */
  private long seedFile(Long id, long uploaderId, String name, OffsetDateTime expiresAt) {
    var f = File.FILE;
    var insert =
        dsl.insertInto(f)
            .set(f.ORIGINAL_NAME, name)
            .set(f.STORED_NAME, UUID.randomUUID().toString())
            .set(f.MIME_TYPE, "image/png")
            .set(f.SIZE_BYTES, 100L)
            .set(f.CATEGORY, "ATTACHMENT")
            .set(f.STORAGE_PATH, "/tmp/test/" + UUID.randomUUID())
            .set(f.UPLOADED_BY, uploaderId);
    if (id != null) {
      insert = insert.set(f.ID, id);
    }
    if (expiresAt != null) {
      insert = insert.set(f.EXPIRES_AT, expiresAt);
    }
    return insert.returning(f.ID).fetchOne().getId();
  }

  /** 프로젝트에 1번 이슈를 만든다(우선순위 MID, 본문·마감일 없음). */
  private IssueRow seedIssue(ProjectResponse proj, long reporter, String title) {
    return IssueSeeds.insert(issueRepo, baseDsl, proj.id(), 1, title, null, "MID", null, reporter);
  }

  private void bindIssueAttachment(long fileId, long issueId, long userId, OffsetDateTime at) {
    dsl.insertInto(ISSUE_ATTACHMENT)
        .set(ISSUE_ATTACHMENT.FILE_ID, fileId)
        .set(ISSUE_ATTACHMENT.ISSUE_ID, issueId)
        .set(ISSUE_ATTACHMENT.ATTACHED_BY, userId)
        .set(ISSUE_ATTACHMENT.ATTACHED_AT, at)
        .execute();
  }

  /** 본문 이미지 매핑. issueId null = 저장 전 임시, demotedAt 있으면 강등. */
  private void seedBodyImage(
      long fileId,
      long projectId,
      Long issueId,
      long uploader,
      OffsetDateTime createdAt,
      OffsetDateTime demotedAt) {
    dsl.insertInto(ISSUE_BODY_IMAGE)
        .set(ISSUE_BODY_IMAGE.FILE_ID, fileId)
        .set(ISSUE_BODY_IMAGE.PROJECT_ID, projectId)
        .set(ISSUE_BODY_IMAGE.ISSUE_ID, issueId)
        .set(ISSUE_BODY_IMAGE.UPLOADED_BY, uploader)
        .set(ISSUE_BODY_IMAGE.CREATED_AT, createdAt)
        .set(ISSUE_BODY_IMAGE.DEMOTED_AT, demotedAt)
        .execute();
  }

  private long seedWikiSpace(long owner, String name) {
    return dsl.insertInto(WIKI_SPACE)
        .set(WIKI_SPACE.TYPE, "TEAM")
        .set(WIKI_SPACE.NAME, name)
        .set(WIKI_SPACE.OWNER_ID, owner)
        .returning(WIKI_SPACE.ID)
        .fetchOne()
        .getId();
  }

  private void addWikiMember(long spaceId, long userId, String role) {
    dsl.insertInto(WIKI_SPACE_MEMBER)
        .set(WIKI_SPACE_MEMBER.SPACE_ID, spaceId)
        .set(WIKI_SPACE_MEMBER.USER_ID, userId)
        .set(WIKI_SPACE_MEMBER.ROLE, role)
        .execute();
  }

  private long seedWikiPage(long spaceId, String title) {
    return dsl.insertInto(WIKI_PAGE)
        .set(WIKI_PAGE.SPACE_ID, spaceId)
        .set(WIKI_PAGE.TITLE, title)
        .returning(WIKI_PAGE.ID)
        .fetchOne()
        .getId();
  }

  private void seedWikiAttachment(
      long fileId, long pageId, long by, OffsetDateTime at, OffsetDateTime demotedAt) {
    dsl.insertInto(WIKI_PAGE_ATTACHMENT)
        .set(WIKI_PAGE_ATTACHMENT.FILE_ID, fileId)
        .set(WIKI_PAGE_ATTACHMENT.PAGE_ID, pageId)
        .set(WIKI_PAGE_ATTACHMENT.ATTACHED_BY, by)
        .set(WIKI_PAGE_ATTACHMENT.ATTACHED_AT, at)
        .set(WIKI_PAGE_ATTACHMENT.DEMOTED_AT, demotedAt)
        .execute();
  }

  /** 메일 계정 + INBOX 폴더. disabled 면 비활성 계정. */
  private long seedAccount(long userId, boolean disabled) {
    long accountId =
        dsl.insertInto(EMAIL_ACCOUNT)
            .set(EMAIL_ACCOUNT.USER_ID, userId)
            .set(
                EMAIL_ACCOUNT.EMAIL_ADDRESS,
                "va-" + UUID.randomUUID().toString().substring(0, 8) + "@test.local")
            .set(EMAIL_ACCOUNT.DISABLED_AT, disabled ? now : null)
            .returning(EMAIL_ACCOUNT.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(EMAIL_FOLDER)
        .set(EMAIL_FOLDER.ACCOUNT_ID, accountId)
        .set(EMAIL_FOLDER.NAME, "INBOX")
        .execute();
    return accountId;
  }

  private static long nextUid = 1;

  /** 메일 1통(email_content 에 제목) — receivedAt·sentAt 은 null 가능. */
  private long seedMail(
      long accountId,
      String subject,
      String fromName,
      String fromAddress,
      OffsetDateTime receivedAt,
      OffsetDateTime sentAt) {
    long folderId =
        dsl.select(EMAIL_FOLDER.ID)
            .from(EMAIL_FOLDER)
            .where(EMAIL_FOLDER.ACCOUNT_ID.eq(accountId))
            .and(EMAIL_FOLDER.NAME.eq("INBOX"))
            .fetchOne(EMAIL_FOLDER.ID);
    String thread = "va-" + UUID.randomUUID();
    long contentId =
        dsl.insertInto(EMAIL_CONTENT)
            .set(EMAIL_CONTENT.TENANT_ID, 1L)
            .set(EMAIL_CONTENT.THREAD_ID, thread)
            .set(EMAIL_CONTENT.SUBJECT, subject)
            .returning(EMAIL_CONTENT.ID)
            .fetchOne()
            .getId();
    return dsl.insertInto(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.ACCOUNT_ID, accountId)
        .set(EMAIL_MESSAGE.FOLDER_ID, folderId)
        .set(EMAIL_MESSAGE.IMAP_UID, nextUid++)
        .set(EMAIL_MESSAGE.THREAD_ID, thread)
        .set(EMAIL_MESSAGE.CONTENT_ID, contentId)
        .set(EMAIL_MESSAGE.FROM_NAME, fromName)
        .set(EMAIL_MESSAGE.FROM_ADDRESS, fromAddress)
        .set(EMAIL_MESSAGE.RECEIVED_AT, receivedAt)
        .set(EMAIL_MESSAGE.SENT_AT, sentAt)
        .set(EMAIL_MESSAGE.HAS_ATTACHMENT, true)
        .returning(EMAIL_MESSAGE.ID)
        .fetchOne()
        .getId();
  }

  /**
   * 메일 첨부(manifest + envelope 행) — 형식은 파일명으로(pdf 면 application/pdf). @return email_attachment.id
   */
  private long seedMailAttachment(
      long messageId, int ordinal, String filename, String mimeContentId) {
    return seedMailAttachment(
        messageId,
        ordinal,
        filename,
        mimeContentId,
        filename.endsWith(".pdf") ? "application/pdf" : "application/octet-stream");
  }

  /** 메일 첨부(manifest + envelope 행), 형식 지정. @return email_attachment.id */
  private long seedMailAttachment(
      long messageId, int ordinal, String filename, String mimeContentId, String contentType) {
    long contentId =
        dsl.select(EMAIL_MESSAGE.CONTENT_ID)
            .from(EMAIL_MESSAGE)
            .where(EMAIL_MESSAGE.ID.eq(messageId))
            .fetchOne(EMAIL_MESSAGE.CONTENT_ID);
    long caId =
        dsl.insertInto(CONTENT_ATTACHMENT)
            .set(CONTENT_ATTACHMENT.CONTENT_ID, contentId)
            .set(CONTENT_ATTACHMENT.ORDINAL, ordinal)
            .set(CONTENT_ATTACHMENT.FILENAME, filename)
            .set(CONTENT_ATTACHMENT.CONTENT_TYPE, contentType)
            .set(CONTENT_ATTACHMENT.SIZE_BYTES, 780L)
            .set(CONTENT_ATTACHMENT.MIME_CONTENT_ID, mimeContentId)
            .returning(CONTENT_ATTACHMENT.ID)
            .fetchOne()
            .getId();
    return dsl.insertInto(EMAIL_ATTACHMENT)
        .set(EMAIL_ATTACHMENT.MESSAGE_ID, messageId)
        .set(EMAIL_ATTACHMENT.ORDINAL, ordinal)
        .set(EMAIL_ATTACHMENT.CONTENT_ATTACHMENT_ID, caId)
        .returning(EMAIL_ATTACHMENT.ID)
        .fetchOne()
        .getId();
  }

  /** 메일 본문을 채운다. fetched=true 면 검증된 사본(fetched_at 있음 — 화면에 본문이 보인다). */
  private void setBody(long messageId, String html, String text, boolean fetched) {
    long contentId =
        dsl.select(EMAIL_MESSAGE.CONTENT_ID)
            .from(EMAIL_MESSAGE)
            .where(EMAIL_MESSAGE.ID.eq(messageId))
            .fetchOne(EMAIL_MESSAGE.CONTENT_ID);
    dsl.update(EMAIL_CONTENT)
        .set(EMAIL_CONTENT.BODY_HTML, html)
        .set(EMAIL_CONTENT.BODY_TEXT, text)
        .where(EMAIL_CONTENT.ID.eq(contentId))
        .execute();
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.FETCHED_AT, fetched ? now : null)
        .where(EMAIL_MESSAGE.ID.eq(messageId))
        .execute();
  }

  /** 서버 메일함 행(role 있음, WP-960). */
  private long seedFolder(long accountId, String name, String displayName, String role) {
    return dsl.insertInto(EMAIL_FOLDER)
        .set(EMAIL_FOLDER.ACCOUNT_ID, accountId)
        .set(EMAIL_FOLDER.NAME, name)
        .set(EMAIL_FOLDER.DISPLAY_NAME, displayName)
        .set(EMAIL_FOLDER.ROLE, role)
        .returning(EMAIL_FOLDER.ID)
        .fetchOne()
        .getId();
  }

  /** 지정 메일함에 메일 1통 — seedMail 로 만든 뒤 폴더만 옮긴다. */
  private long seedMailIn(long accountId, long folderId, OffsetDateTime receivedAt) {
    long msg = seedMail(accountId, "메일", null, "a@x.com", receivedAt, null);
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.FOLDER_ID, folderId)
        .where(EMAIL_MESSAGE.ID.eq(msg))
        .execute();
    return msg;
  }
}
