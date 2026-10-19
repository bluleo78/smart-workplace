package com.workplace.file.controller;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.STAGED_UPLOAD_LINK;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.head;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.file.api.StagedFileClaimer;
import com.workplace.file.exception.StagedFileUnusableException;
import com.workplace.file.service.FileCleanupService;
import com.workplace.file.service.StagedUploadService;
import com.workplace.file.storage.FileStore;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.jooq.tables.records.FileRecord;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 스테이징 업로드 API(WP-421) 통합 테스트 — 텍스트로 임시 첨부 만들기, 일회용 PUT 링크 발급·익명 PUT, 만료 정리, 클레임 소유자 검사.
 *
 * <p>{@code PublicDriveTransferControllerIntegrationTest} 처럼 일부러 {@code @Transactional} 을 달지 않는다 —
 * 공개 PUT 에는 테넌트 컨텍스트가 없다는 실제 조건(소비가 SECURITY DEFINER 함수로 RLS 를 우회해야 하는 이유)과, 소비가 뒤이은 실패와 함께 롤백되지
 * 않는지를 보려면 시드를 커밋해야 한다. 정리는 {@link #cleanup} 이 한다(링크 행은 사용자 삭제로 FK CASCADE).
 */
class StagedUploadIntegrationTest extends IntegrationTestBase {
  @Autowired MockMvc mockMvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired ObjectMapper objectMapper;
  @Autowired FileCleanupService fileCleanupService;
  @Autowired StagedFileClaimer claimer;
  @Autowired StagedUploadService stagedUploadService;
  @Autowired FileStore fileStore;

  private static final String BASE = "http://localhost:6173";

  private final List<Long> userIds = new ArrayList<>();
  private long owner;
  private long other;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    try {
      new TransactionTemplate(txManager)
          .executeWithoutResult(
              st -> {
                owner = withMembership(TestFixtures.createHuman(dsl));
                other = withMembership(TestFixtures.createHuman(dsl));
              });
      userIds.add(owner);
      userIds.add(other);
    } finally {
      // 공개 요청은 컨텍스트 없이 들어온다 — 시드 컨텍스트를 남기지 않는다.
      TenantContext.clear();
    }
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          dsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(userIds)).execute();
          dsl.deleteFrom(FILE).where(FILE.UPLOADED_BY.in(userIds)).execute();
          // 사용자 삭제가 staged_upload_link·membership 을 FK CASCADE 로 함께 지운다.
          dsl.deleteFrom(USER).where(USER.ID.in(userIds)).execute();
        });
    userIds.clear();
  }

  private String bearer(long userId) {
    return "Bearer " + jwtTokenProvider.generateAccessToken(userId, "user-" + userId, 1L);
  }

  /** 텍스트 스테이징 → 응답의 fileId. */
  private long createText(long caller, String name, String content) throws Exception {
    String body =
        mockMvc
            .perform(
                post("/api/v1/staged-files/text")
                    .header("Authorization", bearer(caller))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(
                        objectMapper.writeValueAsString(Map.of("name", name, "content", content))))
            .andExpect(status().isCreated())
            .andReturn()
            .getResponse()
            .getContentAsString();
    return objectMapper.readTree(body).get("fileId").asLong();
  }

  /** 링크 발급 → 공개 경로(호스트 제외). */
  private String issuePath(long issuer, String name) throws Exception {
    String body =
        mockMvc
            .perform(
                post("/api/v1/staged-files/upload-link")
                    .header("Authorization", bearer(issuer))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(Map.of("name", name))))
            .andExpect(status().isCreated())
            .andReturn()
            .getResponse()
            .getContentAsString();
    String url = objectMapper.readTree(body).get("url").asText();
    assertThat(url).startsWith(BASE + "/api/v1/public/staged-files/su_");
    return url.substring(BASE.length());
  }

  private static String tokenHashOf(String path) {
    return CapabilityTokens.sha256Hex(path.substring(path.lastIndexOf('/') + 1));
  }

  private FileRecord fileRow(long fileId) {
    FileRecord[] row = new FileRecord[1];
    cleanupInTenant(1L, () -> row[0] = dsl.selectFrom(FILE).where(FILE.ID.eq(fileId)).fetchOne());
    return row[0];
  }

  private OffsetDateTime usedAtOf(String path) {
    OffsetDateTime[] usedAt = new OffsetDateTime[1];
    cleanupInTenant(
        1L,
        () ->
            usedAt[0] =
                dsl.select(STAGED_UPLOAD_LINK.USED_AT)
                    .from(STAGED_UPLOAD_LINK)
                    .where(STAGED_UPLOAD_LINK.TOKEN_HASH.eq(tokenHashOf(path)))
                    .fetchOne(STAGED_UPLOAD_LINK.USED_AT));
    return usedAt[0];
  }

  // ── 텍스트 ─────────────────────────────────────────────────────────

  /** 텍스트로 만들면 호출자가 올린 임시 ATTACHMENT 파일이 된다(만료 24시간) — 클레임할 수 있는 형태. */
  @Test
  void text_만들면_내_임시_ATTACHMENT_파일() throws Exception {
    byte[] content = "# 메모".getBytes(StandardCharsets.UTF_8);
    String body =
        mockMvc
            .perform(
                post("/api/v1/staged-files/text")
                    .header("Authorization", bearer(owner))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"name\":\"a.md\",\"content\":\"# 메모\"}"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.fileId").isNumber())
            .andExpect(jsonPath("$.name").value("a.md"))
            .andExpect(jsonPath("$.mimeType").value("text/markdown"))
            .andExpect(jsonPath("$.sizeBytes").value(content.length))
            .andExpect(jsonPath("$.expiresAt").isNotEmpty())
            .andReturn()
            .getResponse()
            .getContentAsString();
    long fileId = objectMapper.readTree(body).get("fileId").asLong();

    FileRecord row = fileRow(fileId);
    assertThat(row.getUploadedBy()).isEqualTo(owner);
    assertThat(row.getCategory()).isEqualTo("ATTACHMENT");
    assertThat(row.getStoragePath()).contains("/staged/");
    assertThat(row.getExpiresAt())
        .isCloseTo(OffsetDateTime.now().plusHours(24), within(10, ChronoUnit.MINUTES));
  }

  /** html 이름도 text/plain 으로 저장한다 — 인라인 서빙돼 문서로 렌더링되지 않게. */
  @Test
  void text_html_이름도_text_plain_으로_저장() throws Exception {
    long fileId = createText(owner, "page.html", "<script>alert(1)</script>");
    assertThat(fileRow(fileId).getMimeType()).isEqualTo("text/plain");
  }

  /**
   * 저장 뒤 트랜잭션이 롤백되면(FILE INSERT·감사·커밋 실패) 방금 쓴 바이너리를 지운다 — FILE 행이 없어 만료 스윕이 못 찾는 고아 blob 이 남지 않게.
   */
  @Test
  void text_트랜잭션이_롤백되면_저장한_바이너리를_지운다() {
    String[] path = new String[1];
    TenantContext.set(1L);
    try {
      new TransactionTemplate(txManager)
          .executeWithoutResult(
              st -> {
                long fileId = stagedUploadService.createText(owner, "r.md", "롤백").fileId();
                path[0] =
                    dsl.select(FILE.STORAGE_PATH)
                        .from(FILE)
                        .where(FILE.ID.eq(fileId))
                        .fetchOne(FILE.STORAGE_PATH);
                assertThat(fileStore.exists(path[0])).isTrue();
                st.setRollbackOnly();
              });
    } finally {
      TenantContext.clear();
    }
    assertThat(fileStore.exists(path[0])).isFalse();
  }

  /** UTF-8 10MB 를 넘는 텍스트는 400. */
  @Test
  void text_10MB_초과는_400() throws Exception {
    String big = "a".repeat(10 * 1024 * 1024 + 1);
    mockMvc
        .perform(
            post("/api/v1/staged-files/text")
                .header("Authorization", bearer(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    objectMapper.writeValueAsString(Map.of("name", "big.txt", "content", big))))
        .andExpect(status().isBadRequest());
  }

  // ── 링크 ──────────────────────────────────────────────────────────

  @Test
  void link_발급_계약() throws Exception {
    mockMvc
        .perform(
            post("/api/v1/staged-files/upload-link")
                .header("Authorization", bearer(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"결과.pdf\"}"))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.url").value(containsString("/api/v1/public/staged-files/su_")))
        .andExpect(jsonPath("$.method").value("PUT"))
        .andExpect(jsonPath("$.maxBytes").value(26214400))
        .andExpect(jsonPath("$.name").value("결과.pdf"))
        .andExpect(jsonPath("$.singleUse").value(true))
        .andExpect(jsonPath("$.expiresAt").isNotEmpty());
  }

  /** 익명 PUT 1회로 임시 첨부가 생기고(201 + fileId), 두 번째는 410. 사용 감사 actor 는 발급자이고 요청 IP 가 남는다. */
  @Test
  void link_익명_PUT_은_파일을_만들고_두번째는_410() throws Exception {
    String path = issuePath(owner, "외부 결과.md");
    byte[] content = "# 외부에서 올림".getBytes(StandardCharsets.UTF_8);

    String body =
        mockMvc
            .perform(put(path).content(content).header("X-Forwarded-For", "203.0.113.9"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.fileId").isNumber())
            .andExpect(jsonPath("$.name").value("외부 결과.md"))
            .andExpect(jsonPath("$.mimeType").value("text/markdown"))
            .andExpect(jsonPath("$.sizeBytes").value(content.length))
            .andReturn()
            .getResponse()
            .getContentAsString();
    long fileId = objectMapper.readTree(body).get("fileId").asLong();

    mockMvc
        .perform(put(path).content(content))
        .andExpect(status().isGone())
        .andExpect(jsonPath("$.message").value(containsString("새 링크를 발급받으세요")));

    FileRecord row = fileRow(fileId);
    assertThat(row.getUploadedBy()).isEqualTo(owner);
    assertThat(row.getCategory()).isEqualTo("ATTACHMENT");
    assertThat(row.getExpiresAt()).isNotNull();
    cleanupInTenant(
        1L,
        () -> {
          var uses =
              dsl.selectFrom(AUDIT_LOG)
                  .where(AUDIT_LOG.ACTION_TYPE.eq("STAGED_LINK_USE"))
                  .and(AUDIT_LOG.RESOURCE_ID.eq(String.valueOf(fileId)))
                  .fetch();
          assertThat(uses).hasSize(1);
          assertThat(uses.get(0).getUserId()).isEqualTo(owner);
          assertThat(uses.get(0).getIpAddress()).isEqualTo("203.0.113.9");
        });
    // 공개 요청 뒤 테넌트 컨텍스트가 남지 않는다
    assertThat(TenantContext.get()).isNull();
  }

  /**
   * Content-Type 없이 올린 본문(curl -T)은 실제 바이트가 이미지면 그 MIME 으로 저장한다(WP-515) — AI 가 붙인 스크린샷이 이미지로 보이게.
   * 이름만 .png 인 다른 바이트는 이미지로 바꾸지 않는다.
   */
  @Test
  void link_Content_Type_없는_실제_PNG_는_image_png_이름만_png_면_그대로() throws Exception {
    byte[] png = {
      (byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D, 'I', 'H', 'D', 'R'
    };
    mockMvc
        .perform(put(issuePath(owner, "시안.png")).content(png))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.mimeType").value("image/png"));

    mockMvc
        .perform(
            put(issuePath(owner, "가짜.png"))
                .content("<html>오류</html>".getBytes(StandardCharsets.UTF_8)))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.mimeType").value("application/octet-stream"));
  }

  /** HEAD 는 405(Allow: PUT)이고 링크를 소비하지 않는다 — 링크 미리보기가 일회용 링크를 태우지 않게. */
  @Test
  void link_HEAD_는_405_이고_소비하지_않음() throws Exception {
    String path = issuePath(owner, "미리보기.txt");
    mockMvc
        .perform(head(path))
        .andExpect(status().isMethodNotAllowed())
        .andExpect(header().string("Allow", containsString("PUT")));
    assertThat(usedAtOf(path)).isNull();
    mockMvc
        .perform(put(path).content("x".getBytes(StandardCharsets.UTF_8)))
        .andExpect(status().isCreated());
  }

  /** 만료된 링크는 410 이고 소비되지 않는다(본문 전 확인). */
  @Test
  void link_만료된_토큰은_410_소비_안함() throws Exception {
    String path = issuePath(owner, "만료.txt");
    cleanupInTenant(
        1L,
        () ->
            dsl.update(STAGED_UPLOAD_LINK)
                // 소비 판정은 DB now() 라 만료 시각도 DB 시계로 쓴다 — JVM 시계와 VM 시계가 어긋나도 확실히 지났게.
                .set(
                    STAGED_UPLOAD_LINK.EXPIRES_AT,
                    DSL.field("now() - interval '1 hour'", OffsetDateTime.class))
                .where(STAGED_UPLOAD_LINK.TOKEN_HASH.eq(tokenHashOf(path)))
                .execute());
    mockMvc
        .perform(put(path).content("x".getBytes(StandardCharsets.UTF_8)))
        .andExpect(status().isGone())
        .andExpect(jsonPath("$.message").value(containsString("새 링크를 발급받으세요")));
    assertThat(usedAtOf(path)).isNull();
  }

  /** 모르는 토큰·다른 종류 접두사는 인증 없이도 401 이 아니라 404(permitAll 이 PUT 에 적용). */
  @Test
  void link_모르는_토큰은_404() throws Exception {
    mockMvc
        .perform(put("/api/v1/public/staged-files/su_unknown").content(new byte[] {1}))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.message").value(containsString("새 링크를 발급받으세요")));
    mockMvc
        .perform(put("/api/v1/public/staged-files/ul_unknown").content(new byte[] {1}))
        .andExpect(status().isNotFound());
  }

  /** 선언 크기(Content-Length)가 25MB 를 넘으면 본문을 받기 전에 400 — 소비하지 않는다. */
  @Test
  void link_선언_크기_25MB_초과는_소비_전_400() throws Exception {
    String path = issuePath(owner, "큰.bin");
    mockMvc
        .perform(put(path).content(new byte[25 * 1024 * 1024 + 1]))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value(containsString("25MB")));
    assertThat(usedAtOf(path)).isNull();
  }

  /** 폼 본문(curl --data-binary 기본값)은 415 — 소비하지 않아 같은 링크로 원시 바이트를 다시 보낼 수 있다. */
  @Test
  void link_폼_본문은_415_링크는_살아있음() throws Exception {
    String path = issuePath(owner, "폼.txt");
    mockMvc
        .perform(
            put(path)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .content("a=1".getBytes(StandardCharsets.UTF_8)))
        .andExpect(status().isUnsupportedMediaType())
        .andExpect(jsonPath("$.message").value(containsString("curl -T")));
    for (String contentType : new String[] {"text", "*/*", "text/*"}) {
      mockMvc
          .perform(
              put(path)
                  .header("Content-Type", contentType)
                  .content("x".getBytes(StandardCharsets.UTF_8)))
          .andExpect(status().isUnsupportedMediaType());
    }
    mockMvc
        .perform(
            put(path)
                .contentType(MediaType.TEXT_PLAIN)
                .content("원시".getBytes(StandardCharsets.UTF_8)))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.mimeType").value("text/plain"));
  }

  /** 발급 뒤 발급자의 워크스페이스 멤버십이 정지되면 PUT 은 403(WP-417 멤버십 정지 반영). */
  @Test
  void link_발급자_멤버십이_정지되면_403() throws Exception {
    String path = issuePath(owner, "정지.txt");
    String original = membershipStatus(owner);
    setMembership(owner, "SUSPENDED");
    try {
      mockMvc
          .perform(put(path).content("x".getBytes(StandardCharsets.UTF_8)))
          .andExpect(status().isForbidden())
          .andExpect(jsonPath("$.message").value(containsString("새 링크를 발급받으세요")));
    } finally {
      setMembership(owner, original);
    }
  }

  /** 발급·텍스트 API 는 인증을 요구한다(permitAll 은 /public/staged-files/** 에만). */
  @Test
  void link_비인증_발급은_401() throws Exception {
    mockMvc
        .perform(
            post("/api/v1/staged-files/upload-link")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"a.txt\"}"))
        .andExpect(status().isUnauthorized());
    mockMvc
        .perform(
            post("/api/v1/staged-files/text")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"a.txt\",\"content\":\"x\"}"))
        .andExpect(status().isUnauthorized());
  }

  // ── 수명·클레임 ─────────────────────────────────────────────────────

  /** 클레임되지 않은 스테이징 파일은 만료되면 일반 만료 스윕이 지운다(어떤 보존 정책도 잡지 않는다). */
  @Test
  void 스테이징_파일은_만료되면_FileCleanupService_가_지운다() throws Exception {
    long fileId = createText(owner, "버림.txt", "곧 사라짐");
    cleanupInTenant(
        1L,
        () ->
            // 스윕은 JVM 시계로 비교한다 — VM 시계 차이에 흔들리지 않게 하루 전으로 둔다.
            dsl.update(FILE)
                .set(FILE.EXPIRES_AT, OffsetDateTime.now().minusDays(1))
                .where(FILE.ID.eq(fileId))
                .execute());

    fileCleanupService.cleanupExpiredFiles();

    assertThat(fileRow(fileId)).isNull();
  }

  /** 클레임은 업로더만 — 다른 사용자가 내 스테이징 파일 id 를 보내면 거절되고, 나는 클레임할 수 있다. */
  @Test
  void 다른_사용자는_내_스테이징_파일을_클레임할_수_없다() throws Exception {
    long fileId = createText(owner, "내것.md", "# 내 파일");

    TenantContext.set(1L);
    try {
      TransactionTemplate tx = new TransactionTemplate(txManager);
      assertThatThrownBy(
              () ->
                  tx.executeWithoutResult(
                      st ->
                          claimer.claim(
                              other, List.of(fileId), StagedFileClaimer.Retention.PERMANENT)))
          .isInstanceOf(StagedFileUnusableException.class);
      // 양성 대조 — 업로더 본인은 클레임된다(행이 클레임할 수 있는 형태로 저장됐는지). 롤백해 정리에 맡긴다.
      tx.executeWithoutResult(
          st -> {
            assertThat(claimer.claim(owner, List.of(fileId), StagedFileClaimer.Retention.PERMANENT))
                .singleElement()
                .satisfies(f -> assertThat(f.fileId()).isEqualTo(fileId));
            st.setRollbackOnly();
          });
    } finally {
      TenantContext.clear();
    }
  }

  /** 워크스페이스(tenant#1) 멤버십 상태 조회 — 바꾼 뒤 원래 값으로 되돌리기 위함. */
  private String membershipStatus(long userId) {
    String[] st = new String[1];
    cleanupInTenant(
        1L,
        () ->
            st[0] =
                dsl.select(MEMBERSHIP.STATUS)
                    .from(MEMBERSHIP)
                    .where(MEMBERSHIP.USER_ID.eq(userId))
                    .and(MEMBERSHIP.TENANT_ID.eq(1L))
                    .fetchOne(MEMBERSHIP.STATUS));
    return st[0];
  }

  private void setMembership(long userId, String st) {
    cleanupInTenant(
        1L,
        () ->
            dsl.update(MEMBERSHIP)
                .set(MEMBERSHIP.STATUS, st)
                .where(MEMBERSHIP.USER_ID.eq(userId))
                .and(MEMBERSHIP.TENANT_ID.eq(1L))
                .execute());
  }
}
