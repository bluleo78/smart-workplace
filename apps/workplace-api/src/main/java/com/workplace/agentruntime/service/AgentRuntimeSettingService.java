package com.workplace.agentruntime.service;

import com.workplace.agentruntime.dto.AgentLocationResponse;
import com.workplace.agentruntime.dto.AgentRuntimeSettingResponse;
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
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository.Row;
import com.workplace.audit.service.AuditLogService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.user.dto.AgentRuntime;
import com.workplace.user.dto.UserKind;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.exception.UserNotFoundException;
import com.workplace.user.repository.UserRepository;
import com.workplace.user.service.AgentRuntimePolicy;
import com.workplace.user.service.UserService;
import com.workplace.user.service.WorkspaceMemberGuard;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
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
  private final ApplicationEventPublisher events;

  /** 실행 설정 조회 — 없으면 404. 템플릿이 사라졌으면 500 대신 {@code templateMissing=true}. */
  @Transactional(readOnly = true)
  public AgentRuntimeSettingResponse get(long agentId) {
    memberGuard.require(agentId);
    Row row = settings.find(agentId).orElseThrow(AgentRuntimeSettingNotFoundException::new);
    return toResponse(row, effectiveLocationId(row.locationId()));
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
      settings.insert(
          agentId, template.name(), template.version(), req.locationId(), config, callerId);
      audit(callerId, "AGENT_RUNTIME_SETTING_CHANGED", agentId, "AI 실행 설정 저장", meta(template, req));
      return get(agentId);
    }

    Row row = existing.get();
    Row next =
        row.withTemplateName(template.name())
            .withTemplateVersion(template.version())
            .withLocationId(req.locationId())
            .withConfig(config);
    Long oldEffective = effectiveLocationId(row.locationId());
    if (next.equals(row)) return toResponse(row, oldEffective);

    Long newEffective = oldEffective;
    if (!Objects.equals(req.locationId(), row.locationId())) {
      // 켜져 있는 AI 의 위치 지정이 바뀌면 새 실제 위치의 자리를 「켜기」와 같이 확인한다 — 실제 위치가 그대로면(기본 위치를 직접 지정 ↔ 미지정) 자기
      // 자신을 세어 막지 않는다. 옛 위치 자리는 비워질 뿐이라 보지 않는다. 꺼져 있으면 위치가 있는지만 본다.
      if (row.desired() == Desired.RUN) {
        newEffective = claimSeat(req.locationId(), oldEffective).id();
      } else if (req.locationId() != null) {
        newEffective = requireLocation(req.locationId()).id();
      } else {
        newEffective = effectiveLocationId(null);
      }
    }
    next =
        next.withApplyMode(req.applyMode() == null ? ApplyMode.IDLE : req.applyMode())
            .withGeneration(row.generation() + 1);
    settings.update(next, callerId);
    publish(oldEffective, newEffective);
    audit(callerId, "AGENT_RUNTIME_SETTING_CHANGED", agentId, "AI 실행 설정 변경", meta(template, req));
    return toResponse(next, newEffective);
  }

  /**
   * 켜기 — 실제 위치(지정 위치 ?? 기본, 없으면 409)에 자리가 남았는지 확인한 뒤 desired RUN·generation+1·apply_mode NOW. 템플릿
   * 버전은 레지스트리의 현재 버전으로 다시 고정한다(설정은 새 템플릿으로 다시 검증하고 없어진 칸은 버린다). 이미 켜져 있으면 변화 없음.
   */
  public AgentRuntimeSettingResponse start(long callerId, long agentId) {
    Row row = lockRow(agentId);
    if (row.desired() == Desired.RUN) return toResponse(row, effectiveLocationId(row.locationId()));
    AgentTemplate template =
        registry
            .find(row.templateName())
            .orElseThrow(
                () ->
                    new AgentRuntimeSettingConflictException(
                        "실행 템플릿을 찾을 수 없어 켤 수 없습니다. 실행 설정을 다시 저장하세요"));
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
    publish(location.id());
    audit(callerId, "AGENT_RUNTIME_STARTED", agentId, "AI 켜기", Map.of("locationId", location.id()));
    return toResponse(next, location.id());
  }

  /** 끄기 — desired STOP·generation+1. 이미 꺼져 있으면 변화 없음. */
  public AgentRuntimeSettingResponse stop(long callerId, long agentId) {
    Row row = lockRow(agentId);
    Long effective = effectiveLocationId(row.locationId());
    if (row.desired() == Desired.STOP) return toResponse(row, effective);
    Row next = bumpDesired(row, Desired.STOP, row.applyMode());
    settings.update(next, callerId);
    publish(effective);
    audit(callerId, "AGENT_RUNTIME_STOPPED", agentId, "AI 끄기", Map.of());
    return toResponse(next, effective);
  }

  /** 다시 시작 — 켜져 있을 때만(아니면 409). generation+1·apply_mode NOW 로 runner 가 바로 다시 띄우게 한다. */
  public AgentRuntimeSettingResponse restart(long callerId, long agentId) {
    Row row = lockRow(agentId);
    if (row.desired() != Desired.RUN) {
      throw new AgentRuntimeSettingConflictException("켜져 있는 AI 만 다시 시작할 수 있습니다");
    }
    Long effective = effectiveLocationId(row.locationId());
    Row next = bumpDesired(row, Desired.RUN, ApplyMode.NOW);
    settings.update(next, callerId);
    publish(effective);
    audit(callerId, "AGENT_RUNTIME_RESTARTED", agentId, "AI 다시 시작", Map.of());
    return toResponse(next, effective);
  }

  /** 실행 설정 삭제 — 켜져 있으면 409(먼저 끄기). 실행 방식은 바꾸지 않는다 — 화면이 이어서 기존 실행 방식 변경 API 를 부른다. */
  public void delete(long callerId, long agentId) {
    Row row = lockRow(agentId);
    if (row.desired() == Desired.RUN) throw AgentRuntimeSettingConflictException.running();
    settings.delete(agentId);
    audit(callerId, "AGENT_RUNTIME_SETTING_DELETED", agentId, "AI 실행 설정 삭제", Map.of());
  }

  /**
   * AI 가 지워지거나 이 작업 공간에서 사용 중지될 때 켜 둔 실행을 끈다 — desired STOP·generation+1 로 바꾸고 실제 위치의 runner 에게
   * 알린다. 그대로 두면 사용 중지된 AI 가 자리를 붙잡고 계속 돌고, 삭제는 FK CASCADE 가 행을 조용히 지워 runner 가 알 길이 없다. 꺼져 있거나 설정이
   * 없으면 아무것도 하지 않는다.
   *
   * <p>정지 이벤트는 멤버십을 이미 SUSPENDED 로 바꾼 뒤에 오므로 구성원 가드를 거치지 않는다. 잠금은 저장과 같은 순서(AI 행 → 설정 행)로 잡는다.
   *
   * @param actorId 변경한 관리자(모르면 null)
   */
  public void stopForRemoval(long agentId, Long actorId) {
    if (settings.find(agentId).isEmpty()) return;
    agentRuntimePolicy.lock(agentId);
    settings
        .findForUpdate(agentId)
        .filter(row -> row.desired() == Desired.RUN)
        .ifPresent(
            row -> {
              settings.update(bumpDesired(row, Desired.STOP, row.applyMode()), actorId);
              publish(effectiveLocationId(row.locationId()));
            });
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

  /** 지정 위치 ?? 기본 위치(없으면 null). */
  private Long effectiveLocationId(Long locationId) {
    return locationId != null ? locationId : locationService.defaultLocationId().orElse(null);
  }

  /** 실제 위치마다(겹침·null 제외) 원하는 상태 변경 이벤트를 낸다. */
  private void publish(Long... locationIds) {
    long tenantId = TenantContext.require();
    Set<Long> distinct = new LinkedHashSet<>();
    for (Long id : locationIds) if (id != null) distinct.add(id);
    distinct.forEach(id -> events.publishEvent(new AgentRuntimeDesiredChanged(tenantId, id)));
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
        AgentRuntimeStatusResolver.resolve(
            r.desired(), r.generation(), r.observedGeneration(), r.phase()),
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
