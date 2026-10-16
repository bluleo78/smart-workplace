package com.workplace.drive.service;

import com.workplace.audit.service.AuditLogService;
import com.workplace.drive.dto.CreateShareLinkRequest;
import com.workplace.drive.dto.CreatedShareLinkResponse;
import com.workplace.drive.dto.ShareLinkResponse;
import com.workplace.drive.exception.DriveFileNotFoundException;
import com.workplace.drive.exception.DriveInvalidTargetException;
import com.workplace.drive.exception.DriveShareLinkNotFoundException;
import com.workplace.drive.repository.DriveFileRepository;
import com.workplace.drive.repository.DriveShareLinkRepository;
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

  /** 파일의 링크 목록. EDITOR 검증. 토큰 미포함. */
  @Transactional(readOnly = true)
  public List<ShareLinkResponse> list(long callerId, long driveFileId) {
    DriveFileRepository.DriveFileRow row =
        files.findRow(driveFileId).orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    perms.requireRole(row.spaceId(), callerId, "EDITOR");
    return links.listByFile(driveFileId);
  }

  /** 링크 폐기. 링크의 공간 EDITOR 검증. 미존재/이미폐기 → 404. */
  @Transactional
  public void revoke(long callerId, long linkId) {
    Long spaceId =
        links.findSpaceIdOfActive(linkId).orElseThrow(DriveShareLinkNotFoundException::new);
    perms.requireRole(spaceId, callerId, "EDITOR");
    links.revoke(linkId);
  }

  /**
   * 공개 다운로드용 resolve + 가드. 컨텍스트 설정은 호출부(컨트롤러)가 담당(2-트랜잭션).
   *
   * <p>비밀번호 검증에는 브루트포스 방어(#700)가 적용된다 — {@code login_attempts}(#144)와 동일 정책(5회 연속 실패 시 15분 잠금)을 공유
   * 토큰의 SHA-256 hex(token_hash) 기준으로 적용한다. 비교 전에 잠금 여부를 먼저 확인해 잠긴 상태에서는 bcrypt 비교조차 수행하지
   * 않는다(fail-closed, 연산 낭비 방지).
   */
  public ResolvedTarget resolveForDownload(
      String token, String password, Long requesterTenantId, boolean authenticated) {
    String tokenHash = CapabilityTokens.sha256Hex(token);
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

    if ("INTERNAL".equals(link.audience())) {
      if (!authenticated || requesterTenantId == null) {
        throw new com.workplace.drive.exception.DriveShareLinkUnauthorizedException(
            "사내 공유 링크는 로그인이 필요합니다");
      }
      if (requesterTenantId.longValue() != link.tenantId()) {
        throw new com.workplace.drive.exception.DriveForbiddenException(0L, 0L);
      }
    }

    if (link.passwordHash() != null) {
      if (attemptService.isBlocked(tokenHash)) {
        throw new com.workplace.drive.exception.DriveShareLinkLockedException(
            "비밀번호 시도 횟수를 초과했습니다. 잠시 후 다시 시도해 주세요");
      }
      if (password == null || !passwordEncoder.matches(password, link.passwordHash())) {
        attemptService.attemptFailed(tokenHash);
        if (attemptService.isBlocked(tokenHash)) {
          // 잠금이 이번 실패로 발동됨 — 이상 시도 추적을 위해 감사 로그 기록(#700)
          auditLogService.log(
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
              Map.of("tenantId", link.tenantId()));
        }
        throw new com.workplace.drive.exception.DriveShareLinkUnauthorizedException(
            "비밀번호가 필요하거나 올바르지 않습니다");
      }
      attemptService.attemptSucceeded(tokenHash);
    }
    return new ResolvedTarget(link.tenantId(), link.driveFileId());
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
