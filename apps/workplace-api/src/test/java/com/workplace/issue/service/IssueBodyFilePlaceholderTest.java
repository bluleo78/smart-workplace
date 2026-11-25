package com.workplace.issue.service;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_BODY_IMAGE;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static com.workplace.support.TestFixtures.NBSP;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.file.api.StagedFileClaimer;
import com.workplace.file.exception.StagedFileUnusableException;
import com.workplace.file.storage.FileStore;
import com.workplace.global.security.AgentToolContext;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateCommentRequest;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.UpdateCommentRequest;
import com.workplace.issue.dto.UpdateIssueRequest;
import com.workplace.issue.exception.IssueBodyImageRejectedException;
import com.workplace.issue.outbound.AgentToolWriteEvent;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.repository.ProjectIssueSequenceRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

/**
 * 이슈 본문·댓글의 파일 자리표시(WP-1634) 통합 테스트 — MCP 가 upload_file 로 올린 스테이징 파일 번호를 {@code ![설명](file:N)} 로
 * 본문에 적으면, 저장할 때 서버가 이미지는 본문 이미지(웹과 같은 issue-images 주소)로, 이미지가 아닌 파일은 이슈 첨부로 옮기고 그 자리를 바꿔 넣는다.
 *
 * <p>스테이징 파일은 FILE 행(임시 ATTACHMENT) + 디스크 blob 을 직접 시드한다(매직바이트 판정에 blob 이 필요 — WikiImageClaimTest 와
 * 같은 방식). 실패 시 아무것도 저장되지 않는지는 세이브포인트(NESTED) 트랜잭션으로 확인한다.
 */
@Transactional
@RecordApplicationEvents
class IssueBodyFilePlaceholderTest extends IntegrationTestBase {

  private static final long TEST_TENANT_ID = 1L;

