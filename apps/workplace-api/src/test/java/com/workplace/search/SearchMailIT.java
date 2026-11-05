package com.workplace.search;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.security.EncryptionService;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.MailTestPorts;
import com.workplace.mail.dto.EmailAccountRequest;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.dto.OutgoingMail;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * 통합 검색 팔레트(WP-1359)의 전 메일함 메일 검색 — 받은편지함·보낸편지함(앱 기록 + 서버 사본 중복 제거)·보관함·사용자 메일함을 내 모든 계정에서 최신순으로
 * 합치고, 휴지통 이름 메일함·남의 계정은 빼며, 커서 쪽 나누기·보낸편지함 받는 사람·짧은 검색어·size 범위를 검증한다.
 */
@Transactional
class SearchMailIT extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired EncryptionService encryption;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired EmailMessageRepository messageRepo;

  private final AtomicLong uid = new AtomicLong(1);
  private final Instant base = Instant.parse("2026-10-01T00:00:00Z");

  private long me;
  private long other;
  private String word;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    word = "zq" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    me = withMembership(TestFixtures.createHuman(dsl));
    other = withMembership(TestFixtures.createHuman(dsl));
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  /** 사용자의 IMAP 계정 하나를 만든다 → 계정 id. */
  private long account(long user, String address) {
    EmailAccountRequest req =
        new EmailAccountRequest(
            address,
            "나",
            "127.0.0.1",
            MailTestPorts.IMAP,
            MailSecurity.NONE,
            address,
            "127.0.0.1",
            MailTestPorts.SMTP,
            MailSecurity.NONE,
            address,
            "pw",
            false);
    return accountRepo.insert(user, req, encryption.encrypt("pw"));
  }

  /** 동기화로 받은 메일 한 통(본문 적재 전 — 제목 부분 일치로 찾힌다). minute 는 기준 시각부터의 분(클수록 최신). */
  private long synced(
      long accountId, long folderId, String subject, int minute, String messageId, String to) {
    Instant at = base.plusSeconds(minute * 60L);
    ParsedMessage m =
        new ParsedMessage(
            uid.getAndIncrement(),
            messageId,
            messageId == null ? "t-" + UUID.randomUUID() : messageId,
            null,
            null,
            "sender@test.local",
            "보낸이",
            to,
            null,
            subject,
            at,
            at,
            false,
            false,
            null,
            null,
            null,
            List.of());
    return messageRepo.insertIgnoreConflict(accountId, folderId, m).orElseThrow();
  }

  /** 앱이 보낸 메일 한 통(로컬 SENT — 본문 적재됨, FTS 로 찾힌다). */
  private long appSent(
      long accountId,
      long folderId,
      String subject,
      int minute,
      String messageId,
      List<String> to) {
    return messageRepo.insertSent(
        accountId,
        folderId,
        new OutgoingMail(
            messageId,
            messageId,
            "me@test.local",
            "나",
            to,
            List.of(),
            List.of(),
            subject,
            "본문",
            "<p>본문</p>",
            null,
            null,
            "본문",
            base.plusSeconds(minute * 60L),
            List.of(),
            List.of()));
  }

  private long serverBox(long accountId, String name, String display, String role) {
    return folderRepo
        .upsertServerFolder(accountId, name, name, display, role, true, null, null, null)
        .orElseThrow();
  }

  @Test
  void searchesAllMyFoldersNewestFirst() throws Exception {
    long acc = account(me, "me@test.local");
    long acc2 = account(me, "me2@test.local");
    long inbox = folderRepo.ensureFolder(acc, "INBOX").id();
    long inbox2 = folderRepo.ensureFolder(acc2, "INBOX").id();
    long sent = folderRepo.ensureFolder(acc, "SENT").id();
    long serverSent = folderRepo.ensureServerSentFolder(acc, "Sent").orElseThrow().id();
    long archive = serverBox(acc, "Archive", "Archive", "ARCHIVE");
    long custom = serverBox(acc, "고객사/거래처", "거래처", "USER");
    long trashLike = serverBox(acc, "고객사/Trash", "Trash", "USER");
    long otherAcc = account(other, "other@test.local");
    long otherInbox = folderRepo.ensureFolder(otherAcc, "INBOX").id();

    long mInbox = synced(acc, inbox, "견적 " + word + " 받은", 10, null, null);
    long mInbox2 = synced(acc2, inbox2, "견적 " + word + " 둘째 계정", 20, null, null);
    long mApp =
        appSent(
            acc,
            sent,
            "견적 " + word + " 앱 발송",
            30,
            "app1@test.local",
            List.of("\"김철수\" <kim@test.local>", "lee@test.local", "choi@test.local"));
    // 앱 발송본의 서버 사본(같은 Message-ID, 꺾쇠 포함) — 메일함 화면처럼 가려진다.
    synced(acc, serverSent, "견적 " + word + " 앱 발송", 31, "<app1@test.local>", null);
    long mExt =
        synced(acc, serverSent, "견적 " + word + " 외부 발송", 40, "ext1@test.local", "park@test.local");
    long mArchive = synced(acc, archive, "견적 " + word + " 보관", 50, null, null);
    long mCustom = synced(acc, custom, "견적 " + word + " 거래처", 60, null, null);
    synced(acc, trashLike, "견적 " + word + " 휴지통 이름", 70, null, null);
    synced(otherAcc, otherInbox, "견적 " + word + " 남의 메일", 80, null, null);
    synced(acc, inbox, "상관없는 제목", 90, null, null);

    JsonNode r = search(me, word, null, null, null);
    JsonNode items = r.get("items");

    assertThat(ids(items)).containsExactly(mCustom, mArchive, mExt, mApp, mInbox2, mInbox);
    assertThat(r.get("hasMore").asBoolean()).isFalse();

    JsonNode custom0 = items.get(0);
    assertThat(custom0.get("folderKind").asText()).isEqualTo("OTHER");
    assertThat(custom0.get("folderId").asLong()).isEqualTo(custom);
    assertThat(custom0.get("folderName").asText()).isEqualTo("거래처");
    assertThat(custom0.get("firstRecipient").isNull()).isTrue();
    assertThat(custom0.get("recipientCount").asInt()).isZero();
    assertThat(custom0.get("fromName").asText()).isEqualTo("보낸이");
    assertThat(custom0.get("accountId").asLong()).isEqualTo(acc);

    assertThat(items.get(1).get("folderName").asText()).isEqualTo("보관");
    assertThat(items.get(1).get("folderId").asLong()).isEqualTo(archive);

    // 서버 보낸편지함(외부 발송) — 보낸편지함으로 묶이고 folderId 는 비운다.
    JsonNode ext = items.get(2);
    assertThat(ext.get("folderKind").asText()).isEqualTo("SENT");
    assertThat(ext.get("folderName").asText()).isEqualTo("보낸편지함");
    assertThat(ext.get("folderId").isNull()).isTrue();
    assertThat(ext.get("firstRecipient").asText()).isEqualTo("park@test.local");
    assertThat(ext.get("recipientCount").asInt()).isEqualTo(1);

    // 앱 발송 기록 — 첫 받는 사람은 이름, 수는 to 전체.
    JsonNode app = items.get(3);
    assertThat(app.get("folderKind").asText()).isEqualTo("SENT");
    assertThat(app.get("folderName").asText()).isEqualTo("보낸편지함");
    assertThat(app.get("firstRecipient").asText()).isEqualTo("김철수");
    assertThat(app.get("recipientCount").asInt()).isEqualTo(3);

    JsonNode in = items.get(5);
    assertThat(in.get("folderKind").asText()).isEqualTo("INBOX");
    assertThat(in.get("folderName").asText()).isEqualTo("받은편지함");
    assertThat(in.get("folderId").isNull()).isTrue();
    assertThat(in.get("subject").asText()).isEqualTo("견적 " + word + " 받은");
    assertThat(in.get("receivedAt").asText()).isNotBlank();
  }

  @Test
  void pagesWithCursorAndHasMore() throws Exception {
    long acc = account(me, "me@test.local");
    long inbox = folderRepo.ensureFolder(acc, "INBOX").id();
    long custom = serverBox(acc, "프로젝트", "프로젝트", "USER");
    List<Long> expected = new ArrayList<>();
    for (int i = 0; i < 5; i++) {
      expected.add(0, synced(acc, i % 2 == 0 ? inbox : custom, word + " " + i, i, null, null));
    }

    JsonNode p1 = search(me, word, null, null, 3);
    assertThat(ids(p1.get("items"))).containsExactlyElementsOf(expected.subList(0, 3));
    assertThat(p1.get("hasMore").asBoolean()).isTrue();

    JsonNode last = p1.get("items").get(2);
    JsonNode p2 = search(me, word, last.get("receivedAt").asText(), last.get("id").asLong(), 3);
    assertThat(ids(p2.get("items"))).containsExactlyElementsOf(expected.subList(3, 5));
    assertThat(p2.get("hasMore").asBoolean()).isFalse();
  }

  @Test
  void shortQueryEmpty() throws Exception {
    long acc = account(me, "me@test.local");
    long inbox = folderRepo.ensureFolder(acc, "INBOX").id();
    synced(acc, inbox, "a 제목", 1, null, null);

    JsonNode r = search(me, " a ", null, null, null);

    assertThat(r.get("items")).isEmpty();
    assertThat(r.get("hasMore").asBoolean()).isFalse();
  }

  @Test
  void noAccountEmpty() throws Exception {
    JsonNode r = search(me, word, null, null, null);
    assertThat(r.get("items")).isEmpty();
  }

  @Test
  void invalidSize_is400() throws Exception {
    call(get("/api/v1/search/mail").param("q", word).param("size", "0"), me)
        .andExpect(status().isBadRequest());
    call(get("/api/v1/search/mail").param("q", word).param("size", "51"), me)
        .andExpect(status().isBadRequest());
  }

  private static List<Long> ids(JsonNode items) {
    List<Long> out = new ArrayList<>();
    items.forEach(i -> out.add(i.get("id").asLong()));
    return out;
  }

  private JsonNode search(long user, String q, String beforeAt, Long beforeId, Integer size)
      throws Exception {
    MockHttpServletRequestBuilder req = get("/api/v1/search/mail").param("q", q);
    if (beforeAt != null) req.param("beforeAt", beforeAt);
    if (beforeId != null) req.param("beforeId", "" + beforeId);
    if (size != null) req.param("size", "" + size);
    ResultActions r = call(req, user).andExpect(status().isOk());
    return om.readTree(r.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
  }

  private ResultActions call(MockHttpServletRequestBuilder req, long userId) throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(userId, "u-" + userId, 1L));
    ResultActions r = mvc.perform(req);
    TenantContext.set(1L);
    return r;
  }
}
