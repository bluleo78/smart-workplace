package com.workplace.drive.service;

import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_SHARE_LINK;
import static com.workplace.jooq.Tables.DRIVE_SHARE_LINK_ATTEMPTS;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.drive.dto.CreateShareLinkRequest;
import com.workplace.drive.dto.ShareInfoResponse;
import com.workplace.drive.exception.DriveForbiddenException;
import com.workplace.drive.exception.DriveShareLinkGoneException;
import com.workplace.drive.exception.DriveShareLinkLockedException;
import com.workplace.drive.exception.DriveShareLinkNotFoundException;
import com.workplace.drive.exception.DriveShareLinkUnauthorizedException;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.support.IntegrationTestBase;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 공유 링크 미리보기 경로(WP-1227) 통합 테스트 — 정보 조회·비밀번호 확인(열람 토큰)·미리보기 가드·다운로드의 열람 토큰.
 *
 * <p>핵심: 정보 조회와 미리보기 가드는 비밀번호 시도 칸을 쓰지 않는다(잠긴 링크도 「비밀번호 필요」로만 답함). 비밀번호 추측은 unlock 한 곳에서만 칸을 쓴다. 열람
 * 토큰은 링크 가드(404·410·사내 범위)를 대신하지 않고, 만료·변조·비밀번호 변경이면 무효다.
 */
