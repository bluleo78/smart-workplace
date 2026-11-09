package com.workplace.agentaccount.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.agentaccount.dto.AccountUsage;
import com.workplace.agentaccount.dto.AgentAccountRequest;
import com.workplace.agentaccount.dto.AgentAccountResponse;
import com.workplace.agentaccount.dto.AgentAccountResponse.BoundAgent;
import com.workplace.agentaccount.dto.AgentAccountRow;
import com.workplace.agentaccount.dto.AgentAccountUpdateRequest;
import com.workplace.agentaccount.exception.AgentAccountDuplicateException;
import com.workplace.agentaccount.exception.AgentAccountInUseException;
import com.workplace.agentaccount.exception.AgentAccountNotFoundException;
import com.workplace.agentaccount.repository.AgentAccountBindingRepository;
import com.workplace.agentaccount.repository.AgentAccountRepository;
import com.workplace.agentaccount.usage.AgentAccountUsageProperties;
import com.workplace.agentaccount.usage.AgentAccountUsageRepository;
import com.workplace.agentaccount.usage.UsageCheckRow;
import com.workplace.agentaccount.usage.UsageSnapshot;
import com.workplace.agentaccount.usage.UsageStatusCalculator;
import com.workplace.agentaccount.usage.UsageWindow;
import com.workplace.audit.service.AuditLogService;
import com.workplace.auth.controller.ProviderCredentialSecrets;
import com.workplace.auth.dto.ProviderConfig;
import com.workplace.auth.exception.InvalidProviderCredentialException;
import com.workplace.auth.service.AgentProviders;
import com.workplace.auth.service.AiAgentCredentialService;
import com.workplace.auth.service.LoginInfoNormalizer;
import com.workplace.global.security.EncryptionService;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.global.util.Texts;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.jooq.exception.IntegrityConstraintViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * AI 계정 목록 서비스(WP-1448) — 팀 AI(작업 공간 Pod)가 쓰는 키(Claude 구독 토큰·ChatGPT/Gen:iA 로그인 정보·OpenAI 호환 설정)를
 * AI 와 떼어 워크스페이스 단위로 등록·수정·폐기한다.
 *
 * <ul>
 *   <li>평문은 등록·교체 요청에서만 다룬다 — 저장은 {@link EncryptionService} 암호문, 응답·감사 로그에는 메타만.
 *   <li>입력 검증은 AI 연결(auth)의 것을 그대로 쓴다(복사하지 않는다): {@link ProviderCredentialSecrets}·{@link
 *       LoginInfoNormalizer}·{@link AiAgentCredentialService#validateOpencodePayload}.
 *   <li>같은 키(같은 종류·같은 지문)의 살아 있는 계정은 하나만 둔다 — 같은 ChatGPT 로그인을 두 계정으로 두면 갱신 토큰이 1회용이라 한쪽이 풀린다.
 *   <li>다른 워크스페이스·폐기된 계정은 RLS·revoked_at 조건으로 보이지 않아 404 가 된다.
 * </ul>
 */
@Service
@Transactional
@RequiredArgsConstructor
public class AgentAccountService {

  /** 사람 없이 서버가 한 변경(이관 백필)의 감사 로그 행위자 이름. */
  private static final String SYSTEM_ACTOR = "system";

  /** 정상 상태. 등록·원문 교체 직후는 늘 이 상태다. */
  public static final String STATUS_ACTIVE = "ACTIVE";

  /** 확인 필요 — 이관 백필이 옮긴 로그인형 계정(서버 보관본이 낡았을 수 있다). 첫 사용량 조회(WP-1449)가 판정한다. */
  public static final String STATUS_NEEDS_CHECK = "NEEDS_CHECK";

  /**
   * 다시 로그인 필요 — 「확인 필요」 계정의 첫 사용량 조회가 401 계열로 실패했거나(WP-1449), 갱신 토큰이 더 통하지 않거나 로그인이 만료된
   * 계정(WP-1450). 사용량 조회가 성공하거나 Pod 가 더 새 로그인을 올리면 「정상」으로 돌아가고, 아니면 사람이 다시 로그인해 원문을 교체한다.
   */
  public static final String STATUS_RELOGIN_REQUIRED = "RELOGIN_REQUIRED";

  /** 같은 키 유일 인덱스(V274) — 동시 등록 경합에서 DB 위반을 409 로 옮길 때 이름으로 가린다. */
  private static final String FINGERPRINT_INDEX = "uq_agent_account_fingerprint";

  /** 지문 계산용 JSON 파서 — 정적 함수({@link #fingerprint})가 쓰므로 빈이 아닌 자체 인스턴스. */
  private static final ObjectMapper JSON = new ObjectMapper();

  private final AgentAccountRepository accounts;
  private final AgentAccountBindingRepository bindings;
  private final UserRepository userRepository;
  private final EncryptionService encryptionService;
  private final AuditLogService auditLogService;
  private final AiAgentCredentialService credentialService;
  private final ObjectMapper objectMapper;
  private final AgentAccountRuntimeNotifier runtimeNotifier;
  private final AgentAccountUsageRepository usageRepository;
  private final AgentAccountUsageProperties usageProperties;

  /**
   * 검증·정규화를 마친 계정 원문과 그 메타. {@code plaintext} 는 저장 직전 암호화할 평문이라 {@link #toString()} 에 싣지 않는다.
   *
   * @param plaintext 저장할 평문(anthropic 토큰 / opencode 설정 JSON / 다듬은 auth.json)
   * @param accountEmail 로그인형의 계정 이메일(읽지 못하면 null, 그 밖의 종류는 null)
   * @param lastRefreshedAt 로그인형의 마지막 갱신 시각(auth.json 의 last_refresh, 없으면 지금). 그 밖의 종류는 null
   * @param fingerprint 같은 키 판정용 지문({@link #fingerprint})
   */
  public record SecretParts(
      String plaintext, String accountEmail, Instant lastRefreshedAt, String fingerprint) {
    @Override
    public String toString() {
      return "SecretParts[accountEmail="
          + accountEmail
          + ", lastRefreshedAt="
          + lastRefreshedAt
          + "]";
    }
  }

  /** 계정을 등록한다 — 검증·정규화 → 같은 키 확인 → 암호화 저장 → 감사 로그. label 이 비면 「<종류 이름> 계정」. */
  public AgentAccountResponse register(Long callerId, AgentAccountRequest req) {
    String provider = ProviderCredentialSecrets.resolveProvider(req.provider());
    SecretParts parts = parse(provider, req.token(), req.providerConfig(), req.loginInfo());
    if (accounts.findActiveByFingerprint(provider, parts.fingerprint()).isPresent()) {
      throw new AgentAccountDuplicateException();
    }
    String label = labelOrDefault(req.label(), provider);
    long id = insertAccount(provider, label, parts, STATUS_ACTIVE, callerId, true);
    audit(
        callerId, "AGENT_ACCOUNT_REGISTERED", id, "AI 계정 등록: " + label, provider, label, Map.of());
    return get(id);
  }

  /** 이 워크스페이스의 살아 있는 계정 전부(id 오름차순) — 쓰는 AI 목록을 붙인다. */
  @Transactional(readOnly = true)
  public List<AgentAccountResponse> list() {
    return toResponses(accounts.findAllActive());
  }

  /** 계정 한 건 — 없거나 폐기·다른 워크스페이스면 404. */
  @Transactional(readOnly = true)
  public AgentAccountResponse get(long id) {
    return toResponses(List.of(requireActive(id))).getFirst();
  }

  /**
   * 계정을 수정한다. label 이 오면 라벨을(공백이면 기본 라벨), 원문이 오면 그 계정 종류의 검증을 거쳐 원문을 교체한다 — 교체하면 secret_version 이
   * 새로 나와 이 계정을 쓰는 모든 AI 의 Pod 가 바뀐 키를 받는다(사람이 의도한 키 교체). 상태는 ACTIVE 로 되돌린다(다시 로그인해 넣은 값이므로).
   */
  public AgentAccountResponse update(Long callerId, long id, AgentAccountUpdateRequest req) {
    AgentAccountRow row = requireActive(id);
    boolean secretReplaced = req.hasSecret();
    if (secretReplaced) {
      replaceSecret(
          callerId,
          id,
          row.provider(),
          parse(row.provider(), req.token(), req.providerConfig(), req.loginInfo()));
    }
    String label = row.label();
    if (req.label() != null) {
      label = labelOrDefault(req.label(), row.provider());
      accounts.updateLabel(id, label);
    }
    audit(
        callerId,
        "AGENT_ACCOUNT_UPDATED",
        id,
        "AI 계정 수정: " + label + (secretReplaced ? " (키 교체)" : ""),
        row.provider(),
        label,
        Map.of("secretReplaced", String.valueOf(secretReplaced)));
    return get(id);
  }

  /**
   * 기존 연결 등록 다리(WP-1448, 계정 화면 WP-1451 전까지) — 관리 경로로 Pod AI 에 등록한 연결 원문으로 계정을 찾거나 만든다. 같은 종류·같은 지문의
   * 살아 있는 계정이 있으면 그것을 다시 쓴다(같은 키는 하나로 — 409 로 등록을 깨지 않는다). 다시 쓰는 로그인형 계정의 원문이 방금 넣은 것과 다르면 교체한다 —
   * 같은 계정이라도 로그인형은 갱신마다 토큰이 바뀌고, 방금 넣은 로그인이 가장 새 것이다(옛 갱신 토큰은 이미 쓰였을 수 있다). 사람이 방금 넣은 값이므로 다시 쓰는
   * 계정은 원문이 같아도 「정상」이 된다(이관이 남긴 「확인 필요」를 푼다).
   *
   * @param normalizedPlaintext 연결 등록과 같은 규칙으로 정규화한 원문 — 계정 규칙({@link #partsOf})으로 한 번 더 검증한다
   * @param label 새로 만들 때의 라벨(호출자가 기본값까지 정한 값). 다시 쓰는 계정의 라벨은 바꾸지 않는다
   * @param podBound OpenAI 호환 원문의 Pod 꼴(providerId) 검사 여부 — 기존 연결 등록이 쓴 값({@link
   *     com.workplace.auth.service.AgentAccountFitPolicy#deliversToPod})을 그대로 받는다. 연결 등록이 받아들인 값을
   *     다리가 400 으로 깨지 않게(계정 API 는 늘 엄격하다)
   * @return 계정 id
   */
  public long findOrRegisterFromLegacy(
      Long callerId, String provider, String normalizedPlaintext, String label, boolean podBound) {
    return findOrRegister(
        callerId, provider, normalizedPlaintext, label, LegacySource.BRIDGE, podBound);
  }

  /**
   * 기존 연결 이관 백필(WP-1448, {@link AgentAccountBackfill}) — Pod AI 의 옛 연결 원문으로 계정을 찾거나 만든다. 다리와 같은 경로를
   * 쓰되 다른 점은 셋이다.
   *
   * <ul>
   *   <li>새로 만드는 로그인형(chatgpt·genia) 계정은 「확인 필요」 — 서버 보관본은 Pod 가 갱신한 뒤라 이미 낡았을 수 있다.
   *   <li>같은 계정이 이미 있으면 그 계정을 그대로 쓴다 — 원문·상태를 바꾸지 않는다. 원문을 교체하면 secret_version 이 바뀌어 그 계정을 이미 쓰는 AI
   *       들의 Pod 가 서버 쪽 이관 때문에 다시 만들어진다(설계의 실패 조건). 관리자가 넣은 원문을 옛 보관본으로 덮지도 않는다.
   * </ul>
   *
   * <p>(셋째로, 같은 그룹의 여러 원문 중 살릴 것은 호출자가 last_refresh 로 미리 고른다 — 그룹을 다 모은 뒤 만든다.)
   *
   * @param normalizedPlaintext 정규화한 옛 연결 원문
   * @param label 새로 만들 때의 라벨(「<AI 이름> 계정」)
   * @return 계정 id
   */
  public long findOrRegisterFromBackfill(
      String provider, String normalizedPlaintext, String label) {
    // 백필은 Pod AI 의 옛 연결을 옮긴다 — 계정 API 와 같은 엄격한 검사(podBound=true)를 그대로 쓴다.
    return findOrRegister(null, provider, normalizedPlaintext, label, LegacySource.BACKFILL, true);
  }

  /** 옛 연결 원문이 어디서 왔는가 — 사람이 방금 넣은 등록(다리)인가, 서버 보관본을 옮기는 백필인가. */
  private enum LegacySource {
    BRIDGE("legacy_credential"),
    BACKFILL("legacy_backfill");

    /** 감사 로그 meta 의 source 값. */
    private final String auditSource;

    LegacySource(String auditSource) {
      this.auditSource = auditSource;
    }
  }

  /** 다리·백필이 같이 쓰는 「같은 지문의 계정을 다시 쓰거나 새로 만든다」 본체 — 규칙 차이는 {@link LegacySource} 로 가른다. */
  private long findOrRegister(
      Long callerId,
      String provider,
      String normalizedPlaintext,
      String label,
      LegacySource source,
      boolean podBound) {
    String p = AgentProviders.normalize(provider);
    SecretParts parts = partsOf(p, normalizedPlaintext, podBound);
    boolean backfill = source == LegacySource.BACKFILL;
    Optional<AgentAccountRow> same = accounts.findActiveByFingerprint(p, parts.fingerprint());
    if (same.isPresent()) {
      AgentAccountRow row = same.get();
      if (backfill) return row.id(); // 백필은 있는 계정을 그대로 쓴다(위 javadoc) — 원문 비교(복호화)도 필요 없다
      boolean differs = !encryptionService.decrypt(row.encryptedSecret()).equals(parts.plaintext());
      if (differs) {
        replaceSecret(callerId, row.id(), p, parts);
        audit(
            callerId,
            "AGENT_ACCOUNT_UPDATED",
            row.id(),
            "AI 계정 수정: " + row.label() + " (기존 연결 등록으로 키 교체)",
            p,
            row.label(),
            Map.of("secretReplaced", "true", "source", source.auditSource));
      } else if (!STATUS_ACTIVE.equals(row.status())) {
        // 원문은 같아도 사람이 방금 넣은 값이다 — 이관이 남긴 「확인 필요」를 푼다. 원문이 그대로라 버전(Pod)은 바꾸지 않는다.
        accounts.updateStatus(row.id(), STATUS_ACTIVE);
        audit(
            callerId,
            "AGENT_ACCOUNT_UPDATED",
            row.id(),
            "AI 계정 수정: " + row.label() + " (기존 연결 등록으로 정상 확인)",
            p,
            row.label(),
            Map.of("secretReplaced", "false", "source", source.auditSource));
      }
      return row.id();
    }
    String resolved = labelOrDefault(label, p);
    String status = backfill && AgentProviders.isLogin(p) ? STATUS_NEEDS_CHECK : STATUS_ACTIVE;
    long id = insertAccount(p, resolved, parts, status, callerId, !backfill);
    audit(
        callerId,
        "AGENT_ACCOUNT_REGISTERED",
        id,
        (backfill ? "AI 계정 등록(기존 연결 이관): " : "AI 계정 등록(기존 연결 등록): ") + resolved,
        p,
        resolved,
        Map.of("source", source.auditSource));
    return id;
  }

  /**
   * 계정 행을 암호화해 넣고 새 id 를 낸다 — 동시 등록 경합의 같은 키 유일 인덱스 위반은 409 로 옮긴다. 등록과 다리·백필이 같이 쓴다. {@code
   * serverRefreshReady}: 사람이 넣은 원문(등록·다리)이면 true, 이관 백필이면 false(Pod 가 이미 갱신 토큰을 돌렸을 수 있다).
   */
  private long insertAccount(
      String provider,
      String label,
      SecretParts parts,
      String status,
      Long createdBy,
      boolean serverRefreshReady) {
    try {
      return accounts.insert(
          provider,
          label,
          encryptionService.encrypt(parts.plaintext()),
          parts.accountEmail(),
          parts.lastRefreshedAt(),
          status,
          parts.fingerprint(),
          createdBy,
          serverRefreshReady);
    } catch (IntegrityConstraintViolationException e) {
      throw duplicateOr(e);
    }
  }

  /**
   * 계정 원문을 교체하고 그 계정을 쓰는 모든 AI 의 runner 에 알린다 — 수정(PATCH)과 기존 연결 등록 다리가 같이 쓴다(사람이 넣은 값이라 상태는
   * ACTIVE). 같은 지문의 다른 살아 있는 계정이 있으면 409. 새 secret_version 은 이관 백필의 버전 이어받기도 끝낸다({@link
   * AgentAccountPodSource}).
   */
  private void replaceSecret(Long callerId, long id, String provider, SecretParts parts) {
    accounts
        .findActiveByFingerprint(provider, parts.fingerprint())
        .filter(other -> other.id() != id)
        .ifPresent(
            other -> {
              throw new AgentAccountDuplicateException();
            });
    try {
      accounts.replaceSecret(
          id,
          encryptionService.encrypt(parts.plaintext()),
          parts.accountEmail(),
          parts.lastRefreshedAt(),
          STATUS_ACTIVE,
          parts.fingerprint());
    } catch (IntegrityConstraintViolationException e) {
      throw duplicateOr(e);
    }
    // 남은 사용량·실패 이유는 옛 키의 것이다 — 같은 트랜잭션에서 비워 「모름」으로 두고, 다음 회차가 간격을 기다리지 않고 새 키를 조회하게 한다(WP-1449).
    usageRepository.resetForNewSecret(id);
    // 원문을 바꾸면 secret_version 이 새로 나와 이 계정을 쓰는 모든 AI 의 desired 버전이 바뀐다 — runner 가 폴링을 기다리지 않고 다시
    // 받아 가게 알린다(generation 은 그대로).
    List<Long> boundAgents = bindings.findAgentsByAccounts(List.of(id)).getOrDefault(id, List.of());
    runtimeNotifier.inputsChanged(boundAgents, callerId);
  }

  /**
   * 계정을 폐기한다 — 쓰는 AI 가 있으면 409(먼저 다른 계정으로 옮겨야 한다), 없거나 다른 워크스페이스면 404. 계정 행을 잠근 뒤 확인한다 — 묶기({@link
   * AgentAccountBindingService#bind})도 같은 행을 잠그므로 「쓰는 AI 없음」 확인과 폐기 사이에 묶기가 끼어들지 못한다.
   */
  public void revoke(Long callerId, long id) {
    AgentAccountRow row =
        accounts.findActiveForUpdate(id).orElseThrow(AgentAccountNotFoundException::new);
    if (bindings.isInUse(id)) throw new AgentAccountInUseException();
    if (accounts.revoke(id) == 0) throw new AgentAccountNotFoundException(); // 동시에 폐기됨
    audit(
        callerId,
        "AGENT_ACCOUNT_REVOKED",
        id,
        "AI 계정 폐기: " + row.label(),
        row.provider(),
        row.label(),
        Map.of());
  }

  /**
   * 계정 원문을 검증·정규화하고 메타(계정 이메일·마지막 갱신·지문)를 낸다. 규칙은 AI 연결 등록과 같다 — anthropic 은 토큰(32~2048자), opencode
   * 는 provider config(Pod 가 받는 providerId 꼴 포함 — 계정 목록은 Pod AI 만 쓴다), genia·chatgpt 는 auth.json 을 그
   * 프로그램이 읽는 키만 남겨 다듬는다.
   *
   * @throws InvalidProviderCredentialException 모르는 종류이거나 형식이 맞지 않음(400)
   */
  public SecretParts parse(String provider, String token, ProviderConfig cfg, String loginInfo) {
    String p = AgentProviders.normalize(provider);
    if (!AgentProviders.ALL.contains(p)) {
      throw new InvalidProviderCredentialException("지원하지 않는 계정 종류예요: " + p);
    }
    String raw = ProviderCredentialSecrets.resolveSecret(objectMapper, p, token, cfg, loginInfo);
    if (AgentProviders.OPENCODE.equals(p) && cfg == null) {
      throw new InvalidProviderCredentialException("OpenAI 호환 계정에는 providerConfig 가 필요해요");
    }
    // 계정 API 는 늘 Pod 꼴까지 엄격하게 본다 — 계정 목록은 Pod AI 만 쓴다.
    return partsOf(p, raw, true);
  }

  /**
   * 원문 하나를 계정 종류의 규칙으로 검증·정규화하고 메타를 낸다 — 요청 본문을 푼 뒤({@link #parse})와 기존 연결 등록 다리가 같이 쓴다.
   *
   * @param p 정규화된 계정 종류
   * @param raw 원문(anthropic 토큰 / opencode 설정 JSON / auth.json)
   * @param podBound OpenAI 호환 원문의 providerId 를 Pod 가 받는 꼴로 검사할지 — 계정 API·백필은 true, 다리는 연결 등록과 같은 값
   */
  private SecretParts partsOf(String p, String raw, boolean podBound) {
    if (AgentProviders.isLogin(p)) {
      String normalized = LoginInfoNormalizer.normalize(p, raw);
      return new SecretParts(
          normalized,
          LoginInfoNormalizer.accountEmail(p, normalized),
          lastRefreshOrNow(normalized),
          fingerprint(p, normalized));
    }
    if (AgentProviders.OPENCODE.equals(p)) {
      credentialService.validateOpencodePayload(raw, podBound);
      return new SecretParts(raw, null, null, fingerprint(p, raw));
    }
    if (raw == null || raw.isBlank()) {
      throw new InvalidProviderCredentialException("Claude 구독 토큰을 넣어 주세요");
    }
    if (raw.length() < 32 || raw.length() > 2048) {
      throw new InvalidProviderCredentialException("Claude 구독 토큰은 32~2048자여야 해요");
    }
    return new SecretParts(raw, null, null, fingerprint(p, raw));
  }

  /**
   * 같은 키 판정용 지문 — 같은 계정이면 원문이 달라도(로그인형은 갱신마다 토큰이 바뀐다) 같은 값이 나와야 한다. 이관 백필(Task 5)도 이 함수로 같은 키를 합친다.
   *
   * <ul>
   *   <li>anthropic·opencode: 원문의 SHA-256.
   *   <li>chatgpt: {@code tokens.account_id + "\0" + 로그인한 사람} 의 SHA-256(식별자도 그대로 두지 않는다). 로그인한 사람은
   *       계정 이메일({@link LoginInfoNormalizer#accountEmail} — 메타 표시와 같은 값), 없으면 id_token 의 사용자
   *       id({@link LoginInfoNormalizer#chatgptUserId}). account_id 는 Team·Enterprise 에서 워크스페이스 id
   *       라 여러 사람이 같은 값을 가지므로 그것만으로는 사람을 가르지 못한다. 둘 중 하나라도 읽지 못하면 원문 SHA-256.
   *   <li>genia: 계정 식별자({@code genia.email}, 없으면 {@code genia.accountId}·{@code genia.account_id})의
   *       SHA-256.
   *   <li>식별자를 읽지 못하면 원문 SHA-256.
   * </ul>
   *
   * 종류를 앞에 붙여 해시하지 않는다 — 조회·유일 인덱스가 이미 (provider, fingerprint) 로 가른다.
   *
   * @param normalizedPlaintext 정규화된 평문({@link #parse} 결과의 plaintext)
   */
  public static String fingerprint(String provider, String normalizedPlaintext) {
    String identity = loginIdentity(provider, normalizedPlaintext);
    return CapabilityTokens.sha256Hex(identity != null ? identity : normalizedPlaintext);
  }

  /** 로그인형 auth.json 에서 계정 식별자를 꺼낸다 — 로그인형이 아니거나 읽지 못하면 null. */
  private static String loginIdentity(String provider, String plaintext) {
    if (!AgentProviders.isLogin(provider) || plaintext == null) return null;
    try {
      JsonNode root = JSON.readTree(plaintext);
      if (AgentProviders.CHATGPT.equals(provider)) {
        // account_id 는 Team·Enterprise 에서 여러 사람이 함께 쓰는 워크스페이스 id 다 — 그것만 보면 다른 사람의 로그인이 같은 계정으로
        // 합쳐진다(등록 409·이관 오합침·다리가 남의 로그인을 덮음). 그래서 로그인한 사람(이메일, 없으면 사용자 id)을 함께 본다.
        String accountId = LoginInfoNormalizer.textOrNull(root.path("tokens").get("account_id"));
        if (accountId == null) return null;
        String user = LoginInfoNormalizer.accountEmail(provider, plaintext);
        if (user == null) user = LoginInfoNormalizer.chatgptUserId(plaintext);
        return user == null ? null : accountId + "\0" + user;
      }
      JsonNode genia = root.path("genia");
      String email = LoginInfoNormalizer.textOrNull(genia.get("email"));
      if (email != null) return email;
      String accountId = LoginInfoNormalizer.textOrNull(genia.get("accountId"));
      return accountId != null
          ? accountId
          : LoginInfoNormalizer.textOrNull(genia.get("account_id"));
    } catch (Exception e) {
      return null; // 읽지 못하면 원문 지문으로 — 지문 하나 때문에 등록을 깨지 않는다.
    }
  }

  /** auth.json 의 last_refresh(ISO 시각) — 없거나 읽지 못하면 지금(방금 넣은 로그인으로 본다). */
  private static Instant lastRefreshOrNow(String normalized) {
    Instant at = lastRefreshOf(normalized);
    return at != null ? at : Instant.now();
  }

  /**
   * auth.json 의 last_refresh(ISO 시각) — 없거나 읽지 못하면 null. 이관 백필이 같은 계정의 원문 여럿 중 가장 최근 것을 고를 때도
   * 쓴다(null 은 가장 옛것).
   */
  public static Instant lastRefreshOf(String normalized) {
    try {
      String text = LoginInfoNormalizer.textOrNull(JSON.readTree(normalized).get("last_refresh"));
      if (text != null) {
        try {
          return Instant.parse(text);
        } catch (Exception e) {
          return OffsetDateTime.parse(text).toInstant();
        }
      }
    } catch (Exception e) {
      // 읽지 못함 — null
    }
    return null;
  }

  /** 비었으면 「<종류 이름> 계정」, 아니면 앞뒤 공백을 뗀 라벨. */
  private static String labelOrDefault(String label, String provider) {
    String stripped = Texts.stripToNull(label);
    return stripped != null ? stripped : AgentProviders.label(provider) + " 계정";
  }

  /** 살아 있는 계정 한 건 — 없으면 404(다른 워크스페이스·폐기 포함). */
  private AgentAccountRow requireActive(long id) {
    return accounts.findActive(id).orElseThrow(AgentAccountNotFoundException::new);
  }

  /** 같은 키 유일 인덱스 위반이면 409 예외로, 그 밖의 무결성 위반은 그대로. */
  private static RuntimeException duplicateOr(IntegrityConstraintViolationException e) {
    String msg = e.getMessage();
    return msg != null && msg.contains(FINGERPRINT_INDEX)
        ? new AgentAccountDuplicateException()
        : e;
  }

  /**
   * 계정 한 건의 사용량 블록(WP-1449) — 상태는 {@link UsageStatusCalculator} 가 정하고, 창 값·조회 시각·실패 이유·마지막 사용 시각은
   * 저장된 그대로 싣는다(마지막 시도가 실패해도 마지막 성공 값은 함께 보인다). 기록이 없으면 각 칸이 null 이다.
   */
  private AccountUsage usageOf(
      AgentAccountRow r, List<UsageSnapshot> snapshots, UsageCheckRow check) {
    String status =
        UsageStatusCalculator.status(
            r.provider(),
            r.status(),
            snapshots,
            check,
            BigDecimal.valueOf(usageProperties.nearLimitPercent()),
            Instant.now());
    return new AccountUsage(
        status,
        windowOf(snapshots, UsageWindow.FIVE_HOUR),
        windowOf(snapshots, UsageWindow.WEEKLY),
        check == null ? null : check.checkedAt(),
        check == null ? null : check.succeededAt(),
        check == null ? null : check.errorCode(),
        check == null ? null : check.errorMessage(),
        check == null ? null : check.lastUsedAt());
  }

  /** 스냅샷들 중 한 창 → 응답 창(없으면 null). */
  private static AccountUsage.Window windowOf(List<UsageSnapshot> snapshots, UsageWindow w) {
    for (UsageSnapshot s : snapshots) {
      if (s.window() == w)
        return new AccountUsage.Window(s.usedPercent(), s.resetsAt(), s.observedAt());
    }
    return null;
  }

  /** 행들 → 응답. 쓰는 AI 는 계정·사용자를 한 번씩 몰아 조회한다(N+1 방지). */
  private List<AgentAccountResponse> toResponses(List<AgentAccountRow> rows) {
    if (rows.isEmpty()) return List.of();
    Map<Long, List<Long>> agentsByAccount =
        bindings.findAgentsByAccounts(rows.stream().map(AgentAccountRow::id).toList());
    List<Long> agentIds =
        agentsByAccount.values().stream().flatMap(List::stream).distinct().toList();
    Map<Long, UserResponse> users =
        agentIds.isEmpty()
            ? Map.of()
            : userRepository.findByIds(agentIds).stream()
                .collect(Collectors.toMap(UserResponse::id, Function.identity(), (a, b) -> a));
    // 사용량도 계정마다 따로 읽지 않고 id 묶음으로 한 번씩 읽는다(WP-1449)
    List<Long> ids = rows.stream().map(AgentAccountRow::id).toList();
    Map<Long, List<UsageSnapshot>> snapshots = usageRepository.findSnapshots(ids);
    Map<Long, UsageCheckRow> checks = usageRepository.findChecks(ids);
    List<AgentAccountResponse> out = new ArrayList<>(rows.size());
    for (AgentAccountRow r : rows) {
      List<BoundAgent> agents = new ArrayList<>();
      for (Long agentId : agentsByAccount.getOrDefault(r.id(), List.of())) {
        UserResponse u = users.get(agentId);
        if (u != null) agents.add(new BoundAgent(agentId, u.username(), u.name()));
      }
      out.add(
          new AgentAccountResponse(
              r.id(),
              r.provider(),
              r.label(),
              r.accountEmail(),
              r.lastRefreshedAt(),
              r.status(),
              r.createdAt(),
              r.updatedAt(),
              agents,
              usageOf(r, snapshots.getOrDefault(r.id(), List.of()), checks.get(r.id()))));
    }
    return out;
  }

  /**
   * 계정 감사 로그 — 공통 메타(계정 id·종류·라벨)에 호출자의 extra 를 더해 싣는다. 원문은 절대 싣지 않는다. 같은 패키지의 Pod 로그인 올리기({@link
   * AgentAccountPodSource})도 같은 형식으로 남기도록 패키지 공개.
   */
  void audit(
      Long callerId,
      String action,
      long id,
      String description,
      String provider,
      String label,
      Map<String, String> extra) {
    Map<String, String> meta = new HashMap<>(extra);
    meta.put("account_id", String.valueOf(id));
    meta.put("provider", provider);
    meta.put("label", String.valueOf(label));
    logAudit(callerId, action, "agent_account", String.valueOf(id), description, meta);
  }

  /**
   * 계정·묶음 감사 로그를 남기는 한 곳 — 계정 서비스와 묶기 서비스({@link AgentAccountBindingService})가 같이 쓴다(행위자 이름·기록 형식이
   * 갈라지지 않게). 메타에 원문을 싣지 않는 것은 호출자 책임이다.
   */
  void logAudit(
      Long callerId,
      String action,
      String entityType,
      String entityId,
      String description,
      Map<String, String> meta) {
    auditLogService.log(
        callerId,
        // 사람 없이 서버가 한 일(이관 백필 등)은 「system」 — audit_log.username 은 NOT NULL 이다.
        callerId == null
            ? SYSTEM_ACTOR
            : userRepository.findById(callerId).map(UserResponse::username).orElse(null),
        action,
        entityType,
        entityId,
        description,
        null,
        null,
        "SUCCESS",
        null,
        meta);
  }
}
