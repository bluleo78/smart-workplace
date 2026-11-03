package com.workplace.agentruntime.service;

import com.workplace.agentruntime.dto.AgentLocationResponse;
import com.workplace.agentruntime.dto.AgentRuntimeProjectResponse;
import com.workplace.agentruntime.dto.AgentRuntimeSettingResponse;
import com.workplace.agentruntime.dto.AgentRuntimeStatus;
import com.workplace.agentruntime.dto.AgentTemplate;
import com.workplace.agentruntime.dto.ApplyMode;
import com.workplace.agentruntime.dto.Desired;
import com.workplace.agentruntime.dto.ObservedState;
import com.workplace.agentruntime.dto.PutAgentRuntimeSettingRequest;
import com.workplace.agentruntime.exception.AgentLocationNotFoundException;
import com.workplace.agentruntime.exception.AgentRuntimeSettingConflictException;
import com.workplace.agentruntime.exception.AgentRuntimeSettingNotFoundException;
import com.workplace.agentruntime.exception.InvalidAgentConfigException;
import com.workplace.agentruntime.outbound.AgentRuntimeDesiredChanged;
import com.workplace.agentruntime.repository.AgentLocationRepository;
import com.workplace.agentruntime.repository.AgentRuntimeProjectRepository;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository.Row;
import com.workplace.agentruntime.service.AgentRuntimeTransitions.State;
import com.workplace.audit.service.AuditLogService;
import com.workplace.auth.service.AgentProviders;
import com.workplace.auth.service.AiAgentCredentialService;
import com.workplace.user.dto.AgentRuntime;
import com.workplace.user.dto.UserKind;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.exception.UserNotFoundException;
import com.workplace.user.repository.UserRepository;
import com.workplace.user.service.AgentRuntimePolicy;
import com.workplace.user.service.UserService;
import com.workplace.user.service.WorkspaceMemberGuard;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * AI 별 실행 설정·원하는 상태 서비스(WP-1247) — 템플릿·실행 위치·설정 저장과 켜기·끄기·다시 시작. 관리자 권한은
 * 컨트롤러({@code @RequireAdmin})가 책임진다.
 *
 * <p>행이 있다는 것 = 「Works 가 이 AI 를 작업 공간에서 띄운다」. 이런 AI 의 {@code user.agent_runtime} 은 EXTERNAL 이다 — 작업
 * 공간의 AI 는 AI 키·MCP 로 일하므로 서버(ai-agent)가 대신 답하는 INTERNAL 디스패치를 받으면 안 된다.
 *
 * <p>원하는 상태가 바뀔 때마다 generation 을 1 올리고, 실제 위치(기본 해석 뒤)마다 {@link AgentRuntimeDesiredChanged} 를 내 그
 * 위치의 runner 가 다시 받아 가게 한다. 바뀐 것이 없으면 generation·이벤트 모두 그대로다(재시도·중복 클릭이 헛돌지 않게).
 *
 * <p>메서드는 바뀐 다음 행만 계산해 저장하고, 따라붙는 처리(키 정리·runner 알림·관리자 알림)는 {@link
 * AgentRuntimeTransitions#applyTransition} 한곳에 전·후 모양을 넘겨 맡긴다(WP-1274).
 */
@Service
@Transactional
@RequiredArgsConstructor
public class AgentRuntimeSettingService {

  private final AgentRuntimeSettingRepository settings;
  private final AgentLocationRepository locationRepository;
  private final AgentLocationService locationService;
  private final AgentTemplateRegistry registry;
  private final UserService userService;
  private final AgentRuntimePolicy agentRuntimePolicy;
  private final UserRepository userRepository;
  private final WorkspaceMemberGuard memberGuard;
  private final AuditLogService auditLogService;
  private final AgentRuntimeTransitions transitions;
  private final AgentRuntimeProjectRepository projectRepository;
  private final AgentRepoCredentialService repoCredentials;
  private final AiAgentCredentialService credentials;

  /** 실행 설정 조회 — 없으면 404. 템플릿이 사라졌으면 500 대신 {@code templateMissing=true}. */
  @Transactional(readOnly = true)
  public AgentRuntimeSettingResponse get(long agentId) {
    memberGuard.require(agentId);
    Row row = settings.find(agentId).orElseThrow(AgentRuntimeSettingNotFoundException::new);
    return toResponse(row, locationService.effectiveLocationId(row.locationId()));
  }

  /**
   * 실행 설정 저장(없으면 만들고, 있으면 바꾼다). 순서: 구성원 확인 → AI 인지(아니면 400) → 작업 공간 템플릿인지(아니면 400) → 설정 검증 → 실행 방식을
   * EXTERNAL 로(공통·개인 비서면 409 — 이미 EXTERNAL 이면 아무것도 바뀌지 않는다) → 설정 행 잠금 → 테넌트 락 → 지정 위치 확인(없으면 404) →
   * 저장.
   *
   * <p>실행 방식 변경이 AI 행을 잠가 커밋까지 쥐므로 같은 AI 의 첫 저장 둘이 함께 행을 만들다 PK 500 이 나지 않는다. 테넌트 락은 「켜기」와 같이 설정 행
   * 뒤에 잡는다({@link AgentLocationRepository#lockTenantLocations()} — 그 아래에서 위치를 확인하므로 동시 위치 삭제가 FK
   * 500 을 내지 않고, 켜진 AI 를 옮길 때 자리 수를 넘지 않는다).
   *
   * <p>새 행은 generation 1·꺼짐으로 만들고 이벤트를 내지 않는다(꺼져 있어 runner 가 할 일이 없다). 기존 행은 템플릿·버전·위치·설정 중 하나라도
   * 바뀌면 generation+1, apply_mode 는 요청값(없으면 IDLE). 템플릿 버전은 늘 레지스트리의 현재 버전으로 다시 고정한다.
   */
  public AgentRuntimeSettingResponse put(
      long callerId, long agentId, PutAgentRuntimeSettingRequest req) {
    memberGuard.require(agentId);
    UserResponse user =
        userRepository.findById(agentId).orElseThrow(() -> UserNotFoundException.ofId(agentId));
    if (!UserKind.isAgent(user.kind())) {
      throw new InvalidAgentConfigException("AI 구성원에게만 실행 설정을 둘 수 있습니다");
    }
    AgentTemplate template =
        registry
            .find(req.templateName().trim())
            .orElseThrow(() -> new InvalidAgentConfigException("실행 템플릿을 찾을 수 없습니다"));
    if (!"WORKSPACE".equals(template.kind())) {
      throw new InvalidAgentConfigException("이 템플릿은 작업 공간 템플릿이 아닙니다");
    }
    Map<String, String> config = AgentTemplateRegistry.validateConfig(template, req.config());
    userService.setAgentRuntime(callerId, agentId, AgentRuntime.EXTERNAL);

    Optional<Row> existing = settings.findForUpdate(agentId);
    locationRepository.lockTenantLocations();
    if (existing.isEmpty()) {
      if (req.locationId() != null) requireLocation(req.locationId());
      // WP-1296·1297: 지금 AI 계정이 새 템플릿에 맞지 않으면 방식 변경과 함께 끊는다(같은 트랜잭션). 위치 확인 등 거절 검사를 모두 통과한 뒤
      // 저장 직전에만 끊는다 — 거절된 저장이 연결을 끊지 않게.
      AgentAccountFit.revokeUnfit(
          credentials, callerId, agentId, template, credentials.findActiveProvider(agentId));
      Row inserted =
          settings.insert(
              agentId, template.name(), template.version(), req.locationId(), config, callerId);
      audit(callerId, "AGENT_RUNTIME_SETTING_CHANGED", agentId, "AI 실행 설정 저장", meta(template, req));
      // 새 행은 꺼진 채라 runner 에게 알릴 것이 없다 — 관리자 화면에만 「생김」.
      transitions.applyTransition(agentId, null, State.of(inserted), callerId);
      return get(agentId);
    }

    Row row = existing.get();
    Row next =
        row.withTemplateName(template.name())
            .withTemplateVersion(template.version())
            .withLocationId(req.locationId())
            .withConfig(config);
    Long oldEffective = locationService.effectiveLocationId(row.locationId());
    if (next.equals(row)) return toResponse(row, oldEffective);
    // WP-1296·1297: 바뀌는 저장에서만 맞지 않는 AI 계정을 끊는다(바뀐 것이 없는 저장이 조용히 연결을 끊지 않게). 켜져 있는 AI 를 로그인 계정
    // 템플릿으로 바꾸면 새 계정이 아직 없어 그대로 일하지 못하므로 409 — 먼저 끄고 바꾼 뒤 연결한다. 끊기는 아래 위치·자리 검사(404·409)까지
    // 모두 통과한 뒤 저장 직전에 한다 — 거절된 저장이 아무것도 끊지 않게(롤백에 기대지 않는다).
    Optional<String> activeProvider = credentials.findActiveProvider(agentId);
    if (row.desired() == Desired.RUN) requireLoginAccount(template, activeProvider);

    Long newEffective = oldEffective;
    if (!Objects.equals(req.locationId(), row.locationId())) {
      // 켜져 있는 AI 의 위치 지정이 바뀌면 새 실제 위치의 자리를 「켜기」와 같이 확인한다 — 실제 위치가 그대로면(기본 위치를 직접 지정 ↔ 미지정) 자기
      // 자신을 세어 막지 않는다. 옛 위치 자리는 비워질 뿐이라 보지 않는다. 꺼져 있으면 위치가 있는지만 본다.
      if (row.desired() == Desired.RUN) {
        newEffective = claimSeat(req.locationId(), oldEffective).id();
      } else if (req.locationId() != null) {
        newEffective = requireLocation(req.locationId()).id();
      } else {
        newEffective = locationService.effectiveLocationId(null);
      }
    }
    AgentAccountFit.revokeUnfit(credentials, callerId, agentId, template, activeProvider);
    next =
        next.withApplyMode(req.applyMode() == null ? ApplyMode.IDLE : req.applyMode())
            .withGeneration(row.generation() + 1);
    settings.update(next, callerId);
    // 켜진 채 실제 위치가 바뀌면 옛 위치의 runner 가 Pod 를 바로 지운다(끄기와 같다) — 옛·새 위치 모두에 알리고 키를 정리한다.
    transitions.applyTransition(agentId, State.of(row), State.of(next), callerId);
    audit(callerId, "AGENT_RUNTIME_SETTING_CHANGED", agentId, "AI 실행 설정 변경", meta(template, req));
    return toResponse(next, newEffective);
  }

  /**
   * 켜기 — 실제 위치(지정 위치 ?? 기본, 없으면 409)에 자리가 남았는지 확인한 뒤 desired RUN·generation+1·apply_mode NOW. 템플릿
   * 버전은 레지스트리의 현재 버전으로 다시 고정한다(설정은 새 템플릿으로 다시 검증하고 없어진 칸은 버린다). 이미 켜져 있으면 변화 없음 — 단 실행에 실패한(FAILED)
   * AI 면 다시 시작과 같다.
   */
  public AgentRuntimeSettingResponse start(long callerId, long agentId) {
    Row row = lockRow(agentId);
    if (row.desired() == Desired.RUN) {
      // 실행에 실패한 AI 를 다시 켜면 다시 시작과 같다 — 어느 화면의 「켜기」든 실패한 AI 를 다시 띄우게(그대로 두면 켜져 있다며 아무것도 하지 않는다).
      if (statusOf(row) == AgentRuntimeStatus.FAILED) return restartLocked(callerId, agentId, row);
      return toResponse(row, locationService.effectiveLocationId(row.locationId()));
    }
    AgentTemplate template =
        registry
            .find(row.templateName())
            .orElseThrow(
                () ->
                    new AgentRuntimeSettingConflictException(
                        "실행 템플릿을 찾을 수 없어 켤 수 없습니다. 실행 설정을 다시 저장하세요"));
    requireLoginAccount(template, credentials.findActiveProvider(agentId));
    requireRepoTokens(agentId, template);
    locationRepository.lockTenantLocations();
    AgentLocationRepository.Row location = claimSeat(row.locationId(), null);
    Row next =
        row.withTemplateName(template.name())
            .withTemplateVersion(template.version())
            .withConfig(repinConfig(template, row.config()))
            .withDesired(Desired.RUN)
            .withApplyMode(ApplyMode.NOW)
            .withGeneration(row.generation() + 1);
    settings.update(next, callerId);
    transitions.applyTransition(agentId, State.of(row), State.of(next), callerId);
    audit(callerId, "AGENT_RUNTIME_STARTED", agentId, "AI 켜기", Map.of("locationId", location.id()));
    return toResponse(next, location.id());
  }

  /**
   * 끄기 — desired STOP·generation+1. 이미 꺼져 있으면 변화 없음. Works 가 자동 발급한 키는 정리 유예(5분)로 줄인다(WP-1253) —
   * 지워지는 Pod 가 SIGTERM 유예 안에 마무리할 시간만 남기고, 그 뒤에는 꺼진 AI 의 키가 쓰이지 않게.
   */
  public AgentRuntimeSettingResponse stop(long callerId, long agentId) {
    Row row = lockRow(agentId);
    Long effective = locationService.effectiveLocationId(row.locationId());
    if (row.desired() == Desired.STOP) return toResponse(row, effective);
    Row next = bumpDesired(row, Desired.STOP, row.applyMode());
    settings.update(next, callerId);
    transitions.applyTransition(agentId, State.of(row), State.of(next), callerId);
    audit(callerId, "AGENT_RUNTIME_STOPPED", agentId, "AI 끄기", Map.of());
    return toResponse(next, effective);
  }

  /** 다시 시작 — 켜져 있을 때만(아니면 409). generation+1·apply_mode NOW 로 runner 가 바로 다시 띄우게 한다. */
  public AgentRuntimeSettingResponse restart(long callerId, long agentId) {
    Row row = lockRow(agentId);
    if (row.desired() != Desired.RUN) {
      throw new AgentRuntimeSettingConflictException("켜져 있는 AI 만 다시 시작할 수 있습니다");
    }
    return restartLocked(callerId, agentId, row);
  }

  /** 잠가 읽은 켜진 행을 다시 시작한다 — 다시 시작과 실패한 AI 의 「켜기」가 함께 쓴다. */
  private AgentRuntimeSettingResponse restartLocked(long callerId, long agentId, Row row) {
    Long effective = locationService.effectiveLocationId(row.locationId());
    Row next = bumpDesired(row, Desired.RUN, ApplyMode.NOW);
    settings.update(next, callerId);
    transitions.applyTransition(agentId, State.of(row), State.of(next), callerId);
    audit(callerId, "AGENT_RUNTIME_RESTARTED", agentId, "AI 다시 시작", Map.of());
    return toResponse(next, effective);
  }

  /**
   * 실행 설정 삭제 — 켜져 있으면 409(먼저 끄기). 실행 방식은 바꾸지 않는다 — 화면이 이어서 기존 실행 방식 변경 API 를 부른다. 남은 자동 발급 키는 정리
   * 유예로 줄인다(WP-1253 — 끌 때 이미 줄었으면 그대로).
   */
  public void delete(long callerId, long agentId) {
    Row row = lockRow(agentId);
    if (row.desired() == Desired.RUN) throw AgentRuntimeSettingConflictException.running();
    settings.delete(agentId);
    transitions.applyTransition(agentId, State.of(row), null, callerId);
    audit(callerId, "AGENT_RUNTIME_SETTING_DELETED", agentId, "AI 실행 설정 삭제", Map.of());
  }

  /**
   * AI 가 지워지거나 이 작업 공간에서 사용 중지될 때 켜 둔 실행을 끈다 — desired STOP·generation+1 로 바꾸고 실제 위치의 runner 에게
   * 알린다. 그대로 두면 사용 중지된 AI 가 자리를 붙잡고 계속 돌고, 삭제는 FK CASCADE 가 행을 조용히 지워 runner 가 알 길이 없다. 꺼져 있거나 설정이
   * 없으면 아무것도 하지 않는다.
   *
   * <p>정지 이벤트는 멤버십을 이미 SUSPENDED 로 바꾼 뒤에 오므로 구성원 가드를 거치지 않는다. 잠금은 저장과 같은 순서(AI 행 → 설정 행)로 잡는다.
   *
   * <p>자동 발급 키는 정리 유예로 줄인다(WP-1253) — 키 규칙에는 「AI 가 이 워크스페이스를 떠남 = 행이 없어짐」으로 넘긴다(WP-1264, 꺼져 있었어도
   * 줄인다). 키는 발급한 워크스페이스에 묶여 있어 이 워크스페이스의 키만 줄어든다 — 같은 AI 를 다른 워크스페이스에서 Works 가 띄우고 있어도 그쪽 Pod 의 키는
   * 그대로다.
   *
   * <p>AI 삭제({@code deleted=true})면 행이 FK CASCADE 로 곧 사라지므로 관리자 화면에 「지워짐」으로 알리고, 사용 중지면 켜져 있다가 꺼졌을
   * 때만 「바뀜」으로 알린다(WP-1254).
   *
   * @param actorId 변경한 관리자(모르면 null)
   * @param deleted AI 삭제인지(false 면 이 워크스페이스 사용 중지)
   */
  public void stopForRemoval(long agentId, Long actorId, boolean deleted) {
    if (settings.find(agentId).isEmpty()) return;
    agentRuntimePolicy.lock(agentId);
    Optional<Row> locked = settings.findForUpdate(agentId);
    if (locked.isEmpty()) return;
    Row row = locked.get();
    // 켜져 있었을 때만 끈다 — 실제 위치의 runner 알림은 전이 규칙이 정한다.
    Row next = row;
    if (row.desired() == Desired.RUN) {
      next = bumpDesired(row, Desired.STOP, row.applyMode());
      settings.update(next, actorId);
    }
    transitions.applyTransition(
        agentId, State.of(row), deleted ? null : State.departing(next), actorId);
  }

  /**
   * 켜기 전 로그인 계정 확인(WP-1296·1297) — 템플릿이 로그인 정보 계정(genia·chatgpt)을 쓰는데 그 종류의 활성 연결이 없으면 409. 그 프로그램은
   * 로그인 없이 일을 못 한다. Claude 계정 템플릿은 지금처럼 확인하지 않는다(기존 켜기 흐름을 바꾸지 않게 — runner 가 연결 없음을 실패로 알린다).
   */
  private static void requireLoginAccount(AgentTemplate template, Optional<String> activeProvider) {
    String account = template.account();
    if (!AgentProviders.isLogin(account)) return;
    if (activeProvider.filter(p -> AgentAccountFit.fits(template, p)).isEmpty()) {
      throw new AgentRuntimeSettingConflictException(
          "「" + AgentProviders.label(account) + "」을 먼저 연결해 주세요");
    }
  }

  /**
   * 켜기 전 저장소 토큰 확인(WP-1268) — 템플릿이 {@code repo} 를 요구하면, 그 AI 가 맡는 프로젝트 저장소의 호스트 중 활성 토큰이 없는 것이 있을 때
   * 409. 토큰 없이 띄우면 Pod 안에서 clone·push 가 인증에 실패해 AI 가 일을 못 하므로 켜기 전에 막고 어느 호스트가 빠졌는지 알린다. 호스트를 읽을 수
   * 없는 URL 은 건너뛴다.
   */
  private void requireRepoTokens(long agentId, AgentTemplate template) {
    if (!template.requires().contains("repo")) return;
    List<String> needed =
        RepoHosts.missing(
            projectRepository.findMemberProjectsWithRepository(agentId).stream()
                .map(AgentRuntimeProjectResponse::repositoryUrl)
                .toList(),
            repoCredentials.activeHosts(agentId));
    if (!needed.isEmpty()) {
      throw new AgentRuntimeSettingConflictException(
          "저장소 토큰이 연결되지 않아 실행할 수 없어요: " + String.join(", ", needed));
    }
  }

  /** 저장 행의 화면용 실행 상태. */
  private static AgentRuntimeStatus statusOf(Row r) {
    return AgentRuntimeStatusResolver.resolve(
        r.desired(), r.generation(), r.observedGeneration(), r.phase());
  }

  /** 구성원 확인 뒤 설정 행을 잠가 읽는다 — 없으면 404. */
  private Row lockRow(long agentId) {
    memberGuard.require(agentId);
    return settings.findForUpdate(agentId).orElseThrow(AgentRuntimeSettingNotFoundException::new);
  }

  /** 원하는 상태만 바꾼 다음 행(템플릿·위치·설정은 그대로, generation +1). */
  private static Row bumpDesired(Row row, Desired desired, ApplyMode applyMode) {
    return row.withDesired(desired).withApplyMode(applyMode).withGeneration(row.generation() + 1);
  }

  /**
   * 실제 위치(지정 위치 ?? 기본)를 정하고, 그 위치가 {@code currentEffective}(지금 쓰는 위치, 없으면 null)와 다르면 빈 자리가 있는지 확인한다
   * — 「켜기」와 켜진 AI 의 위치 변경이 쓴다. 지정 위치가 없으면 404, 기본 위치도 없으면 409, 자리가 찼으면 409. 테넌트 락을 잡은 뒤에 불러야 센 수가
   * 동시 요청에 어긋나지 않는다.
   */
  private AgentLocationRepository.Row claimSeat(Long locationId, Long currentEffective) {
    AgentLocationRepository.Row target =
        locationId != null
            ? requireLocation(locationId)
            : locationRepository
                .findDefault()
                .orElseThrow(
                    () ->
                        new AgentRuntimeSettingConflictException(
                            "기본 실행 위치가 없습니다. 먼저 실행 위치를 등록하세요"));
    if (!Objects.equals(target.id(), currentEffective)
        && locationRepository.countRunning(target.id(), target.isDefault()) >= target.capacity()) {
      throw new AgentRuntimeSettingConflictException("실행 위치의 자리가 모두 찼습니다");
    }
    return target;
  }

  /** 지정 위치 — 없거나 다른 워크스페이스의 것이면 404. */
  private AgentLocationRepository.Row requireLocation(long locationId) {
    return locationRepository.findById(locationId).orElseThrow(AgentLocationNotFoundException::new);
  }

  /** 저장된 설정을 새 템플릿으로 다시 검증한다 — 새 템플릿에 없는 칸은 버리고, 빈 칸은 새 기본값으로 채운다. */
  private static Map<String, String> repinConfig(
      AgentTemplate template, Map<String, String> stored) {
    Map<String, String> kept = new LinkedHashMap<>();
    template
        .config()
        .forEach(
            f -> {
              if (stored.containsKey(f.key())) kept.put(f.key(), stored.get(f.key()));
            });
    return AgentTemplateRegistry.validateConfig(template, kept);
  }

  /**
   * 저장 행 → 응답. 템플릿 존재·버전 차이, 실제 위치, 계산한 상태를 더한다. 실제 위치 id 는 호출자가 이미 정한 값을 받는다(기본 위치를 두 번 읽지 않게).
   */
  private AgentRuntimeSettingResponse toResponse(Row r, Long effectiveId) {
    Optional<AgentTemplate> template = registry.find(r.templateName());
    boolean missing = template.isEmpty();
    boolean updateAvailable =
        template.map(t -> !t.version().equals(r.templateVersion())).orElse(false);
    AgentLocationResponse effective = effectiveId == null ? null : locationService.get(effectiveId);
    return new AgentRuntimeSettingResponse(
        r.agentUserId(),
        r.templateName(),
        r.templateVersion(),
        missing,
        updateAvailable,
        r.locationId(),
        effective,
        r.config(),
        r.desired(),
        r.applyMode(),
        r.generation(),
        statusOf(r),
        new ObservedState(
            r.observedGeneration(),
            r.phase(),
            r.observedMessage(),
            r.cpuMillicores(),
            r.memoryBytes(),
            r.startedAt(),
            r.observedAt(),
            r.agentState(),
            r.agentIssueKey(),
            r.agentNextCheckAt()));
  }

  private static Map<String, Object> meta(AgentTemplate t, PutAgentRuntimeSettingRequest req) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("templateName", t.name());
    m.put("templateVersion", t.version());
    if (req.locationId() != null) m.put("locationId", req.locationId());
    return m;
  }

  private void audit(
      long callerId, String action, long agentId, String description, Map<String, Object> meta) {
    String username =
        userRepository.findById(callerId).map(UserResponse::username).orElse("system");
    auditLogService.log(
        callerId,
        username,
        action,
        "user",
        String.valueOf(agentId),
        description,
        null,
        null,
        "SUCCESS",
        null,
        meta);
  }
}