  /** PNG 매직바이트 8 + 채움 8 — ImageSniffer.HEAD_BYTES(16) 판정용. */
  private static final byte[] PNG = {
    (byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0, 0, 0, 0, 0
  };

  @Autowired DSLContext dsl;
  @Autowired FileStore fileStore;
  @Autowired IssueService issueService;
  @Autowired IssueCommentService commentService;
  @Autowired IssueBodyImageService bodyImageService;
  @Autowired IssueAttachmentService attachmentService;
  @Autowired ProjectService projectService;
  @Autowired IssueTypeService issueTypeService;
  @Autowired IssueRepository issueRepository;
  @Autowired ProjectIssueSequenceRepository sequenceRepository;
  @Autowired MockMvc mvc;
  @Autowired ApplicationEvents events;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired ObjectMapper objectMapper;

  private long ownerId;
  private long memberId;
  private String projectKey;
  private long projectId;

  @BeforeEach
  void setUp() {
    TenantContext.set(TEST_TENANT_ID);
    ownerId = createUser("ph-owner");
    memberId = createUser("ph-member");
    ProjectResponse p =
        projectService.create(ownerId, new CreateProjectRequest(uniqueKey("PH"), "P-ph", "x"));
    projectKey = p.key();
    projectId = p.id();
    projectService.addMember(ownerId, projectKey, new AddMemberRequest(memberId, "MEMBER"));
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  // ---------------------------------------------------------------- 이미지

  @Test
  void 이슈_만들기_본문의_이미지_자리표시는_issue_images_주소로_바뀌고_영구가_되며_멤버가_볼_수_있다() {
    long png = seedStaged(ownerId, "shot.png", PNG, "image/png", PNG.length);

    var created =
        issueService.create(ownerId, projectKey, createReq("앞 ![화면](file:" + png + ") 뒤"));

    String body = bodyOf(created.id());
    assertThat(body).isEqualTo("앞 ![화면](" + imageUrl(png) + ") 뒤");
    assertThat(body).doesNotContain("file:");
    // 본문 이미지로 연결되고 만료가 풀린다 — 스테이징 만료 정리 대상이 아니다.
    assertThat(boundIssueOf(png)).isEqualTo(created.id());
    assertThat(expiresAtOf(png)).isNull();
    // 웹 업로드 본문 이미지와 같은 모양(IMAGE 범주·판정 MIME) — 다른 도메인이 스테이징 파일로 다시 가져갈 수 없다.
    assertThat(categoryOf(png)).isEqualTo("IMAGE");
    // 올린 사람이 아닌 프로젝트 멤버도 웹과 같은 경로로 열 수 있다.
    var loaded = bodyImageService.load(memberId, projectKey, png);
    assertThat(loaded.mimeType()).isEqualTo("image/png");
    // 이미지는 이슈 첨부 목록에 붙지 않는다(본문 이미지로만).
    assertThat(attachmentService.listByIssueId(created.id())).isEmpty();
  }

  @Test
  void 이슈_고치기_본문의_자리표시도_바뀐다() {
    var created = issueService.create(ownerId, projectKey, createReq("처음"));
    long png = seedStaged(ownerId, "edit.png", PNG, "image/png", PNG.length);

    issueService.update(
        ownerId,
        projectKey,
        created.number(),
        bodyOnly("![](file:" + png + ")", created.version()));

    assertThat(bodyOf(created.id())).isEqualTo("![](" + imageUrl(png) + ")");
    assertThat(boundIssueOf(png)).isEqualTo(created.id());
    assertThat(expiresAtOf(png)).isNull();
  }

  @Test
  void 댓글_만들기와_고치기의_자리표시도_바뀐다() {
    var issue = issueService.create(ownerId, projectKey, createReq("본문"));
    long first = seedStaged(memberId, "c1.png", PNG, "image/png", PNG.length);
    long second = seedStaged(memberId, "c2.png", PNG, "image/png", PNG.length);

    var comment =
        commentService.create(
            memberId, issue.id(), new CreateCommentRequest("재현 ![첫](file:" + first + ")"));
    assertThat(comment.body()).isEqualTo("재현 ![첫](" + imageUrl(first) + ")");
    assertThat(boundIssueOf(first)).isEqualTo(issue.id());

    var edited =
        commentService.update(
            memberId,
            issue.id(),
            comment.id(),
            new UpdateCommentRequest("고침 ![둘](file:" + second + ")"));
    assertThat(edited.body()).isEqualTo("고침 ![둘](" + imageUrl(second) + ")");
    assertThat(boundIssueOf(second)).isEqualTo(issue.id());
    assertThat(expiresAtOf(second)).isNull();
  }

  @Test
  void 같은_번호가_여러_번_나오면_한_번만_옮기고_모두_같은_주소가_된다() {
    long png = seedStaged(ownerId, "twice.png", PNG, "image/png", PNG.length);

    var created =
        issueService.create(
            ownerId,
            projectKey,
            createReq("![a](file:" + png + ")\n\n중간\n\n![b](file:" + png + ")"));

    String url = imageUrl(png);
    assertThat(bodyOf(created.id())).isEqualTo("![a](" + url + ")\n\n중간\n\n![b](" + url + ")");
    assertThat(dsl.fetchCount(ISSUE_BODY_IMAGE, ISSUE_BODY_IMAGE.FILE_ID.eq(png))).isEqualTo(1);
  }

  @Test
  void 링크_꼴로_적은_이미지도_본문_이미지로_넣는다() {
    long png = seedStaged(ownerId, "link.png", PNG, "image/png", PNG.length);

    var created = issueService.create(ownerId, projectKey, createReq("[시안](file:" + png + ")"));

    assertThat(bodyOf(created.id())).isEqualTo("![시안](" + imageUrl(png) + ")");
  }

  @Test
  void 코드_표기_안의_자리표시는_그대로_둔다() {
    long png = seedStaged(ownerId, "real.png", PNG, "image/png", PNG.length);
    String body =
        "설명 `![x](file:1)` 예시\n\n```\n![y](file:2)\n```\n\n~~~md\n[z](file:3)\n~~~\n\n진짜 ![s](file:"
            + png
            + ")";

    var created = issueService.create(ownerId, projectKey, createReq(body));

    assertThat(bodyOf(created.id()))
        .isEqualTo(
            "설명 `![x](file:1)` 예시\n\n```\n![y](file:2)\n```\n\n~~~md\n[z](file:3)\n~~~\n\n진짜 ![s]("
                + imageUrl(png)
                + ")");
  }

  @Test
  void 자리표시가_없는_본문은_그대로_저장된다() {
    var created =
        issueService.create(
            ownerId, projectKey, createReq("file:12 은 자리표시가 아니다 [링크](https://x.y/file:3)"));

    assertThat(bodyOf(created.id())).isEqualTo("file:12 은 자리표시가 아니다 [링크](https://x.y/file:3)");
  }

  @Test
  void 크기_상한을_넘는_이미지는_400_이고_이슈가_생기지_않는다() {
    long big = seedStaged(ownerId, "big.png", PNG, "image/png", 10L * 1024 * 1024 + 1);

    assertCreateRejected("![](file:" + big + ")", IssueBodyImageRejectedException.class, "10MB");
    assertThat(expiresAtOf(big)).isNotNull();
  }

  // ---------------------------------------------------------------- 이미지가 아닌 파일

  @Test
  void 이미지가_아닌_파일은_이슈_첨부로_붙고_본문에는_굵은_이름이_남는다() {
    long doc = seedStaged(ownerId, "report.pdf", "%PDF-1.4".getBytes(), "application/pdf", 8);

    var created =
        issueService.create(ownerId, projectKey, createReq("보고서: [보고서](file:" + doc + ") 확인"));

    String body = bodyOf(created.id());
    assertThat(body).isEqualTo("보고서: **report.pdf** (첨부 파일) 확인");
    assertThat(body).doesNotContain("file:");
    assertThat(attachmentService.listByIssueId(created.id()))
        .extracting("fileId")
        .containsExactly(doc);
    assertThat(expiresAtOf(doc)).isNull();
    assertThat(dsl.fetchCount(ISSUE_BODY_IMAGE, ISSUE_BODY_IMAGE.FILE_ID.eq(doc))).isZero();
  }

  @Test
  void 만들기_fileIds_와_자리표시가_함께_와도_첨부는_한_번만_붙는다() {
    long doc = seedStaged(ownerId, "both.txt", "hello".getBytes(), "text/plain", 5);
    long other = seedStaged(ownerId, "other.txt", "world".getBytes(), "text/plain", 5);

    var created =
        issueService.create(
            ownerId, projectKey, createReqWithFiles("[x](file:" + doc + ")", List.of(other, doc)));

    assertThat(bodyOf(created.id())).isEqualTo("**both.txt** (첨부 파일)");
    assertThat(attachmentService.listByIssueId(created.id()))
        .extracting("fileId")
        .containsExactlyInAnyOrder(doc, other);
  }

  /** WP-1755 fileIds 의 중복은 본문에 자리표시가 있어도 없을 때와 똑같이 형태 오류(400)로 거절된다. */
  @Test
  void 만들기_fileIds_중복은_다른_파일의_자리표시가_있어도_똑같이_거절된다() {
    long doc = seedStaged(ownerId, "dup.txt", "hello".getBytes(), "text/plain", 5);
    long other = seedStaged(ownerId, "dup2.txt", "world".getBytes(), "text/plain", 5);
    var nested = nested();

    assertThatThrownBy(
            () ->
                nested.executeWithoutResult(
                    st ->
                        issueService.create(
                            ownerId,
                            projectKey,
                            createReqWithFiles("[x](file:" + other + ")", List.of(doc, doc)))))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("두 번");
  }

  /** WP-1755 같은 이미지 번호가 fileIds 와 자리표시에 함께 와도 본문 그림으로만 묶이고 첨부로 다시 클레임되지 않는다. */
  @Test
  void 만들기_같은_이미지_번호를_fileIds_와_자리표시에_함께_넣어도_본문_그림으로_한_번만_묶인다() {
    long img = seedStaged(ownerId, "dup.png", PNG, "image/png", PNG.length);

    var created =
        issueService.create(
            ownerId, projectKey, createReqWithFiles("시안 ![시안](file:" + img + ")", List.of(img)));

    String body = bodyOf(created.id());
    assertThat(body).contains("/issue-images/").doesNotContain("file:");
    assertThat(dsl.fetchCount(ISSUE_BODY_IMAGE, ISSUE_BODY_IMAGE.FILE_ID.eq(img))).isEqualTo(1);
    assertThat(attachmentService.listByIssueId(created.id())).isEmpty();
  }

  /** WP-1755 이미지는 본문 그림, fileIds 에만 있는 다른 파일은 첨부로 붙는다. */
  @Test
  void 만들기_이미지와_다른_첨부를_섞어도_이미지는_본문_다른_번호는_첨부로_붙는다() {
    long img = seedStaged(ownerId, "mix.png", PNG, "image/png", PNG.length);
    long doc = seedStaged(ownerId, "mix.txt", "hello".getBytes(), "text/plain", 5);

    var created =
        issueService.create(
            ownerId, projectKey, createReqWithFiles("![시안](file:" + img + ")", List.of(img, doc)));

    assertThat(attachmentService.listByIssueId(created.id()))
        .extracting("fileId")
        .containsExactly(doc);
    assertThat(dsl.fetchCount(ISSUE_BODY_IMAGE, ISSUE_BODY_IMAGE.FILE_ID.eq(img))).isEqualTo(1);
  }

  /** WP-1755 자리표시 없이 fileIds 에만 넣은 이미지는 지금처럼 첨부로 붙는다(회귀 방지). */
  @Test
  void 만들기_fileIds_에만_넣은_이미지는_지금처럼_첨부로_붙는다() {
    long img = seedStaged(ownerId, "only.png", PNG, "image/png", PNG.length);

    var created = issueService.create(ownerId, projectKey, createReqWithFiles("본문", List.of(img)));

    assertThat(attachmentService.listByIssueId(created.id()))
        .extracting("fileId")
        .containsExactly(img);
    assertThat(dsl.fetchCount(ISSUE_BODY_IMAGE, ISSUE_BODY_IMAGE.FILE_ID.eq(img))).isZero();
  }

  @Test
  void 댓글의_이미지가_아닌_파일도_이슈_첨부로_붙는다() {
    var issue = issueService.create(ownerId, projectKey, createReq("본문"));
    long doc = seedStaged(memberId, "log.txt", "log".getBytes(), "text/plain", 3);

    var comment =
        commentService.create(
            memberId, issue.id(), new CreateCommentRequest("로그 ![로그](file:" + doc + ")"));

    assertThat(comment.body()).isEqualTo("로그 **log.txt** (첨부 파일)");
    assertThat(attachmentService.listByIssueId(issue.id()))
        .extracting("fileId")
        .containsExactly(doc);
  }

  @Test
  void 이슈_고치기의_이미지가_아닌_파일도_이슈_첨부로_붙는다() {
    var created = issueService.create(ownerId, projectKey, createReq("처음"));
    long doc = seedStaged(ownerId, "a_b*c.txt", "x".getBytes(), "text/plain", 1);

    issueService.update(
        ownerId,
        projectKey,
        created.number(),
        bodyOnly("[f](file:" + doc + ")", created.version()));

    // 이름의 마크다운 특수 문자는 이스케이프해 굵게가 깨지지 않게 한다.
    assertThat(bodyOf(created.id())).isEqualTo("**a\\_b\\*c.txt** (첨부 파일)");
    assertThat(attachmentService.listByIssueId(created.id()))
        .extracting("fileId")
        .containsExactly(doc);
  }

  @Test
  void 비멤버_댓글_설정으로만_댓글을_다는_사람은_이미지가_아닌_파일을_첨부할_수_없다() {
    var s =
        OpenScenario.create(
            dsl, issueTypeService, issueRepository, sequenceRepository, TEST_TENANT_ID);
    dsl.update(PROJECT)
        .set(PROJECT.NON_MEMBER_COMMENT, true)
        .where(PROJECT.ID.eq(s.project().id()))
        .execute();
    long doc = seedStaged(s.strangerId(), "s.txt", "x".getBytes(), "text/plain", 1);
    long png = seedStaged(s.strangerId(), "s.png", PNG, "image/png", PNG.length);

    assertThatThrownBy(
            () ->
                commentService.create(
                    s.strangerId(), s.issueId(), new CreateCommentRequest("[f](file:" + doc + ")")))
        .isInstanceOf(ProjectAccessDeniedException.class)
        .hasMessageContaining("file:" + doc);
    // 이미지는 웹 댓글 이미지와 같이 넣을 수 있다.
    var ok =
        commentService.create(
            s.strangerId(), s.issueId(), new CreateCommentRequest("![](file:" + png + ")"));
    assertThat(ok.body()).isEqualTo("![](" + imageUrl(s.project().key(), png) + ")");
  }

  // ---------------------------------------------------------------- 거절

  @Test
  void 남의_스테이징_파일은_400_이고_이슈가_생기지_않는다() {
    long othersPng = seedStaged(memberId, "theirs.png", PNG, "image/png", PNG.length);

    assertCreateRejected(
        "![](file:" + othersPng + ")", IssueBodyImageRejectedException.class, "file:" + othersPng);
    // 남의 파일은 옮겨지지 않는다.
    assertThat(dsl.fetchCount(ISSUE_BODY_IMAGE, ISSUE_BODY_IMAGE.FILE_ID.eq(othersPng))).isZero();
    assertThat(categoryOf(othersPng)).isEqualTo("ATTACHMENT");
  }

  /** WP-1755 남의 파일 번호는 fileIds 와 자리표시에 함께 넣어도 똑같이 거절된다. */
  @Test
  void 남의_파일_번호를_fileIds_와_자리표시에_함께_넣어도_400_이고_이슈가_생기지_않는다() {
    long othersPng = seedStaged(memberId, "theirs2.png", PNG, "image/png", PNG.length);
    int before = dsl.fetchCount(ISSUE, ISSUE.PROJECT_ID.eq(projectId));
    var nested = nested();

    assertThatThrownBy(
            () ->
                nested.executeWithoutResult(
                    st ->
                        issueService.create(
                            ownerId,
                            projectKey,
                            createReqWithFiles("![](file:" + othersPng + ")", List.of(othersPng)))))
        .isInstanceOf(IssueBodyImageRejectedException.class)
        .hasMessageContaining("file:" + othersPng);
    assertThat(dsl.fetchCount(ISSUE, ISSUE.PROJECT_ID.eq(projectId))).isEqualTo(before);
  }

  @Test
  void 없는_번호와_만료된_파일은_400_이고_이슈가_생기지_않는다() {
    long expired = seedStaged(ownerId, "old.png", PNG, "image/png", PNG.length);
    dsl.update(FILE)
        .set(FILE.EXPIRES_AT, OffsetDateTime.now().minusMinutes(1))
        .where(FILE.ID.eq(expired))
        .execute();

    assertCreateRejected(
        "![](file:999999999)", IssueBodyImageRejectedException.class, "file:999999999");
    assertCreateRejected(
        "![](file:" + expired + ")", IssueBodyImageRejectedException.class, "file:" + expired);
  }

  @Test
  void 댓글의_잘못된_번호는_400_이고_댓글이_저장되지_않는다() {
    var issue = issueService.create(ownerId, projectKey, createReq("본문"));
    long othersPng = seedStaged(memberId, "theirs.png", PNG, "image/png", PNG.length);
    int before = commentCount(issue.id());

    var nested = nested();
    assertThatThrownBy(
            () ->
                nested.executeWithoutResult(
                    st ->
                        commentService.create(
                            ownerId,
                            issue.id(),
                            new CreateCommentRequest("![](file:" + othersPng + ")"))))
        .isInstanceOf(IssueBodyImageRejectedException.class);
    assertThat(commentCount(issue.id())).isEqualTo(before);
  }

  @Test
  void 이슈_고치기의_잘못된_번호는_400_이고_본문이_바뀌지_않는다() {
    var created = issueService.create(ownerId, projectKey, createReq("그대로"));

    var nested = nested();
    assertThatThrownBy(
            () ->
                nested.executeWithoutResult(
                    st ->
                        issueService.update(
                            ownerId,
                            projectKey,
                            created.number(),
                            bodyOnly("![](file:1)", created.version()))))
        .isInstanceOf(IssueBodyImageRejectedException.class);
    assertThat(bodyOf(created.id())).isEqualTo("그대로");
  }

  @Test
  void HTTP_로_보내면_400_과_어느_번호가_왜_안_되는지_알려준다() throws Exception {
    long othersPng = seedStaged(memberId, "theirs.png", PNG, "image/png", PNG.length);

    mvc.perform(
            post("/api/v1/projects/" + projectKey + "/issues")
                .header("Authorization", tokenFor(ownerId))
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    objectMapper.writeValueAsString(
                        Map.of("title", "t", "body", "![](file:" + othersPng + ")"))))
        .andExpect(status().isBadRequest())
        .andExpect(
            jsonPath("$.message")
                .value(
                    "본문의 file:"
                        + othersPng
                        + " 은 넣을 수 없어요 — 내가 올렸고 아직 어디에도 붙이지 않은, 24시간이 지나지 않은 파일만 넣을 수 있어요. 파일을 다시 올려 주세요."));
  }

  // ---------------------------------------------------------------- WP-1780 고치기 fileIds

  /** WP-1780 고치기도 만들기와 같이, 같은 이미지 번호가 fileIds 와 자리표시에 함께 와도 본문 그림으로만 묶인다. */
  @Test
  void 고치기_같은_이미지_번호를_fileIds_와_자리표시에_함께_넣어도_본문_그림으로_한_번만_묶인다() {
    var created = issueService.create(ownerId, projectKey, createReq("처음"));
    long img = seedStaged(ownerId, "dupu.png", PNG, "image/png", PNG.length);

    issueService.update(
        ownerId,
        projectKey,
        created.number(),
        bodyWithFiles("시안 ![시안](file:" + img + ")", List.of(img), created.version()));

    assertThat(bodyOf(created.id())).contains("/issue-images/").doesNotContain("file:");
    assertThat(dsl.fetchCount(ISSUE_BODY_IMAGE, ISSUE_BODY_IMAGE.FILE_ID.eq(img))).isEqualTo(1);
    assertThat(attachmentService.listByIssueId(created.id())).isEmpty();
  }

  /** WP-1780 fileIds 와 이미지가 아닌 자리표시가 겹쳐도 첨부는 한 번만 붙는다. */
  @Test
  void 고치기_fileIds_와_비이미지_자리표시가_함께_와도_첨부는_한_번만_붙는다() {
    var created = issueService.create(ownerId, projectKey, createReq("처음"));
    long doc = seedStaged(ownerId, "u1.txt", "hello".getBytes(), "text/plain", 5);
    long other = seedStaged(ownerId, "u2.txt", "world".getBytes(), "text/plain", 5);

    issueService.update(
        ownerId,
        projectKey,
        created.number(),
        bodyWithFiles("[x](file:" + doc + ")", List.of(other, doc), created.version()));

    assertThat(attachmentService.listByIssueId(created.id()))
        .extracting("fileId")
        .containsExactlyInAnyOrder(doc, other);
  }

  /** WP-1780 닫는 펜스 뒤 NBSP 경계에서도 자리표시 번호가 한 번만 붙고 거절되지 않는다. */
  @Test
  void 고치기_닫는_펜스_뒤_NBSP_경계에서도_한_번만_붙고_거절되지_않는다() {
    var created = issueService.create(ownerId, projectKey, createReq("처음"));
    long doc = seedStaged(ownerId, "nb.txt", "hello".getBytes(), "text/plain", 5);

    // WP-1780 경계는 펜스 뒤가 아니라 공백 문자 그 자체 — NBSP(U+00A0)를 통상 공백(0x20)으로 두면 이 회귀 테스트가 사라진다.
    issueService.update(
        ownerId,
        projectKey,
        created.number(),
        bodyWithFiles(
            "```\n코드\n```" + NBSP + "\n[x](file:" + doc + ")", List.of(doc), created.version()));

    assertThat(attachmentService.listByIssueId(created.id()))
        .extracting("fileId")
        .containsExactly(doc);
    // NBSP 는 Java 공백이 아니어서 닫는 펜스가 못 된다 — 그 뒤 자리표시는 코드 예시로 두고 건드리지 않는다(파서 계약).
    // 통상 공백(0x20)이면 펜스가 닫혀 자리표시가 실제로 바뀌므로, 이 단언이 NBSP 경계 자체를 고정한다.
    assertThat(bodyOf(created.id())).contains("[x](file:" + doc + ")");
  }

  /** WP-1780 본문 없이 fileIds 만 주면 본문은 그대로, 첨부만 붙는다. */
  @Test
  void 고치기_fileIds_만_주면_본문은_그대로_첨부만_붙는다() {
    var created = issueService.create(ownerId, projectKey, createReq("처음"));
    long doc = seedStaged(ownerId, "only.txt", "hello".getBytes(), "text/plain", 5);

    issueService.update(
        ownerId, projectKey, created.number(), bodyWithFiles(null, List.of(doc), null));

    assertThat(bodyOf(created.id())).isEqualTo("처음");
    assertThat(attachmentService.listByIssueId(created.id()))
        .extracting("fileId")
        .containsExactly(doc);
  }

  /** WP-1780 fileIds 의 남의 파일은 거절되고 같은 요청의 본문 변경도 반영되지 않는다. */
  @Test
  void 고치기_fileIds_의_남의_파일은_400_이고_본문이_바뀌지_않는다() {
    var created = issueService.create(ownerId, projectKey, createReq("그대로"));
    long theirs = seedStaged(memberId, "th.txt", "x".getBytes(), "text/plain", 1);
    var nested = nested();

    assertThatThrownBy(
            () ->
                nested.executeWithoutResult(
                    st ->
                        issueService.update(
                            ownerId,
                            projectKey,
                            created.number(),
                            bodyWithFiles("새 본문", List.of(theirs), created.version()))))
        .isInstanceOf(StagedFileUnusableException.class);
    assertThat(bodyOf(created.id())).isEqualTo("그대로");
  }

  /** WP-1780 fileIds 만 고치면 이슈 행 version 이 그대로이고(편집기를 연 사람이 409 를 받지 않는다) 첨부만 붙는다. */
  @Test
  void 고치기_fileIds_만_주면_version_이_그대로이고_첨부가_붙는다() {
    var created = issueService.create(ownerId, projectKey, createReq("처음"));
    int versionBefore = issueRepository.findById(created.id()).orElseThrow().version();
    long doc = seedStaged(ownerId, "ver.txt", "hello".getBytes(), "text/plain", 5);

    var res =
        issueService.update(
            ownerId, projectKey, created.number(), bodyWithFiles(null, List.of(doc), null));

    assertThat(issueRepository.findById(created.id()).orElseThrow().version())
        .isEqualTo(versionBefore);
    assertThat(res.summary().number()).isEqualTo(created.number());
    assertThat(attachmentService.listByIssueId(created.id()))
        .extracting("fileId")
        .containsExactly(doc);
  }

  /** WP-1780 fileIds 와 함께 우선순위를 바꾸면 이슈 행이 갱신돼 version 이 오른다(첨부 전용이 아니다). */
  @Test
  void 고치기_fileIds_와_우선순위를_함께_주면_version_이_오른다() {
    var created = issueService.create(ownerId, projectKey, createReq("처음"));
    int versionBefore = issueRepository.findById(created.id()).orElseThrow().version();
    long doc = seedStaged(ownerId, "ver2.txt", "hello".getBytes(), "text/plain", 5);

    issueService.update(
        ownerId,
        projectKey,
        created.number(),
        new UpdateIssueRequest(
            null,
            null,
            null,
            "HIGH",
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            List.of(doc)));

    assertThat(issueRepository.findById(created.id()).orElseThrow().version())
        .isGreaterThan(versionBefore);
    assertThat(attachmentService.listByIssueId(created.id())).hasSize(1);
  }

  /**
   * WP-1780 MCP 수행 도구 경유 fileIds 고치기는 예전 claim 처럼 작업 쓰기라 AI 작업 터치 이벤트를 낸다(fileIds 만·우선순위와 함께 모두).
   */
  @Test
  void 고치기_fileIds_는_MCP_경유_작업_쓰기로_AgentToolWriteEvent_를_낸다() {
    var created = issueService.create(ownerId, projectKey, createReq("처음"));
    long doc = seedStaged(ownerId, "ev1.txt", "hello".getBytes(), "text/plain", 5);
    long doc2 = seedStaged(ownerId, "ev2.txt", "hello".getBytes(), "text/plain", 5);
    events.clear();

    AgentToolContext.set("test-tool");
    try {
      issueService.update(
          ownerId, projectKey, created.number(), bodyWithFiles(null, List.of(doc), null));
      assertThat(events.stream(AgentToolWriteEvent.class).count()).isEqualTo(1);
      events.clear();

      issueService.update(
          ownerId,
          projectKey,
          created.number(),
          new UpdateIssueRequest(
              null,
              null,
              null,
              "HIGH",
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              List.of(doc2)));
      assertThat(events.stream(AgentToolWriteEvent.class).count()).isEqualTo(1);
    } finally {
      AgentToolContext.clear();
    }
  }

  /** WP-1780 OPEN 프로젝트의 비멤버 보고자는 고치기 fileIds 로 첨부할 수 있고, 보고자가 아닌 비멤버는 거절된다. */
  @Test
  void 고치기_fileIds_OPEN_비멤버_보고자는_첨부할_수_있고_비보고자는_거절된다() {
    long reporter = createUser("ph-rep");
    long stranger = createUser("ph-stranger");
    ProjectResponse open =
        projectService.create(
            ownerId, new CreateProjectRequest(uniqueKey("PO"), "P-open", "x", "OPEN"));
    var created = issueService.create(reporter, open.key(), createReq("보고"));
    long mine = seedStaged(reporter, "rep.txt", "hello".getBytes(), "text/plain", 5);
    long theirs = seedStaged(stranger, "str.txt", "hello".getBytes(), "text/plain", 5);

    issueService.update(
        reporter, open.key(), created.number(), bodyWithFiles(null, List.of(mine), null));
    assertThat(attachmentService.listByIssueId(created.id()))
        .extracting("fileId")
        .containsExactly(mine);

    assertThatThrownBy(
            () ->
                issueService.update(
                    stranger,
                    open.key(),
                    created.number(),
                    bodyWithFiles(null, List.of(theirs), null)))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  /** WP-1780 HTTP — fileIds 는 만들기와 같이 10개까지. */
  @Test
  void 고치기_fileIds_가_10개를_넘으면_400() throws Exception {
    var created = issueService.create(ownerId, projectKey, createReq("처음"));

    mvc.perform(
            patch("/api/v1/projects/" + projectKey + "/issues/" + created.number())
                .header("Authorization", tokenFor(ownerId))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"fileIds\":[1,2,3,4,5,6,7,8,9,10,11]}"))
        .andExpect(status().isBadRequest());
  }

  /** WP-1780 fileIds 의 빈 원소(null)는 첨부 단계까지 가 500 이 되지 않고 형태 오류 400 으로 거절된다. */
  @Test
  void 고치기_fileIds_에_null_이_있으면_400() throws Exception {
    var created = issueService.create(ownerId, projectKey, createReq("처음"));

    mvc.perform(
            patch("/api/v1/projects/" + projectKey + "/issues/" + created.number())
                .header("Authorization", tokenFor(ownerId))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"fileIds\":[null]}"))
        .andExpect(status().isBadRequest());
  }

