package com.workplace.agentruntime.service;

import com.workplace.agentruntime.dto.AgentRepoCredentialRequest;
import com.workplace.agentruntime.dto.AgentRepoCredentialResponse;
import com.workplace.agentruntime.dto.RunnerReposSecretResponse;
import com.workplace.agentruntime.exception.AgentRepoCredentialNotFoundException;
import com.workplace.agentruntime.exception.InvalidAgentRepoCredentialException;
import com.workplace.agentruntime.repository.AgentRepoCredentialRepository;
import com.workplace.agentruntime.repository.AgentRepoCredentialRepository.Row;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository;
import com.workplace.audit.service.AuditLogService;
import com.workplace.global.security.EncryptionService;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * AI 별·저장소 호스트별 토큰(WP-1268) — 관리자가 AI 마다 GitHub/GitLab 호스트의 토큰을 등록·교체·폐기하고, runner 가 원문을 받아 간다.
 * Claude 연결({@code AiAgentCredentialService})과 같은 방식: DB 에는 EncryptionService 출력만, 같은 host 의 활성 행은
 * 하나(교체 = 폐기 뒤 새로 넣기), 원문은 등록 요청과 runner 응답에만 나온다.
 *
 * <p>등록·폐기는 그 AI 의 repos 버전을 바꾸므로(desired 의 {@code repos} 참조 — {@link
 * AgentRepoCredentialRepository#versionsByAgents}) 켜져 있는 AI 면 실제 위치의 runner 에게 「다시 받아 가라」고 알린다. 알림은
 * 커밋 뒤에 나간다.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class AgentRepoCredentialService {

  /** 허용하는 kind — DB CHECK 와 같다. */
  private static final Set<String> KINDS = Set.of("GITHUB", "GITLAB");

  private static final int TOKEN_MIN = 16;
  private static final int TOKEN_MAX = 2048;

  private final AgentRepoCredentialRepository repo;
  private final EncryptionService encryptionService;
  private final AuditLogService auditLogService;
  private final UserRepository userRepository;
  private final AgentRuntimeSettingRepository settings;
  private final AgentRuntimeTransitions transitions;

  /** 그 AI 의 활성 토큰 메타(host 오름차순) — 토큰·암호문 없음. */
  @Transactional(readOnly = true)
  public List<AgentRepoCredentialResponse> list(long agentUserId) {
    return repo.findActive(agentUserId).stream().map(AgentRepoCredentialService::toMeta).toList();
  }

  /**
   * 등록·교체 — 같은 host 의 활성 행이 있으면 폐기하고 새 행을 넣는다. kind·host·token 형식이 틀리면 400(검증은 이 한 곳에서). 대상이 AI
   * 인지·개인 비서인지는 호출자(컨트롤러)가 확인한다.
   */
  public AgentRepoCredentialResponse register(
      long callerId, long agentUserId, AgentRepoCredentialRequest req) {
    String kind = req.kind() == null ? "" : req.kind().trim().toUpperCase(java.util.Locale.ROOT);
    if (!KINDS.contains(kind)) {
      throw new InvalidAgentRepoCredentialException("종류는 GITHUB 또는 GITLAB 이어야 합니다");
    }
    String host = RepoHosts.normalize(req.host());
    if (host == null) {
      throw new InvalidAgentRepoCredentialException(
          "호스트는 github.com 처럼 호스트 이름만 적어 주세요(주소·포트·경로 제외)");
    }
    String token = req.token() == null ? "" : req.token().trim();
    if (token.length() < TOKEN_MIN || token.length() > TOKEN_MAX) {
      throw new InvalidAgentRepoCredentialException(
          "토큰은 " + TOKEN_MIN + "~" + TOKEN_MAX + "자여야 합니다");
    }
    UserResponse agent = userRepository.findById(agentUserId).orElse(null);

    repo.revokeActive(agentUserId, host);
    Row row = repo.insert(agentUserId, kind, host, encryptionService.encrypt(token), callerId);

    audit(
        callerId, "AGENT_REPO_TOKEN_REGISTERED", row, "AI 저장소 토큰 등록: " + usernameOf(agent), agent);
    notifyRuntime(callerId, agentUserId);
    return toMeta(row);
  }

  /** 폐기 — 그 AI 의 활성 행이면 폐기, 아니면 404. */
  public void revoke(long callerId, long agentUserId, long credentialId) {
    Row row =
        repo.revokeById(agentUserId, credentialId)
            .orElseThrow(AgentRepoCredentialNotFoundException::new);
    UserResponse agent = userRepository.findById(agentUserId).orElse(null);
    audit(callerId, "AGENT_REPO_TOKEN_REVOKED", row, "AI 저장소 토큰 폐기: " + usernameOf(agent), agent);
    notifyRuntime(callerId, agentUserId);
  }

  /** 그 AI 의 활성 토큰 host 집합 — 켜기 전 확인이 쓴다. */
  @Transactional(readOnly = true)
  public Set<String> activeHosts(long agentUserId) {
    return repo.findActive(agentUserId).stream()
        .map(Row::host)
        .collect(java.util.stream.Collectors.toSet());
  }

  /** 여러 AI 의 repos 버전(epoch 밀리초) — desired 가 AI 마다 묻지 않게 묶어 읽는다. 행이 없는 AI 는 빠진다. */
  @Transactional(readOnly = true)
  public Map<Long, Long> versions(Collection<Long> agentUserIds) {
    return repo.versionsByAgents(agentUserIds);
  }

  /**
   * runner 에 넘길 활성 토큰 원문(활성만, host 오름차순) — 돌려준 행의 last_used_at 을 지금으로 고친다(「최근 사용」= runner 가 마지막으로
   * 받아 간 때). 원문은 응답으로만 나가고 로그·예외에 싣지 않는다.
   */
  public RunnerReposSecretResponse secretsFor(long agentUserId) {
    List<Row> rows = repo.findActive(agentUserId);
    Long version = repo.versionsByAgents(List.of(agentUserId)).get(agentUserId);
    repo.touchLastUsed(rows.stream().map(Row::id).toList());
    return new RunnerReposSecretResponse(
        version,
        rows.stream()
            .map(
                r ->
                    new RunnerReposSecretResponse.Token(
                        r.kind(), r.host(), encryptionService.decrypt(r.encryptedToken())))
            .toList());
  }

  /**
   * 켜져 있는 AI 면 실제 위치(지정 위치 ?? 기본)의 runner 에게 desired 를 다시 받아 가게 알리고, 관리자 화면에는 「바뀜」을 알린다(알림 규칙은
   * {@link AgentRuntimeTransitions#inputsChanged}). Claude 연결 등록은 runner 에 알리지 않고 폴링(5분)에 맡기지만, 저장소
   * 토큰은 「바로 반영」으로 보여 주므로 알린다. 실행 설정 행이 없으면 화면 알림만 낸다.
   */
  private void notifyRuntime(long callerId, long agentUserId) {
    transitions.inputsChanged(
        agentUserId,
        settings.find(agentUserId).map(AgentRuntimeTransitions.State::of).orElse(null),
        callerId);
  }

  /** 감사 로그 — 메타에 토큰은 싣지 않는다(대상 AI·kind·host 만). 호출자 이름을 못 찾으면 system 으로 남긴다. */
  private void audit(
      long callerId, String action, Row row, String description, UserResponse agent) {
    Map<String, Object> meta = new LinkedHashMap<>();
    meta.put("agentUserId", String.valueOf(row.agentUserId()));
    meta.put("agentUsername", usernameOf(agent));
    meta.put("kind", row.kind());
    meta.put("host", row.host());
    String caller = userRepository.findById(callerId).map(UserResponse::username).orElse("system");
    auditLogService.log(
        callerId,
        caller,
        action,
        "agent_repo_credential",
        String.valueOf(row.id()),
        description,
        null,
        null,
        "SUCCESS",
        null,
        meta);
  }

  private static String usernameOf(UserResponse agent) {
    return agent == null ? "" : agent.username();
  }

  private static AgentRepoCredentialResponse toMeta(Row r) {
    return new AgentRepoCredentialResponse(
        r.id(), r.kind(), r.host(), r.createdAt(), r.lastUsedAt());
  }
}
