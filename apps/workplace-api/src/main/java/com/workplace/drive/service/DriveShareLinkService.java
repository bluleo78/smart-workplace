package com.workplace.drive.service;

import com.workplace.audit.service.AuditLogService;
import com.workplace.drive.dto.CreateShareLinkRequest;
import com.workplace.drive.dto.CreatedShareLinkResponse;
import com.workplace.drive.dto.ShareInfoResponse;
import com.workplace.drive.dto.ShareLinkResponse;
import com.workplace.drive.exception.DriveFileNotFoundException;
import com.workplace.drive.exception.DriveInvalidTargetException;
import com.workplace.drive.exception.DriveShareLinkNotFoundException;
import com.workplace.drive.repository.DriveFileRepository;
import com.workplace.drive.repository.DriveShareLinkRepository;
import com.workplace.drive.repository.DriveSpaceMemberRepository;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.tenant.TenantStatusChecker;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.user.repository.UserRepository;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/** 공유 링크 관리(생성/목록/폐기). 생성 권한 EDITOR. 평문 토큰은 생성 응답 1회만. */
@Service
@RequiredArgsConstructor
public class DriveShareLinkService {
  private static final Set<String> AUDIENCES = Set.of("EXTERNAL", "INTERNAL");

  private final DriveShareLinkRepository links;
  private final DriveFileRepository files;
  private final DrivePermissions perms;
  private final PasswordEncoder passwordEncoder;

  /** 공유 링크 비밀번호 브루트포스 방어(#700). */
  private final DriveShareLinkAttemptService attemptService;

  /** 감사 로그 기록(#81). */
  private final AuditLogService auditLogService;

  /** 사용자명 조회용 — 감사 로그에 username 을 기록한다(#81). */
  private final UserRepository userRepository;

  // WP-341: 정지·삭제된 테넌트의 공유 링크를 "없음"으로 처리하기 위한 테넌트 상태 확인.
  private final TenantStatusChecker tenantStatusChecker;

  /**
   * 익명 공개 경로에서 링크의 워크스페이스로 감사를 남기거나(WP-789 — logInTenant 는 트랜잭션 안에서만) 공유 정보를 읽을 때(WP-1227 — FORCE
   * RLS 라 트랜잭션 밖 조회는 빈 결과) 쓰는 트랜잭션.
   */
  private final TransactionTemplate tx;

  /** 공유 링크 열람 토큰 발급·검증(WP-1227). */
  private final ShareViewTokens viewTokens;

  /** 「드라이브에서 열기」 판정 — 요청자의 공간 역할(부서 역할 포함, WP-1227). */
  private final DriveSpaceMemberRepository spaceMembers;

  /** 링크 생성. 파일의 공간 EDITOR 검증 → 토큰 생성 → 해시 저장 → 평문 1회 반환. */
  @Transactional
  public CreatedShareLinkResponse create(
      long callerId, long driveFileId, CreateShareLinkRequest req) {
    DriveFileRepository.DriveFileRow row =
        files.findRow(driveFileId).orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    perms.requireRole(row.spaceId(), callerId, "EDITOR");

    String audience = req.audience();
    if (audience == null || !AUDIENCES.contains(audience)) {
      throw new DriveInvalidTargetException("공유 대상이 올바르지 않습니다.");
    }
    String token = CapabilityTokens.generate("sl_");
    String tokenHash = CapabilityTokens.sha256Hex(token);
    String pwHash =
        (req.password() == null || req.password().isBlank())
            ? null
            : passwordEncoder.encode(req.password());
    OffsetDateTime expiresAt =
        req.expiresAt() == null ? null : req.expiresAt().atOffset(ZoneOffset.UTC);
    // 과거 만료일 차단(#673) — 프런트 가드가 우회되더라도(직접 API 호출 등) 생성 시점부터
    // 이미 무효인 링크가 만들어지지 않도록 서버에서도 강제.
    if (expiresAt != null && expiresAt.isBefore(OffsetDateTime.now())) {
      throw new DriveInvalidTargetException("만료일은 현재 시각 이후여야 합니다.");
    }

    long id =
        links.insert(driveFileId, row.spaceId(), tokenHash, audience, pwHash, expiresAt, callerId);
    // 감사 로그 — FILE_SHARE(#81), 같은 @Transactional 안에서 기록.
    auditLogService.log(
        callerId,
        usernameOf(callerId),
        "FILE_SHARE",
        "drive",
        String.valueOf(driveFileId),
        "공유 링크 생성",
        null,
        null,
        "SUCCESS",
        null,
        Map.of("spaceId", row.spaceId(), "audience", audience));
    return new CreatedShareLinkResponse(id, token, audience, pwHash != null, expiresAt);
  }

