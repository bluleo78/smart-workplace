package com.workplace.drive.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.audit.service.AuditLogService;
import com.workplace.drive.dto.DrivePlaybackUrlResponse;
import com.workplace.drive.repository.DriveFileRepository;
import com.workplace.file.service.FileUploadService;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.LabeledTokenCrypto;
import com.workplace.global.tenant.MembershipGuard;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.annotation.Transactional;

/**
 * 재생 주소 발급의 만료 경계(WP-1532) — 서비스와 토큰에 같은 고정 시계를 넣어 issue() 가 「발급 + 4시간」(초 단위)으로 만료를 정하고, 그 1초 전까지만
 * 토큰이 열리는지 본다. 공유 열람 토큰이 공용 서명 도구로 옮긴 뒤에도 예전 형식과 바이트 단위로 같은지도 여기서 함께 본다(이미 발급한 공유 링크 토큰이 계속 통해야
 * 한다).
 */
@Transactional
class DrivePlaybackServiceTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired JwtProperties jwtProperties;
  @Autowired DriveFileService fileService;
  @Autowired DriveSpaceService spaceService;
  @Autowired DriveFileRepository files;
  @Autowired DrivePermissions perms;
  @Autowired FileUploadService fileUpload;
  @Autowired MembershipGuard membershipGuard;
  @Autowired AuditLogService auditLogService;

  /** 초 단위가 아닌 시각 — 만료가 초로 잘리는지도 본다. */
  private static final Instant NOW = Instant.parse("2026-11-12T01:02:03.456Z");

  @BeforeEach
  void ctx() {
    TenantContext.set(1L);
  }

  @AfterEach
  void clear() {
    TenantContext.clear();
  }

  private DrivePlaybackService serviceAt(Instant now, DrivePlaybackTokens tokens) {
    return new DrivePlaybackService(
        fileService,
        files,
        perms,
        fileUpload,
        membershipGuard,
        tokens,
        auditLogService,
        Clock.fixed(now, ZoneOffset.UTC));
  }

  @Test
  void issue_expiresAtIsIssueTimePlusTtl_andTokenOpensUntilOneSecondBefore() throws Exception {
    long owner = withMembership(TestFixtures.createHuman(dsl));
    long spaceId =
        spaceService
            .createTeamSpace(owner, "재생TTL_" + UUID.randomUUID().toString().substring(0, 8))
            .id();
    long videoId =
        fileService
            .upload(
                owner,
                spaceId,
                null,
                new MockMultipartFile("file", "a.mp4", "video/mp4", new byte[] {1, 2}))
            .id();

    DrivePlaybackUrlResponse res =
        serviceAt(NOW, new DrivePlaybackTokens(jwtProperties, Clock.fixed(NOW, ZoneOffset.UTC)))
            .issue(owner, videoId);
    Instant expected = Instant.parse("2026-11-12T05:02:03Z");
    assertThat(res.expiresAt().toInstant()).isEqualTo(expected);
    assertThat(DrivePlaybackService.TTL).hasHours(4);

    String token = res.url().substring(DrivePlaybackService.PUBLIC_PATH.length());
    DrivePlaybackTokens justBefore =
        new DrivePlaybackTokens(
            jwtProperties, Clock.fixed(expected.minusSeconds(1), ZoneOffset.UTC));
    DrivePlaybackTokens atExpiry =
        new DrivePlaybackTokens(jwtProperties, Clock.fixed(expected, ZoneOffset.UTC));
    assertThat(justBefore.verify(token))
        .hasValueSatisfying(c -> assertThat(c.driveFileId()).isEqualTo(videoId));
    assertThat(atExpiry.verify(token)).isEmpty();
  }

  @Test
  void isPlayable_whitelistsConcreteContainersOnly() {
    assertThat(DrivePlaybackService.isPlayable("video/mp4")).isTrue();
    assertThat(DrivePlaybackService.isPlayable("Video/WebM; codecs=\"vp9\"")).isTrue();
    assertThat(DrivePlaybackService.isPlayable("audio/mpeg")).isTrue();
    assertThat(DrivePlaybackService.isPlayable("application/vnd.apple.mpegurl")).isFalse();
    assertThat(DrivePlaybackService.isPlayable("audio/x-mpegurl")).isFalse();
    assertThat(DrivePlaybackService.isPlayable("video/x-ms-asf")).isFalse();
    assertThat(DrivePlaybackService.isPlayable("video/x-msvideo")).isFalse();
    assertThat(DrivePlaybackService.isPlayable("text/html")).isFalse();
    assertThat(DrivePlaybackService.isPlayable(null)).isFalse();
  }

  /** 공유 열람 토큰을 공용 도구로 옮긴 뒤에도 예전 구현(라벨 파생 키 HMAC)과 바이트 단위로 같은 토큰이 나온다. */
  @Test
  void shareViewToken_formatIsByteCompatibleWithPreviousImplementation() throws Exception {
    Clock clock = Clock.fixed(NOW, ZoneOffset.UTC);
    String issued = new ShareViewTokens(jwtProperties, clock).issue("hash123", null).viewToken();

    long exp = NOW.plus(ShareViewTokens.TTL).getEpochSecond();
    String payload =
        Base64.getUrlEncoder()
            .withoutPadding()
            .encodeToString(("hash123|" + exp + "|").getBytes(StandardCharsets.UTF_8));
    javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256");
    mac.init(
        new javax.crypto.spec.SecretKeySpec(
            jwtProperties.secret().getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
    byte[] key = mac.doFinal("swp-share-view-v1".getBytes(StandardCharsets.UTF_8));
    mac.init(new javax.crypto.spec.SecretKeySpec(key, "HmacSHA256"));
    String legacy =
        payload
            + "."
            + Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(mac.doFinal(payload.getBytes(StandardCharsets.UTF_8)));
    assertThat(issued).isEqualTo(legacy);
    assertThat(new ShareViewTokens(jwtProperties, clock).isValid(legacy, "hash123", null)).isTrue();
    // 공용 도구 기준으로도 같은 서명.
    assertThat(LabeledTokenCrypto.derive(jwtProperties.secret(), "swp-share-view-v1").sign(payload))
        .isEqualTo(legacy);
  }
}