  // ---------------------------------------------------------------- 도우미

  /** 이슈 만들기가 거절되고 이슈가 생기지 않는지 세이브포인트 안에서 확인한다. */
  private void assertCreateRejected(String body, Class<? extends Throwable> type, String message) {
    int before = dsl.fetchCount(ISSUE, ISSUE.PROJECT_ID.eq(projectId));
    var nested = nested();
    assertThatThrownBy(
            () ->
                nested.executeWithoutResult(
                    st -> issueService.create(ownerId, projectKey, createReq(body))))
        .isInstanceOf(type)
        .hasMessageContaining(message);
    assertThat(dsl.fetchCount(ISSUE, ISSUE.PROJECT_ID.eq(projectId))).isEqualTo(before);
  }

  private TransactionTemplate nested() {
    var nested = new TransactionTemplate(txManager);
    nested.setPropagationBehavior(TransactionDefinition.PROPAGATION_NESTED);
    return nested;
  }

  /** 스테이징 파일 시드 — FILE 행(임시 ATTACHMENT) + 디스크 blob. sizeBytes 는 행에만 적용(크기 상한 검증용). */
  private long seedStaged(long uploader, String name, byte[] bytes, String mime, long sizeBytes) {
    String path = "tenant-1/staged/" + UUID.randomUUID();
    fileStore.storeBytes(path, bytes);
    return dsl.insertInto(FILE)
        .set(FILE.ORIGINAL_NAME, name)
        .set(FILE.STORED_NAME, path)
        .set(FILE.STORAGE_PATH, path)
        .set(FILE.MIME_TYPE, mime)
        .set(FILE.SIZE_BYTES, sizeBytes)
        .set(FILE.CATEGORY, StagedFileClaimer.CATEGORY_ATTACHMENT)
        .set(FILE.UPLOADED_BY, uploader)
        .set(FILE.EXPIRES_AT, OffsetDateTime.now().plusHours(24))
        .returning(FILE.ID)
        .fetchOne()
        .getId();
  }

