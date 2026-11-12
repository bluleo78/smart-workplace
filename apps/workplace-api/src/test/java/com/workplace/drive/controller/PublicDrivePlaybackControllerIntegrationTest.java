package com.workplace.drive.controller;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.drive.service.DriveFileService;
import com.workplace.drive.service.DrivePlaybackService;
import com.workplace.drive.service.DrivePlaybackTokens;
import com.workplace.drive.service.DrivePlaybackTokens.Claims;
import com.workplace.drive.service.DriveSpaceService;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.security.LabeledTokenCrypto;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 드라이브 재생 주소(WP-1532) 발급 → 공개 Range 재생 전 구간(HTTP) 통합 테스트.
 *
 * <p>전송 링크 테스트와 같이 {@code @Transactional} 을 달지 않는다 — 공개 요청에는 테넌트 컨텍스트가 없다는 실제 조건에서 토큰의 테넌트로 컨텍스트를
 * 세워 읽는지 봐야 한다. 시드는 커밋하고 {@link #cleanup} 에서 지운다.
 */
class PublicDrivePlaybackControllerIntegrationTest extends IntegrationTestBase {
  @Autowired MockMvc mockMvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired DriveFileService fileService;
  @Autowired DriveSpaceService spaceService;
  @Autowired DrivePlaybackTokens tokens;
  @Autowired JwtProperties jwtProperties;
  @Autowired ObjectMapper objectMapper;

  /** 영상 본문 대역 — 바이트마다 값이 달라 범위 응답이 정확한 구간인지 비교할 수 있다. */
  private static final byte[] VIDEO = new byte[4096];

  static {
    for (int i = 0; i < VIDEO.length; i++) VIDEO[i] = (byte) (i % 251);
  }

  private final List<Long> userIds = new ArrayList<>();
  private long owner;
  private long viewer;
  private long spaceId;
  private long videoId;
  private long docId;

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
                            owner, "재생HTTP_" + UUID.randomUUID().toString().substring(0, 8))
                        .id();
                dsl.insertInto(DRIVE_SPACE_MEMBER)
                    .set(DRIVE_SPACE_MEMBER.SPACE_ID, spaceId)
                    .set(DRIVE_SPACE_MEMBER.USER_ID, viewer)
                    .set(DRIVE_SPACE_MEMBER.ROLE, "VIEWER")
                    .execute();
              });
      videoId =
          fileService
              .upload(
                  owner,
                  spaceId,
                  null,
                  new MockMultipartFile("file", "회의.webm", "video/webm", VIDEO))
              .id();
      docId =
          fileService
              .upload(
                  owner,
                  spaceId,
                  null,
                  new MockMultipartFile(
                      "file",
                      "page.html",
                      "text/html",
                      "<p>hi</p>".getBytes(StandardCharsets.UTF_8)))
              .id();
    } finally {
      TenantContext.clear();
    }
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
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

  /** 인증된 발급 → 응답의 상대 경로. */
  private String issuePath(long caller, long driveFileId) throws Exception {
    String body =
        mockMvc
            .perform(
                post("/api/v1/drive/files/" + driveFileId + "/playback-url")
                    .header("Authorization", bearer(caller)))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();
    String url = objectMapper.readTree(body).get("url").asText();
    assertThat(url).startsWith(DrivePlaybackService.PUBLIC_PATH);
    return url;
  }

  private int playbackAuditCount() {
    return callInTenant(
        1L,
        () ->
            dsl.fetchCount(
                AUDIT_LOG,
                AUDIT_LOG
                    .ACTION_TYPE
                    .eq(DrivePlaybackService.AUDIT_PLAYBACK)
                    .and(AUDIT_LOG.RESOURCE_ID.eq(String.valueOf(videoId)))));
  }

  /** 서명된 토큰 경로를 직접 만든다(만료·다른 버전 등 발급 API 로 만들 수 없는 값). */
  private String signedPath(long userId, long driveFileId, long coreFileId, Instant exp) {
    return DrivePlaybackService.PUBLIC_PATH
        + tokens.seal(new Claims(1L, userId, driveFileId, coreFileId, exp));
  }

  private long coreFileId(long driveFileId) {
    return callInTenant(
        1L,
        () ->
            dsl.select(com.workplace.jooq.Tables.DRIVE_FILE.FILE_ID)
                .from(com.workplace.jooq.Tables.DRIVE_FILE)
                .where(com.workplace.jooq.Tables.DRIVE_FILE.ID.eq(driveFileId))
                .fetchOne(com.workplace.jooq.Tables.DRIVE_FILE.FILE_ID));
  }

  @Test
  void issue_returnsRelativeUrlAndExpiry() throws Exception {
    mockMvc
        .perform(
            post("/api/v1/drive/files/" + videoId + "/playback-url")
                .header("Authorization", bearer(viewer)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.url").value(containsString("/api/v1/public/drive/playback/")))
        .andExpect(jsonPath("$.expiresAt").isNotEmpty())
        .andExpect(jsonPath("$.mimeType").value(containsString("video/webm")));
  }

  /** 발급은 인증이 필요하다 — 공개 permitAll 은 재생 경로(GET·HEAD)에만 있다. */
  @Test
  void issue_anonymous_isUnauthorized() throws Exception {
    mockMvc
        .perform(post("/api/v1/drive/files/" + videoId + "/playback-url"))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void issue_nonMember_isNotFound() throws Exception {
    long outsider = withMembership(TestFixtures.createHuman(dsl));
    userIds.add(outsider);
    mockMvc
        .perform(
            post("/api/v1/drive/files/" + videoId + "/playback-url")
                .header("Authorization", bearer(outsider)))
        .andExpect(status().isNotFound());
    assertThat(playbackAuditCount()).isZero();
  }

  /** 영상·오디오가 아니면 409 — 공개 inline 주소로 HTML 을 띄우는 길을 만들지 않는다. */
  @Test
  void issue_nonMedia_isConflict() throws Exception {
    mockMvc
        .perform(
            post("/api/v1/drive/files/" + docId + "/playback-url")
                .header("Authorization", bearer(viewer)))
        .andExpect(status().isConflict());
  }

  @Test
  void issue_trashedFile_isNotFound() throws Exception {
    cleanupInTenant(1L, () -> fileService.delete(owner, videoId));
    mockMvc
        .perform(
            post("/api/v1/drive/files/" + videoId + "/playback-url")
                .header("Authorization", bearer(viewer)))
        .andExpect(status().isNotFound());
  }

  /** 익명 GET 전체(200) — 범위 광고·형식·inline·nosniff·캐시 정책. */
  @Test
  void anonymousGet_full_withHeaders() throws Exception {
    String path = issuePath(viewer, videoId);
    byte[] body =
        mockMvc
            .perform(get(path))
            .andExpect(status().isOk())
            .andExpect(header().string("Accept-Ranges", "bytes"))
            .andExpect(header().string("Content-Type", containsString("video/webm")))
            .andExpect(header().string("Content-Disposition", containsString("inline")))
            .andExpect(header().string("X-Content-Type-Options", "nosniff"))
            .andExpect(header().string("Content-Security-Policy", "sandbox"))
            .andExpect(header().string("Cache-Control", containsString("no-store")))
            .andExpect(header().string("Cache-Control", containsString("private")))
            .andReturn()
            .getResponse()
            .getContentAsByteArray();
    assertThat(body).isEqualTo(VIDEO);
  }

  /** Range 요청은 206 + Content-Range + 그 구간 바이트 — 탐색(중간 구간)·끝 구간 모두. */
  @Test
  void rangeGet_returnsPartialContent() throws Exception {
    String path = issuePath(viewer, videoId);
    byte[] mid =
        mockMvc
            .perform(get(path).header("Range", "bytes=1000-1999"))
            .andExpect(status().isPartialContent())
            .andExpect(header().string("Content-Range", "bytes 1000-1999/" + VIDEO.length))
            .andExpect(header().longValue("Content-Length", 1000))
            .andExpect(header().string("Content-Type", containsString("video/webm")))
            .andExpect(header().string("X-Content-Type-Options", "nosniff"))
            .andReturn()
            .getResponse()
            .getContentAsByteArray();
    assertThat(mid).isEqualTo(Arrays.copyOfRange(VIDEO, 1000, 2000));

    byte[] open =
        mockMvc
            .perform(get(path).header("Range", "bytes=4000-"))
            .andExpect(status().isPartialContent())
            .andExpect(header().string("Content-Range", "bytes 4000-4095/" + VIDEO.length))
            .andReturn()
            .getResponse()
            .getContentAsByteArray();
    assertThat(open).isEqualTo(Arrays.copyOfRange(VIDEO, 4000, 4096));
  }

  /** 범위 요청이 여러 번 와도 열람 감사는 발급 때 1건뿐이다. */
  @Test
  void audit_recordedOnceAtIssue_notPerRange() throws Exception {
    String path = issuePath(viewer, videoId);
    for (int i = 0; i < 5; i++) {
      mockMvc
          .perform(get(path).header("Range", "bytes=" + (i * 100) + "-" + (i * 100 + 99)))
          .andExpect(status().isPartialContent());
    }
    mockMvc.perform(get(path)).andExpect(status().isOk());
    assertThat(playbackAuditCount()).isEqualTo(1);
  }

  @Test
  void expiredToken_isNotFound() throws Exception {
    String path = signedPath(viewer, videoId, coreFileId(videoId), Instant.now().minusSeconds(5));
    mockMvc.perform(get(path)).andExpect(status().isNotFound());
  }

  /** 봉인 바이트 하나 변조·다른 라벨(공유 열람 토큰 키)로 봉인한 같은 내용·형식 오류 모두 404. */
  @Test
  void tamperedOrForeignKeyToken_isNotFound() throws Exception {
    String path = issuePath(viewer, videoId);
    String token = path.substring(DrivePlaybackService.PUBLIC_PATH.length());
    byte[] raw = Base64.getUrlDecoder().decode(token);
    raw[raw.length / 2] ^= 0x01;
    String flipped = Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
    mockMvc
        .perform(get(DrivePlaybackService.PUBLIC_PATH + flipped))
        .andExpect(status().isNotFound());

    // 같은 평문을 공유 열람 토큰 라벨로 봉인 — 키가 도메인 분리돼 열리지 않는다. 같은 평문을 재생 라벨로 봉인하면 열린다(형식 확인).
    String plain =
        "1|"
            + viewer
            + "|"
            + videoId
            + "|"
            + coreFileId(videoId)
            + "|"
            + Instant.now().plusSeconds(600).getEpochSecond();
    String foreign =
        LabeledTokenCrypto.derive(jwtProperties.secret(), "swp-share-view-v1").seal(plain);
    mockMvc
        .perform(get(DrivePlaybackService.PUBLIC_PATH + foreign))
        .andExpect(status().isNotFound());
    String own =
        LabeledTokenCrypto.derive(jwtProperties.secret(), "swp-drive-playback-v1").seal(plain);
    mockMvc.perform(get(DrivePlaybackService.PUBLIC_PATH + own)).andExpect(status().isOk());

    mockMvc
        .perform(get(DrivePlaybackService.PUBLIC_PATH + "not-a-token"))
        .andExpect(status().isNotFound());
  }

  /** 주소에는 내부 id(테넌트·사용자·파일)가 보이지 않는다 — 봉인이라 base64url 을 풀어도 평문 구분자·id 가 없다. */
  @Test
  void token_isOpaque() throws Exception {
    String path = issuePath(viewer, videoId);
    String token = path.substring(DrivePlaybackService.PUBLIC_PATH.length());
    assertThat(token).doesNotContain(".").doesNotContain("|");
    String decoded = new String(Base64.getUrlDecoder().decode(token), StandardCharsets.ISO_8859_1);
    assertThat(decoded)
        .doesNotContain("|" + viewer + "|")
        .doesNotContain("|" + videoId + "|")
        .doesNotContain("|" + coreFileId(videoId) + "|");
    // 같은 파일도 발급마다 다른 값(IV) — 주소로 같은 파일인지 알 수 없다.
    assertThat(issuePath(viewer, videoId)).isNotEqualTo(path);
  }

  /** 웹 로그인 세션이 아닌 인증(PAT·AI 키처럼 AuthDetails 없음)으로는 발급할 수 없다 — 회수 가능한 토큰으로 4시간 자격을 만들지 않게. */
  @Test
  void issue_nonWebSession_isForbidden() throws Exception {
    var nonWeb = new UsernamePasswordAuthenticationToken(viewer, "n/a", List.of());
    TenantContext.set(1L);
    try {
      mockMvc
          .perform(
              post("/api/v1/drive/files/" + videoId + "/playback-url").with(authentication(nonWeb)))
          .andExpect(status().isForbidden());
    } finally {
      TenantContext.clear();
    }
    assertThat(playbackAuditCount()).isZero();
  }

  /** 저장된 MIME 이 깨져 있으면(형식 목록은 통과해도 해석 실패) 500 이 아니라 같은 404. */
  @Test
  void brokenStoredMime_isNotFound() throws Exception {
    String path = issuePath(viewer, videoId);
    long core = coreFileId(videoId);
    cleanupInTenant(
        1L,
        () ->
            dsl.update(FILE)
                .set(FILE.MIME_TYPE, "video/mp4; a=\"unterminated")
                .where(FILE.ID.eq(core))
                .execute());
    mockMvc.perform(get(path)).andExpect(status().isNotFound());
  }

  /** 재생 목록 밖 형식(재생 목록 m3u8·asf)은 발급하지 않는다(409). */
  @Test
  void issue_playlistOrUnsupportedType_isConflict() throws Exception {
    long core = coreFileId(videoId);
    for (String mime :
        List.of("application/vnd.apple.mpegurl", "audio/mpegurl", "video/x-ms-asf")) {
      cleanupInTenant(
          1L, () -> dsl.update(FILE).set(FILE.MIME_TYPE, mime).where(FILE.ID.eq(core)).execute());
      mockMvc
          .perform(
              post("/api/v1/drive/files/" + videoId + "/playback-url")
                  .header("Authorization", bearer(viewer)))
          .andExpect(status().isConflict());
    }
  }

  /** 공유 열람 토큰 등 다른 키로 만든 값은 통과하지 못한다 — 같은 형식이어도 키 라벨이 다르다. */
  @Test
  void tokenSignedForAnotherTenant_isNotServedFromThisTenant() throws Exception {
    // 서명은 맞지만 테넌트가 다르면(없는 테넌트) 테넌트 활성 확인에서 404.
    String path =
        DrivePlaybackService.PUBLIC_PATH
            + tokens.seal(
                new Claims(
                    987_654L,
                    viewer,
                    videoId,
                    coreFileId(videoId),
                    Instant.now().plusSeconds(600)));
    mockMvc.perform(get(path)).andExpect(status().isNotFound());
  }

  /** 발급 뒤 휴지통으로 가면 만료 전이라도 404. */
  @Test
  void trashedAfterIssue_isNotFound() throws Exception {
    String path = issuePath(viewer, videoId);
    mockMvc.perform(get(path).header("Range", "bytes=0-9")).andExpect(status().isPartialContent());
    cleanupInTenant(1L, () -> fileService.delete(owner, videoId));
    mockMvc.perform(get(path).header("Range", "bytes=0-9")).andExpect(status().isNotFound());
  }

  /** 발급 뒤 공간에서 빠지면(볼 권한 상실) 404. */
  @Test
  void permissionLostAfterIssue_isNotFound() throws Exception {
    String path = issuePath(viewer, videoId);
    cleanupInTenant(
        1L,
        () ->
            dsl.deleteFrom(DRIVE_SPACE_MEMBER)
                .where(DRIVE_SPACE_MEMBER.SPACE_ID.eq(spaceId))
                .and(DRIVE_SPACE_MEMBER.USER_ID.eq(viewer))
                .execute());
    mockMvc.perform(get(path)).andExpect(status().isNotFound());
  }

  /** 새 버전이 오르면 이전 버전에 묶인 토큰은 404 — 서명이 core file.id(버전)를 묶는다. */
  @Test
  void newVersionAfterIssue_isNotFound() throws Exception {
    String path = issuePath(viewer, videoId);
    TenantContext.set(1L);
    try {
      fileService.upload(
          owner,
          spaceId,
          null,
          new MockMultipartFile("file", "회의.webm", "video/webm", new byte[] {1, 2, 3}));
    } finally {
      TenantContext.clear();
    }
    mockMvc.perform(get(path)).andExpect(status().isNotFound());
    // 새로 발급하면 새 버전으로 재생된다.
    mockMvc
        .perform(get(issuePath(viewer, videoId)))
        .andExpect(status().isOk())
        .andExpect(header().longValue("Content-Length", 3));
  }
}
