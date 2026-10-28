package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.MAIL_DRAFT;
import static com.workplace.jooq.Tables.MAIL_DRAFT_ATTACHMENT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.workplace.action.ConfirmActionDispatcher;
import com.workplace.file.api.StagedFileClaimer;
import com.workplace.file.service.FileCleanupService;
import com.workplace.global.security.EncryptionService;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.MailSendRequest;
import com.workplace.mail.dto.ParsedAttachment;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.exception.MailSendException;
import com.workplace.mail.exception.MailValidationException;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.repository.EmailAttachmentRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.AccountPurgeService;
import com.workplace.mail.service.GraphTokenService;
import com.workplace.mail.service.MailComposeAttachmentService;
import com.workplace.mail.service.MailComposeService;
import com.workplace.mail.service.MailSentAttachmentRecorder;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.RequestBuilder;
import org.springframework.test.web.servlet.ResultActions;

/**
 * 메일 임시저장(WP-577) 통합 — REST CRUD·목록·개수·소유 404·버전 충돌 409·상한 400, 업로드 묶기(만료 스윕 생존·풀기·삭제 정리), draftId
 * 발송(성공 시 삭제·실패 시 유지·묶인 업로드 재사용·다른 임시저장 업로드 거절), AI 확인카드 draftId 거절, 계정 purge 정리.
 *
 * <p>만료 스윕·발송 단계별 트랜잭션은 커밋을 봐야 하므로 테스트 트랜잭션 없이 돈다({@link MailComposeSendIsolationTest} 와 같은 구성 —
 * Spring 컨텍스트 캐시를 공유한다). 시드는 {@link #cleanup} 에서 지운다.
 */
class MailDraftIntegrationTest extends ExternalClientMockedTestBase {

  @Autowired DSLContext dsl;
  @Autowired MockMvc mockMvc;
  @Autowired ObjectMapper om;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired MailComposeService composeService;
  @Autowired MailComposeAttachmentService uploadService;
  @Autowired StagedFileClaimer claimer;
  @Autowired EncryptionService encryption;
  @Autowired FileCleanupService fileCleanupService;
  @Autowired ConfirmActionDispatcher confirmDispatcher;
  @Autowired AccountPurgeService purgeService;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EmailAttachmentRepository attachmentRepo;

  @Autowired GraphApiClient graphApiClient;
  @Autowired GraphTokenService graphTokenService;
  @Autowired MailSentAttachmentRecorder recorder;

  private final List<Long> users = new ArrayList<>();

  @BeforeEach
  void tenant() {
    TenantContext.set(1L);
    when(graphTokenService.getAccessToken(anyLong(), anyLong())).thenReturn("FAKE_TOKEN");
  }

  /** file(uploaded_by) → 계정(메일·임시저장 CASCADE) → 사용자 순으로 정리. 정션은 file·임시저장 CASCADE. */
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

  // ---- 시드·요청 도우미 ----