  private String imageUrl(long fileId) {
    return imageUrl(projectKey, fileId);
  }

  private String imageUrl(String key, long fileId) {
    return "/api/v1/projects/" + key + "/issue-images/" + fileId;
  }

  private String bodyOf(long issueId) {
    return dsl.select(ISSUE.BODY).from(ISSUE).where(ISSUE.ID.eq(issueId)).fetchOne(ISSUE.BODY);
  }

  private Long boundIssueOf(long fileId) {
    return dsl.select(ISSUE_BODY_IMAGE.ISSUE_ID)
        .from(ISSUE_BODY_IMAGE)
        .where(ISSUE_BODY_IMAGE.FILE_ID.eq(fileId))
        .fetchOne(ISSUE_BODY_IMAGE.ISSUE_ID);
  }

  private OffsetDateTime expiresAtOf(long fileId) {
    return dsl.select(FILE.EXPIRES_AT)
        .from(FILE)
        .where(FILE.ID.eq(fileId))
        .fetchOne(FILE.EXPIRES_AT);
  }

  private String categoryOf(long fileId) {
    return dsl.select(FILE.CATEGORY).from(FILE).where(FILE.ID.eq(fileId)).fetchOne(FILE.CATEGORY);
  }

  private int commentCount(long issueId) {
    return dsl.fetchCount(
        com.workplace.jooq.Tables.ISSUE_COMMENT,
        com.workplace.jooq.Tables.ISSUE_COMMENT.ISSUE_ID.eq(issueId));
  }

