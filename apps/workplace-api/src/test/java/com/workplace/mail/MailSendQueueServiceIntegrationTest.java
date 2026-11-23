package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_ATTACHMENT;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.MAIL_DRAFT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.EncryptionService;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.MailDraftDetail;
import com.workplace.mail.dto.MailDraftSaveRequest;
import com.workplace.mail.dto.MailSendRequest;
import com.workplace.mail.dto.MailSendRequest.InlineImageRef;
import com.workplace.mail.dto.MailSendRequest.InlineUploadRef;
import com.workplace.mail.dto.ParsedAttachment;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.dto.QueuedSend;
import com.workplace.mail.exception.MailAlreadySendingException;
import com.workplace.mail.exception.MailDraftNotFoundException;
import com.workplace.mail.exception.MailDraftSendingException;
import com.workplace.mail.exception.MailValidationException;
import com.workplace.mail.repository.EmailAttachmentRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.repository.MailDraftRepository;
import com.workplace.mail.repository.MailDraftRepository.QueuedRow;
import com.workplace.mail.service.MailComposeAttachmentService;
import com.workplace.mail.service.MailDraftService;
import com.workplace.mail.service.MailSendQueueService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;

/**
 * 메일 보내기 대기열 서비스(WP-1786) 통합 — enqueue(새 행·sendAt·검증 실패 시 행 없음), cancel(상세 복원·늦은 되돌리기 409),
 * toSendRequest 왕복, 컨트롤러 응답 모양. 커밋을 봐야 하는 트랜잭션 경계가 있어 테스트 트랜잭션 없이 돈다. 시드는 {@link #cleanup} 에서 지운다.
 */
class MailSendQueueServiceIntegrationTest extends ExternalClientMockedTestBase {

  @Autowired DSLContext dsl;
  @Autowired MockMvc mockMvc;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired MailSendQueueService queueService;
  @Autowired MailDraftService draftService;
  @Autowired MailDraftRepository draftRepo;
  @Autowired MailComposeAttachmentService uploadService;
  @Autowired EncryptionService encryption;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EmailAttachmentRepository attachmentRepo;

  private final List<Long> users = new ArrayList<>();

  @BeforeEach
  void tenant() {
    TenantContext.set(1L);
  }

