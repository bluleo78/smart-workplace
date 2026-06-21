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
import com.workplace.user.repository.UserRepository;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HexFormat;
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
  private static final String BASE62 =
      "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  private static final Set<String> AUDIENCES = Set.of("EXTERNAL", "INTERNAL");

  private final DriveShareLinkRepository links;
  private final DriveFileRepository files;
  private final DrivePermissions perms;
  private final PasswordEncoder passwordEncoder;
  private final SecureRandom secureRandom = new SecureRandom();

  /** 감사 로그 기록(#81). */
  private final AuditLogService auditLogService;

  /** 사용자명 조회용 — 감사 로그에 username 을 기록한다(#81). */
  private final UserRepository userRepository;

  /** 링크 생성. 파일의 공간 EDITOR 검증 → 토큰 생성 → 해시 저장 → 평문 1회 반환. */
  @Transactional
  public CreatedShareLinkResponse create(
      long callerId, long driveFileId, CreateShareLinkRequest req) {
    DriveFileRepository.DriveFileRow row =
        files.findRow(driveFileId).orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    perms.requireRole(row.spaceId(), callerId, "EDITOR");

    String audience = req.audience();
    if (audience == null || !AUDIENCES.contains(audience)) {
      throw new DriveInvalidTargetException("invalid audience");
    }
    String token = generateToken();
    String tokenHash = sha256Hex(token);
    String pwHash =
        (req.password() == null || req.password().isBlank())
            ? null
            : passwordEncoder.encode(req.password());
    OffsetDateTime expiresAt =
        req.expiresAt() == null ? null : req.expiresAt().atOffset(ZoneOffset.UTC);

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

  /** 공개 다운로드용 resolve + 가드. 컨텍스트 설정은 호출부(컨트롤러)가 담당(2-트랜잭션). */
  public ResolvedTarget resolveForDownload(
      String token, String password, Long requesterTenantId, boolean authenticated) {
    var link =
        links
            .resolve(sha256Hex(token))
            .orElseThrow(com.workplace.drive.exception.DriveShareLinkNotFoundException::new);

    if (link.revokedAt() != null
        || (link.expiresAt() != null
            && link.expiresAt().isBefore(java.time.OffsetDateTime.now()))) {
      throw new com.workplace.drive.exception.DriveShareLinkGoneException();
    }

    if ("INTERNAL".equals(link.audience())) {
      if (!authenticated || requesterTenantId == null) {
        throw new com.workplace.drive.exception.DriveShareLinkUnauthorizedException(
            "login required");
      }
      if (requesterTenantId.longValue() != link.tenantId()) {
        throw new com.workplace.drive.exception.DriveForbiddenException(0L, 0L);
      }
    }

    if (link.passwordHash() != null) {
      if (password == null || !passwordEncoder.matches(password, link.passwordHash())) {
        throw new com.workplace.drive.exception.DriveShareLinkUnauthorizedException(
            "password required");
      }
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

  /** sl_ + base62(32 random bytes). */
  private String generateToken() {
    byte[] bytes = new byte[32];
    secureRandom.nextBytes(bytes);
    BigInteger n = new BigInteger(1, bytes);
    BigInteger base = BigInteger.valueOf(62);
    StringBuilder sb = new StringBuilder();
    while (n.signum() > 0) {
      BigInteger[] qr = n.divideAndRemainder(base);
      sb.insert(0, BASE62.charAt(qr[1].intValue()));
      n = qr[0];
    }
    return "sl_" + (sb.length() > 0 ? sb.toString() : "0");
  }

  /** SHA-256 hex(저장/조회 키). 공개 resolve(Task 5)도 동일 해시 사용. */
  public static String sha256Hex(String plaintext) {
    try {
      MessageDigest md = MessageDigest.getInstance("SHA-256");
      byte[] hash = md.digest(plaintext.getBytes(StandardCharsets.UTF_8));
      return HexFormat.of().formatHex(hash);
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException("SHA-256 미지원", e);
    }
  }
}