  private CreateIssueRequest createReq(String body) {
    return new CreateIssueRequest("자리표시", body, null, null, null, null, null, null);
  }

  private CreateIssueRequest createReqWithFiles(String body, List<Long> fileIds) {
    return new CreateIssueRequest(
        "자리표시", body, "MID", null, null, null, null, null, null, null, null, null, fileIds, null,
        null, null);
  }

  /** 본문만 바꾸는 PATCH — WP-2113 에 따라 version 을 함께 싣는다(이 테스트는 자리표시·첨부 동작만 본다). */
  private UpdateIssueRequest bodyOnly(String body, Integer version) {
    return new UpdateIssueRequest(
        null, body, null, null, null, null, null, null, null, null, version, null, null);
  }

  /**
   * WP-1780 본문·fileIds 를 함께(또는 fileIds 만) 보내는 PATCH. 본문이 있으면 WP-2113 에 따라 version 필수, fileIds 만이면
   * 첨부 전용이라 null 이어도 된다.
   */
  private UpdateIssueRequest bodyWithFiles(String body, List<Long> fileIds, Integer version) {
    return new UpdateIssueRequest(
        null, body, null, null, null, null, null, null, null, null, version, null, null, fileIds);
  }

  private String tokenFor(long userId) {
    return "Bearer " + jwtTokenProvider.generateAccessToken(userId, "user-" + userId, 1L);
  }

  private long createUser(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    // 테넌트#1 ACTIVE 멤버십 — addMember 가 대상의 테넌트 소속을 검증한다.
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, TEST_TENANT_ID)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  private String uniqueKey(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    return (prefix + suffix).substring(0, Math.min(10, (prefix + suffix).length()));
  }
}
