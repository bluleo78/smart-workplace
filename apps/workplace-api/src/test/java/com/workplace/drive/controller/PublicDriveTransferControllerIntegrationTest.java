package com.workplace.drive.controller;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER;
import static com.workplace.jooq.Tables.DRIVE_TRANSFER_LINK;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.head;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.drive.service.DriveFileService;
import com.workplace.drive.service.DriveFolderService;
import com.workplace.drive.service.DriveSpaceService;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 드라이브 전송 링크(WP-369) 공개 다운로드 전 구간(HTTP) 통합 테스트.
 *
 * <p>일부러 {@code @Transactional} 을 달지 않는다 — 테스트 트랜잭션이 미리 테넌트 GUC 를 심으면 "공개 요청에는 테넌트 컨텍스트가 없다"는 실제
 * 조건(소비가 SECURITY DEFINER 함수로 RLS 를 우회해야 하는 이유)이 가려지고, 소비가 뒤이은 실패와 함께 롤백되는지(링크가 되살아나는지)도 볼 수 없다.
 * 시드는 커밋하고 {@link #cleanup} 에서 지운다.
 */
class PublicDriveTransferControllerIntegrationTest extends IntegrationTestBase {
  @Autowired MockMvc mockMvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired DriveFileService fileService;
  @Autowired DriveSpaceService spaceService;
  @Autowired DriveFolderService folderService;
  @Autowired ObjectMapper objectMapper;

  private static final byte[] CONTENT = "전송 링크 본문".getBytes(StandardCharsets.UTF_8);

  private final List<Long> userIds = new ArrayList<>();
  private long owner;
  private long viewer;
  private long spaceId;
  private long driveFileId;
  private Long otherSpaceId;

  @BeforeEach
  void seed() throws Exception {
    TenantContext.set(1L);
    try {
      new TransactionTemplate(txManager)
          .executeWithoutResult(
              st -> {
                owner = withMembership(TestFixtures.createHuman(dsl));
                viewer = withMembership(TestFixtures.createHuman(dsl));
                userIds.add(owner);
                userIds.add(viewer);
                spaceId =
                    spaceService
                        .createTeamSpace(
                            owner, "전송HTTP_" + UUID.randomUUID().toString().substring(0, 8))
                        .id();
                dsl.insertInto(DRIVE_SPACE_MEMBER)
                    .set(DRIVE_SPACE_MEMBER.SPACE_ID, spaceId)
                    .set(DRIVE_SPACE_MEMBER.USER_ID, viewer)
                    .set(DRIVE_SPACE_MEMBER.ROLE, "VIEWER")
                    .execute();
              });
      driveFileId =
          fileService
              .upload(
                  owner,
                  spaceId,
                  null,
                  new MockMultipartFile("file", "회의 메모.md", "text/markdown", CONTENT))
              .id();
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
          // 공간 삭제가 멤버·파일·전송 링크를 FK CASCADE 로 함께 지운다.
          dsl.deleteFrom(DRIVE_SPACE).where(DRIVE_SPACE.ID.eq(spaceId)).execute();
          if (otherSpaceId != null) {
            dsl.deleteFrom(DRIVE_SPACE).where(DRIVE_SPACE.ID.eq(otherSpaceId)).execute();
            otherSpaceId = null;
          }
          dsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(userIds)).execute();
          dsl.deleteFrom(FILE).where(FILE.UPLOADED_BY.in(userIds)).execute();
          dsl.deleteFrom(USER).where(USER.ID.in(userIds)).execute();
        });
    userIds.clear();
  }

  private String bearer(long userId) {
    return "Bearer " + jwtTokenProvider.generateAccessToken(userId, "user-" + userId, 1L);
  }

  /** 인증된 발급 → 공개 경로(호스트 제외) 반환. */
  private String issuePath(long issuer) throws Exception {
    String body =
        mockMvc
            .perform(
                post("/api/v1/drive/files/" + driveFileId + "/download-link")
                    .header("Authorization", bearer(issuer)))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.singleUse").value(true))
            .andReturn()
            .getResponse()
            .getContentAsString();
    JsonNode json = objectMapper.readTree(body);
    String url = json.get("url").asText();
    assertThat(url).startsWith("http://localhost:6173/api/v1/public/drive/transfer/dl_");
    return url.substring("http://localhost:6173".length());
  }

  @Test
  void issue_returnsContract() throws Exception {
    mockMvc
        .perform(
            post("/api/v1/drive/files/" + driveFileId + "/download-link")
                .header("Authorization", bearer(viewer)))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.url").value(containsString("/api/v1/public/drive/transfer/dl_")))
        .andExpect(jsonPath("$.expiresAt").isNotEmpty())
        .andExpect(jsonPath("$.name").value("회의 메모.md"))
        .andExpect(jsonPath("$.sizeBytes").value(CONTENT.length))
        .andExpect(jsonPath("$.mimeType").value(containsString("text/markdown")))
        .andExpect(jsonPath("$.singleUse").value(true));
  }

  @Test
  void issue_nonMember_isNotFound() throws Exception {
    long outsider = withMembership(TestFixtures.createHuman(dsl));
    userIds.add(outsider);
    mockMvc
        .perform(
            post("/api/v1/drive/files/" + driveFileId + "/download-link")
                .header("Authorization", bearer(outsider)))
        .andExpect(status().isNotFound());
  }

  /** 발급 API 는 그대로 인증을 요구한다(공개 permitAll 은 /public/drive/transfer/** 에만). */
  @Test
  void issue_anonymous_isUnauthorized() throws Exception {
    mockMvc
        .perform(post("/api/v1/drive/files/" + driveFileId + "/download-link"))
        .andExpect(status().isUnauthorized());
  }

  /** 익명 GET 1회 성공(첨부·UTF-8 파일명·nosniff·no-store), 두 번째 GET 은 410 + 새 링크 안내. */
  @Test
  void anonymousGet_once_thenGone() throws Exception {
    String path = issuePath(viewer);

    byte[] body =
        mockMvc
            .perform(get(path))
            .andExpect(status().isOk())
            .andExpect(header().string("Content-Disposition", containsString("attachment")))
            .andExpect(header().string("Content-Disposition", containsString("UTF-8''")))
            .andExpect(header().string("X-Content-Type-Options", "nosniff"))
            .andExpect(header().string("Cache-Control", containsString("no-store")))
            .andExpect(header().string("Content-Type", containsString("text/markdown")))
            .andExpect(header().longValue("Content-Length", CONTENT.length))
            .andReturn()
            .getResponse()
            .getContentAsByteArray();
    assertThat(body).isEqualTo(CONTENT);

    mockMvc
        .perform(get(path))
        .andExpect(status().isGone())
        .andExpect(jsonPath("$.message").value(containsString("새 링크를 발급받으세요")));
  }

  /** HEAD 는 405(Allow: GET)이고 링크를 소비하지 않는다 — 링크 미리보기가 일회용 링크를 태우지 않게. */
  @Test
  void head_isMethodNotAllowed_andDoesNotConsume() throws Exception {
    String path = issuePath(viewer);
    mockMvc
        .perform(head(path))
        .andExpect(status().isMethodNotAllowed())
        .andExpect(header().string("Allow", "GET, PUT"));
    mockMvc.perform(get(path)).andExpect(status().isOk());
  }

  /**
   * Range 요청에도 일부(206)가 아니라 전체를 보낸다 — 일회용 링크라 첫 GET 이 소비하므로, 다운로드 관리자·이어받기(curl -C, wget -c)의 범위
   * 탐색이 1바이트만 받고 링크를 태우면 나머지를 받을 길이 없다. 범위 지원 광고(Accept-Ranges)도 하지 않는다.
   */
  @Test
  void rangeRequest_getsWholeFile_notPartial() throws Exception {
    String path = issuePath(viewer);
    var res =
        mockMvc
            .perform(get(path).header("Range", "bytes=0-0"))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse();
    assertThat(res.getContentAsByteArray()).isEqualTo(CONTENT);
    assertThat(res.getHeader("Accept-Ranges")).isNull();
    assertThat(res.getHeader("Content-Range")).isNull();
  }

  /** 동시 GET 중 정확히 하나만 200, 나머지는 410(원자적 소비). */
  @Test
  void concurrentGets_exactlyOneSucceeds() throws Exception {
    String path = issuePath(viewer);
    int n = 8;
    ExecutorService pool = Executors.newFixedThreadPool(n);
    CountDownLatch start = new CountDownLatch(1);
    try {
      List<Future<Integer>> results = new ArrayList<>();
      for (int i = 0; i < n; i++) {
        results.add(
            pool.submit(
                () -> {
                  start.await();
                  return mockMvc.perform(get(path)).andReturn().getResponse().getStatus();
                }));
      }
      start.countDown();
      List<Integer> statuses = new ArrayList<>();
      for (Future<Integer> f : results) {
        statuses.add(f.get(60, TimeUnit.SECONDS));
      }
      assertThat(statuses).containsOnly(200, 410);
      assertThat(statuses.stream().filter(s -> s == 200).count()).isEqualTo(1);
    } finally {
      pool.shutdownNow();
    }
  }

  /** 발급자가 공간에서 빠지면 403, 링크는 이미 소비돼 권한을 되찾아도 410(소비가 실패와 함께 롤백되지 않음). */
  @Test
  void issuerLostPermission_isForbidden_andLinkStaysBurned() throws Exception {
    String path = issuePath(viewer);
    cleanupInTenant(
        1L,
        () ->
            dsl.deleteFrom(DRIVE_SPACE_MEMBER)
                .where(DRIVE_SPACE_MEMBER.SPACE_ID.eq(spaceId))
                .and(DRIVE_SPACE_MEMBER.USER_ID.eq(viewer))
                .execute());

    mockMvc
        .perform(get(path))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.message").value(containsString("새 링크를 발급받으세요")));

    cleanupInTenant(
        1L,
        () ->
            dsl.insertInto(DRIVE_SPACE_MEMBER)
                .set(DRIVE_SPACE_MEMBER.SPACE_ID, spaceId)
                .set(DRIVE_SPACE_MEMBER.USER_ID, viewer)
                .set(DRIVE_SPACE_MEMBER.ROLE, "VIEWER")
                .execute());
    mockMvc.perform(get(path)).andExpect(status().isGone());
  }

  /** 링크 발급 뒤 파일이 휴지통으로 가면 404 + 새 링크 안내. */
  @Test
  void trashedFile_isNotFound() throws Exception {
    String path = issuePath(viewer);
    TenantContext.set(1L);
    try {
      fileService.delete(owner, driveFileId);
    } finally {
      TenantContext.clear();
    }
    mockMvc
        .perform(get(path))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.message").value(containsString("새 링크를 발급받으세요")));
  }

  /** 모르는 토큰은 인증 없이도 401 이 아니라 404(permitAll 통과 후 토큰 판정). */
  @Test
  void unknownToken_isNotFound_notUnauthorized() throws Exception {
    mockMvc
        .perform(get("/api/v1/public/drive/transfer/dl_unknown"))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.message").value(containsString("새 링크를 발급받으세요")));
    mockMvc.perform(get("/api/v1/public/drive/transfer/sl_other")).andExpect(status().isNotFound());
  }

  // ── 1b: 업로드 링크 발급 · 텍스트로 만들기 · 공개 PUT ─────────────────────────

  /** 업로드 링크 발급(EDITOR 이상) → 201 + PUT 계약. 공개 PUT(익명)으로 그 링크에 쓸 수 있는 경로를 돌려준다. */
  private String issueUploadPath(long issuer, String json) throws Exception {
    String body =
        mockMvc
            .perform(
                post("/api/v1/drive/spaces/" + spaceId + "/upload-link")
                    .header("Authorization", bearer(issuer))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(json))
            .andExpect(status().isCreated())
            .andReturn()
            .getResponse()
            .getContentAsString();
    String url = objectMapper.readTree(body).get("url").asText();
    assertThat(url).startsWith("http://localhost:6173/api/v1/public/drive/transfer/ul_");
    return url.substring("http://localhost:6173".length());
  }

  /** 다른 공간과 그 안의 폴더를 만든다(정리는 cleanup). */
  private long foreignFolder() {
    TenantContext.set(1L);
    try {
      otherSpaceId =
          spaceService
              .createTeamSpace(owner, "남_" + UUID.randomUUID().toString().substring(0, 8))
              .id();
      return folderService.create(owner, otherSpaceId, null, "남의폴더").id();
    } finally {
      TenantContext.clear();
    }
  }

  @Test
  void uploadLink_issue_contractAndRefusals() throws Exception {
    mockMvc
        .perform(
            post("/api/v1/drive/spaces/" + spaceId + "/upload-link")
                .header("Authorization", bearer(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"결과.md\"}"))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.url").value(containsString("/api/v1/public/drive/transfer/ul_")))
        .andExpect(jsonPath("$.method").value("PUT"))
        .andExpect(jsonPath("$.expiresAt").isNotEmpty())
        .andExpect(jsonPath("$.maxBytes").value(10 * 1024 * 1024))
        .andExpect(jsonPath("$.name").value("결과.md"))
        .andExpect(jsonPath("$.singleUse").value(true));

    // VIEWER 는 403, 익명은 401, 이름 없음 400, 다른 공간의 폴더 400
    mockMvc
        .perform(
            post("/api/v1/drive/spaces/" + spaceId + "/upload-link")
                .header("Authorization", bearer(viewer))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"a.md\"}"))
        .andExpect(status().isForbidden());
    mockMvc
        .perform(
            post("/api/v1/drive/spaces/" + spaceId + "/upload-link")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"a.md\"}"))
        .andExpect(status().isUnauthorized());
    mockMvc
        .perform(
            post("/api/v1/drive/spaces/" + spaceId + "/upload-link")
                .header("Authorization", bearer(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\" \"}"))
        .andExpect(status().isBadRequest());
    long foreign = foreignFolder();
    mockMvc
        .perform(
            post("/api/v1/drive/spaces/" + spaceId + "/upload-link")
                .header("Authorization", bearer(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"folderId\":" + foreign + ",\"name\":\"a.md\"}"))
        .andExpect(status().isBadRequest());
  }

  @Test
  void textCreate_http_contractAndRefusals() throws Exception {
    mockMvc
        .perform(
            post("/api/v1/drive/spaces/" + spaceId + "/files/text")
                .header("Authorization", bearer(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"정리.csv\",\"content\":\"a,b\\n1,2\"}"))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.name").value("정리.csv"))
        .andExpect(jsonPath("$.mimeType").value("text/csv"))
        .andExpect(jsonPath("$.sizeBytes").value(7))
        .andExpect(jsonPath("$.versionCount").value(1));

    // html MIME 은 허용하지 않는다(R4), VIEWER 403, 다른 공간 폴더 400, content 누락 400
    mockMvc
        .perform(
            post("/api/v1/drive/spaces/" + spaceId + "/files/text")
                .header("Authorization", bearer(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"name\":\"p.html\",\"content\":\"<b>x</b>\",\"mimeType\":\"text/html\"}"))
        .andExpect(status().isBadRequest());
    mockMvc
        .perform(
            post("/api/v1/drive/spaces/" + spaceId + "/files/text")
                .header("Authorization", bearer(viewer))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"a.md\",\"content\":\"x\"}"))
        .andExpect(status().isForbidden());
    mockMvc
        .perform(
            post("/api/v1/drive/spaces/" + spaceId + "/files/text")
                .header("Authorization", bearer(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"a.md\"}"))
        .andExpect(status().isBadRequest());
    long foreign = foreignFolder();
    mockMvc
        .perform(
            post("/api/v1/drive/spaces/" + spaceId + "/files/text")
                .header("Authorization", bearer(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"folderId\":" + foreign + ",\"name\":\"a.md\",\"content\":\"x\"}"))
        .andExpect(status().isBadRequest());
  }

  /**
   * 익명 PUT 1회로 새 파일이 생기고(201 + DriveFileResponse), 두 번째 PUT 은 410. 감사 actor 는 발급자(R3)이고 사용 기록엔 요청
   * IP 가 남는다(R11).
   */
  @Test
  void anonymousPut_createsFile_thenGone_auditedAsIssuer() throws Exception {
    String path = issueUploadPath(owner, "{\"name\":\"외부 결과.md\"}");
    byte[] content = "# 외부에서 올림".getBytes(StandardCharsets.UTF_8);

    String body =
        mockMvc
            .perform(put(path).content(content).header("X-Forwarded-For", "203.0.113.9"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.name").value("외부 결과.md"))
            .andExpect(jsonPath("$.mimeType").value("text/markdown"))
            .andExpect(jsonPath("$.sizeBytes").value(content.length))
            .andExpect(jsonPath("$.versionCount").value(1))
            .andReturn()
            .getResponse()
            .getContentAsString();
    long newId = objectMapper.readTree(body).get("id").asLong();

    mockMvc
        .perform(put(path).content(content))
        .andExpect(status().isGone())
        .andExpect(jsonPath("$.message").value(containsString("새 링크를 발급받으세요")));

    cleanupInTenant(
        1L,
        () -> {
          var upload =
              dsl.selectFrom(AUDIT_LOG)
                  .where(AUDIT_LOG.ACTION_TYPE.eq("FILE_UPLOAD"))
                  .and(AUDIT_LOG.RESOURCE_ID.eq(String.valueOf(newId)))
                  .fetchOne();
          assertThat(upload.getUserId()).isEqualTo(owner);
          var use =
              dsl.selectFrom(AUDIT_LOG)
                  .where(AUDIT_LOG.ACTION_TYPE.eq("TRANSFER_LINK_USE"))
                  .and(AUDIT_LOG.RESOURCE_ID.eq(String.valueOf(newId)))
                  .fetchOne();
          assertThat(use.getUserId()).isEqualTo(owner);
          assertThat(use.getIpAddress()).isEqualTo("203.0.113.9");
          assertThat(
                  dsl.select(DRIVE_FILE.SPACE_ID)
                      .from(DRIVE_FILE)
                      .where(DRIVE_FILE.ID.eq(newId))
                      .fetchOne(DRIVE_FILE.SPACE_ID))
              .isEqualTo(spaceId);
          // 멀티파트 업로드와 같은 의미: 영구 파일(expires_at NULL)로 승격되고 추출 행이 생긴다
          long fileId =
              dsl.select(DRIVE_FILE.FILE_ID)
                  .from(DRIVE_FILE)
                  .where(DRIVE_FILE.ID.eq(newId))
                  .fetchOne(DRIVE_FILE.FILE_ID);
          assertThat(
                  dsl.select(FILE.EXPIRES_AT)
                      .from(FILE)
                      .where(FILE.ID.eq(fileId))
                      .fetchOne(FILE.EXPIRES_AT))
              .isNull();
          assertThat(dsl.fetchExists(FILE_EXTRACTION, FILE_EXTRACTION.FILE_ID.eq(fileId))).isTrue();
        });
    // 공개 요청 뒤 테넌트 컨텍스트가 남지 않는다
    assertThat(TenantContext.get()).isNull();
  }

  /** 같은 이름의 파일이 있으면 새 버전으로 흡수(업로드와 같은 의미). */
  @Test
  void put_sameName_becomesNewVersion() throws Exception {
    String path = issueUploadPath(owner, "{\"name\":\"회의 메모.md\"}");
    mockMvc
        .perform(put(path).content("새 버전".getBytes(StandardCharsets.UTF_8)))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.id").value(driveFileId))
        .andExpect(jsonPath("$.versionCount").value(2));
  }

  /** 동시 PUT 중 정확히 하나만 201, 나머지는 410(원자적 소비). */
  @Test
  void concurrentPuts_exactlyOneSucceeds() throws Exception {
    String path = issueUploadPath(owner, "{\"name\":\"동시.txt\"}");
    int n = 6;
    ExecutorService pool = Executors.newFixedThreadPool(n);
    CountDownLatch start = new CountDownLatch(1);
    try {
      List<Future<Integer>> results = new ArrayList<>();
      for (int i = 0; i < n; i++) {
        final byte[] b = ("본문" + i).getBytes(StandardCharsets.UTF_8);
        results.add(
            pool.submit(
                () -> {
                  start.await();
                  return mockMvc
                      .perform(put(path).content(b))
                      .andReturn()
                      .getResponse()
                      .getStatus();
                }));
      }
      start.countDown();
      List<Integer> statuses = new ArrayList<>();
      for (Future<Integer> f : results) {
        statuses.add(f.get(60, TimeUnit.SECONDS));
      }
      assertThat(statuses).containsOnly(201, 410);
      assertThat(statuses.stream().filter(s -> s == 201).count()).isEqualTo(1);
    } finally {
      pool.shutdownNow();
    }
  }

  /** 폼 본문(curl --data-binary 기본값)은 415 — 소비하지 않아 같은 링크로 원시 바이트를 다시 보낼 수 있다. */
  @Test
  void put_formBody_isUnsupported_andLinkStillUsable() throws Exception {
    String path = issueUploadPath(owner, "{\"name\":\"폼.txt\"}");
    mockMvc
        .perform(
            put(path)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .content("a=1".getBytes(StandardCharsets.UTF_8)))
        .andExpect(status().isUnsupportedMediaType())
        .andExpect(jsonPath("$.message").value(containsString("curl -T")));
    mockMvc
        .perform(
            put(path)
                .contentType(MediaType.TEXT_PLAIN)
                .content("원시".getBytes(StandardCharsets.UTF_8)))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.mimeType").value("text/plain"));
  }

  /** 선언 크기(Content-Length)가 범주 상한을 넘으면 본문을 받기 전에 400 — 소비하지 않는다. */
  @Test
  void put_declaredSizeOverCap_isRejectedBeforeConsume() throws Exception {
    String path = issueUploadPath(owner, "{\"name\":\"큰.md\"}");
    mockMvc
        .perform(put(path).content(new byte[10 * 1024 * 1024 + 1]))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value(containsString("10MB")));
    mockMvc
        .perform(put(path).content("작음".getBytes(StandardCharsets.UTF_8)))
        .andExpect(status().isCreated());
  }

  /** 발급 뒤 발급자 역할이 VIEWER 로 내려가면 403, 링크는 이미 소비돼 역할을 되찾아도 410. */
  @Test
  void put_issuerDemoted_isForbidden_andLinkStaysBurned() throws Exception {
    String path = issueUploadPath(owner, "{\"name\":\"권한.txt\"}");
    setRole(owner, "VIEWER");
    try {
      mockMvc
          .perform(put(path).content("x".getBytes(StandardCharsets.UTF_8)))
          .andExpect(status().isForbidden())
          .andExpect(jsonPath("$.message").value(containsString("새 링크를 발급받으세요")));
    } finally {
      setRole(owner, "OWNER");
    }
    mockMvc
        .perform(put(path).content("x".getBytes(StandardCharsets.UTF_8)))
        .andExpect(status().isGone());
  }

  /** 모르는 업로드 토큰은 인증 없이도 401 이 아니라 404(permitAll 이 PUT 에도 적용). 다운로드 토큰으로 PUT 해도 404. */
  @Test
  void put_unknownToken_isNotFound_notUnauthorized() throws Exception {
    mockMvc
        .perform(put("/api/v1/public/drive/transfer/ul_unknown").content(new byte[] {1}))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.message").value(containsString("새 링크를 발급받으세요")));
    String dlPath = issuePath(viewer);
    mockMvc.perform(put(dlPath).content(new byte[] {1})).andExpect(status().isNotFound());
    // 다운로드 링크는 PUT 으로 소비되지 않는다
    mockMvc.perform(get(dlPath)).andExpect(status().isOk());
  }

  private void setRole(long userId, String role) {
    cleanupInTenant(
        1L,
        () ->
            dsl.update(DRIVE_SPACE_MEMBER)
                .set(DRIVE_SPACE_MEMBER.ROLE, role)
                .where(DRIVE_SPACE_MEMBER.SPACE_ID.eq(spaceId))
                .and(DRIVE_SPACE_MEMBER.USER_ID.eq(userId))
                .execute());
  }

  // ── Fix round 1 ──────────────────────────────────────────────────────

  @org.springframework.beans.factory.annotation.Value("${workplace.drive.transfer-temp-dir}")
  String tempDir;

  /** 만료된 업로드 링크는 410 이고 소비되지 않는다(본문 전 확인). */
  @Test
  void put_expiredToken_isGone_andNotConsumed() throws Exception {
    String path = issueUploadPath(owner, "{\"name\":\"만료.txt\"}");
    String hash =
        com.workplace.drive.service.DriveShareLinkService.sha256Hex(
            path.substring(path.lastIndexOf('/') + 1));
    cleanupInTenant(
        1L,
        () ->
            dsl.update(DRIVE_TRANSFER_LINK)
                .set(DRIVE_TRANSFER_LINK.EXPIRES_AT, java.time.OffsetDateTime.now().minusSeconds(1))
                .where(DRIVE_TRANSFER_LINK.TOKEN_HASH.eq(hash))
                .execute());

    mockMvc
        .perform(put(path).content("x".getBytes(StandardCharsets.UTF_8)))
        .andExpect(status().isGone())
        .andExpect(jsonPath("$.message").value(containsString("새 링크를 발급받으세요")));
    cleanupInTenant(
        1L,
        () ->
            assertThat(
                    dsl.select(DRIVE_TRANSFER_LINK.USED_AT)
                        .from(DRIVE_TRANSFER_LINK)
                        .where(DRIVE_TRANSFER_LINK.TOKEN_HASH.eq(hash))
                        .fetchOne(DRIVE_TRANSFER_LINK.USED_AT))
                .isNull());
  }

  /** 발급 뒤 발급자의 워크스페이스 멤버십이 정지되면(공간 멤버 행이 남아 있어도) PUT 은 403. */
  @Test
  void put_issuerMembershipSuspended_isForbidden() throws Exception {
    String path = issueUploadPath(owner, "{\"name\":\"정지.txt\"}");
    setMembership(owner, "SUSPENDED");
    try {
      mockMvc
          .perform(put(path).content("x".getBytes(StandardCharsets.UTF_8)))
          .andExpect(status().isForbidden())
          .andExpect(jsonPath("$.message").value(containsString("새 링크를 발급받으세요")));
    } finally {
      setMembership(owner, "ACTIVE");
    }
  }

  /** 소비 뒤 핵심에서 실패(할당량 초과)해도 임시 파일이 남지 않는다. 409 문구는 사용량·한도를 드러내지 않는다. */
  @Test
  void put_quotaExceeded_isConflict_genericMessage_andTempFileRemoved() throws Exception {
    String path = issueUploadPath(owner, "{\"name\":\"할당량.txt\"}");
    Long[] original = new Long[1];
    cleanupInTenant(
        1L,
        () -> {
          original[0] =
              dsl.select(TENANT.QUOTA_BYTES)
                  .from(TENANT)
                  .where(TENANT.ID.eq(1L))
                  .fetchOne(TENANT.QUOTA_BYTES);
          dsl.update(TENANT).set(TENANT.QUOTA_BYTES, 0L).where(TENANT.ID.eq(1L)).execute();
        });
    long before = tempPartFiles();
    try {
      mockMvc
          .perform(put(path).content("내용".getBytes(StandardCharsets.UTF_8)))
          .andExpect(status().isConflict())
          .andExpect(jsonPath("$.message").value("저장 용량이 부족합니다. 공간을 비운 뒤 새 링크를 발급받으세요"));
    } finally {
      cleanupInTenant(
          1L,
          () ->
              dsl.update(TENANT)
                  .set(TENANT.QUOTA_BYTES, original[0])
                  .where(TENANT.ID.eq(1L))
                  .execute());
    }
    assertThat(tempPartFiles()).isEqualTo(before);
  }

  private void setMembership(long userId, String status) {
    cleanupInTenant(
        1L,
        () ->
            dsl.update(MEMBERSHIP)
                .set(MEMBERSHIP.STATUS, status)
                .where(MEMBERSHIP.USER_ID.eq(userId))
                .and(MEMBERSHIP.TENANT_ID.eq(1L))
                .execute());
  }

  /** 업로드 임시 파일 디렉터리에 남은 drive-transfer-*.part 수(테스트는 워커별 디렉터리라 다른 포크가 섞이지 않는다). */
  private long tempPartFiles() throws java.io.IOException {
    java.nio.file.Path dir = java.nio.file.Path.of(tempDir);
    if (!java.nio.file.Files.isDirectory(dir)) {
      return 0;
    }
    try (var files = java.nio.file.Files.list(dir)) {
      return files
          .map(f -> f.getFileName().toString())
          .filter(n -> n.startsWith("drive-transfer-") && n.endsWith(".part"))
          .count();
    }
  }
}
