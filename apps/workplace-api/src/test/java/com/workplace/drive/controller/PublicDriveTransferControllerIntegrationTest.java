package com.workplace.drive.controller;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.head;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.drive.service.DriveFileService;
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
  @Autowired ObjectMapper objectMapper;

  private static final byte[] CONTENT = "전송 링크 본문".getBytes(StandardCharsets.UTF_8);

  private final List<Long> userIds = new ArrayList<>();
  private long owner;
  private long viewer;
  private long spaceId;
  private long driveFileId;

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
        .andExpect(header().string("Allow", "GET"));
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
}