  /** 파일의 링크 목록. EDITOR 검증(보관 공간도 허용 — 폐기할 링크를 찾아야 하므로). 토큰 미포함. */
  @Transactional(readOnly = true)
  public List<ShareLinkResponse> list(long callerId, long driveFileId) {
    DriveFileRepository.DriveFileRow row =
        files.findRow(driveFileId).orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    perms.requireRoleEvenIfArchived(row.spaceId(), callerId, "EDITOR");
    return links.listByFile(driveFileId);
  }

  /** 링크 폐기. 링크의 공간 EDITOR 검증(보관 공간도 허용 — 공유 중단은 노출을 줄이는 작업). 미존재/이미폐기 → 404. */
  @Transactional
  public void revoke(long callerId, long linkId) {
    Long spaceId =
        links.findSpaceIdOfActive(linkId).orElseThrow(DriveShareLinkNotFoundException::new);
    perms.requireRoleEvenIfArchived(spaceId, callerId, "EDITOR");
    links.revoke(linkId);
  }

  /**
   * 공개 다운로드용 resolve + 가드. 컨텍스트 설정은 호출부(컨트롤러)가 담당(2-트랜잭션).
   *
   * <p>비밀번호 검증에는 브루트포스 방어(#700)가 적용된다 — {@code login_attempts}(#144)와 동일 정책(5회 연속 실패 시 15분 잠금)을 공유
   * 토큰의 SHA-256 hex(token_hash) 기준으로 적용한다. 비교 전에 시도 한 칸을 원자적으로 잡아(WP-783) 동시 요청으로도 상한을 넘겨 추측하지 못하게
   * 하고, 잠긴 상태에서는 bcrypt 비교조차 수행하지 않는다(fail-closed, 연산 낭비 방지).
   *
   * <p>WP-1227: 열람 토큰도 받는다. 링크 가드는 그대로 거치고, 비밀번호 링크에서 열람 토큰이 유효하면(잠기지 않았을 때만) 비밀번호 검증을 건너뛴다. 토큰이
   * 없거나 무효면 기존과 같은 비밀번호 검증으로 넘어간다 — 다운로드 계약은 바뀌지 않는다.
   */
  public ResolvedTarget resolveForDownload(
      String token,
      String password,
      String viewToken,
      Long requesterTenantId,
      boolean authenticated) {
    GuardedLink g = guard(token, requesterTenantId, authenticated);
    if (requiresPassword(g, viewToken)) {
      verifyPassword(g, password);
    }
    return g.target();
  }

  /**
   * 미리보기·원본(inline) 경로용 resolve(WP-1227). 링크 가드는 그대로이고, 비밀번호 링크는 유효한 열람 토큰만 받는다 — 비밀번호 자체는 받지 않아 이
   * 경로로는 시도 칸을 쓰지 않는다(비밀번호 추측은 /unlock 한 곳에서만, 속도 제한·잠금과 함께). 토큰이 없거나 무효면 401.
   */
  public ResolvedTarget resolveForView(
      String token, String viewToken, Long requesterTenantId, boolean authenticated) {
    GuardedLink g = guard(token, requesterTenantId, authenticated);
    if (requiresPassword(g, viewToken)) {
      throw new com.workplace.drive.exception.DriveShareLinkUnauthorizedException(
          "비밀번호 확인이 필요하거나 열람 시간이 지났습니다");
    }
    return g.target();
  }

  /**
   * 비밀번호를 확인하고 열람 토큰을 발급한다(POST /unlock, WP-1227). 시도 칸·잠금·감사는 다운로드와 같은 {@link #verifyPassword} 를
   * 쓴다 — 틀리면 401, 잠기면 429(기존 매핑). 비밀번호 없는 링크도 토큰을 돌려준다(클라이언트가 분기하지 않아도 되게, 확인할 것이 없으니 무해).
   */
  public ShareViewTokens.ViewToken unlock(
      String token, String password, Long requesterTenantId, boolean authenticated) {
    GuardedLink g = guard(token, requesterTenantId, authenticated);
    verifyPassword(g, password);
    return viewTokens.issue(g.tokenHash(), g.link().passwordHash());
  }

