package com.workplace.issue;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ATTACHMENT;
import static com.workplace.jooq.Tables.ISSUE_BODY_IMAGE;
import static com.workplace.jooq.Tables.ISSUE_COMMENT;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.ISSUE_WATCHER;
import static com.workplace.jooq.Tables.NOTIFICATION;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.file.service.StagedUploadService;
import com.workplace.fileai.inbound.FileExtractionRequestedEvent;
import com.workplace.issue.dto.CreateCommentRequest;
import com.workplace.issue.dto.ImportIssueRequest;
import com.workplace.issue.dto.IssueBodyImageResponse;
import com.workplace.issue.dto.IssueHistoryEventType;
import com.workplace.issue.outbound.AgentToolWriteEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentedEvent;
import com.workplace.issue.outbound.IssueHumanReplyPosted;
import com.workplace.issue.service.IssueBodyImageService;
import com.workplace.issue.service.IssueCommentService;
import com.workplace.issue.service.IssueImportService;
import com.workplace.issue.service.IssueService;
import com.workplace.notify.push.InboxPushRequestedEvent;
import com.workplace.watcher.outbound.WatcherDomainEvents.WatcherAddedEvent;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 이슈 가져오기의 댓글·첨부·본문 이미지(WP-883) — 원작성자·원시각 보존, 이력·알림 없음, 개수 상한 50, 끝에서 실패하면 전체 롤백, 가져온 뒤의 일반 댓글은
 * 평소대로 알림.
 *
 * <p>테스트 트랜잭션 안이라 AFTER_COMMIT 비동기 리스너가 돌지 않으므로 "알림 없음" 은 알림을 만드는 원인 이벤트가 0건임으로 단언한다({@link
 * RecordApplicationEvents}). 준비(관리자·프로젝트·멤버)는 {@link IssueImportTest} 와 같은 모양의 최소판이다.
 */
@Transactional
@RecordApplicationEvents
class IssueImportContentTest extends IssueImportTestSupport {

