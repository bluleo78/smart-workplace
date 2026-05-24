package com.workplace.auth.service;

import com.workplace.audit.service.AuditLogService;
import com.workplace.auth.dto.AgentApiKeyIssueResponse;
import com.workplace.auth.dto.AgentApiKeyResponse;
import com.workplace.auth.dto.IssueAgentKeyRequest;
import com.workplace.auth.exception.KeyNotFoundException;
import com.workplace.auth.exception.KeyTargetMustBeAgentException;
import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.user.dto.UserKind;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.exception.UserNotFoundException;
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
 * Phase 5a — AGENT API 키 발급/조회/회수 서비스. 평문은 발급 응답으로만 1회 노출되며 DB 에는 SHA-256 hex 만 저장된다. ADMIN 권한 가드는
 * 컨트롤러 @RequirePermission("user:manage") 가 책임진다.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class AgentApiKeyService {

  /** ak_ + base62(32 bytes random) 형식. base62 알파벳. */
  private static final String BASE62 =
      "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

  private final AgentApiKeyRepository repo;
  private final UserRepository userRepository;
  private final AuditLogService auditLogService;
  private final SecureRandom secureRandom = new SecureRandom();

  /** AGENT 의 키 목록. HUMAN 대상이면 400. 평문/해시는 응답에 포함되지 않는다. */
  @Transactional(readOnly = true)
  public List<AgentApiKeyResponse> list(Long userId) {
    UserResponse user =
        userRepository
            .findById(userId)
            .orElseThrow(() -> new UserNotFoundException("User not found: " + userId));
    if (!UserKind.isAgent(user.kind())) throw new KeyTargetMustBeAgentException();
    return repo.findByUser(userId);
  }

  /**
   * 키 발급. 평문은 응답 1회만, DB 에는 SHA-256 hex 만 저장. AGENT 가 아니면 400, 없는 user 면 404. 감사 로그
   * AGENT_KEY_ISSUED.
   */
  public AgentApiKeyIssueResponse issue(Long callerId, Long userId, IssueAgentKeyRequest req) {
    UserResponse user =
        userRepository
            .findById(userId)
            .orElseThrow(() -> new UserNotFoundException("User not found: " + userId));
    if (!UserKind.isAgent(user.kind())) throw new KeyTargetMustBeAgentException();

    String plaintext = generatePlaintext();
    String hash = sha256Hex(plaintext);
    String prefix = plaintext.substring(0, Math.min(12, plaintext.length()));
    String label = req == null ? null : req.label();
    Long id = repo.insert(userId, prefix, hash, label, callerId);

    auditLogService.log(
        callerId,
        resolveUsername(callerId),
        "AGENT_KEY_ISSUED",
        "agent_api_key",
        String.valueOf(id),
        "AGENT 키 발급",
        null,
        null,
        "SUCCESS",
        null,
        Map.of(
            "userId", userId,
            "keyPrefix", prefix,
            "label", label == null ? "" : label));

    return new AgentApiKeyIssueResponse(id, userId, plaintext, prefix, label, Instant.now());
  }

  /** 키 회수. 키 id 가 없거나 user 와 불일치하거나 이미 회수된 경우 모두 404 로 통일한다. 감사 로그 AGENT_KEY_REVOKED. */
  public void revoke(Long callerId, Long userId, Long keyId) {
    AgentApiKeyResponse key =
        repo.findById(keyId).orElseThrow(() -> new KeyNotFoundException(keyId));
    if (!key.userId().equals(userId)) throw new KeyNotFoundException(keyId);
    int updated = repo.revoke(keyId);
    if (updated == 0) throw new KeyNotFoundException(keyId);

    auditLogService.log(
        callerId,
        resolveUsername(callerId),
        "AGENT_KEY_REVOKED",
        "agent_api_key",
        String.valueOf(keyId),
        "AGENT 키 회수",
        null,
        null,
        "SUCCESS",
        null,
        Map.of("userId", userId));
  }

  /** ak_ + base62(32 random bytes). */
  private String generatePlaintext() {
    byte[] bytes = new byte[32];
    secureRandom.nextBytes(bytes);
    return "ak_" + base62Encode(bytes);
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