  /** 테넌트#1 멤버 사용자(JWT 테넌트 해석용). */
  long user() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    users.add(id);
    return id;
  }

  /** 사용자의 Graph 계정(전송은 GraphApiClient 목). */
  long account(long user) {
    return MailTestSupport.seedGraphAccount(dsl, encryption, user);
  }

  long upload(long user, String name) {
    return uploadService
        .upload(user, new MockMultipartFile("file", name, "application/pdf", new byte[] {1, 2, 3}))
        .id();
  }

  /** 받은 메일 + 첨부 1건 — 전달 원본 후보. @return email_attachment.id */
  long seedReceivedAttachment(long accountId, String pmid, String filename) {
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
        messageId,
        contentId,
        0,
        new ParsedAttachment(filename, "application/pdf", 1234, null, "ATT-" + pmid));
    // insert 는 content_attachment id 를 돌려준다 — 전달 원본 참조는 email_attachment id 다
    return dsl.select(EMAIL_ATTACHMENT.ID)
        .from(EMAIL_ATTACHMENT)
        .where(EMAIL_ATTACHMENT.MESSAGE_ID.eq(messageId))
        .fetchOne(EMAIL_ATTACHMENT.ID);
  }

  String bearer(long uid) {
    return "Bearer " + jwtTokenProvider.generateAccessToken(uid, "u" + uid, 1L);
  }

  /** MockMvc 요청 — JwtAuthenticationFilter 가 지운 테스트 스레드의 TenantContext 를 되돌린다. */
  ResultActions http(RequestBuilder rb) throws Exception {
    try {
      return mockMvc.perform(rb);
    } finally {
      TenantContext.set(1L);
    }
  }

  /** 저장 요청 본문 — 필요한 필드만 덮어쓴다. */
  Map<String, Object> body(long accountId) {
    Map<String, Object> b = new LinkedHashMap<>();
    b.put("accountId", accountId);
    b.put("mode", "new");
    b.put("to", List.of("a@x.com"));
    b.put("cc", List.of());
    b.put("bcc", List.of());
    b.put("subject", "제목");
    b.put("bodyHtml", "<p>본문</p>");
    b.put("bodyText", "본문");
    return b;
  }

  ResultActions postDraft(long uid, Map<String, Object> b) throws Exception {
    return http(
        post("/api/v1/mail/drafts")
            .header("Authorization", bearer(uid))
            .contentType(MediaType.APPLICATION_JSON)
            .content(om.writeValueAsString(b)));
  }

  ResultActions putDraft(long uid, long id, Map<String, Object> b) throws Exception {
    return http(
        put("/api/v1/mail/drafts/" + id)
            .header("Authorization", bearer(uid))
            .contentType(MediaType.APPLICATION_JSON)
            .content(om.writeValueAsString(b)));
  }

  JsonNode json(ResultActions r) throws Exception {
    return om.readTree(r.andReturn().getResponse().getContentAsString());
  }

  /** 새 임시저장을 만들고 응답(id·version·updatedAt)을 돌려준다. */
  JsonNode create(long uid, Map<String, Object> b) throws Exception {
    return json(postDraft(uid, b).andExpect(status().isCreated()));
  }

  OffsetDateTime expiresAt(long fileId) {
    return dsl.select(FILE.EXPIRES_AT)
        .from(FILE)
        .where(FILE.ID.eq(fileId))
        .fetchOne(FILE.EXPIRES_AT);
  }

  boolean fileExists(long fileId) {
    return dsl.fetchExists(FILE, FILE.ID.eq(fileId));
  }

  boolean bound(long draftId, long fileId) {
    return dsl.fetchExists(
        MAIL_DRAFT_ATTACHMENT,
        MAIL_DRAFT_ATTACHMENT.DRAFT_ID.eq(draftId).and(MAIL_DRAFT_ATTACHMENT.FILE_ID.eq(fileId)));
  }

  boolean draftExists(long draftId) {
    return dsl.fetchExists(MAIL_DRAFT, MAIL_DRAFT.ID.eq(draftId));
  }

  static MailSendRequest sendRequest(List<Long> attachmentIds, Long draftId) {
    return new MailSendRequest(
        List.of("peer@example.com"),
        List.of(),
        List.of(),
        "보냄",
        "<p>본문</p>",
        "본문",
        null,
        null,
        attachmentIds,
        null,
        draftId);
  }

  // ---- CRUD ----

  /** 만들기 → 상세 → 수정(버전 증가) → 다시 상세 → 버리기 204 → 404. */
  @Test
  void crud_createGetUpdateDelete() throws Exception {
    long me = user();
    long acc = account(me);
    long acc2 = account2(me);
    Map<String, Object> b = body(acc);
    b.put("mode", "reply");
    b.put("cc", List.of("c@x.com"));
    b.put("bcc", List.of("d@x.com"));
    b.put("sourceMessageId", 777);
    b.put("quoteRemoved", true);

    JsonNode created = create(me, b);
    long id = created.get("id").asLong();
    assertThat(created.get("version").asInt()).isEqualTo(1);
    assertThat(created.get("updatedAt").asText()).isNotBlank();

    http(get("/api/v1/mail/drafts/" + id).header("Authorization", bearer(me)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.id").value(id))
        .andExpect(jsonPath("$.accountId").value(acc))
        .andExpect(jsonPath("$.mode").value("reply"))
        .andExpect(jsonPath("$.to[0]").value("a@x.com"))
        .andExpect(jsonPath("$.cc[0]").value("c@x.com"))
        .andExpect(jsonPath("$.bcc[0]").value("d@x.com"))
        .andExpect(jsonPath("$.subject").value("제목"))
        .andExpect(jsonPath("$.bodyHtml").value("<p>본문</p>"))
        .andExpect(jsonPath("$.sourceMessageId").value(777))
        .andExpect(jsonPath("$.quoteRemoved").value(true))
        .andExpect(jsonPath("$.attachments").isEmpty())
        .andExpect(jsonPath("$.version").value(1));

    // 수정 — 계정도 바꿀 수 있고, 자동 저장이라 형식이 틀린 주소도 받는다
    b.put("accountId", acc2);
    b.put("to", List.of("kim@"));
    b.put("subject", "고친 제목");
    b.put("version", 1);
    putDraft(me, id, b)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.version").value(2))
        .andExpect(jsonPath("$.updatedAt").isNotEmpty())
        .andExpect(jsonPath("$.id").doesNotExist());
    http(get("/api/v1/mail/drafts/" + id).header("Authorization", bearer(me)))
        .andExpect(jsonPath("$.accountId").value(acc2))
        .andExpect(jsonPath("$.to[0]").value("kim@"))
        .andExpect(jsonPath("$.subject").value("고친 제목"))
        .andExpect(jsonPath("$.version").value(2));

    http(delete("/api/v1/mail/drafts/" + id).header("Authorization", bearer(me)))
        .andExpect(status().isNoContent());
    // 없어진 임시저장의 404 는 errors.code=DRAFT_NOT_FOUND(웹이 「다른 곳에서 보냈거나 버린 메일」로 가린다), 문구에 id 가 없다
    http(get("/api/v1/mail/drafts/" + id).header("Authorization", bearer(me)))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.errors.code").value("DRAFT_NOT_FOUND"))
        .andExpect(jsonPath("$.message").value("임시저장을 찾을 수 없어요"));
    Map<String, Object> again = body(acc);
    again.put("version", 2);
    putDraft(me, id, again)
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.errors.code").value("DRAFT_NOT_FOUND"));
    http(delete("/api/v1/mail/drafts/" + id).header("Authorization", bearer(me)))
        .andExpect(status().isNotFound());
  }

  /** 같은 사용자의 두 번째 계정(주소 유일 제약을 피해 따로 넣는다). */
  long account2(long user) {
    return dsl.insertInto(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.USER_ID, user)
        .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, "second-" + user + "@example.com")
        .set(EMAIL_ACCOUNT.DISPLAY_NAME, "둘째")
        .set(EMAIL_ACCOUNT.PROVIDER, "M365_GRAPH")
        .set(EMAIL_ACCOUNT.OAUTH_REFRESH_TOKEN, encryption.encrypt("RT"))
        .set(EMAIL_ACCOUNT.OAUTH_TOKEN_EXPIRES_AT, OffsetDateTime.now().plusHours(1))
        .set(EMAIL_ACCOUNT.OAUTH_ACCESS_TOKEN, encryption.encrypt("FAKE_TOKEN"))
        .set(EMAIL_ACCOUNT.AI_ENABLED, false)
        .returning(EMAIL_ACCOUNT.ID)
        .fetchOne()
        .getId();
  }

  /** 빈 값 저장 — 자동 저장이라 받는사람·제목·본문이 비어도 저장된다(mode 생략은 new). */
  @Test
  void create_emptyValuesAllowed() throws Exception {
    long me = user();
    long acc = account(me);
    Map<String, Object> b = new LinkedHashMap<>();
    b.put("accountId", acc);

    long id = create(me, b).get("id").asLong();

    http(get("/api/v1/mail/drafts/" + id).header("Authorization", bearer(me)))
        .andExpect(jsonPath("$.mode").value("new"))
        .andExpect(jsonPath("$.to").isEmpty())
        .andExpect(jsonPath("$.subject").value(""))
        .andExpect(jsonPath("$.bodyHtml").value(""))
        .andExpect(jsonPath("$.quoteRemoved").value(false));
  }

  // ---- 목록·개수 ----

  /** 갱신 최신순, 필드(미리보기 120자·첨부 수), 다른 계정 임시저장은 빠진다. count 도 같은 기준. */
  @Test
  void list_sortedByUpdatedAtDesc_withFields_andCount() throws Exception {
    long me = user();
    long acc = account(me);
    long acc2 = account2(me);
    long up = upload(me, "a.pdf");
    long fwd = seedReceivedAttachment(acc, "L1", "원본.pdf");

    Map<String, Object> first = body(acc);
    first.put("subject", "첫째");
    first.put("bodyText", "  가나다\n\n" + "라".repeat(200));
    first.put("attachmentIds", List.of(up));
    first.put("forwardAttachmentIds", List.of(fwd));
    long firstId = create(me, first).get("id").asLong();
    Map<String, Object> second = body(acc);
    second.put("subject", "둘째");
    long secondId = create(me, second).get("id").asLong();
    create(me, body(acc2)); // 다른 계정 — 목록·개수에서 빠진다

    // 첫째를 고치면 맨 위로 올라온다
    first.put("version", 1);
    putDraft(me, firstId, first).andExpect(status().isOk());

    JsonNode list =
        json(
            http(get("/api/v1/mail/drafts")
                    .param("accountId", String.valueOf(acc))
                    .header("Authorization", bearer(me)))
                .andExpect(status().isOk()));
    assertThat(list).hasSize(2);
    JsonNode top = list.get(0);
    assertThat(top.get("id").asLong()).isEqualTo(firstId);
    assertThat(list.get(1).get("id").asLong()).isEqualTo(secondId);
    assertThat(top.get("accountId").asLong()).isEqualTo(acc);
    assertThat(top.get("mode").asText()).isEqualTo("new");
    assertThat(top.get("to").get(0).asText()).isEqualTo("a@x.com");
    // 목록 요약에는 참조·숨은참조가 없다(상세에서만 내려준다)
    assertThat(top.has("cc")).isFalse();
    assertThat(top.has("bcc")).isFalse();
    assertThat(top.get("subject").asText()).isEqualTo("첫째");
    String preview = top.get("preview").asText();
    assertThat(preview).startsWith("가나다 라");
    assertThat(preview.codePointCount(0, preview.length())).isEqualTo(120);
    assertThat(top.get("attachmentCount").asInt()).isEqualTo(2);
    assertThat(top.get("updatedAt").asText()).isNotBlank();
    // 본문 HTML 은 목록에 싣지 않는다
    assertThat(top.has("bodyHtml")).isFalse();

    http(get("/api/v1/mail/drafts/count")
            .param("accountId", String.valueOf(acc))
            .header("Authorization", bearer(me)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.count").value(2));
  }

  // ---- 소유 ----

  /** 남의 임시저장 id 는 상세·수정·삭제 모두 404, 남의 계정은 목록·개수·만들기 404. */
  @Test
  void othersDraftAndAccount_404() throws Exception {
    long owner = user();
    long ownerAcc = account(owner);
    long me = user();
    long myAcc = account(me);
    long theirs = create(owner, body(ownerAcc)).get("id").asLong();

    http(get("/api/v1/mail/drafts/" + theirs).header("Authorization", bearer(me)))
        .andExpect(status().isNotFound());
    // 내 계정으로 남의 임시저장 id 를 고치려 해도 404(409 로 존재를 드러내지 않는다)
    Map<String, Object> b = body(myAcc);
    b.put("version", 1);
    putDraft(me, theirs, b).andExpect(status().isNotFound());
    http(delete("/api/v1/mail/drafts/" + theirs).header("Authorization", bearer(me)))
        .andExpect(status().isNotFound());
    http(get("/api/v1/mail/drafts")
            .param("accountId", String.valueOf(ownerAcc))
            .header("Authorization", bearer(me)))
        .andExpect(status().isNotFound());
    http(get("/api/v1/mail/drafts/count")
            .param("accountId", String.valueOf(ownerAcc))
            .header("Authorization", bearer(me)))
        .andExpect(status().isNotFound());
    // 계정 404 는 임시저장 404 와 다른 응답 — DRAFT_NOT_FOUND 코드가 없다(웹이 일반 저장 실패로 다룬다)
    postDraft(me, body(ownerAcc))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.errors.code").doesNotExist());
    Map<String, Object> mineToOthersAccount = body(ownerAcc);
    mineToOthersAccount.put("version", 1);
    long mine = create(me, body(myAcc)).get("id").asLong();
    putDraft(me, mine, mineToOthersAccount)
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.errors.code").doesNotExist());

    // 주인의 임시저장은 그대로
    assertThat(draftExists(theirs)).isTrue();
  }

  // ---- 버전 충돌 ----

  /** 다른 탭이 먼저 저장해 버전이 달라지면 409 + errors.code=DRAFT_CONFLICT, 내용은 바뀌지 않는다. */
  @Test
  void update_staleVersion_409DraftConflict() throws Exception {
    long me = user();
    long acc = account(me);
    long id = create(me, body(acc)).get("id").asLong();
    Map<String, Object> tabA = body(acc);
    tabA.put("subject", "A 탭");
    tabA.put("version", 1);
    putDraft(me, id, tabA).andExpect(status().isOk());

    Map<String, Object> tabB = body(acc);
    tabB.put("subject", "B 탭");
    tabB.put("version", 1);
    putDraft(me, id, tabB)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("DRAFT_CONFLICT"))
        .andExpect(jsonPath("$.message").isNotEmpty());

    http(get("/api/v1/mail/drafts/" + id).header("Authorization", bearer(me)))
        .andExpect(jsonPath("$.subject").value("A 탭"))
        .andExpect(jsonPath("$.version").value(2));

    // version 없는 수정은 400
    Map<String, Object> noVersion = body(acc);
    putDraft(me, id, noVersion).andExpect(status().isBadRequest());
  }

  // ---- 상한 ----

  @Test
  void limits_400() throws Exception {
    long me = user();
    long acc = account(me);

    List<Map<String, Object>> bad = new ArrayList<>();
    Map<String, Object> tooMany = body(acc);
    tooMany.put("to", Collections.nCopies(101, "a@x.com"));
    bad.add(tooMany);
    Map<String, Object> longAddr = body(acc);
    longAddr.put("cc", List.of("a".repeat(321)));
    bad.add(longAddr);
    Map<String, Object> longSubject = body(acc);
    longSubject.put("subject", "가".repeat(501));
    bad.add(longSubject);
    Map<String, Object> bigBody = body(acc);
    // 한글 3바이트 × 70만 자 ≈ 2.1MB > 2MB(문자 수로는 상한 안)
    bigBody.put("bodyHtml", "가".repeat(700_000));
    bad.add(bigBody);
    Map<String, Object> badMode = body(acc);
    badMode.put("mode", "draft");
    bad.add(badMode);
    Map<String, Object> noAccount = body(acc);
    noAccount.remove("accountId");
    bad.add(noAccount);

    for (Map<String, Object> b : bad) {
      postDraft(me, b).andExpect(status().isBadRequest());
    }
    assertThat(dsl.fetchCount(MAIL_DRAFT, MAIL_DRAFT.USER_ID.eq(me))).isZero();
    // 상한 초과는 웹 저장 상태 줄에 그대로 보일 짧은 한국어 문구
    // (발송과 같은 MailComposeLimits 검사라 문구는 message 에 실린다)
    postDraft(me, tooMany).andExpect(jsonPath("$.message").value("받는사람이 너무 많아요"));
    postDraft(me, longSubject).andExpect(jsonPath("$.message").value("제목이 너무 길어요"));
    postDraft(me, longAddr).andExpect(jsonPath("$.message").value("주소가 너무 길어요"));

    // 상한 바로 아래는 저장된다
    Map<String, Object> edge = body(acc);
    edge.put("to", Collections.nCopies(100, "a".repeat(310) + "@x.com"));
    edge.put("subject", "가".repeat(500));
    edge.put("bodyHtml", "a".repeat(2 * 1024 * 1024));
    postDraft(me, edge).andExpect(status().isCreated());
  }

  // ---- 업로드 묶기 ----

  /** 저장에 묶인 업로드는 영구(만료 없음)라 만료 스윕에 살아남고 다른 곳에 클레임되지 않는다. 저장에서 빼면 다시 임시(24시간)로 풀려 만료 뒤 스윕이 지운다. */
  @Test
  void boundUpload_survivesSweep_releasedWhenRemoved() throws Exception {
    long me = user();
    long acc = account(me);
    long kept = upload(me, "keep.pdf");
    long dropped = upload(me, "drop.pdf");
    Map<String, Object> b = body(acc);
    b.put("attachmentIds", List.of(kept, dropped));
    long id = create(me, b).get("id").asLong();

    assertThat(expiresAt(kept)).isNull();
    assertThat(expiresAt(dropped)).isNull();
    fileCleanupService.cleanupExpiredFiles();
    assertThat(fileExists(kept)).isTrue();
    assertThat(fileExists(dropped)).isTrue();
    // 묶인 동안 다른 도메인(이슈 등)이 가져갈 수 없다
    assertThatThrownBy(
            () ->
                claimer.requireClaimable(me, List.of(kept), StagedFileClaimer.Retention.PERMANENT))
        .isInstanceOf(RuntimeException.class);

    http(get("/api/v1/mail/drafts/" + id).header("Authorization", bearer(me)))
        .andExpect(jsonPath("$.attachments.length()").value(2))
        .andExpect(jsonPath("$.attachments[0].id").value(kept))
        .andExpect(jsonPath("$.attachments[0].name").value("keep.pdf"))
        .andExpect(jsonPath("$.attachments[0].size").value(3))
        .andExpect(jsonPath("$.attachments[0].mimeType").value("application/pdf"))
        .andExpect(jsonPath("$.attachments[0].source").value("upload"));

    // 하나를 빼고 저장 → 풀림(임시 24시간, 정션 없음, 다시 클레임 가능)
    b.put("attachmentIds", List.of(kept));
    b.put("version", 1);
    putDraft(me, id, b).andExpect(status().isOk());
    assertThat(expiresAt(kept)).isNull();
    assertThat(bound(id, dropped)).isFalse();
    assertThat(expiresAt(dropped)).isAfter(OffsetDateTime.now().plusHours(23));
    assertThat(
            claimer.requireClaimable(me, List.of(dropped), StagedFileClaimer.Retention.PERMANENT))
        .hasSize(1);

    // 풀린 파일은 만료가 지나면 스윕이 지운다, 묶인 파일은 남는다
    dsl.update(FILE)
        .set(FILE.EXPIRES_AT, OffsetDateTime.now().minusMinutes(1))
        .where(FILE.ID.eq(dropped))
        .execute();
    fileCleanupService.cleanupExpiredFiles();
    assertThat(fileExists(dropped)).isFalse();
    assertThat(fileExists(kept)).isTrue();
  }

  /**
   * 임시저장을 버리면 묶인 업로드는 다시 임시(24시간)로 풀린다 — 웹의 「되돌리기」가 같은 업로드로 새 임시저장을 만들 수 있다. 되돌리지 않으면 만료 뒤 스윕이 지운다.
   */
  @Test
  void delete_releasesBoundUploads_undoRebinds_elseSweptAway() throws Exception {
    long me = user();
    long acc = account(me);
    long up = upload(me, "a.pdf");
    long other = upload(me, "b.pdf");
    Map<String, Object> b = body(acc);
    b.put("attachmentIds", List.of(up, other));
    long id = create(me, b).get("id").asLong();

    http(delete("/api/v1/mail/drafts/" + id).header("Authorization", bearer(me)))
        .andExpect(status().isNoContent());
    assertThat(expiresAt(up)).isAfter(OffsetDateTime.now().plusHours(23));
    assertThat(expiresAt(other)).isAfter(OffsetDateTime.now().plusHours(23));

    // 되돌리기 — 같은 내용·같은 업로드로 다시 만들면 201 이고 다시 영구로 묶인다
    b.put("attachmentIds", List.of(up));
    long restored = create(me, b).get("id").asLong();
    assertThat(bound(restored, up)).isTrue();
    assertThat(expiresAt(up)).isNull();

    // 되돌리지 않은 업로드는 만료가 지나면 스윕이 지운다
    dsl.update(FILE)
        .set(FILE.EXPIRES_AT, OffsetDateTime.now().minusMinutes(1))
        .where(FILE.ID.eq(other))
        .execute();
    fileCleanupService.cleanupExpiredFiles();
    assertThat(fileExists(other)).isFalse();
    assertThat(fileExists(up)).isTrue();
  }

  /**
   * 남의 업로드·남의 임시저장에 묶인 업로드·만료된 업로드는 저장에서 400 — 저장 전체가 롤백된다(버전도 그대로). 남의 임시저장에 묶인 파일은 옮겨 묶이지 않는다.
   */
  @Test
  void save_unusableUpload_400() throws Exception {
    long me = user();
    long acc = account(me);
    long other = user();
    long otherAcc = account(other);
    long theirs = upload(other, "theirs.pdf");
    long mine = upload(me, "mine.pdf");
    Map<String, Object> a = body(acc);
    a.put("attachmentIds", List.of(mine));
    long draftA = create(me, a).get("id").asLong();

    Map<String, Object> withTheirs = body(acc);
    withTheirs.put("attachmentIds", List.of(theirs));
    postDraft(me, withTheirs).andExpect(status().isBadRequest());

    // 남의 임시저장에 묶인 업로드 — 내 임시저장으로 옮겨 묶을 수 없다(400, 남의 묶임 유지, 내 저장은 롤백)
    Map<String, Object> theirDraft = body(otherAcc);
    theirDraft.put("attachmentIds", List.of(theirs));
    long theirDraftId = create(other, theirDraft).get("id").asLong();
    long draftB = create(me, body(acc)).get("id").asLong();
    Map<String, Object> b = body(acc);
    b.put("attachmentIds", List.of(theirs));
    b.put("subject", "바뀌면 안 됨");
    b.put("version", 1);
    putDraft(me, draftB, b).andExpect(status().isBadRequest());
    http(get("/api/v1/mail/drafts/" + draftB).header("Authorization", bearer(me)))
        .andExpect(jsonPath("$.version").value(1))
        .andExpect(jsonPath("$.subject").value("제목"));
    assertThat(bound(theirDraftId, theirs)).isTrue();
    assertThat(bound(draftA, mine)).isTrue();

    // 만료된 내 업로드도 400
    long expired = upload(me, "old.pdf");
    dsl.update(FILE)
        .set(FILE.EXPIRES_AT, OffsetDateTime.now().minusMinutes(1))
        .where(FILE.ID.eq(expired))
        .execute();
    Map<String, Object> withExpired = body(acc);
    withExpired.put("attachmentIds", List.of(expired));
    postDraft(me, withExpired).andExpect(status().isBadRequest());
  }

  /**
   * 같은 사용자의 다른 임시저장에 묶인 업로드를 저장에 실으면 400 이 아니라 이 임시저장으로 옮겨 묶는다 — 원래 임시저장에서는 빠지고 영구(만료 없음)로 남는다. 충돌
   * 뒤 내 내용을 새 임시저장으로 남길 때(POST)와 이미 있는 임시저장의 수정(PUT) 모두.
   */
  @Test
  void save_uploadBoundToMyOtherDraft_movesBinding() throws Exception {
    long me = user();
    long acc = account(me);
    long up = upload(me, "a.pdf");
    long keep = upload(me, "keep.pdf");
    Map<String, Object> a = body(acc);
    a.put("attachmentIds", List.of(up, keep));
    long draftA = create(me, a).get("id").asLong();

    // POST — 충돌 뒤 새 임시저장처럼 같은 업로드를 싣는다
    Map<String, Object> copy = body(acc);
    copy.put("attachmentIds", List.of(up));
    long draftB = create(me, copy).get("id").asLong();
    assertThat(bound(draftB, up)).isTrue();
    assertThat(bound(draftA, up)).isFalse();
    assertThat(bound(draftA, keep)).isTrue();
    assertThat(expiresAt(up)).isNull();
    http(get("/api/v1/mail/drafts/" + draftA).header("Authorization", bearer(me)))
        .andExpect(jsonPath("$.attachments.length()").value(1))
        .andExpect(jsonPath("$.attachments[0].id").value(keep));

    // PUT — 다른 임시저장(A)의 업로드를 옮겨 온다
    Map<String, Object> put = body(acc);
    put.put("attachmentIds", List.of(up, keep));
    put.put("version", 1);
    putDraft(me, draftB, put).andExpect(status().isOk());
    assertThat(bound(draftB, keep)).isTrue();
    assertThat(bound(draftA, keep)).isFalse();
    http(get("/api/v1/mail/drafts/" + draftB).header("Authorization", bearer(me)))
        .andExpect(jsonPath("$.attachments.length()").value(2));

    // 옮겨 온 업로드로 B 를 보낼 수 있다(B 에 묶였으므로 재사용)
    composeService.send(me, acc, sendRequest(List.of(up, keep), draftB));
    assertThat(draftExists(draftB)).isFalse();
    assertThat(draftExists(draftA)).isTrue();
  }

  /**
   * 다른 곳에서 버리거나 보낸 임시저장의 업로드로 draftId 없이 보낼 때 — 버린 것은 24시간 임시로 풀려 있어 그대로 보낼 수 있고, 보낸 것은 소비돼 400
   * 이다(웹이 「첨부를 다시 올려 주세요」 문구를 보여 준다).
   */
  @Test
  void sendWithoutDraft_afterDraftGoneElsewhere() throws Exception {
    long me = user();
    long acc = account(me);
    long discardedUp = upload(me, "d.pdf");
    Map<String, Object> d = body(acc);
    d.put("attachmentIds", List.of(discardedUp));
    long discarded = create(me, d).get("id").asLong();
    http(delete("/api/v1/mail/drafts/" + discarded).header("Authorization", bearer(me)))
        .andExpect(status().isNoContent());
    composeService.send(me, acc, sendRequest(List.of(discardedUp), null));

    long sentUp = upload(me, "s.pdf");
    Map<String, Object> s = body(acc);
    s.put("attachmentIds", List.of(sentUp));
    long sent = create(me, s).get("id").asLong();
    composeService.send(me, acc, sendRequest(List.of(sentUp), sent));
    assertThatThrownBy(() -> composeService.send(me, acc, sendRequest(List.of(sentUp), null)))
        .isInstanceOf(MailValidationException.class);
  }

  // ---- 전달 원본 첨부 ----

  /** 전달 원본은 내 메일 첨부만 남는다(남의 것은 버림). 원본 메일이 지워지면 상세·첨부 수에서 빠진다. */
  @Test
  void forwardAttachments_ownedOnly_droppedWhenSourceDeleted() throws Exception {
    long me = user();
    long acc = account(me);
    long other = user();
    long otherAcc = account(other);
    long mineFwd = seedReceivedAttachment(acc, "F1", "계약서.pdf");
    long theirsFwd = seedReceivedAttachment(otherAcc, "F2", "남의것.pdf");
    long up = upload(me, "up.pdf");
    Map<String, Object> b = body(acc);
    b.put("mode", "forward");
    b.put("attachmentIds", List.of(up));
    b.put("forwardAttachmentIds", List.of(mineFwd, theirsFwd));
    long id = create(me, b).get("id").asLong();

    http(get("/api/v1/mail/drafts/" + id).header("Authorization", bearer(me)))
        .andExpect(jsonPath("$.attachments.length()").value(2))
        .andExpect(jsonPath("$.attachments[0].id").value(mineFwd))
        .andExpect(jsonPath("$.attachments[0].name").value("계약서.pdf"))
        .andExpect(jsonPath("$.attachments[0].size").value(1234))
        .andExpect(jsonPath("$.attachments[0].source").value("forward"))
        .andExpect(jsonPath("$.attachments[1].id").value(up))
        .andExpect(jsonPath("$.attachments[1].source").value("upload"));

    // PUT 응답의 첨부 수는 서버가 정한 값 — 남의 전달 원본은 다시 실어도 버려져 세지 않는다(웹이 목록 행을 이 값으로 고친다)
    b.put("version", 1);
    putDraft(me, id, b).andExpect(jsonPath("$.attachmentCount").value(2));
    b.put("version", 2);
    b.put("forwardAttachmentIds", List.of());
    putDraft(me, id, b).andExpect(jsonPath("$.attachmentCount").value(1));
    b.put("version", 3);
    b.put("forwardAttachmentIds", List.of(mineFwd, theirsFwd));
    putDraft(me, id, b).andExpect(jsonPath("$.attachmentCount").value(2));

    // 원본 메일 삭제 → email_attachment CASCADE → 임시저장에서 빠진다
    dsl.deleteFrom(EMAIL_MESSAGE).where(EMAIL_MESSAGE.ACCOUNT_ID.eq(acc)).execute();
    http(get("/api/v1/mail/drafts/" + id).header("Authorization", bearer(me)))
        .andExpect(jsonPath("$.attachments.length()").value(1))
        .andExpect(jsonPath("$.attachments[0].source").value("upload"));
    http(get("/api/v1/mail/drafts")
            .param("accountId", String.valueOf(acc))
            .header("Authorization", bearer(me)))
        .andExpect(jsonPath("$[0].attachmentCount").value(1));
  }

  // ---- draftId 발송 ----

  /**
   * 임시저장에 묶인 업로드로 발송 — 사전검증·발송 모두 통과하고, 성공하면 임시저장이 지워진다. 보낸 업로드는 사용 완료(만료), 보내지 않은 묶인 업로드도 만료된다.
   */
  @Test
  void sendWithDraft_usesBoundUpload_deletesDraftOnSuccess() throws Exception {
    long me = user();
    long acc = account(me);
    long sent = upload(me, "sent.pdf");
    long unsent = upload(me, "unsent.pdf");
    Map<String, Object> b = body(acc);
    b.put("attachmentIds", List.of(sent, unsent));
    long id = create(me, b).get("id").asLong();
    long fresh = upload(me, "fresh.pdf"); // 아직 저장 전에 올린 업로드도 함께 보낼 수 있다

    composeService.validateSendable(me, acc, sendRequest(List.of(sent, fresh), id));
    composeService.send(me, acc, sendRequest(List.of(sent, fresh), id));

    org.mockito.Mockito.verify(graphApiClient).sendMail(anyString(), anyString());
    assertThat(draftExists(id)).isFalse();
    assertThat(expiresAt(sent)).isBeforeOrEqualTo(OffsetDateTime.now());
    assertThat(expiresAt(fresh)).isBeforeOrEqualTo(OffsetDateTime.now());
    assertThat(expiresAt(unsent)).isBeforeOrEqualTo(OffsetDateTime.now());
    fileCleanupService.cleanupExpiredFiles();
    assertThat(fileExists(sent)).isFalse();
    assertThat(fileExists(unsent)).isFalse();
  }

  /** 전송이 실패하면 임시저장은 남고, 묶인 업로드는 보류에서 원래 상태(영구·ATTACHMENT·묶임)로 돌아온다 — 같은 임시저장으로 다시 보낼 수 있다. */
  @Test
  void sendWithDraft_transmitFails_keepsDraftAndBinding() throws Exception {
    long me = user();
    long acc = account(me);
    long up = upload(me, "a.pdf");
    Map<String, Object> b = body(acc);
    b.put("attachmentIds", List.of(up));
    long id = create(me, b).get("id").asLong();
    doThrow(new MailSendException("Graph sendMail 실패: 503"))
        .when(graphApiClient)
        .sendMail(any(), any());

    assertThatThrownBy(() -> composeService.send(me, acc, sendRequest(List.of(up), id)))
        .isInstanceOf(MailSendException.class);

    assertThat(draftExists(id)).isTrue();
    assertThat(bound(id, up)).isTrue();
    var row = dsl.selectFrom(FILE).where(FILE.ID.eq(up)).fetchOne();
    assertThat(row.getExpiresAt()).isNull();
    assertThat(row.getCategory()).isEqualTo(StagedFileClaimer.CATEGORY_ATTACHMENT);
    fileCleanupService.cleanupExpiredFiles();
    assertThat(fileExists(up)).isTrue();

    // 다시 보내면 성공하고 정리된다
    org.mockito.Mockito.reset(graphApiClient);
    composeService.send(me, acc, sendRequest(List.of(up), id));
    assertThat(draftExists(id)).isFalse();
  }

  /** 발송 실패 사이에 임시저장이 버려졌으면, 보류를 되돌린 영구 업로드가 고아로 남지 않게 다시 임시로 만든다. */
  @Test
  void sendWithDraft_failsAfterDraftDiscarded_uploadNotOrphaned() throws Exception {
    long me = user();
    long acc = account(me);
    long up = upload(me, "a.pdf");
    Map<String, Object> b = body(acc);
    b.put("attachmentIds", List.of(up));
    long id = create(me, b).get("id").asLong();
    // 전송 중에 다른 탭이 임시저장을 버린다 → 그다음 전송 실패
    org.mockito.Mockito.doAnswer(
            inv -> {
              http(delete("/api/v1/mail/drafts/" + id).header("Authorization", bearer(me)))
                  .andExpect(status().isNoContent());
              throw new MailSendException("Graph sendMail 실패: 503");
            })
        .when(graphApiClient)
        .sendMail(any(), any());

    assertThatThrownBy(() -> composeService.send(me, acc, sendRequest(List.of(up), id)))
        .isInstanceOf(MailSendException.class);

    assertThat(draftExists(id)).isFalse();
    assertThat(expiresAt(up)).isNotNull();
  }

  /**
   * 내 다른 임시저장에 묶인 업로드도 보낼 수 있다(저장의 옮겨 묶기와 같은 규칙) — draftId 가 다른 임시저장이든 없든. 보낸 업로드는 원래 임시저장 정션에서도
   * 빠진다(사라질 파일을 첨부로 들고 있지 않게).
   */
  @Test
  void sendWithUploadOfMyOtherDraft_allowed_unboundEverywhere() throws Exception {
    long me = user();
    long acc = account(me);
    long up = upload(me, "a.pdf");
    long up2 = upload(me, "b.pdf");
    long keep = upload(me, "keep.pdf");
    Map<String, Object> a = body(acc);
    a.put("attachmentIds", List.of(up, up2, keep));
    long draftA = create(me, a).get("id").asLong();
    long draftB = create(me, body(acc)).get("id").asLong();

    // 다른 임시저장(B)을 이어받아 A 에 묶인 업로드를 보낸다
    composeService.validateSendable(me, acc, sendRequest(List.of(up), draftB));
    composeService.send(me, acc, sendRequest(List.of(up), draftB));
    assertThat(draftExists(draftB)).isFalse();
    assertThat(bound(draftA, up)).isFalse();
    assertThat(expiresAt(up)).isBeforeOrEqualTo(OffsetDateTime.now());

    // 임시저장 없이(draftId 없음) A 에 묶인 업로드를 보낸다
    composeService.send(me, acc, sendRequest(List.of(up2), null));
    assertThat(bound(draftA, up2)).isFalse();
    // 보내지 않은 업로드는 A 에 그대로
    assertThat(bound(draftA, keep)).isTrue();
    assertThat(expiresAt(keep)).isNull();
    http(get("/api/v1/mail/drafts/" + draftA).header("Authorization", bearer(me)))
        .andExpect(jsonPath("$.attachments.length()").value(1))
        .andExpect(jsonPath("$.attachments[0].id").value(keep));
  }

  /**
   * 충돌 중 보내기(웹은 draftId 없이 보낸다) — 다른 탭이 더 새로 저장한 임시저장은 지우지 않고, 그 임시저장에 묶인 내 업로드로도 보낼 수 있으며, 보낸 업로드는
   * 그 임시저장 정션에서 빠진다(나머지 내용·업로드는 그대로).
   */
  @Test
  void sendInConflict_withoutDraftId_keepsNewerDraft_unbindsSentUploads() throws Exception {
    long me = user();
    long acc = account(me);
    long up = upload(me, "a.pdf");
    long keep = upload(me, "keep.pdf");
    Map<String, Object> b = body(acc);
    b.put("attachmentIds", List.of(up, keep));
    long id = create(me, b).get("id").asLong();
    // 다른 탭이 먼저 고쳐 버전 2 — 이 탭은 충돌 상태
    Map<String, Object> other = body(acc);
    other.put("subject", "다른 탭 제목");
    other.put("attachmentIds", List.of(up, keep));
    other.put("version", 1);
    putDraft(me, id, other).andExpect(status().isOk());

    composeService.validateSendable(me, acc, sendRequest(List.of(up), null));
    composeService.send(me, acc, sendRequest(List.of(up), null));

    assertThat(draftExists(id)).isTrue();
    assertThat(bound(id, up)).isFalse();
    assertThat(bound(id, keep)).isTrue();
    http(get("/api/v1/mail/drafts/" + id).header("Authorization", bearer(me)))
        .andExpect(jsonPath("$.subject").value("다른 탭 제목"))
        .andExpect(jsonPath("$.version").value(2))
        .andExpect(jsonPath("$.attachments.length()").value(1));
  }

  /** 남의 임시저장에 묶인 업로드로는 보낼 수 없다 — draftId 가 그 임시저장이든 내 것이든 사전검증·발송 모두 400, 아무것도 바뀌지 않는다. */
  @Test
  void sendWithUploadOfOthersDraft_rejected() throws Exception {
    long me = user();
    long acc = account(me);
    long other = user();
    long otherAcc = account(other);
    long draftA = create(me, body(acc)).get("id").asLong();
    long theirsUp = upload(other, "t.pdf");
    Map<String, Object> t = body(otherAcc);
    t.put("attachmentIds", List.of(theirsUp));
    long theirsDraft = create(other, t).get("id").asLong();

    for (MailSendRequest req :
        List.of(
            sendRequest(List.of(theirsUp), theirsDraft),
            sendRequest(List.of(theirsUp), draftA),
            sendRequest(List.of(theirsUp), null))) {
      assertThatThrownBy(() -> composeService.validateSendable(me, acc, req))
          .isInstanceOf(MailValidationException.class);
      assertThatThrownBy(() -> composeService.send(me, acc, req))
          .isInstanceOf(MailValidationException.class);
    }
    org.mockito.Mockito.verify(graphApiClient, org.mockito.Mockito.never())
        .sendMail(anyString(), anyString());
    assertThat(bound(theirsDraft, theirsUp)).isTrue();
    assertThat(expiresAt(theirsUp)).isNull();
    assertThat(draftExists(draftA)).isTrue();
  }

  /** 발송도 임시저장과 같은 상한(받는사람 100·주소 320자·제목 500자)으로 거른다 — 저장은 되는데 발송만 되거나 그 반대가 없다. */
  @Test
  void send_sameLimitsAsDraft() {
    long me = user();
    long acc = account(me);
    List<MailSendRequest> bad =
        List.of(
            new MailSendRequest(
                Collections.nCopies(101, "a@x.com"),
                List.of(),
                List.of(),
                "s",
                "<p>b</p>",
                "b",
                null),
            new MailSendRequest(
                List.of("a@x.com"),
                List.of(),
                Collections.nCopies(101, "b@x.com"),
                "s",
                "<p>b</p>",
                "b",
                null),
            new MailSendRequest(
                List.of("a".repeat(315) + "@x.com"),
                List.of(),
                List.of(),
                "s",
                "<p>b</p>",
                "b",
                null),
            new MailSendRequest(
                List.of("a@x.com"), List.of(), List.of(), "가".repeat(501), "<p>b</p>", "b", null));
    List<String> messages = List.of("받는사람이 너무 많아요", "숨은참조가 너무 많아요", "주소가 너무 길어요", "제목이 너무 길어요");
    for (int i = 0; i < bad.size(); i++) {
      MailSendRequest req = bad.get(i);
      assertThatThrownBy(() -> composeService.validateSendable(me, acc, req))
          .isInstanceOf(MailValidationException.class)
          .hasMessage(messages.get(i));
    }
    org.mockito.Mockito.verify(graphApiClient, org.mockito.Mockito.never())
        .sendMail(anyString(), anyString());
    // 상한 바로 아래는 통과한다
    composeService.validateSendable(
        me,
        acc,
        new MailSendRequest(
            Collections.nCopies(100, "a@x.com"),
            List.of(),
            List.of(),
            "가".repeat(500),
            "<p>b</p>",
            "b",
            null));
  }

  /** 남의 임시저장 id 를 draftId 로 보내도 그 임시저장은 지워지지 않는다(없는 것처럼 보낸다). */
  @Test
  void sendWithOthersDraftId_doesNotDeleteIt() throws Exception {
    long me = user();
    long acc = account(me);
    long other = user();
    long theirsDraft = create(other, body(account(other))).get("id").asLong();

    composeService.send(me, acc, sendRequest(List.of(), theirsDraft));

    assertThat(draftExists(theirsDraft)).isTrue();
  }

  // ---- AI 확인카드 ----

  /** AI 확인카드 mail.send 는 draftId 를 받지 않는다(모르는 필드 거절) — 사전검증·승인 모두. */
  @Test
  void confirmCard_mailSend_rejectsDraftId() throws Exception {
    long me = user();
    long acc = account(me);
    long id = create(me, body(acc)).get("id").asLong();
    ObjectNode p = om.createObjectNode();
    p.put("accountId", acc);
    p.putArray("to").add("rcpt@test.local");
    p.put("subject", "x");
    p.put("bodyText", "x");
    p.put("draftId", id);

    assertThatThrownBy(() -> confirmDispatcher.validate(me, "mail.send", p))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("draftId");
    assertThatThrownBy(() -> confirmDispatcher.confirm(me, "mail.send", p))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(draftExists(id)).isTrue();
  }

  // ---- 계정 purge ----

  /** 계정 하드 삭제는 임시저장을 CASCADE 로 지우고, 묶인 업로드는 먼저 만료시켜 스윕이 지우게 한다(영구 고아 방지). */
  @Test
  void accountPurge_removesDraftsAndExpiresBoundUploads() throws Exception {
    long me = user();
    long acc = account(me);
    long up = upload(me, "a.pdf");
    Map<String, Object> b = body(acc);
    b.put("attachmentIds", List.of(up));
    long id = create(me, b).get("id").asLong();

    purgeService.purgeAccount(me, acc);

    assertThat(draftExists(id)).isFalse();
    assertThat(expiresAt(up)).isBeforeOrEqualTo(OffsetDateTime.now());
    fileCleanupService.cleanupExpiredFiles();
    assertThat(fileExists(up)).isFalse();
  }
}