  /** 1x1 PNG 의 앞부분 — 매직바이트 판정만 통과하면 된다. */
  private static final byte[] PNG =
      new byte[] {
        (byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D, 'I', 'H', 'D', 'R'
      };

  @Autowired ApplicationEvents events;
  @Autowired IssueService issueService;
  @Autowired IssueCommentService commentService;
  @Autowired IssueImportService importService;
  @Autowired IssueBodyImageService bodyImageService;
  @Autowired StagedUploadService stagedUploadService;
  @Autowired PlatformTransactionManager txManager;

  private long userB;
  private long userC;

  @BeforeEach
  void seed() {
    seedProject("IC", "내용");
    userB = member();
    userC = member();
  }

  private Map<String, Object> comment(long author, String created, String updated, String text) {
    Map<String, Object> c = new LinkedHashMap<>();
    c.put("author", username(author));
    c.put("createdAt", created);
    if (updated != null) c.put("updatedAt", updated);
    c.put("body", text);
    return c;
  }

  private Map<String, Object> attachment(long fileId, long by, String at) {
    return Map.of("fileId", fileId, "attachedBy", username(by), "attachedAt", at);
  }

  /** ADMIN 이 스테이징으로 올린 텍스트 파일 id. */
  private long staged(long uploader, String name) {
    return stagedUploadService.createText(uploader, name, "내용").fileId();
  }

  /** ADMIN 이 올린 미연결 본문 이미지의 참조 URL. */
  private String imageRef(long fileId) {
    return "![x](" + IssueBodyImageResponse.urlOf(key, fileId) + ")";
  }

  private long uploadImage() {
    return bodyImageService
        .upload(admin, key, new MockMultipartFile("file", "a.png", "image/png", PNG))
        .fileId();
  }

  @Test
  void commentsKeepAuthorAndTimes() throws Exception {
    Map<String, Object> m = body("댓글");
    m.put(
        "comments",
        List.of(
            comment(userB, "2026-06-12T09:00:00+09:00", null, "첫째"),
            comment(userC, "2026-06-13T09:00:00+09:00", "2026-06-14T09:00:00+09:00", "둘째")));
    int number = numberOf(importAs(admin, m).andExpect(status().isCreated()));

    var comments = issueService.get(admin, key, number).comments();
    assertThat(comments).extracting(c -> c.body()).containsExactly("첫째", "둘째");
    assertThat(comments).extracting(c -> c.authorId()).containsExactly(userB, userC);
    assertThat(comments.get(0).createdAt()).isEqualTo(t("2026-06-12T09:00:00+09:00").toInstant());
    // 수정 시각을 주지 않으면 작성 시각.
    assertThat(comments.get(0).updatedAt()).isEqualTo(t("2026-06-12T09:00:00+09:00").toInstant());
    assertThat(comments.get(1).createdAt()).isEqualTo(t("2026-06-13T09:00:00+09:00").toInstant());
    assertThat(comments.get(1).updatedAt()).isEqualTo(t("2026-06-14T09:00:00+09:00").toInstant());
    // 가져옴 표시는 호출한 관리자.
    assertThat(
            dsl.select(ISSUE_COMMENT.IMPORTED_BY)
                .from(ISSUE_COMMENT)
                .where(ISSUE_COMMENT.ISSUE_ID.eq(issueId(number)))
                .fetch(ISSUE_COMMENT.IMPORTED_BY))
        .containsOnly(admin);
  }

  @Test
  void commentUpdatedBeforeCreated_400() throws Exception {
    Map<String, Object> m = body("역전");
    m.put(
        "comments",
        List.of(comment(userB, "2026-06-12T09:00:00+09:00", "2026-06-11T09:00:00+09:00", "x")));
    importAs(admin, m).andExpect(status().isBadRequest());
    assertThat(dsl.fetchCount(ISSUE, ISSUE.PROJECT_ID.eq(projectId))).isZero();
  }

  @Test
  void attachmentsKeepUploaderAndTime() throws Exception {
    long f1 = staged(admin, "a.md");
    long f2 = staged(admin, "b.md");
    Map<String, Object> m = body("첨부");
    m.put(
        "attachments",
        List.of(
            attachment(f1, userC, "2026-06-11T09:00:00+09:00"),
            attachment(f2, userC, "2026-06-11T09:00:00+09:00")));
    events.clear();
    int number = numberOf(importAs(admin, m).andExpect(status().isCreated()));

    var list =
        dsl.selectFrom(ISSUE_ATTACHMENT)
            .where(ISSUE_ATTACHMENT.ISSUE_ID.eq(issueId(number)))
            .fetch();
    assertThat(list).hasSize(2);
    assertThat(list).extracting(a -> a.getAttachedBy()).containsOnly(userC);
    assertThat(list)
        .extracting(a -> a.getAttachedAt().toInstant())
        .containsOnly(t("2026-06-11T09:00:00+09:00").toInstant());
    assertThat(
            dsl.fetchCount(
                ISSUE_HISTORY,
                ISSUE_HISTORY
                    .ISSUE_ID
                    .eq(issueId(number))
                    .and(
                        ISSUE_HISTORY.EVENT_TYPE.eq(
                            IssueHistoryEventType.ATTACHMENTS_CHANGED.name()))))
        .isZero();
    assertThat(events.stream(FileExtractionRequestedEvent.class).count()).isEqualTo(2);
    // 상세 응답의 첨부 목록에서도 첨부자가 C.
    assertThat(issueService.get(admin, key, number).attachments())
        .extracting(a -> a.attachedById())
        .containsOnly(userC);
  }

  @Test
  void bodyAndCommentImagesReassigned() throws Exception {
    long bodyImg = uploadImage();
    long commentImg = uploadImage();
    Map<String, Object> m = body("이미지");
    m.put("body", "본문 " + imageRef(bodyImg));
    m.put(
        "comments",
        List.of(comment(userB, "2026-06-12T09:00:00+09:00", null, "댓글 " + imageRef(commentImg))));
    int number = numberOf(importAs(admin, m).andExpect(status().isCreated()));
    long id = issueId(number);

    var body =
        dsl.selectFrom(ISSUE_BODY_IMAGE).where(ISSUE_BODY_IMAGE.FILE_ID.eq(bodyImg)).fetchOne();
    assertThat(body.getIssueId()).isEqualTo(id);
    assertThat(body.getUploadedBy()).isEqualTo(reporter);
    assertThat(body.getCreatedAt().toInstant())
        .isEqualTo(t("2026-06-10T09:00:00+09:00").toInstant());
    var cm =
        dsl.selectFrom(ISSUE_BODY_IMAGE).where(ISSUE_BODY_IMAGE.FILE_ID.eq(commentImg)).fetchOne();
    assertThat(cm.getIssueId()).isEqualTo(id);
    assertThat(cm.getUploadedBy()).isEqualTo(userB);
    assertThat(cm.getCreatedAt().toInstant()).isEqualTo(t("2026-06-12T09:00:00+09:00").toInstant());
  }

  /**
   * 본문과 댓글이 같은 이미지를 가리키면 올린 사람·시각은 처음 연결한 본문(보고자·이슈 생성 시각) 것으로 남는다 — 이미 이 이슈에 붙은 이미지를 뒤 댓글이 다시 되돌리면
   * 마지막 댓글 작성자·시각이 이긴다.
   */
  @Test
  void imageSharedByBodyAndComment_keepsBodyUploaderAndTime() throws Exception {
    long img = uploadImage();
    Map<String, Object> m = body("공유 이미지");
    m.put("body", "본문 " + imageRef(img));
    m.put(
        "comments",
        List.of(comment(userB, "2026-06-12T09:00:00+09:00", null, "같은 그림 " + imageRef(img))));
    int number = numberOf(importAs(admin, m).andExpect(status().isCreated()));

    var row = dsl.selectFrom(ISSUE_BODY_IMAGE).where(ISSUE_BODY_IMAGE.FILE_ID.eq(img)).fetchOne();
    assertThat(row.getIssueId()).isEqualTo(issueId(number));
    assertThat(row.getUploadedBy()).isEqualTo(reporter);
    assertThat(row.getCreatedAt().toInstant())
        .isEqualTo(t("2026-06-10T09:00:00+09:00").toInstant());
  }

  /** 목록 안의 null 원소(comments:[null] 등)는 500 이 아니라 400 으로 거절한다. */
  @Test
  void nullListElements_400() throws Exception {
    for (String field : List.of("comments", "attachments", "history", "fields", "labelNames")) {
      Map<String, Object> m = body("null 원소 " + field);
      List<Object> withNull = new ArrayList<>();
      withNull.add(null);
      m.put(field, withNull);
      importAs(admin, m).andExpect(status().isBadRequest());
    }
    assertThat(dsl.fetchCount(ISSUE, ISSUE.PROJECT_ID.eq(projectId))).isZero();
  }

  @Test
  void eleventhAttachmentAllowed_upTo50() throws Exception {
    List<Map<String, Object>> list = new ArrayList<>();
    for (int i = 0; i < 11; i++) {
      list.add(attachment(staged(admin, "f" + i + ".md"), userC, "2026-06-11T09:00:00+09:00"));
    }
    Map<String, Object> m = body("많은 첨부");
    m.put("attachments", list);
    int number = numberOf(importAs(admin, m).andExpect(status().isCreated()));
    assertThat(dsl.fetchCount(ISSUE_ATTACHMENT, ISSUE_ATTACHMENT.ISSUE_ID.eq(issueId(number))))
        .isEqualTo(11);
  }

  @Test
  void noCommentNotifications() throws Exception {
    Map<String, Object> m = body("멘션");
    m.put("assignees", List.of(username(userB)));
    m.put(
        "comments",
        List.of(comment(userB, "2026-06-12T09:00:00+09:00", null, "확인 @" + username(userC))));
    events.clear();
    int number = numberOf(importAs(admin, m).andExpect(status().isCreated()));

    assertThat(dsl.fetchCount(NOTIFICATION)).isZero();
    for (Class<?> c :
        List.of(
            IssueCommentedEvent.class,
            IssueHumanReplyPosted.class,
            WatcherAddedEvent.class,
            AgentToolWriteEvent.class,
            InboxPushRequestedEvent.class)) {
      assertThat(events.stream(c).count()).as(c.getSimpleName()).isZero();
    }
    // 댓글 작성자가 워처로 자동 등록되지 않는다.
    assertThat(dsl.fetchCount(ISSUE_WATCHER, ISSUE_WATCHER.ISSUE_ID.eq(issueId(number)))).isZero();
  }

  /** 첨부 단계에서 실패(남이 올린 스테이징 파일)하면 그 앞에서 넣은 워처·첨부까지 모두 되돌아간다. */
  @Test
  void attachmentFailure_rollsBackWholeIssue() throws Exception {
    long mine = staged(admin, "mine.md");
    long others = staged(owner, "others.md");
    Map<String, Object> m = body("롤백");
    m.put("watchers", List.of(username(userB)));
    m.put(
        "attachments",
        List.of(
            attachment(mine, userC, "2026-06-11T09:00:00+09:00"),
            attachment(others, userC, "2026-06-11T09:00:00+09:00")));

    assertThatThrownBy(() -> importNested(m))
        .isInstanceOf(com.workplace.file.exception.StagedFileUnusableException.class);

    assertThat(dsl.fetchCount(ISSUE, ISSUE.PROJECT_ID.eq(projectId))).isZero();
    assertThat(dsl.fetchCount(ISSUE_WATCHER, ISSUE_WATCHER.USER_ID.eq(userB))).isZero();
    assertThat(dsl.fetchCount(ISSUE_ATTACHMENT, ISSUE_ATTACHMENT.FILE_ID.eq(mine))).isZero();
  }

  /**
   * 댓글까지 넣은 뒤(이력 검증은 댓글 다음) 실패하면 댓글·첨부·워처도 남지 않는다 — 첨부 실패는 댓글보다 먼저라 댓글 롤백을 보여 주지 못해 이력 실패로 따로 본다.
   */
  @Test
  void historyFailureAfterComments_rollsBackCommentsToo() throws Exception {
    long mine = staged(admin, "mine.md");
    Map<String, Object> m = body("이력 롤백");
    m.put("watchers", List.of(username(userB)));
    m.put("attachments", List.of(attachment(mine, userC, "2026-06-11T09:00:00+09:00")));
    m.put("comments", List.of(comment(userB, "2026-06-12T09:00:00+09:00", null, "롤백될 댓글")));
    m.put(
        "history",
        List.of(
            Map.of("type", "BOGUS", "actor", username(userB), "at", "2026-06-13T09:00:00+09:00")));

    assertThatThrownBy(() -> importNested(m))
        .isInstanceOf(com.workplace.issue.exception.IssueImportException.class)
        .hasMessageContaining("지원하지 않는 이력 유형");

    assertThat(dsl.fetchCount(ISSUE, ISSUE.PROJECT_ID.eq(projectId))).isZero();
    assertThat(
            dsl.fetchCount(
                ISSUE_COMMENT,
                ISSUE_COMMENT.AUTHOR_ID.eq(userB).and(ISSUE_COMMENT.BODY.eq("롤백될 댓글"))))
        .isZero();
    assertThat(dsl.fetchCount(ISSUE_WATCHER, ISSUE_WATCHER.USER_ID.eq(userB))).isZero();
    assertThat(dsl.fetchCount(ISSUE_ATTACHMENT, ISSUE_ATTACHMENT.FILE_ID.eq(mine))).isZero();
  }

  /** 요청 트랜잭션처럼 savepoint 로 감싸 서비스를 부른다 — 예외 시 그 안의 쓰기만 되돌린다(테스트 트랜잭션 안이라). */
  private void importNested(Map<String, Object> m) {
    ImportIssueRequest req = objectMapper.convertValue(m, ImportIssueRequest.class);
    var tt = new TransactionTemplate(txManager);
    tt.setPropagationBehavior(TransactionDefinition.PROPAGATION_NESTED);
    tt.executeWithoutResult(s -> importService.importIssue(admin, key, req));
  }

  @Test
  void normalCommentAfterImport_notifies() throws Exception {
    Map<String, Object> m = body("이후 댓글");
    m.put("assignees", List.of(username(userB)));
    int number = numberOf(importAs(admin, m).andExpect(status().isCreated()));
    long id = issueId(number);

    events.clear();
    commentService.create(owner, id, new CreateCommentRequest("일반 댓글"));

    // NotificationDispatcher 가 이 이벤트의 assignees 로 COMMENTED 알림을 만든다 — 가져온 담당자가 실려 있어야 한다.
    var published = events.stream(IssueCommentedEvent.class).toList();
    assertThat(published).hasSize(1);
    assertThat(published.get(0).assignees()).extracting(a -> a.id()).containsExactly(userB);
  }
}