  /** file(uploaded_by) → 계정(메일·임시저장 CASCADE) → 사용자 순으로 정리. */
  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          if (!users.isEmpty()) {
            dsl.deleteFrom(FILE).where(FILE.UPLOADED_BY.in(users)).execute();
            dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.USER_ID.in(users)).execute();
            dsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
          }
        });
    users.clear();
    TenantContext.clear();
  }

  private long user() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    users.add(id);
    return id;
  }

  private long account(long user) {
    return MailTestSupport.seedGraphAccount(dsl, encryption, user);
  }

  private long upload(long user, String name, String mime) {
    return uploadService
        .upload(user, new MockMultipartFile("file", name, mime, new byte[] {1, 2, 3}))
        .id();
  }

  /** 받은 메일 + 첨부 1건 — email_attachment.id 를 돌려준다(인용문 이미지·전달 원본 후보). */
  private long seedReceivedAttachment(long accountId, String pmid, String mime) {
    long folderId = folderRepo.ensureFolder(accountId, "INBOX").id();
    ParsedMessage m =
        new ParsedMessage(
            0L,
            "src-" + pmid + "@x",
            "t-" + pmid,
            null,
            null,
            "a@x.com",
            "A",
            "me@x.com",
            null,
            "원본",
            Instant.now(),
            Instant.now(),
            true,
            true,
            null,
            null,
            null,
            List.of());
    messageRepo.upsertByProviderId(accountId, folderId, m, pmid, true);
    long messageId = messageRepo.findByProviderId(accountId, folderId, pmid).orElseThrow();
    long contentId = messageRepo.findBodyTarget(accountId, messageId).orElseThrow().contentId();
    attachmentRepo.insert(
        messageId, contentId, 0, new ParsedAttachment("a.bin", mime, 1234, null, "ATT-" + pmid));
    return dsl.select(EMAIL_ATTACHMENT.ID)
        .from(EMAIL_ATTACHMENT)
        .where(EMAIL_ATTACHMENT.MESSAGE_ID.eq(messageId))
        .fetchOne(EMAIL_ATTACHMENT.ID);
  }

  private MailSendRequest simple(Long draftId) {
    return new MailSendRequest(
        List.of("peer@example.com"),
        List.of("cc@example.com"),
        List.of(),
        "제목",
        "<p>본문</p>",
        "본문",
        null,
        null,
        null,
        null,
        draftId);
  }

  /** 스케줄러가 잡은 것처럼 SENDING 으로 올린 뒤 보낼 행을 읽는다 — startSend 는 발송 중인 행만 읽는다(코드 리뷰). */
  private QueuedRow claimedRow(long draftId) {
    dsl.update(MAIL_DRAFT)
        .set(MAIL_DRAFT.SEND_STATE, "SENDING")
        .where(MAIL_DRAFT.ID.eq(draftId))
        .execute();
    return draftRepo.startSend(draftId).orElseThrow();
  }

  private long draftCount(long user) {
    return dsl.fetchCount(MAIL_DRAFT, MAIL_DRAFT.USER_ID.eq(user));
  }

  @Test
  void enqueue_draftId_없이_보내면_새_임시보관이_QUEUED_로_생기고_sendAt_은_10초_뒤() {
    long me = user();
    long acc = account(me);
    OffsetDateTime before = OffsetDateTime.now();

    QueuedSend q = queueService.enqueue(me, acc, simple(null));

    assertThat(MailSendQueueService.SEND_UNDO_SECONDS).isEqualTo(10);
    assertThat(draftRepo.sendState(me, q.draftId())).contains("QUEUED");
    assertThat(Duration.between(before, q.sendAt()).toMillis()).isBetween(9_000L, 11_500L);
    assertThat(draftCount(me)).isEqualTo(1);
  }

  /**
   * 보낼 시각은 DB 시계로 정한다(코드 리뷰) — 스케줄러가 DB now() 와 비교하므로 앱 시계와 어긋나면 유예가 줄거나 는다. 응답 sendAt 은 행에 저장된 값
   * 그대로이고, enqueue 앞뒤의 DB now() + 10초 사이에 있다.
   */
  @Test
  void enqueue_의_sendAt_은_DB_now_더하기_10초이고_저장값과_같다() {
    long me = user();
    long acc = account(me);
    OffsetDateTime dbBefore = dsl.select(DSL.currentOffsetDateTime()).fetchOne().value1();

    QueuedSend q = queueService.enqueue(me, acc, simple(null));

    OffsetDateTime dbAfter = dsl.select(DSL.currentOffsetDateTime()).fetchOne().value1();
    OffsetDateTime stored =
        dsl.select(MAIL_DRAFT.SEND_AT)
            .from(MAIL_DRAFT)
            .where(MAIL_DRAFT.ID.eq(q.draftId()))
            .fetchOne(MAIL_DRAFT.SEND_AT);
    assertThat(q.sendAt().toInstant()).isEqualTo(stored.toInstant());
    assertThat(stored.toInstant())
        .isBetween(
            dbBefore.plusSeconds(MailSendQueueService.SEND_UNDO_SECONDS).toInstant(),
            dbAfter.plusSeconds(MailSendQueueService.SEND_UNDO_SECONDS).toInstant());
  }

  /**
   * 보내기에는 본문 상한이 없다(최종 리뷰 I1) — 큰 HTML 메일에 답장·전달하면 인용한 원본이 붙어 임시저장 상한(2MB)을 넘을 수 있는데, 대기열에 담는
   * 길(upsertForSend)이 그 상한으로 막으면 예전엔 보내지던 메일이 거절된다.
   */
  @Test
  void enqueue_본문이_2MB_를_넘어도_대기열에_담긴다() {
    long me = user();
    long acc = account(me);
    String big = "<p>" + "a".repeat(MailDraftSaveRequest.MAX_BODY_HTML_BYTES + 10) + "</p>";
    MailSendRequest req =
        new MailSendRequest(
            List.of("peer@example.com"), List.of(), List.of(), "큰 본문", big, "큰 본문", null);

    QueuedSend q = queueService.enqueue(me, acc, req);

    assertThat(draftRepo.sendState(me, q.draftId())).contains("QUEUED");
    assertThat(
            dsl.select(MAIL_DRAFT.BODY_HTML)
                .from(MAIL_DRAFT)
                .where(MAIL_DRAFT.ID.eq(q.draftId()))
                .fetchOne(MAIL_DRAFT.BODY_HTML))
        .hasSize(big.length());
  }

  @Test
  void enqueue_받는사람_형식이_틀리면_400_이고_행이_생기지_않는다() {
    long me = user();
    long acc = account(me);
    MailSendRequest bad =
        new MailSendRequest(List.of("kim@"), List.of(), List.of(), "x", "<p>x</p>", "x", null);

    assertThatThrownBy(() -> queueService.enqueue(me, acc, bad))
        .isInstanceOf(MailValidationException.class);
    assertThat(draftCount(me)).isZero();
  }

  @Test
  void enqueue_뒤_cancel_하면_같은_받는사람_제목_본문_첨부로_상세가_돌아온다() {
    long me = user();
    long acc = account(me);
    long file = upload(me, "a.pdf", "application/pdf");
    long fwd = seedReceivedAttachment(acc, "fw", "application/pdf");
    MailSendRequest req =
        new MailSendRequest(
            List.of("peer@example.com"),
            List.of("cc@example.com"),
            List.of(),
            "제목",
            "<p>본문</p>",
            "본문",
            null,
            null,
            List.of(file),
            List.of(fwd));

    QueuedSend q = queueService.enqueue(me, acc, req);
    MailDraftDetail d = queueService.cancel(me, q.draftId());

    assertThat(d.id()).isEqualTo(q.draftId());
    assertThat(d.mode()).isEqualTo("forward");
    assertThat(d.to()).containsExactly("peer@example.com");
    assertThat(d.cc()).containsExactly("cc@example.com");
    assertThat(d.subject()).isEqualTo("제목");
    assertThat(d.bodyHtml()).isEqualTo("<p>본문</p>");
    assertThat(d.attachments()).extracting(MailDraftDetail.Attachment::id).contains(file, fwd);
    assertThat(draftRepo.sendState(me, q.draftId())).contains("");
  }

  /** 받은 메일 한 통의 email_message.id — 첨부 시드(seedReceivedAttachment)가 만든 메일을 그 첨부 id 로 찾는다. */
  private long messageOf(long attachmentId) {
    return dsl.select(EMAIL_ATTACHMENT.MESSAGE_ID)
        .from(EMAIL_ATTACHMENT)
        .where(EMAIL_ATTACHMENT.ID.eq(attachmentId))
        .fetchOne(EMAIL_ATTACHMENT.MESSAGE_ID);
  }

  /** 작성 문맥(mode·원본·인용문 지움)을 실은 보내기 요청(WP-1786). */
  private MailSendRequest withContext(
      Long inReplyTo, String mode, Long sourceMessageId, Boolean quoteRemoved) {
    return new MailSendRequest(
        List.of("peer@example.com"),
        List.of(),
        List.of(),
        "Fwd: 원본",
        "<p>참고</p><div class=\"wp_quote gmail_quote\"><hr><p>원본</p></div>",
        "참고",
        inReplyTo,
        null,
        null,
        null,
        null,
        null,
        mode,
        sourceMessageId,
        quoteRemoved,
        null);
  }

  @Test
  void enqueue_전달_작성_문맥을_실으면_되돌릴_때_mode_원본_인용문지움이_그대로_돌아온다() {
    long me = user();
    long acc = account(me);
    long src = messageOf(seedReceivedAttachment(acc, "fw-ctx", "application/pdf"));

    // 전달 첨부 없는 전달 — 추정이면 new·원본 없음이 되던 경우다.
    QueuedSend q = queueService.enqueue(me, acc, withContext(null, "forward", src, false));
    MailDraftDetail d = queueService.cancel(me, q.draftId());

    assertThat(d.mode()).isEqualTo("forward");
    assertThat(d.sourceMessageId()).isEqualTo(src);
    assertThat(d.quoteRemoved()).isFalse();
    assertThat(d.inReplyToMessageId()).isNull();
  }

  @Test
  void enqueue_인용문을_지운_답장은_quoteRemoved_가_남고_원본은_답장_대상이다() {
    long me = user();
    long acc = account(me);
    long src = messageOf(seedReceivedAttachment(acc, "re-ctx", "application/pdf"));

    QueuedSend q = queueService.enqueue(me, acc, withContext(src, "reply", src, true));
    MailDraftDetail d = queueService.cancel(me, q.draftId());

    assertThat(d.mode()).isEqualTo("reply");
    assertThat(d.sourceMessageId()).isEqualTo(src);
    assertThat(d.inReplyToMessageId()).isEqualTo(src);
    assertThat(d.quoteRemoved()).isTrue();
  }

  @Test
  void enqueue_작성_문맥이_없거나_모르는_mode_면_지금처럼_추정한다() {
    long me = user();
    long acc = account(me);

    QueuedSend unknown = queueService.enqueue(me, acc, withContext(null, "weird", null, null));
    MailDraftDetail d = queueService.cancel(me, unknown.draftId());

    assertThat(d.mode()).isEqualTo("new");
    assertThat(d.sourceMessageId()).isNull();
    assertThat(d.quoteRemoved()).isFalse();
  }

  @Test
  void enqueue_뒤_toSendRequest_는_원래_요청과_인라인_이미지_업로드_첨부가_같다() {
    long me = user();
    long acc = account(me);
    long plain = upload(me, "a.pdf", "application/pdf");
    long pasted = upload(me, "p.png", "image/png");
    long fwd = seedReceivedAttachment(acc, "fw2", "application/pdf");
    long quoted = seedReceivedAttachment(acc, "q2", "image/png");
    MailSendRequest req =
        new MailSendRequest(
            List.of("peer@example.com"),
            List.of(),
            List.of("bcc@example.com"),
            "제목",
            "<p>본문<img src=\"cid:p1\"></p>",
            "본문",
            null,
            List.of(new InlineImageRef(quoted, "q1")),
            List.of(plain, pasted),
            List.of(fwd),
            null,
            List.of(new InlineUploadRef(pasted, "p1")));

    QueuedSend q = queueService.enqueue(me, acc, req);
    QueuedRow row = claimedRow(q.draftId());
    MailSendRequest back = queueService.toSendRequest(row);

    assertThat(back.draftId()).isEqualTo(q.draftId());
    assertThat(back.to()).isEqualTo(req.to());
    assertThat(back.cc()).isEqualTo(req.cc());
    assertThat(back.bcc()).isEqualTo(req.bcc());
    assertThat(back.subject()).isEqualTo(req.subject());
    assertThat(back.bodyHtml()).isEqualTo(req.bodyHtml());
    assertThat(back.bodyText()).isEqualTo(req.bodyText());
    assertThat(back.inlineImages()).isEqualTo(req.inlineImages());
    assertThat(back.inlineUploads()).isEqualTo(req.inlineUploads());
    assertThat(back.attachmentIds()).containsExactlyInAnyOrder(plain, pasted);
    assertThat(back.forwardAttachmentIds()).containsExactly(fwd);
  }

  /** 기밀 표시(WP-2029) — 대기 행에 저장되고, 스케줄러용 요청으로 되돌려도·되돌리기 상세에도 남는다. */
  @Test
  void enqueue_기밀이면_대기_행과_toSendRequest_에_남는다() {
    long me = user();
    long acc = account(me);
    MailSendRequest req =
        new MailSendRequest(
            List.of("peer@example.com"),
            List.of(),
            List.of(),
            "제목",
            "<p>본문</p>",
            "본문",
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            true);

    QueuedSend q = queueService.enqueue(me, acc, req);

    assertThat(draftService.get(me, q.draftId()).confidential()).isTrue();
    assertThat(queueService.toSendRequest(claimedRow(q.draftId())).isConfidential()).isTrue();
  }

  @Test
  void cancel_기밀로_대기한_행은_되돌린_상세에도_기밀이다() {
    long me = user();
    long acc = account(me);
    MailSendRequest req =
        new MailSendRequest(
            List.of("peer@example.com"),
            List.of(),
            List.of(),
            "제목",
            "<p>본문</p>",
            "본문",
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            true);

    QueuedSend q = queueService.enqueue(me, acc, req);

    assertThat(queueService.cancel(me, q.draftId()).confidential()).isTrue();
  }

  @Test
  void enqueue_기밀_표시가_없으면_toSendRequest_는_기밀이_아니다() {
    long me = user();
    long acc = account(me);

    QueuedSend q = queueService.enqueue(me, acc, simple(null));

    assertThat(queueService.toSendRequest(claimedRow(q.draftId())).isConfidential()).isFalse();
  }

  @Test
  void cancel_SENDING_이면_409_ALREADY_SENDING() {
    long me = user();
    long acc = account(me);
    QueuedSend q = queueService.enqueue(me, acc, simple(null));
    dsl.update(MAIL_DRAFT)
        .set(MAIL_DRAFT.SEND_STATE, "SENDING")
        .where(MAIL_DRAFT.ID.eq(q.draftId()))
        .execute();

    assertThatThrownBy(() -> queueService.cancel(me, q.draftId()))
        .isInstanceOf(MailAlreadySendingException.class);
  }

  @Test
  void cancel_남의_것이거나_없으면_404_이고_이미_풀린_행은_상세를_그대로_돌려준다() {
    long me = user();
    long other = user();
    long acc = account(me);
    QueuedSend q = queueService.enqueue(me, acc, simple(null));

    assertThatThrownBy(() -> queueService.cancel(other, q.draftId()))
        .isInstanceOf(MailDraftNotFoundException.class);
    queueService.cancel(me, q.draftId());
    // 두 번째 되돌리기는 멱등 — 이미 일반 임시보관이라 상세를 그대로 준다
    assertThat(queueService.cancel(me, q.draftId()).id()).isEqualTo(q.draftId());
  }

  /**
   * 계정이 삭제 대기(disabled)여도 되돌리기는 대기를 풀고 상세를 돌려준다(코드 리뷰) — 예전에는 상세 읽기가 비활성 계정을 걸러 404 를 내며 대기 풀기까지
   * 롤백해, 사용자는 「이미 보냄」을 보는데 행은 QUEUED 로 남아 곧 보내졌다.
   */
  @Test
  void cancel_계정이_삭제_대기여도_대기가_풀리고_상세를_돌려준다() {
    long me = user();
    long acc = account(me);
    QueuedSend q = queueService.enqueue(me, acc, simple(null));
    dsl.update(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.DISABLED_AT, OffsetDateTime.now())
        .where(EMAIL_ACCOUNT.ID.eq(acc))
        .execute();

    MailDraftDetail d = queueService.cancel(me, q.draftId());

    assertThat(d.id()).isEqualTo(q.draftId());
    assertThat(d.subject()).isEqualTo("제목");
    // 대기가 풀려 일반 임시보관 — 스케줄러가 집지 않는다
    assertThat(draftRepo.sendState(me, q.draftId())).contains("");
    assertThat(
            dsl.select(MAIL_DRAFT.SEND_AT)
                .from(MAIL_DRAFT)
                .where(MAIL_DRAFT.ID.eq(q.draftId()))
                .fetchOne(MAIL_DRAFT.SEND_AT))
        .isNull();
  }

  /** 인라인 참조 목록은 요청 단계에서 100개 상한(코드 리뷰) — 보내기·임시저장 모두 400 이고 행이 생기지 않는다. */
  @Test
  void 인라인_참조가_100개를_넘으면_보내기와_임시저장이_400() throws Exception {
    long me = user();
    long acc = account(me);
    String bearer = "Bearer " + jwtTokenProvider.generateAccessToken(me, "u" + me, 1L);
    StringBuilder refs = new StringBuilder();
    for (int i = 0; i < 101; i++) {
      if (i > 0) {
        refs.append(',');
      }
      refs.append("{\"attachmentId\":")
          .append(i + 1)
          .append(",\"contentId\":\"c")
          .append(i)
          .append("\"}");
    }
    String sendJson =
        "{\"to\":[\"a@example.com\"],\"subject\":\"s\",\"bodyHtml\":\"<p>b</p>\",\"bodyText\":\"b\","
            + "\"inlineImages\":["
            + refs
            + "]}";
    String draftJson =
        "{\"accountId\":" + acc + ",\"subject\":\"s\",\"inlineUploads\":[" + refs + "]}";

    mockMvc
        .perform(
            post("/api/v1/mail/accounts/" + acc + "/send")
                .header("Authorization", bearer)
                .contentType(MediaType.APPLICATION_JSON)
                .content(sendJson))
        .andExpect(status().isBadRequest());
    mockMvc
        .perform(
            post("/api/v1/mail/drafts")
                .header("Authorization", bearer)
                .contentType(MediaType.APPLICATION_JSON)
                .content(draftJson))
        .andExpect(status().isBadRequest());
    TenantContext.set(1L);
    assertThat(draftCount(me)).isZero();
  }

  /** 이미 대기(QUEUED) 중인 임시보관으로 다시 보내면 409 DRAFT_SENDING — 같은 메일이 대기열에 두 번 오르지 않는다. */
  @Test
  void enqueue_이미_QUEUED_인_draftId_로_다시_보내면_409_DRAFT_SENDING() {
    long me = user();
    long acc = account(me);
    QueuedSend q = queueService.enqueue(me, acc, simple(null));

    assertThatThrownBy(() -> queueService.enqueue(me, acc, simple(q.draftId())))
        .isInstanceOf(MailDraftSendingException.class);
    assertThat(draftRepo.sendState(me, q.draftId())).contains("QUEUED");
    assertThat(draftCount(me)).isEqualTo(1);
  }

  /** 자동 저장된 임시보관의 draftId 로 보내면 새 행을 만들지 않고 그 행(같은 id)을 이어받아 QUEUED 로 올린다. */
  @Test
  void enqueue_자동저장된_draftId_는_그_행을_이어받아_QUEUED_로_올린다() {
    long me = user();
    long acc = account(me);
    long saved =
        draftService
            .create(
                me,
                new MailDraftSaveRequest(
                    acc,
                    "new",
                    List.of("old@example.com"),
                    List.of(),
                    List.of(),
                    "옛 제목",
                    "<p>옛</p>",
                    "옛",
                    null,
                    false,
                    List.of(),
                    List.of(),
                    null,
                    null,
                    null,
                    null,
                    null))
            .id();

    QueuedSend q = queueService.enqueue(me, acc, simple(saved));

    assertThat(q.draftId()).isEqualTo(saved);
    assertThat(draftCount(me)).isEqualTo(1);
    assertThat(draftRepo.sendState(me, saved)).contains("QUEUED");
    QueuedRow row = claimedRow(saved);
    assertThat(row.subject()).isEqualTo("제목");
    assertThat(row.to()).containsExactly("peer@example.com");
  }

  @Test
  void 컨트롤러_보내기_응답에_draftId_와_sendAt_이_있고_cancel_send_는_상세를_돌려준다() throws Exception {
    long me = user();
    long acc = account(me);
    String bearer = "Bearer " + jwtTokenProvider.generateAccessToken(me, "u" + me, 1L);
    String json =
        """
        {"to":["a@example.com"],"subject":"s","bodyHtml":"<p>b</p>","bodyText":"b"}
        """;

    String res =
        mockMvc
            .perform(
                post("/api/v1/mail/accounts/" + acc + "/send")
                    .header("Authorization", bearer)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(json))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.draftId").isNumber())
            .andExpect(jsonPath("$.sendAt").isNotEmpty())
            .andReturn()
            .getResponse()
            .getContentAsString();
    TenantContext.set(1L);
    long draftId = Long.parseLong(res.replaceAll(".*\"draftId\":(\\d+).*", "$1"));

    mockMvc
        .perform(
            post("/api/v1/mail/drafts/" + draftId + "/cancel-send").header("Authorization", bearer))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.id").value(draftId))
        .andExpect(jsonPath("$.subject").value("s"));
    TenantContext.set(1L);
  }
}
