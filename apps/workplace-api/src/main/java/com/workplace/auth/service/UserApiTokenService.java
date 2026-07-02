package com.workplace.auth.service;

import com.workplace.audit.service.AuditLogService;
import com.workplace.auth.dto.IssueUserTokenRequest;
import com.workplace.auth.dto.UserApiTokenIssueResponse;
import com.workplace.auth.dto.UserApiTokenResponse;
import com.workplace.auth.exception.ActiveTenantRequiredException;
import com.workplace.auth.exception.UserTokenNotFoundException;
import com.workplace.auth.repository.UserApiTokenRepository;
import com.workplace.global.tenant.TenantContext;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 사용자 PAT 발급/조회/회수 서비스. 평문은 발급 응답으로만 1회 노출되며 DB 에는 SHA-256 hex 만 저장한다. 토큰은 발급 시점의 활성
 * 테넌트(TenantContext)에 바인딩된다 — MCP 등 외부 클라이언트가 헤더 하나로 테넌트를 결정하게 하기 위함. 본인 리소스이므로 권한 가드는 없다(인증만 전제).
 */
@Service
@Transactional
@RequiredArgsConstructor
public class UserApiTokenService {

  private static final String PREFIX = "swp_";

  /** base62(32 bytes random) 형식. base62 알파벳 — AgentApiKeyService 와 동일. */
  private static final String BASE62 =
      "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

  private final UserApiTokenRepository repo;
  private final UserRepository userRepository;
  private final AuditLogService auditLogService;
  private final SecureRandom secureRandom = new SecureRandom();

  /**
   * PAT 발급. 평문은 응답 1회만, DB 에는 SHA-256 hex 만 저장. 발급 시점의 활성 테넌트(TenantContext)가 없으면 400. 감사 로그
   * USER_TOKEN_ISSUED.
   */
  public UserApiTokenIssueResponse issue(Long callerId, IssueUserTokenRequest req) {
    Long tenantId = TenantContext.get();
    if (tenantId == null) throw new ActiveTenantRequiredException();

    String plaintext = generatePlaintext();
    String hash = sha256Hex(plaintext);
    String prefix = plaintext.substring(0, Math.min(12, plaintext.length()));
    Long id = repo.insert(callerId, tenantId, req.name(), prefix, hash, req.expiresAt());

    auditLogService.log(
        callerId,
        resolveUsername(callerId),
        "USER_TOKEN_ISSUED",
        "user_api_token",
        String.valueOf(id),
        "사용자 PAT 발급",
        null,
        null,
        "SUCCESS",
        null,
        Map.of("tokenPrefix", prefix, "name", req.name()));

    return new UserApiTokenIssueResponse(
        id, req.name(), plaintext, prefix, tenantId, req.expiresAt(), Instant.now());
  }

  /** 호출자 본인의 PAT 목록 (회수된 것 포함). 평문/해시는 응답에 포함되지 않는다. */
  @Transactional(readOnly = true)
  public List<UserApiTokenResponse> list(Long callerId) {
    return repo.findByUser(callerId);
  }

  /** PAT 회수. PAT id 가 없거나 caller 와 불일치하거나 이미 회수된 경우 모두 404 로 통일한다. 감사 로그 USER_TOKEN_REVOKED. */
  public void revoke(Long callerId, Long tokenId) {
    Long ownerId =
        repo.findUserId(tokenId).orElseThrow(() -> new UserTokenNotFoundException(tokenId));
    if (!ownerId.equals(callerId)) throw new UserTokenNotFoundException(tokenId);
    int updated = repo.revoke(tokenId);
    if (updated == 0) throw new UserTokenNotFoundException(tokenId);

    auditLogService.log(
        callerId,
        resolveUsername(callerId),
        "USER_TOKEN_REVOKED",
        "user_api_token",
        String.valueOf(tokenId),
        "사용자 PAT 회수",
        null,
        null,
        "SUCCESS",
        null,
        Map.of("userId", callerId));
  }

  /** swp_ + base62(32 random bytes). */
  private String generatePlaintext() {
    byte[] bytes = new byte[32];
    secureRandom.nextBytes(bytes);
    return PREFIX + base62Encode(bytes);
  }

  private static String base62Encode(byte[] bytes) {
    BigInteger n = new BigInteger(1, bytes);
    BigInteger base = BigInteger.valueOf(62);
    StringBuilder sb = new StringBuilder();
    while (n.signum() > 0) {
      BigInteger[] qr = n.divideAndRemainder(base);
      sb.insert(0, BASE62.charAt(qr[1].intValue()));
      n = qr[0];
    }
    return sb.length() > 0 ? sb.toString() : "0";
  }

  private String sha256Hex(String plaintext) {
    try {
      MessageDigest md = MessageDigest.getInstance("SHA-256");
      byte[] hash = md.digest(plaintext.getBytes(StandardCharsets.UTF_8));
      return HexFormat.of().formatHex(hash);
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException("SHA-256 미지원", e);
    }
  }

  private String resolveUsername(Long callerId) {
    if (callerId == null) return "system";
    return userRepository.findById(callerId).map(UserResponse::username).orElse("system");
  }
}