  /**
   * 공유 링크 정보(GET /share/{token}, WP-1227) — 받는 화면이 미리보기·잠금·로그인 안내 중 무엇을 보일지 정한다. 시도 칸을 쓰지 않는다(잠긴
   * 링크도 「비밀번호 필요」로만 답한다 — 정보 조회로 잠금 여부를 떠보거나 칸을 소모시키지 못하게).
   *
   * <p>순서는 다운로드와 같다: 404(없음·비활성 테넌트) → 410(만료·폐기) → 사내 링크(비로그인 200 loginRequired, 다른 워크스페이스 403) →
   * 비밀번호 링크 + 유효 토큰 없음 200 passwordRequired → 파일 정보. 휴지통·없는 파일은 다운로드와 같은 404 「공유 링크 없음」.
   *
   * <p>파일·만든 사람·공간 권한은 링크 워크스페이스로 컨텍스트를 세운 뒤 트랜잭션 안에서 읽는다 — FORCE RLS 라 트랜잭션 밖의 조회는 빈 결과가 된다. 끝나면
   * 요청자의 원래 컨텍스트로 되돌린다.
   *
   * @param requesterUserId 로그인 사용자 id(비로그인 null) — driveOpen 판정용
   */
  public ShareInfoResponse info(
      String token, String viewToken, Long requesterTenantId, Long requesterUserId) {
    boolean authenticated = requesterUserId != null;
    String tokenHash = CapabilityTokens.sha256Hex(token);
    var link = resolveActive(tokenHash);
    if ("INTERNAL".equals(link.audience()) && (!authenticated || requesterTenantId == null)) {
      return ShareInfoResponse.loginRequired();
    }
    GuardedLink g = new GuardedLink(tokenHash, link);
    checkAudience(link, requesterTenantId, authenticated);
    if (requiresPassword(g, viewToken)) {
      return ShareInfoResponse.passwordRequired();
    }
    boolean sameWorkspace =
        authenticated && requesterTenantId != null && requesterTenantId == link.tenantId();
    return TenantContext.callAs(
        link.tenantId(),
        () ->
            tx.execute(
                st -> {
                  DriveFileRepository.DriveFileRow row =
                      files
                          .findRow(link.driveFileId())
                          .orElseThrow(
                              com.workplace.drive.exception.DriveShareLinkNotFoundException::new);
                  var meta =
                      links
                          .findFileMeta(row.fileId())
                          .orElseThrow(
                              com.workplace.drive.exception.DriveShareLinkNotFoundException::new);
                  String sharedBy = links.findCreatorName(tokenHash).orElse(null);
                  // 「드라이브에서 열기」는 같은 워크스페이스에서 그 공간을 볼 수 있는(VIEWER 이상, 부서 역할 포함) 사람에게만 보인다 —
                  // 볼 수 없는 사람에게 공간·폴더 id 를 알려 주지 않는다.
                  ShareInfoResponse.DriveOpen driveOpen =
                      sameWorkspace
                              && spaceMembers.findRole(row.spaceId(), requesterUserId).isPresent()
                          ? new ShareInfoResponse.DriveOpen(row.spaceId(), row.folderId(), row.id())
                          : null;
                  return ShareInfoResponse.full(
                      row.name(),
                      meta.mimeType(),
                      meta.sizeBytes(),
                      sharedBy,
                      !authenticated,
                      driveOpen);
                }));
  }

  /**
   * 링크 가드(시도 칸 없음) — 404(없음·비활성 테넌트) → 410(만료·폐기) → 사내 링크 로그인(401)·워크스페이스(403). 비밀번호는 보지 않는다(
   * {@link #verifyPassword} 또는 열람 토큰이 맡는다). 모든 공개 경로가 매 요청 이 가드를 거친다.
   */
  private GuardedLink guard(String token, Long requesterTenantId, boolean authenticated) {
    String tokenHash = CapabilityTokens.sha256Hex(token);
    var link = resolveActive(tokenHash);
    checkAudience(link, requesterTenantId, authenticated);
    return new GuardedLink(tokenHash, link);
  }

  /** 링크를 찾아 존재·테넌트 활성·만료·폐기를 본다(404 → 410). */
  private DriveShareLinkRepository.ResolvedLink resolveActive(String tokenHash) {
    var link =
        links
            .resolve(tokenHash)
            .orElseThrow(com.workplace.drive.exception.DriveShareLinkNotFoundException::new);
    // WP-341: 정지·삭제·영구 삭제 중인 테넌트의 링크는 "링크 없음"과 같은 404. 만료·비밀번호·잠금 가드보다 먼저 검사해야
    // 응답 코드(410/401/423)로 링크 존재가 드러나지 않고, 비활성 테넌트에 비밀번호 시도 카운터도 쌓이지 않는다.
    if (!tenantStatusChecker.isActive(link.tenantId())) {
      throw new com.workplace.drive.exception.DriveShareLinkNotFoundException();
    }

    if (link.revokedAt() != null
        || (link.expiresAt() != null
            && link.expiresAt().isBefore(java.time.OffsetDateTime.now()))) {
      throw new com.workplace.drive.exception.DriveShareLinkGoneException();
    }
    return link;
  }