@Transactional
class DriveShareLinkViewTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired DriveShareLinkService service;
  @Autowired JwtProperties jwtProperties;

  // 시도 칸은 REQUIRES_NEW 로 독립 커밋되어 테스트 롤백에 지워지지 않는다 — 쓴 token_hash 를 모아 회수한다.
  private final List<String> tokenHashes = new ArrayList<>();

  @BeforeEach
  void setCtx() {
    TenantContext.set(1L);
  }

  @AfterEach
  void cleanup() {
    TenantContext.clear();
    if (!tokenHashes.isEmpty()) {
      dsl.deleteFrom(DRIVE_SHARE_LINK_ATTEMPTS)
          .where(DRIVE_SHARE_LINK_ATTEMPTS.TOKEN_HASH.in(tokenHashes))
          .execute();
      tokenHashes.clear();
    }
  }

  // --- 정보 조회 ---

  @Test
  void info_noPassword_returnsFileFields_andLoginAvailableForAnonymous() {
    long owner = seedUser("공유자");
    long spaceId = seedSpace(owner);
    long fileId = seedFile(spaceId);
    String token = link(owner, fileId, "EXTERNAL", null);
    TenantContext.clear();

    var info = (ShareInfoResponse.Full) service.info(token, null, null, null);
    assertThat(info.passwordRequired()).isFalse();
    assertThat(info.loginRequired()).isFalse();
    assertThat(info.name()).isEqualTo("a.txt");
    assertThat(info.mimeType()).isEqualTo("text/plain");
    assertThat(info.sizeBytes()).isEqualTo(3L);
    assertThat(info.sharedBy()).isEqualTo("공유자");
    assertThat(info.loginAvailable()).isTrue();
    assertThat(info.driveOpen()).isNull();
  }

  @Test
  void info_passwordWithoutToken_isPasswordRequired_andConsumesNoSlot() {
    long owner = seedUser("o");
    long fileId = seedFile(seedSpace(owner));
    String token = link(owner, fileId, "EXTERNAL", "secret");
    TenantContext.clear();

    for (int i = 0; i < 7; i++) {
      assertThat(service.info(token, null, null, null))
          .isEqualTo(new ShareInfoResponse.Gate(true, false));
    }
    assertThat(attempts(token)).isZero();
  }

  @Test
  void info_lockedLink_isStillPasswordRequired_withoutTouchingSlots() {
    long owner = seedUser("o");
    long fileId = seedFile(seedSpace(owner));
    String token = link(owner, fileId, "EXTERNAL", "secret");
    TenantContext.clear();
    for (int i = 0; i < 5; i++) {
      assertThatThrownBy(() -> service.unlock(token, "wrong", null, false))
          .isInstanceOf(DriveShareLinkUnauthorizedException.class);
    }
    int before = attempts(token);

    assertThat(service.info(token, null, null, null))
        .isEqualTo(ShareInfoResponse.passwordRequired());
    assertThat(attempts(token)).isEqualTo(before);
    // 잠긴 동안은 정답도 429(기존 잠금 예외)
    assertThatThrownBy(() -> service.unlock(token, "secret", null, false))
        .isInstanceOf(DriveShareLinkLockedException.class);
  }

  @Test
  void unlock_wrongPassword_is401_andConsumesSlot_thenCorrectIssuesWorkingToken() {
    long owner = seedUser("o");
    long fileId = seedFile(seedSpace(owner));
    String token = link(owner, fileId, "EXTERNAL", "secret");
    TenantContext.clear();

    assertThatThrownBy(() -> service.unlock(token, "wrong", null, false))
        .isInstanceOf(DriveShareLinkUnauthorizedException.class);
    assertThat(attempts(token)).isEqualTo(1);

    var vt = service.unlock(token, "secret", null, false);
    assertThat(vt.expiresAt()).isAfter(Instant.now().plus(Duration.ofMinutes(29)));
    var info = service.info(token, vt.viewToken(), null, null);
    assertThat(info).isInstanceOf(ShareInfoResponse.Full.class);
    assertThat(service.resolveForView(token, vt.viewToken(), null, false).driveFileId())
        .isEqualTo(fileId);
    // 다운로드도 열람 토큰을 받는다 — 비밀번호 없이 통과
    assertThat(service.resolveForDownload(token, null, vt.viewToken(), null, false).driveFileId())
        .isEqualTo(fileId);
  }

  @Test
  void viewToken_expired_tampered_orOtherLink_isRejected() {
    long owner = seedUser("o");
    long spaceId = seedSpace(owner);
    long fileId = seedFile(spaceId);
    String token = link(owner, fileId, "EXTERNAL", "secret");
    String other = link(owner, seedFile(spaceId, "b.txt"), "EXTERNAL", "secret");
    TenantContext.clear();
    String pwHash = passwordHashOf(token);

    // 만료 — 31분 전 시계로 발급
    var pastClock = Clock.fixed(Instant.now().minus(Duration.ofMinutes(31)), ZoneOffset.UTC);
    String expired =
        new ShareViewTokens(jwtProperties, pastClock)
            .issue(CapabilityTokens.sha256Hex(token), pwHash)
            .viewToken();
    assertThat(service.info(token, expired, null, null))
        .isEqualTo(ShareInfoResponse.passwordRequired());
    assertThatThrownBy(() -> service.resolveForView(token, expired, null, false))
        .isInstanceOf(DriveShareLinkUnauthorizedException.class);

    // 변조 — 서명 마지막 글자 바꿈
    String good = service.unlock(token, "secret", null, false).viewToken();
    char last = good.charAt(good.length() - 1);
    String tampered = good.substring(0, good.length() - 1) + (last == 'A' ? 'B' : 'A');
    assertThatThrownBy(() -> service.resolveForView(token, tampered, null, false))
        .isInstanceOf(DriveShareLinkUnauthorizedException.class);
    assertThatThrownBy(() -> service.resolveForView(token, "garbage", null, false))
        .isInstanceOf(DriveShareLinkUnauthorizedException.class);

    // 다른 링크의 토큰은 이 링크에 쓰이지 않는다
    String otherToken = service.unlock(other, "secret", null, false).viewToken();
    assertThatThrownBy(() -> service.resolveForView(token, otherToken, null, false))
        .isInstanceOf(DriveShareLinkUnauthorizedException.class);

    // 열람 토큰 무효 + 비밀번호 없는 다운로드는 기존처럼 401(시도 칸 사용)
    assertThatThrownBy(() -> service.resolveForDownload(token, null, tampered, null, false))
        .isInstanceOf(DriveShareLinkUnauthorizedException.class);
  }

  /** 잠금(WP-783)이 걸리면 앞서 받은 열람 토큰도 곧바로 막힌다 — 안 그러면 잠금 뒤에도 30분간 열린다. 잠금 확인은 읽기 전용이라 칸을 더 쓰지 않는다. */
  @Test
  void viewToken_rejectedWhileLinkLocked_withoutConsumingSlots() {
    long owner = seedUser("o");
    long fileId = seedFile(seedSpace(owner));
    String token = link(owner, fileId, "EXTERNAL", "secret");
    TenantContext.clear();
    String vt = service.unlock(token, "secret", null, false).viewToken();
    assertThat(service.resolveForView(token, vt, null, false).driveFileId()).isEqualTo(fileId);

    for (int i = 0; i < 5; i++) {
      assertThatThrownBy(() -> service.unlock(token, "wrong", null, false))
          .isInstanceOf(DriveShareLinkUnauthorizedException.class);
    }
    int locked = attempts(token);

    assertThat(service.info(token, vt, null, null)).isEqualTo(ShareInfoResponse.passwordRequired());
    assertThatThrownBy(() -> service.resolveForView(token, vt, null, false))
        .isInstanceOf(DriveShareLinkUnauthorizedException.class);
    // 다운로드는 토큰이 막혀 비밀번호 단계로 넘어가고, 잠겨 있으니 429(잠금 예외)
    assertThatThrownBy(() -> service.resolveForDownload(token, null, vt, null, false))
        .isInstanceOf(DriveShareLinkLockedException.class);
    assertThat(attempts(token)).isEqualTo(locked);
  }

  @Test
  void viewToken_passwordChanged_isInvalidated() {
    long owner = seedUser("o");
    long fileId = seedFile(seedSpace(owner));
    String token = link(owner, fileId, "EXTERNAL", "secret");
    TenantContext.clear();
    String vt = service.unlock(token, "secret", null, false).viewToken();

    // 비밀번호 변경 API 는 없지만 해시가 바뀌면(재설정 등) 기존 토큰이 무효여야 한다 — DB 를 직접 바꿔 확인.
    TenantContext.set(1L);
    dsl.update(DRIVE_SHARE_LINK)
        .set(
            DRIVE_SHARE_LINK.PASSWORD_HASH,
            "$2a$10$abcdefghijklmnopqrstuuJ8Q2mE2l3wHTVm1lD0eqJvSL7pY2bq")
        .where(DRIVE_SHARE_LINK.TOKEN_HASH.eq(CapabilityTokens.sha256Hex(token)))
        .execute();
    TenantContext.clear();

    assertThat(service.info(token, vt, null, null)).isEqualTo(ShareInfoResponse.passwordRequired());
    assertThatThrownBy(() -> service.resolveForView(token, vt, null, false))
        .isInstanceOf(DriveShareLinkUnauthorizedException.class);
  }

  @Test
  void viewToken_revokedLink_isGone() {
    long owner = seedUser("o");
    long fileId = seedFile(seedSpace(owner));
    var created =
        service.create(owner, fileId, new CreateShareLinkRequest("EXTERNAL", "secret", null));
    tokenHashes.add(CapabilityTokens.sha256Hex(created.token()));
    TenantContext.clear();
    String vt = service.unlock(created.token(), "secret", null, false).viewToken();
    TenantContext.set(1L);
    service.revoke(owner, created.id());
    TenantContext.clear();

    assertThatThrownBy(() -> service.info(created.token(), vt, null, null))
        .isInstanceOf(DriveShareLinkGoneException.class);
    assertThatThrownBy(() -> service.resolveForView(created.token(), vt, null, false))
        .isInstanceOf(DriveShareLinkGoneException.class);
    assertThatThrownBy(() -> service.resolveForDownload(created.token(), null, vt, null, false))
        .isInstanceOf(DriveShareLinkGoneException.class);
  }

  @Test
  void info_internal_anonymous_isLoginRequired_otherWorkspace_isForbidden() {
    long owner = seedUser("o");
    long fileId = seedFile(seedSpace(owner));
    String token = link(owner, fileId, "INTERNAL", "secret");
    TenantContext.clear();

    // 비로그인 → 로그인 안내(비밀번호보다 먼저, 파일 필드 없음)
    assertThat(service.info(token, null, null, null)).isEqualTo(ShareInfoResponse.loginRequired());
    // 다른 워크스페이스 로그인 → 403
    assertThatThrownBy(() -> service.info(token, null, 2L, owner))
        .isInstanceOf(DriveForbiddenException.class);
    assertThatThrownBy(() -> service.resolveForView(token, null, null, false))
        .isInstanceOf(DriveShareLinkUnauthorizedException.class);
    // 같은 워크스페이스 로그인 → 비밀번호 단계로
    assertThat(service.info(token, null, 1L, owner))
        .isEqualTo(ShareInfoResponse.passwordRequired());
    assertThat(attempts(token)).isZero();
  }

  @Test
  void info_order_404_410_inactiveTenant() {
    assertThatThrownBy(() -> service.info("sl_nope_" + UUID.randomUUID(), null, null, null))
        .isInstanceOf(DriveShareLinkNotFoundException.class);

    long owner = seedUser("o");
    long spaceId = seedSpace(owner);
    // 만료(과거) — 생성 검증을 우회해 DB 로 과거 만료일을 넣는다
    String expiredToken = link(owner, seedFile(spaceId), "EXTERNAL", "secret");
    dsl.update(DRIVE_SHARE_LINK)
        .set(DRIVE_SHARE_LINK.EXPIRES_AT, dbNow().minusDays(1))
        .where(DRIVE_SHARE_LINK.TOKEN_HASH.eq(CapabilityTokens.sha256Hex(expiredToken)))
        .execute();
    String activeToken = link(owner, seedFile(spaceId, "b.txt"), "INTERNAL", "secret");
    TenantContext.clear();

    // 만료는 비밀번호보다 먼저 410
    assertThatThrownBy(() -> service.info(expiredToken, null, null, null))
        .isInstanceOf(DriveShareLinkGoneException.class);

    // 비활성 테넌트는 410·로그인·비밀번호보다 먼저 404
    dsl.update(TENANT).set(TENANT.STATUS, "DELETED").where(TENANT.ID.eq(1L)).execute();
    assertThatThrownBy(() -> service.info(expiredToken, null, null, null))
        .isInstanceOf(DriveShareLinkNotFoundException.class);
    assertThatThrownBy(() -> service.info(activeToken, null, null, null))
        .isInstanceOf(DriveShareLinkNotFoundException.class);
    assertThatThrownBy(() -> service.unlock(activeToken, "x", 1L, true))
        .isInstanceOf(DriveShareLinkNotFoundException.class);
    assertThat(attempts(activeToken)).isZero();
  }

  @Test
  void info_trashedFile_isShareLinkNotFound() {
    long owner = seedUser("o");
    long fileId = seedFile(seedSpace(owner));
    String token = link(owner, fileId, "EXTERNAL", null);
    dsl.update(DRIVE_FILE)
        .set(DRIVE_FILE.TRASHED_AT, dbNow())
        .where(DRIVE_FILE.ID.eq(fileId))
        .execute();
    TenantContext.clear();
    assertThatThrownBy(() -> service.info(token, null, null, null))
        .isInstanceOf(DriveShareLinkNotFoundException.class)
        .hasMessage("공유 링크를 찾을 수 없습니다");
  }

  @Test
  void info_driveOpen_onlyForSameWorkspaceSpaceMember() {
    long owner = seedUser("o");
    long spaceId = seedSpace(owner);
    long fileId = seedFile(spaceId);
    long viewer = seedUser("v");
    dsl.insertInto(DRIVE_SPACE_MEMBER)
        .set(DRIVE_SPACE_MEMBER.SPACE_ID, spaceId)
        .set(DRIVE_SPACE_MEMBER.USER_ID, viewer)
        .set(DRIVE_SPACE_MEMBER.ROLE, "VIEWER")
        .execute();
    long outsider = seedUser("x");
    String token = link(owner, fileId, "EXTERNAL", null);

    var asViewer = (ShareInfoResponse.Full) service.info(token, null, 1L, viewer);
    assertThat(asViewer.driveOpen())
        .isEqualTo(new ShareInfoResponse.DriveOpen(spaceId, null, fileId));
    assertThat(asViewer.loginAvailable()).isFalse();

    // 같은 워크스페이스지만 공간 멤버가 아님
    assertThat(((ShareInfoResponse.Full) service.info(token, null, 1L, outsider)).driveOpen())
        .isNull();
    // 다른 워크스페이스 로그인(외부 링크라 열람은 됨) — 멤버 id 여도 위치를 주지 않는다
    assertThat(((ShareInfoResponse.Full) service.info(token, null, 2L, viewer)).driveOpen())
        .isNull();
    // 비로그인
    assertThat(((ShareInfoResponse.Full) service.info(token, null, null, null)).driveOpen())
        .isNull();
    // 요청자의 원래 컨텍스트가 되돌려진다
    assertThat(TenantContext.get()).isEqualTo(1L);
  }

  @Test
  void resolveForView_noPasswordLink_needsNoToken() {
    long owner = seedUser("o");
    long fileId = seedFile(seedSpace(owner));
    String token = link(owner, fileId, "EXTERNAL", null);
    TenantContext.clear();
    assertThat(service.resolveForView(token, null, null, false).driveFileId()).isEqualTo(fileId);
  }

  // --- 헬퍼 ---

  private String link(long owner, long fileId, String audience, String password) {
    var created =
        service.create(owner, fileId, new CreateShareLinkRequest(audience, password, null));
    tokenHashes.add(CapabilityTokens.sha256Hex(created.token()));
    return created.token();
  }

  private int attempts(String token) {
    Integer n =
        dsl.select(DRIVE_SHARE_LINK_ATTEMPTS.ATTEMPTS)
            .from(DRIVE_SHARE_LINK_ATTEMPTS)
            .where(DRIVE_SHARE_LINK_ATTEMPTS.TOKEN_HASH.eq(CapabilityTokens.sha256Hex(token)))
            .fetchOne(DRIVE_SHARE_LINK_ATTEMPTS.ATTEMPTS);
    return n == null ? 0 : n;
  }

  private String passwordHashOf(String token) {
    TenantContext.set(1L);
    try {
      return dsl.select(DRIVE_SHARE_LINK.PASSWORD_HASH)
          .from(DRIVE_SHARE_LINK)
          .where(DRIVE_SHARE_LINK.TOKEN_HASH.eq(CapabilityTokens.sha256Hex(token)))
          .fetchOne(DRIVE_SHARE_LINK.PASSWORD_HASH);
    } finally {
      TenantContext.clear();
    }
  }

  private long seedUser(String name) {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "sv_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, name)
        .set(USER.EMAIL, "sv_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  private long seedSpace(long ownerId) {
    long spaceId =
        dsl.insertInto(DRIVE_SPACE)
            .set(DRIVE_SPACE.TYPE, "TEAM")
            .set(DRIVE_SPACE.NAME, "sp")
            .set(DRIVE_SPACE.OWNER_ID, ownerId)
            .returning(DRIVE_SPACE.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(DRIVE_SPACE_MEMBER)
        .set(DRIVE_SPACE_MEMBER.SPACE_ID, spaceId)
        .set(DRIVE_SPACE_MEMBER.USER_ID, ownerId)
        .set(DRIVE_SPACE_MEMBER.ROLE, "OWNER")
        .execute();
    return spaceId;
  }

  private long seedFile(long spaceId) {
    return seedFile(spaceId, "a.txt");
  }

  /** 같은 공간에 파일을 둘 이상 둘 때는 이름을 달리한다(공간·폴더 안 이름 유일). */
  private long seedFile(long spaceId, String name) {
    long uploadedBy = seedUser("up");
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long coreFileId =
        dsl.insertInto(FILE)
            .set(FILE.ORIGINAL_NAME, "a.txt")
            .set(FILE.STORED_NAME, "stored-" + s)
            .set(FILE.STORAGE_PATH, "/tmp/a-" + s + ".txt")
            .set(FILE.MIME_TYPE, "text/plain")
            .set(FILE.SIZE_BYTES, 3L)
            .set(FILE.UPLOADED_BY, uploadedBy)
            .returning(FILE.ID)
            .fetchOne()
            .getId();
    return dsl.insertInto(DRIVE_FILE)
        .set(DRIVE_FILE.SPACE_ID, spaceId)
        .set(DRIVE_FILE.FILE_ID, coreFileId)
        .set(DRIVE_FILE.NAME, name)
        .returning(DRIVE_FILE.ID)
        .fetchOne()
        .getId();
  }
}
