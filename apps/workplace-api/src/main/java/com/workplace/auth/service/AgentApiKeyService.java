package com.workplace.auth.service;

import com.workplace.audit.service.AuditLogService;
import com.workplace.auth.dto.AgentApiKeyIssueResponse;
import com.workplace.auth.dto.AgentApiKeyResponse;
import com.workplace.auth.dto.IssueAgentKeyRequest;
import com.workplace.auth.dto.ManagedKeyChain;
import com.workplace.auth.exception.KeyNotFoundException;
import com.workplace.auth.exception.KeyTargetMustBeAgentException;
import com.workplace.auth.exception.PersonalAssistantKeyIssueForbiddenException;
import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.user.dto.AgentUsernames;
import com.workplace.user.dto.UserKind;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.exception.UserNotFoundException;
import com.workplace.user.repository.UserRepository;
import com.workplace.user.service.WorkspaceMemberGuard;
import java.math.BigInteger;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
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

  /**
   * 에이전트당 쓸 수 있는(활성) 관리자 발급 키 상한(WP-818). Works 자동 발급 키는 세지 않는다(WP-1253) — 회전 주기가 AI·워크스페이스마다 두세 개로
   * 묶는다({@link ManagedKeyChain}).
   */
  static final int MAX_ACTIVE = 20;

  /** 키 목록에 남기는 평문 앞자리 수 — 평문 전체를 추측할 수 없는 길이만큼만. */
  private static final int KEY_PREFIX_LENGTH = 12;

  private final AgentApiKeyRepository repo;
  private final UserRepository userRepository;
  private final WorkspaceMemberGuard memberGuard;
  private final AuditLogService auditLogService;
  private final SecureRandom secureRandom = new SecureRandom();

  /** AGENT 의 키 목록. HUMAN 대상이면 400. 평문/해시는 응답에 포함되지 않는다. */
  @Transactional(readOnly = true)
  public List<AgentApiKeyResponse> list(Long userId) {
    // WP-703: 다른 워크스페이스의 AI 는 없는 것과 같다(404) — 이름 변경·삭제(#811)와 같은 가드.
    memberGuard.require(userId);
    requireAgentUser(userId);
    // WP-1253: 다른 워크스페이스가 자동 발급한 키는 그쪽 Pod 의 키라 보이지 않는다.
    return repo.findByUser(userId, TenantContext.require());
  }

  /**
   * 키 발급. 평문은 응답 1회만, DB 에는 SHA-256 hex 만 저장. AGENT 가 아니면 400, 개인 비서면 403(WP-1153), 없는 user 면 404.
   * 감사 로그 AGENT_KEY_ISSUED — 개인 비서 거절은 결과 FAILURE 로 남긴다(WP-1162).
   */
  // 개인 비서 발급 거절(403)의 실패 감사는 이 트랜잭션에 함께 남긴다 — 그 예외에 롤백하면 기록도 사라진다(UserService 비밀번호 변경 실패와 같은 방식).
  @Transactional(noRollbackFor = PersonalAssistantKeyIssueForbiddenException.class)
  public AgentApiKeyIssueResponse issue(Long callerId, Long userId, IssueAgentKeyRequest req) {
    requireNotSelf(callerId, userId);
    memberGuard.require(userId);
    UserResponse user = requireAgentUser(userId);
    // WP-1153: 개인 비서는 주인의 자격증명·위임으로만 움직인다 — 관리자가 키를 받으면 그 신원으로 주인의 개인 작업(관리자에게도 안 보임)을
    // 읽을 수 있어, 이름 변경·삭제처럼 발급을 막는다(403). 이미 있는 키의 목록·회수는 정리 수단으로 남긴다.
    if (AgentUsernames.isPersonalAssistant(user.username())) {
      // WP-1162: 거절한 시도도 감사 로그 「실패」로 남겨, 관리자가 누가 개인 비서 키를 받으려 했는지 볼 수 있게 한다.
      auditLogService.log(
          callerId,
          resolveUsername(callerId),
          "AGENT_KEY_ISSUED",
          "agent_api_key",
          null,
          "AGENT 키 발급 거절(개인 비서): " + user.username(),
          null,
          null,
          "FAILURE",
          "PERSONAL_ASSISTANT",
          Map.of("userId", userId, "agentUsername", user.username()));
      throw new PersonalAssistantKeyIssueForbiddenException();
    }
    // WP-818: 쓸 수 있는 관리자 키는 에이전트당 MAX_ACTIVE 개까지(개인 PAT 와 같은 규칙) — 잠근 뒤 세어 동시 발급이 함께 넘지 않게 한다.
    repo.lockIssue(userId);
    if (repo.countActiveAdmin(userId) >= MAX_ACTIVE) {
      throw new IllegalArgumentException(
          "AI 에이전트 API 키는 " + MAX_ACTIVE + "개까지 쓸 수 있습니다. 쓰지 않는 키를 회수한 뒤 다시 발급하세요");
    }

    String plaintext = generatePlaintext();
    String hash = CapabilityTokens.sha256Hex(plaintext);
    String prefix = keyPrefix(plaintext);
    String label = req == null ? null : req.label();
    Long id = repo.insert(userId, prefix, hash, label, callerId);

    auditLogService.log(
        callerId,
        resolveUsername(callerId),
        "AGENT_KEY_ISSUED",
        "agent_api_key",
        String.valueOf(id),
        // WP-706 대상 AI 를 아이디로 적는다 — id 만 남기면 AI 를 지운 뒤 누구 키였는지 알 수 없다(다른 AGENT 기록과 같은 꼴).
        "AGENT 키 발급: " + user.username(),
        null,
        null,
        "SUCCESS",
        null,
        Map.of(
            "userId",
            userId,
            "agentUsername",
            user.username(),
            "keyPrefix",
            prefix,
            "label",
            label == null ? "" : label));

    return new AgentApiKeyIssueResponse(id, userId, plaintext, prefix, label, Instant.now());
  }

  /**
   * 키 회수. 키 id 가 없거나 user 와 불일치하거나 이미 회수됐거나 다른 워크스페이스가 자동 발급한 키(WP-1253)인 경우 모두 404 로 통일한다. 감사 로그
   * AGENT_KEY_REVOKED.
   */
  public void revoke(Long callerId, Long userId, Long keyId) {
    requireNotSelf(callerId, userId);
    memberGuard.require(userId);
    long tenantId = TenantContext.require();
    AgentApiKeyResponse key =
        repo.findById(keyId, tenantId).orElseThrow(() -> new KeyNotFoundException(keyId));
    if (!key.userId().equals(userId)) throw new KeyNotFoundException(keyId);
    int updated = repo.revoke(keyId, tenantId);
    if (updated == 0) throw new KeyNotFoundException(keyId);
    String agentUsername = resolveUsername(userId);

    auditLogService.log(
        callerId,
        resolveUsername(callerId),
        "AGENT_KEY_REVOKED",
        "agent_api_key",
        String.valueOf(keyId),
        "AGENT 키 회수: " + agentUsername,
        null,
        null,
        "SUCCESS",
        null,
        Map.of("userId", userId, "agentUsername", agentUsername));
  }

  /**
   * Works 자동 발급(WP-1253) — runner 가 작업 공간에 띄울 AI 의 키를 받는다. managed=true, 만료 = 지금 + 수명({@link
   * ManagedKeyChain#expiresAtFor}), 발급한 워크스페이스에 묶인다(그 워크스페이스로만 인증되고, 교체·정리도 그 워크스페이스 키 사슬 안에서만).
   * 평문은 반환값으로만 나가고 DB 에는 해시만, 감사 기록에는 접두사도 남기지 않는다(원문 일부라서).
   *
   * <p>사람 관리자 경로의 자기 발급 금지·개인 비서 가드·관리자 키 상한은 적용하지 않는다 — 호출자는 사람이 아니라 runner 이고, 대상이 작업 공간에서 켜져
   * 있는지는 호출자(agentruntime)가 실행 설정 행을 잠근 채 확인한다. 키 수는 회전 주기가 묶는다.
   *
   * @param tenantId 발급하는 워크스페이스
   * @param rotationGeneration 이 키가 맞춰진 실행 설정 generation(교체면 올린 값) — 그 generation 의 Pod 가 관찰되면 쓰인 키로
   *     보고 옛 키를 정리한다
   * @param replaceKeyId 이번 발급으로 대신할, 아직 전달되지 않은 키(재시도) — 바로 만료·회수한다. 없으면 null
   * @param locationName 요청한 실행 위치 이름(감사 기록 설명용)
   */
  public ManagedKey issueManaged(
      long agentUserId,
      long tenantId,
      Long rotationGeneration,
      Long replaceKeyId,
      String locationName) {
    UserResponse user = requireAgentUser(agentUserId);
    repo.lockIssue(agentUserId);
    OffsetDateTime now = OffsetDateTime.now();
    if (replaceKeyId != null) repo.expireManagedNow(replaceKeyId, tenantId, now);

    String plaintext = generatePlaintext();
    OffsetDateTime expiresAt = ManagedKeyChain.expiresAtFor(now);
    Long id =
        repo.insertManaged(
            agentUserId,
            tenantId,
            keyPrefix(plaintext),
            CapabilityTokens.sha256Hex(plaintext),
            "Works 자동 발급",
            expiresAt,
            rotationGeneration);

    Map<String, Object> meta = new LinkedHashMap<>();
    meta.put("userId", agentUserId);
    meta.put("agentUsername", user.username());
    meta.put("managed", true);
    meta.put("tenantId", tenantId);
    meta.put("expiresAt", expiresAt.toString());
    if (rotationGeneration != null) meta.put("rotationGeneration", rotationGeneration);
    auditLogService.log(
        null,
        "system",
        "AGENT_KEY_ISSUED",
        "agent_api_key",
        String.valueOf(id),
        "AGENT 키 발급(Works 자동 발급 · 위치 " + locationName + "): " + user.username(),
        null,
        null,
        "SUCCESS",
        null,
        meta);
    return new ManagedKey(id, plaintext, expiresAt);
  }

  /** 이 AI 의 이 워크스페이스 활성 managed 키 사슬(WP-1253). */
  @Transactional(readOnly = true)
  public ManagedKeyChain managedChain(long agentUserId, long tenantId) {
    return repo.findActiveManaged(agentUserId, tenantId);
  }

  /** 여러 AI 의 이 워크스페이스 활성 managed 키 사슬을 한 번에 — AI id → 사슬(키가 없는 AI 는 빠진다, WP-1253). */
  @Transactional(readOnly = true)
  public Map<Long, ManagedKeyChain> managedChains(Collection<Long> agentUserIds, long tenantId) {
    return repo.findActiveManagedByUsers(agentUserIds, tenantId);
  }

  /** 이 AI 에 이 워크스페이스 managed 키가 한 번이라도 있었는지(회수·만료 포함, WP-1253). */
  @Transactional(readOnly = true)
  public boolean hasManagedHistory(long agentUserId, long tenantId) {
    return repo.existsManaged(agentUserId, tenantId);
  }

  /**
   * 교체가 확인된 AI 들의 이 워크스페이스 옛 managed 키를 정리 유예로 줄인다(WP-1253) — {@code currentKeyIds}(AI 마다 현재 키)는
   * 남긴다. 이미 더 일찍 만료되는 키는 그대로다(늦추지 않는다). 관리자 발급 키·다른 워크스페이스 키는 건드리지 않는다.
   *
   * @return 줄인 키 수
   */
  public int shortenOthersToGrace(
      Collection<Long> agentUserIds, long tenantId, Collection<Long> currentKeyIds) {
    return repo.shortenManaged(
        agentUserIds, tenantId, ManagedKeyChain.graceUntil(OffsetDateTime.now()), currentKeyIds);
  }

  /**
   * 이 AI 의 이 워크스페이스 managed 키를 모두 정리 유예로 줄인다. 끄기·삭제·「내부 · 기본」 전환이 쓴다. 그 워크스페이스의 managed 키만 줄인다 — 같은
   * AI 를 다른 워크스페이스에서 Works 가 띄우고 있어도 그쪽 Pod 의 키는 그대로다.
   */
  public int shortenManagedToGrace(long agentUserId, long tenantId) {
    return repo.shortenManaged(
        agentUserId, tenantId, ManagedKeyChain.graceUntil(OffsetDateTime.now()));
  }

  /** 자동 발급 결과 — 평문은 이 값으로만 한 번 나간다. toString 에 평문을 싣지 않는다. */
  public record ManagedKey(long id, String plaintext, OffsetDateTime expiresAt) {
    /** runner 가 미리 다시 받을 시각. */
    public OffsetDateTime rotateAfter() {
      return ManagedKeyChain.rotateAfter(expiresAt);
    }

    @Override
    public String toString() {
      return "ManagedKey[id=" + id + ", expiresAt=" + expiresAt + "]";
    }
  }

  /** 키 대상 AI — 없으면 404, AI 가 아니면 400. */
  private UserResponse requireAgentUser(long userId) {
    UserResponse user =
        userRepository.findById(userId).orElseThrow(() -> UserNotFoundException.ofId(userId));
    if (!UserKind.isAgent(user.kind())) throw new KeyTargetMustBeAgentException();
    return user;
  }

  /** 키 목록에 남길 평문 앞자리. */
  private static String keyPrefix(String plaintext) {
    return plaintext.substring(0, Math.min(KEY_PREFIX_LENGTH, plaintext.length()));
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

  private String resolveUsername(Long callerId) {
    if (callerId == null) return "system";
    return userRepository.findById(callerId).map(UserResponse::username).orElse("system");
  }

  /**
   * AI 가 자기 키를 발급·회수하지 못하게 한다(WP-728) — 자기 키를 새로 발급할 수 있으면 사람이 기존 키를 회수해도 AI 가 다시 살아난다. 키 관리는 사람
   * 관리자의 일이다.
   */
  private static void requireNotSelf(Long callerId, Long userId) {
    if (callerId != null && callerId.equals(userId)) {
      throw new AccessDeniedException("AI 는 자기 API 키를 발급하거나 회수할 수 없습니다");
    }
  }
}