  /** 사내(INTERNAL) 링크 범위 — 비로그인 401, 다른 워크스페이스 403. 외부 링크는 통과. */
  private static void checkAudience(
      DriveShareLinkRepository.ResolvedLink link, Long requesterTenantId, boolean authenticated) {
    if ("INTERNAL".equals(link.audience())) {
      if (!authenticated || requesterTenantId == null) {
        throw new com.workplace.drive.exception.DriveShareLinkUnauthorizedException(
            "사내 공유 링크는 로그인이 필요합니다");
      }
      if (requesterTenantId.longValue() != link.tenantId()) {
        throw new com.workplace.drive.exception.DriveForbiddenException(0L, 0L);
      }
    }
  }

  /**
   * 이 요청이 아직 비밀번호 확인을 거쳐야 하는가 — 비밀번호 링크인데 쓸 수 있는 열람 토큰이 없을 때 true. 정보·미리보기·다운로드가 같은 판정을 쓴다.
   *
   * <p>열람 토큰은 이 링크·현재 비밀번호 해시로 발급돼 만료 전이어야 하고, 링크가 잠겨 있지 않아야 한다(WP-783 잠금이 걸리면 앞서 받은 토큰도 곧바로 막는다 —
   * 안 그러면 잠금 뒤에도 30분간 열린다). 잠금 확인은 시도 칸을 잡지 않는 읽기 전용이다. 서명이 맞는 토큰일 때만 DB 를 읽는다.
   */
  private boolean requiresPassword(GuardedLink g, String viewToken) {
    String passwordHash = g.link().passwordHash();
    if (passwordHash == null) return false;
    return !viewTokens.isValid(viewToken, g.tokenHash(), passwordHash)
        || attemptService.isBlocked(g.tokenHash());
  }

  /**
   * 비밀번호 검증(시도 칸 사용, WP-783). 비밀번호 없는 링크는 통과. 비교 전에 시도 한 칸을 잡고 — 잠겼으면(칸 없음) bcrypt 비교조차 하지 않고 429 —
   * 틀리면 401, 이번 실패로 잠금이 걸렸으면 링크 워크스페이스로 SHARE_LINK_LOCKED 감사를 남긴다.
   */
  private void verifyPassword(GuardedLink g, String password) {
    var link = g.link();
    String tokenHash = g.tokenHash();
    if (link.passwordHash() != null) {
      // 비교 전에 시도 한 칸을 잡는다(WP-783) — 잠겼으면(칸 없음) bcrypt 비교조차 하지 않는다.
      int attempt = attemptService.tryReserve(tokenHash);
      if (attempt == 0) {
        throw new com.workplace.drive.exception.DriveShareLinkLockedException(
            "비밀번호 시도 횟수를 초과했습니다. 잠시 후 다시 시도해 주세요");
      }
      if (password == null || !passwordEncoder.matches(password, link.passwordHash())) {
        // 잡은 칸이 곧 실패 기록이다.
        if (attemptService.reachedLimit(attempt)) {
          // 잠금이 이번 실패로 발동됨 — 이상 시도 추적을 위해 감사 로그 기록(#700). 익명 공개 경로라 워크스페이스 컨텍스트가 없어 그대로
          // 남기면 tenant_id 가 비어 링크 주인 워크스페이스 관리자에게 보이지 않았다 — 링크의 워크스페이스로 남긴다(WP-789).
          tx.executeWithoutResult(
              st ->
                  auditLogService.logInTenant(
                      link.tenantId(),
                      null,
                      "anonymous",
                      "SHARE_LINK_LOCKED",
                      "drive",
                      String.valueOf(link.driveFileId()),
                      "공유 링크 비밀번호 잠금(브루트포스 방어)",
                      null,
                      null,
                      "BLOCKED",
                      null,
                      Map.of("tenantId", link.tenantId())));
        }
        throw new com.workplace.drive.exception.DriveShareLinkUnauthorizedException(
            "비밀번호가 필요하거나 올바르지 않습니다");
      }
      attemptService.attemptSucceeded(tokenHash);
    }
  }

  /** 가드를 통과한 링크(토큰 해시 + resolve 결과). */
  private record GuardedLink(String tokenHash, DriveShareLinkRepository.ResolvedLink link) {
    ResolvedTarget target() {
      return new ResolvedTarget(link.tenantId(), link.driveFileId());
    }
  }

  /** resolve 결과(다운로드 대상). */
  public record ResolvedTarget(long tenantId, long driveFileId) {}

  /**
   * 감사 로그용 사용자명 조회. 없으면 userId 문자열로 대체(#81).
   *
   * <p>AuthService 와 동일하게 UserRepository.findById 를 통해 username 을 얻는다.
   */
  private String usernameOf(long userId) {
    return userRepository
        .findById(userId)
        .map(com.workplace.user.dto.UserResponse::username)
        .orElse(String.valueOf(userId));
  }
}
