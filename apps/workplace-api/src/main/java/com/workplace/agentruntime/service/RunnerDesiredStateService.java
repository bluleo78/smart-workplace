package com.workplace.agentruntime.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.agentruntime.config.AgentRuntimeProperties;
import com.workplace.agentruntime.dto.AgentTemplate;
import com.workplace.agentruntime.dto.ApplyMode;
import com.workplace.agentruntime.dto.RunnerAgentKeyResponse;
import com.workplace.agentruntime.dto.RunnerClaudeSecretResponse;
import com.workplace.agentruntime.dto.RunnerDesiredAgent;
import com.workplace.agentruntime.dto.RunnerDesiredResponse;
import com.workplace.agentruntime.dto.RunnerObservedAgent;
import com.workplace.agentruntime.dto.RunnerObservedRequest;
import com.workplace.agentruntime.dto.RunnerObservedResponse;
import com.workplace.agentruntime.dto.RunnerPrincipal;
import com.workplace.agentruntime.dto.RunnerSecretRef;
import com.workplace.agentruntime.exception.AgentLocationNotFoundException;
import com.workplace.agentruntime.exception.RunnerAgentNotFoundException;
import com.workplace.agentruntime.exception.RunnerSecretNotFoundException;
import com.workplace.agentruntime.outbound.AgentRuntimeDesiredChanged;
import com.workplace.agentruntime.repository.AgentLocationRepository;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository.Row;
import com.workplace.auth.dto.ManagedKeyChain;
import com.workplace.auth.service.AgentApiKeyService;
import com.workplace.auth.service.AgentApiKeyService.ManagedKey;
import com.workplace.auth.service.AiAgentCredentialService;
import com.workplace.auth.service.AiAgentCredentialService.ActiveProviderSecret;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * runner 쪽 원하는 상태·관찰 상태 서비스(WP-1249) — runner 토큰이 가리키는 위치에 떠 있어야 할 AI 목록을 만들고, runner 가 본 Pod 상태를
 * 저장한다. 테넌트는 인증 필터가 토큰의 테넌트로 세워 두므로 모든 조회가 RLS 로 그 워크스페이스에 갇힌다. 위치 조건은 쿼리 WHERE 에 둔다 — 다른 위치의 AI 가
 * desired 에 나오거나 observed 로 고쳐지지 않게.
 *
 * <p>WP-1253: Works 가 띄운 AI 의 키를 runner 요청으로 자동 발급·교체하고(옛 키는 새 Pod 가 관찰된 뒤 정리), 모델 연결 원문을 runner 에
 * 넘긴다. 원문은 runner 전용 응답으로만 나가고 desired 에는 버전만 싣는다.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class RunnerDesiredStateService {

  /** runner 가 변경 스트림과 별도로 desired 를 다시 조회하는 주기(초) — 이벤트를 놓쳐도 이 안에 맞춰진다. */
  public static final int POLL_INTERVAL_SECONDS = 300;

  private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {};
  private static final TypeReference<List<Map<String, Object>>> LIST_TYPE =
      new TypeReference<>() {};

  private final AgentLocationRepository locations;
  private final AgentRuntimeSettingRepository settings;
  private final AgentTemplateRegistry registry;
  private final UserRepository userRepository;
  private final AgentRuntimeProperties properties;
  private final ObjectMapper objectMapper;
  private final AgentApiKeyService agentKeys;
  private final AiAgentCredentialService credentials;
  private final ApplicationEventPublisher events;

  /**
   * 템플릿 이름@버전 → runner 모양으로 바꾼 자원·보조 컨테이너·플러그인. 템플릿은 시작 때 한 번 읽혀 바뀌지 않으므로 요청마다 다시 바꾸지 않는다. 응답과 같은
   * ObjectMapper 로 바꿔 직렬화 모양이 그대로다.
   */
  private final Map<String, TemplateShape> shapes = new ConcurrentHashMap<>();

  /** runner 모양으로 바꾼 템플릿 값(자원이 없으면 빈 맵). */
  private record TemplateShape(
      Map<String, Object> resources,
      List<Map<String, Object>> sidecars,
      List<Map<String, Object>> plugins) {}

  /**
   * 이 위치에 떠 있어야 할 AI 목록 — desired RUN 이고 실제 위치(지정 위치 ?? 기본)가 이 위치인 AI 만. 템플릿이 사라진 AI 는 띄울 방법이 없어 싣지
   * 않는다(runner 는 목록에 없는 Pod 를 지우므로 결과적으로 내려간다 — 관리자 화면은 templateMissing 으로 알린다).
   */
  @Transactional(readOnly = true)
  public RunnerDesiredResponse desired(RunnerPrincipal principal) {
    AgentLocationRepository.Row location = requireLocation(principal);
    List<Row> rows = settings.findRunningAt(location.id(), location.isDefault());
    OffsetDateTime now = OffsetDateTime.now();
    List<RunnerDesiredAgent> agents = new ArrayList<>();
    if (!rows.isEmpty()) {
      List<Long> ids = rows.stream().map(Row::agentUserId).toList();
      // AI 마다 따로 조회하지 않게 이름·managed 키·모델 연결을 한 번씩 모아 읽는다(WP-1253).
      Map<Long, String> usernames =
          userRepository.findByIds(ids).stream()
              .collect(Collectors.toMap(UserResponse::id, UserResponse::username));
      Map<Long, ManagedKeyChain> chains = agentKeys.managedChains(ids, principal.tenantId());
      Map<Long, Long> claudeVersions = credentials.findActiveIds(ids);
      for (Row row : rows) {
        long id = row.agentUserId();
        registry
            .find(row.templateName())
            .ifPresent(
                t ->
                    agents.add(
                        toAgent(
                            principal,
                            row,
                            t,
                            usernames.get(id),
                            chains.getOrDefault(id, ManagedKeyChain.EMPTY),
                            claudeVersions.get(id),
                            now)));
      }
    }
    return new RunnerDesiredResponse(
        location.id(),
        location.name(),
        now,
        POLL_INTERVAL_SECONDS,
        properties.mcpUrl(),
        properties.apiUrl(),
        agents);
  }

  /**
   * 관찰 상태 저장 — 실제 위치가 이 위치인 AI 만 고치고, 없는 AI·다른 위치의 AI 는 {@code ignored} 로 돌려준다. generation·원하는 상태는
   * 바꾸지 않고 변경 이벤트도 내지 않는다(관찰은 원하는 상태가 아니다). 관찰 칸 쓰기는 보고 묶음 전체를 한 번에 보낸다.
   */
  public RunnerObservedResponse observed(RunnerPrincipal principal, RunnerObservedRequest req) {
    AgentLocationRepository.Row location = requireLocation(principal);
    List<Boolean> updated =
        settings.updateObserved(location.id(), location.isDefault(), req.agents());
    List<RunnerObservedAgent> applied = new ArrayList<>();
    List<Long> ignored = new ArrayList<>();
    for (int i = 0; i < updated.size(); i++) {
      RunnerObservedAgent o = req.agents().get(i);
      if (updated.get(i)) applied.add(o);
      else ignored.add(o.agentUserId());
    }
    afterObservedUpdated(principal.tenantId(), applied);
    return new RunnerObservedResponse(applied.size(), ignored);
  }

  /**
   * 관찰 칸을 고친 AI 들에 이어서 할 일 — 같은 트랜잭션에서 돈다(WP-1253). 보고한 generation 으로 현재 managed 키가 확인되면({@link
   * ManagedKeyChain#isConfirmed}) 그 AI 의 이 워크스페이스 다른 managed 키를 정리 유예로 줄인다. 옛 generation 보고·교체
   * generation 이 없는 옛 키는 그대로 둔다. 줄이기는 늦추지 않으므로 60초마다 같은 보고가 와도 만료가 밀리지 않는다. 키 조회와 줄이기는 보고 묶음 전체에 한
   * 번씩 한다.
   *
   * @param applied 이 위치의 AI 로 확인돼 반영된 보고들
   */
  private void afterObservedUpdated(long tenantId, List<RunnerObservedAgent> applied) {
    List<RunnerObservedAgent> withGen =
        applied.stream().filter(o -> o.observedGeneration() != null).toList();
    if (withGen.isEmpty()) return;
    Map<Long, ManagedKeyChain> chains =
        agentKeys.managedChains(
            withGen.stream().map(RunnerObservedAgent::agentUserId).toList(), tenantId);
    List<Long> confirmedAgents = new ArrayList<>();
    List<Long> keep = new ArrayList<>();
    for (RunnerObservedAgent o : withGen) {
      ManagedKeyChain chain = chains.getOrDefault(o.agentUserId(), ManagedKeyChain.EMPTY);
      if (!chain.isConfirmed(o.observedGeneration())) continue;
      confirmedAgents.add(o.agentUserId());
      keep.add(chain.current().orElseThrow().id());
    }
    agentKeys.shortenOthersToGrace(confirmedAgents, tenantId, keep);
  }

  /**
   * AI 키 자동 발급(WP-1253) — 이 위치에서 켜져 있는 AI 만(아니면 404). 설정 행을 먼저 잠가 같은 AI 의 동시 발급·끄기와 차례로 선다. 키 사슬은 이
   * 워크스페이스(토큰의 테넌트) 안에서만 본다.
   *
   * <p>Pod 안의 MCP 헤더·알림 감시는 키를 시작할 때 읽어 들고 있어 새 키는 Pod 를 다시 띄워야 반영된다. 그래서 경우를 나눈다.
   *
   * <ol>
   *   <li><b>재시도</b> — 현재 managed 키가 아직 어떤 Pod 에도 쓰였다고 확인되지 않았으면({@link
   *       ManagedKeyChain#isUndelivered}) runner 가 앞 응답을 받지 못한 것으로 본다. 같은 generation 으로 새 키를 주고
   *       전달되지 않은 앞 키는 바로 만료·회수한다. generation 은 올리지 않는다 — 재시도가 Pod 를 거듭 갈아치우지 않게.
   *   <li><b>죽은 키 교체</b> — 활성 managed 키가 없는데 전에 있었고(회수·만료) Pod 가 떠 있었다면(관찰 generation 있음) 그 Pod 는
   *       이미 인증되지 않는다. 쉬는 중을 보고할 수도 없으니 generation 을 올리고 바로 적용(NOW)한다. 이미 바로 적용이 걸려 있으면(끄고 다시 켬 등 —
   *       runner 가 어차피 새 Pod 를 만든다) 올리지 않는다 — 다시 켤 때마다 Pod 를 두 번 만들지 않게.
   *   <li><b>교체</b> — 활성 managed 키가 있고 쓰였으면 generation 을 올리고 쉴 때 적용(IDLE — 아직 반영 안 된 NOW 가 걸려 있으면
   *       그대로)한다. 옛 키는 지금 줄이지 않는다(지금 Pod 가 계속 쓴다). 옛 키가 24시간 안에 만료되면 {@link RolloutPolicy} 가 쉬기를
   *       기다리지 않는다.
   *   <li><b>첫 발급</b> — generation 을 올리지 않는다. 정리 유예에 든 키만 있을 때(끄고 곧 다시 켬·다른 위치로 옮겼다 돌아옴)도 첫 발급으로 본다
   *       — 그 키는 지워지는 Pod 의 것이고 runner 는 어차피 새 Pod 를 만든다.
   * </ol>
   *
   * <p>새 키 행에는 늘 그 키가 맞춰진 generation(올렸으면 올린 값, 아니면 지금 값)을 교체 generation 으로 남긴다 — 그 generation 의
   * Pod 가 관찰되면 「쓰인 키」가 되고 다른 managed 키가 정리된다.
   *
   * <p>generation 올리기는 generation·apply_mode 만 고친다 — 관리자가 남긴 updated_by 를 지우지 않는다.
   */
  public RunnerAgentKeyResponse issueAgentKey(RunnerPrincipal principal, long agentUserId) {
    AgentLocationRepository.Row location = requireLocation(principal);
    long tenantId = principal.tenantId();
    Row row =
        settings
            .findRunningAtForUpdate(agentUserId, location.id(), location.isDefault())
            .orElseThrow(RunnerAgentNotFoundException::new);
    ManagedKeyChain chain = agentKeys.managedChain(agentUserId, tenantId);
    // 교체·재시도 판정은 정리 유예에 든 키(끄기·위치 이동으로 줄인 — 지워지는 Pod 의 키)를 빼고 한다. 죽은 키 판정은 전체 사슬로 한다 — 유예 중인
    // 키가 있다는 것은 일부러 내린 것(Pod 를 지우는 중)이라 죽은 키를 쥔 채 떠 있는 Pod 가 아니다.
    ManagedKeyChain live = chain.live(OffsetDateTime.now());
    boolean undelivered = live.isUndelivered(row.generation(), row.observedGeneration());
    // 올릴 적용 시점 — null 이면 generation 을 올리지 않는다(재시도·첫 발급).
    ApplyMode bump = null;
    if (!live.isEmpty() && !undelivered) {
      bump = ApplyMode.IDLE;
    } else if (chain.isEmpty()
        && row.observedGeneration() != null
        && !pendingApplyNow(row)
        && agentKeys.hasManagedHistory(agentUserId, tenantId)) {
      bump = ApplyMode.NOW;
    }
    long keyGeneration = row.generation();
    if (bump != null) {
      keyGeneration = settings.bumpGenerationForRotation(agentUserId, bump);
      events.publishEvent(new AgentRuntimeDesiredChanged(tenantId, location.id()));
    }
    Long replaceKeyId = undelivered ? live.current().orElseThrow().id() : null;
    ManagedKey key =
        agentKeys.issueManaged(agentUserId, tenantId, keyGeneration, replaceKeyId, location.name());
    return new RunnerAgentKeyResponse(
        key.id(), key.plaintext(), key.expiresAt(), key.rotateAfter());
  }

  /** 아직 반영되지 않은 바로 적용(NOW)이 걸려 있는지 — 켜기·다시 시작 직후처럼 runner 가 어차피 Pod 를 새로 만든다. */
  private static boolean pendingApplyNow(Row row) {
    return row.applyMode() == ApplyMode.NOW && row.hasUnappliedGeneration();
  }

  /** 모델 연결 원문(WP-1253) — 이 위치에서 켜져 있는 AI 만(아니면 404), 활성 연결이 없으면 404. */
  @Transactional(readOnly = true)
  public RunnerClaudeSecretResponse claudeSecret(RunnerPrincipal principal, long agentUserId) {
    AgentLocationRepository.Row location = requireLocation(principal);
    if (!settings.isRunningAt(agentUserId, location.id(), location.isDefault())) {
      throw new RunnerAgentNotFoundException();
    }
    ActiveProviderSecret secret =
        credentials
            .findActiveSecret(agentUserId)
            .orElseThrow(() -> new RunnerSecretNotFoundException("AI 에 등록된 모델 연결이 없습니다"));
    return new RunnerClaudeSecretResponse(secret.id(), secret.provider(), secret.plaintext());
  }

  /** 토큰의 위치 — 토큰은 위치와 함께 지워지므로 보통 있지만, 없으면 404. */
  private AgentLocationRepository.Row requireLocation(RunnerPrincipal principal) {
    return locations
        .findById(principal.locationId())
        .orElseThrow(AgentLocationNotFoundException::new);
  }

  /**
   * 설정 행 + 레지스트리 템플릿 → desired 항목. 이미지·자원·보조 컨테이너·플러그인은 레지스트리의 현재 템플릿 값이다. {@code applyNow} 는
   * {@link RolloutPolicy} 가 지금 적용이라고 할 때만 참이다 — 그 밖에는 runner 가 지금 Pod 를 그대로 두고, AI 가 쉬는 중이라고 보고하면
   * Works 가 변경 이벤트를 내 다시 조회하게 한다(WP-1250).
   *
   * @param keys 이 AI 의 이 워크스페이스 활성 managed 키 사슬
   * @param claudeVersion 활성 모델 연결 id(없으면 null)
   */
  private RunnerDesiredAgent toAgent(
      RunnerPrincipal principal,
      Row row,
      AgentTemplate t,
      String username,
      ManagedKeyChain keys,
      Long claudeVersion,
      OffsetDateTime now) {
    TemplateShape shape = shapeOf(t);
    return new RunnerDesiredAgent(
        row.agentUserId(),
        username,
        principal.tenantId(),
        row.generation(),
        RolloutPolicy.decide(row, keys, now) == RolloutPolicy.Decision.NOW,
        t.name(),
        t.version(),
        t.image(),
        shape.resources(),
        shape.sidecars(),
        shape.plugins(),
        row.config(),
        secretsFor(t, keys.live(now), claudeVersion));
  }

  /** 템플릿 한 개의 runner 모양 — 이름@버전마다 한 번만 바꾼다. */
  private TemplateShape shapeOf(AgentTemplate t) {
    return shapes.computeIfAbsent(
        t.name() + "@" + t.version(),
        k ->
            new TemplateShape(
                t.resources() == null
                    ? Map.of()
                    : objectMapper.convertValue(t.resources(), MAP_TYPE),
                objectMapper.convertValue(t.sidecars(), LIST_TYPE),
                objectMapper.convertValue(t.plugins(), LIST_TYPE)));
  }

  /**
   * 비밀값 참조 — 원문 없이 이름·출처·버전만. agent-key 는 Works 가 띄우는 AI 모두에(현재 managed 키 id·rotateAfter, 아직 없으면
   * null — 정리 유예에 든 키만 남았으면 그것도 「없음」이라 runner 가 새로 받는다. 끄고 곧 다시 켰을 때 5분 뒤 만료될 키로 Pod 를 띄우지 않게),
   * claude 는 템플릿이 요구할 때(활성 연결 id, 없으면 null), github 는 runner 설치 때 위치 쪽에 만든 Secret(Works 는 이름만).
   */
  private static List<RunnerSecretRef> secretsFor(
      AgentTemplate t, ManagedKeyChain keys, Long claudeVersion) {
    List<RunnerSecretRef> out = new ArrayList<>();
    Optional<ManagedKeyChain.Key> key = keys.current();
    out.add(
        new RunnerSecretRef(
            "agent-key",
            RunnerSecretRef.SOURCE_WORKS,
            key.map(ManagedKeyChain.Key::id).orElse(null),
            key.map(ManagedKeyChain.Key::rotateAfter).orElse(null)));
    for (String need : t.requires()) {
      if ("claude".equals(need)) {
        out.add(new RunnerSecretRef("claude", RunnerSecretRef.SOURCE_WORKS, claudeVersion, null));
      } else if ("github".equals(need)) {
        out.add(new RunnerSecretRef("github", RunnerSecretRef.SOURCE_LOCATION, null, null));
      }
    }
    return out;
  }
}
