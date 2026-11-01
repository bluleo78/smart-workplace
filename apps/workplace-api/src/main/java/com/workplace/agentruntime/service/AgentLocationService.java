package com.workplace.agentruntime.service;

import com.workplace.agentruntime.dto.AgentLocationResponse;
import com.workplace.agentruntime.dto.AgentLocationTokenResponse;
import com.workplace.agentruntime.dto.CreateAgentLocationRequest;
import com.workplace.agentruntime.dto.LocationConnection;
import com.workplace.agentruntime.dto.UpdateAgentLocationRequest;
import com.workplace.agentruntime.exception.AgentLocationConflictException;
import com.workplace.agentruntime.exception.AgentLocationNotFoundException;
import com.workplace.agentruntime.outbound.AgentRuntimeDesiredChanged;
import com.workplace.agentruntime.realtime.RunnerSseRegistry;
import com.workplace.agentruntime.repository.AgentLocationRepository;
import com.workplace.agentruntime.repository.AgentLocationRepository.Row;
import com.workplace.agentruntime.repository.AgentRunnerTokenRepository;
import com.workplace.audit.service.AuditLogService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.AfterCommit;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.global.util.Texts;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * AI 실행 위치 관리 서비스(WP-1248) — 등록·수정·기본 이동·삭제와 runner 토큰 발급·재발급. 관리자 권한은 컨트롤러({@code @RequireAdmin})가
 * 책임진다.
 *
 * <p>토큰 평문은 생성·재발급 응답으로만 한 번 나가고 DB 에는 SHA-256 해시만 남는다. 위치당 쓸 수 있는 토큰은 1개라 재발급하면 옛 토큰을 회수한다.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class AgentLocationService {

  /** 이 시간 안에 토큰을 쓴 위치만 CONNECTED 로 본다(runner 가 주기적으로 부르는 것을 전제). */
  static final Duration CONNECTED_WITHIN = Duration.ofMinutes(2);

  /** 새 위치의 기본 자리 수(요청에 없을 때). */
  private static final int DEFAULT_CAPACITY = 3;

  /** 토큰 평문 앞 몇 자를 화면용 prefix 로 남길지 — 평문 전체를 추측할 수 없는 길이만큼만. */
  private static final int TOKEN_PREFIX_LENGTH = 12;

  private final AgentLocationRepository locations;
  private final AgentRunnerTokenRepository tokens;
  private final AuditLogService auditLogService;
  private final UserRepository userRepository;
  private final ApplicationEventPublisher events;
  private final RunnerSseRegistry runnerSse;

  /** 모든 위치 — 기본 위치 먼저. 자리 사용 수·연결 상태 포함. */
  @Transactional(readOnly = true)
  public List<AgentLocationResponse> list() {
    // 켜진 수는 한 번의 GROUP BY 로 센다 — 위치 미지정(기본 따라가기) 설정은 기본 위치에 더한다.
    Map<Long, Integer> running = locations.countRunningByLocation();
    int unassigned = running.getOrDefault(null, 0);
    return locations.findAll().stream()
        .map(r -> toResponse(r, running.getOrDefault(r.id(), 0) + (r.isDefault() ? unassigned : 0)))
        .toList();
  }

  /** 위치 한 개 — 없거나 다른 워크스페이스의 것이면 404. */
  @Transactional(readOnly = true)
  public AgentLocationResponse get(long id) {
    return withUsage(require(id));
  }

  /** 기본 위치 id — 실행 위치를 지정하지 않은 AI 가 쓴다. 없으면 비어 있음. */
  @Transactional(readOnly = true)
  public Optional<Long> defaultLocationId() {
    return locations.findDefaultId();
  }

  /** AI 의 실제 위치 — 지정 위치 ?? 기본 위치(둘 다 없으면 null). 실행 설정·상태 보고가 이벤트를 낼 위치를 정할 때 쓴다. */
  @Transactional(readOnly = true)
  public Long effectiveLocationId(Long locationId) {
    return locationId != null ? locationId : locations.findDefaultId().orElse(null);
  }

  /** 위치 등록 + 첫 토큰 발급. 이 워크스페이스의 첫 위치면 자동으로 기본이 된다. 이름이 겹치면 409. */
  public AgentLocationTokenResponse create(long callerId, CreateAgentLocationRequest req) {
    String name = req.name().trim();
    // 「첫 위치」 판정과 기본 유일성이 동시 요청에 깨지지 않게 위치 변경을 차례로 세운다.
    locations.lockTenantLocations();
    requireUniqueName(name, null);
    boolean first = locations.count() == 0;
    int capacity = req.capacity() == null ? DEFAULT_CAPACITY : req.capacity();
    String description = blankToNull(req.description());
    long id;
    try {
      id = locations.insert(name, description, capacity, first, callerId);
    } catch (DuplicateKeyException e) {
      throw AgentLocationConflictException.nameTaken();
    }

    IssuedToken token = issueToken(id, callerId);
    audit(
        callerId,
        "AGENT_LOCATION_CREATED",
        id,
        "AI 실행 위치 등록: " + name,
        Map.of("locationId", id, "name", name, "capacity", capacity));
    // 방금 만든 값으로 응답한다 — 새 위치는 켜진 AI 가 없고(켜려면 위치가 있어야 한다) 토큰은 아직 쓰이지 않았다.
    Row created = new Row(id, name, description, first, capacity, token.prefix(), null);
    return new AgentLocationTokenResponse(toResponse(created, 0), token.plaintext());
  }

  /**
   * 이름·설명·자리 수 수정. 이름이 겹치면 409, 없으면 404. 자리 수를 지금 켜져 있는 AI 수보다 적게 줄이면 409 — 테넌트 락을 잡은 뒤 세어 동시 켜기와
   * 차례로 일어나게 한다.
   */
  public AgentLocationResponse update(long id, UpdateAgentLocationRequest req) {
    locations.lockTenantLocations();
    Row row = require(id);
    int used = locations.countRunning(id, row.isDefault());
    if (used > req.capacity()) {
      throw new AgentLocationConflictException("켜져 있는 AI 수보다 적게 줄일 수 없습니다. 먼저 AI 를 끄세요");
    }
    String name = req.name().trim();
    requireUniqueName(name, id);
    String description = blankToNull(req.description());
    try {
      locations.update(id, name, description, req.capacity());
    } catch (DuplicateKeyException e) {
      throw AgentLocationConflictException.nameTaken();
    }
    return toResponse(
        row.withName(name).withDescription(description).withCapacity(req.capacity()), used);
  }

  /**
   * 기본 위치를 이 위치로 옮긴다(옛 기본은 내려간다). 이미 기본이면 변화 없음.
   *
   * <p>위치를 지정하지 않고 켜져 있는 AI 들은 기본을 따라 새 위치로 옮겨 가므로, 새 위치에 직접 지정돼 켜진 AI 와 합쳐 자리 수를 넘으면 409(WP-1247).
   * 테넌트 락을 잡은 뒤 세어 「켜기」와 차례로 일어나게 한다. 옮기면 두 위치의 runner 에게 알린다.
   */
  public void setDefault(long id) {
    locations.lockTenantLocations();
    Optional<Long> oldDefault = locations.findDefaultId();
    if (oldDefault.filter(d -> d == id).isPresent()) return;
    Row row = require(id);
    if (locations.countRunning(id, true) > row.capacity()) {
      throw new AgentLocationConflictException(
          "이 실행 위치의 자리가 모자라 기본으로 바꿀 수 없습니다. 자리 수를 늘리거나 먼저 AI 를 끄세요");
    }
    // 부분 유니크(워크스페이스당 기본 1개) 때문에 옛 기본을 먼저 내린 뒤 새 기본을 올린다.
    locations.clearDefault();
    locations.markDefault(id);
    long tenantId = TenantContext.require();
    oldDefault.ifPresent(old -> events.publishEvent(new AgentRuntimeDesiredChanged(tenantId, old)));
    events.publishEvent(new AgentRuntimeDesiredChanged(tenantId, id));
  }

  /** runner 토큰 재발급 — 옛 토큰을 회수하고 새 평문을 한 번만 돌려준다. 없으면 404. */
  public AgentLocationTokenResponse rotateToken(long callerId, long id) {
    // 테넌트 락으로 동시 재발급·삭제와 차례로 선다 — 「위치당 활성 토큰 1개」 부분 유니크 위반이나 지워진 위치에 토큰을 넣는 FK 위반(500)이 나지 않게.
    locations.lockTenantLocations();
    Row row = require(id);
    tokens.revokeActive(id);
    IssuedToken token = issueToken(id, callerId);
    audit(
        callerId,
        "AGENT_LOCATION_TOKEN_ROTATED",
        id,
        "AI 실행 위치 토큰 재발급: " + row.name(),
        Map.of("locationId", id, "name", row.name()));
    // 새 토큰은 아직 쓰이지 않았다 — 마지막 사용 시각이 비어 연결 상태는 PENDING.
    closeRunnerStreams(id);
    Row rotated = row.withTokenPrefix(token.prefix()).withLastSeenAt(null);
    return new AgentLocationTokenResponse(withUsage(rotated), token.plaintext());
  }

  /** 위치 삭제 — 기본 위치와 실행 설정이 쓰는 위치는 지울 수 없다(409). 토큰은 함께 지워진다. */
  public void delete(long callerId, long id) {
    // 테넌트 락을 잡은 뒤 판정한다 — 이 위치로 설정을 저장하는 요청도 같은 락 아래에서 돌아 FK 500 대신 409 가 된다.
    locations.lockTenantLocations();
    Row row = require(id);
    if (row.isDefault()) {
      throw new AgentLocationConflictException("기본 실행 위치는 삭제할 수 없습니다. 다른 위치를 기본으로 바꾼 뒤 삭제하세요");
    }
    // 실행 설정이 이 위치를 가리키면 FK(ON DELETE RESTRICT)가 500 을 내기 전에 409 로 안내한다(WP-1247).
    if (locations.countSettingsUsing(id) > 0) {
      throw new AgentLocationConflictException("이 실행 위치를 쓰는 AI 가 있습니다. 먼저 AI 의 실행 위치를 바꾸세요");
    }
    locations.delete(id);
    closeRunnerStreams(id);
    audit(
        callerId,
        "AGENT_LOCATION_DELETED",
        id,
        "AI 실행 위치 삭제: " + row.name(),
        Map.of("locationId", id, "name", row.name()));
  }

  /**
   * 커밋 뒤 이 위치의 runner 변경 스트림을 닫는다(WP-1249) — 회수된 옛 토큰으로 연 스트림이 계속 신호를 받지 않게. runner 는 다시 붙으며 토큰을 다시
   * 검증받는다. 이 인스턴스의 연결만 닫히고, 다른 인스턴스의 연결은 연결 수명(30분)이 지나면 끊긴다.
   */
  private void closeRunnerStreams(long locationId) {
    long tenantId = TenantContext.require();
    AfterCommit.run(() -> runnerSse.closeAll(tenantId, locationId));
  }

  /** 발급한 토큰 — 응답용 평문(한 번만 나간다)과 화면용 앞자리. */
  private record IssuedToken(String plaintext, String prefix) {}

  /** 새 토큰을 만들어 해시로 저장하고 평문·앞자리를 돌려준다(저장된 prefix 는 평문 앞 12자). */
  private IssuedToken issueToken(long locationId, long callerId) {
    String plaintext = CapabilityTokens.generate("rt_");
    String prefix = plaintext.substring(0, Math.min(TOKEN_PREFIX_LENGTH, plaintext.length()));
    tokens.insert(
        locationId,
        TenantContext.require(),
        prefix,
        CapabilityTokens.sha256Hex(plaintext),
        callerId);
    return new IssuedToken(plaintext, prefix);
  }

  /** 위치 한 행 — 없거나 다른 워크스페이스의 것이면 404. */
  private Row require(long id) {
    return locations.findById(id).orElseThrow(AgentLocationNotFoundException::new);
  }

  private void requireUniqueName(String name, Long exceptId) {
    if (locations.existsByName(name, exceptId)) throw AgentLocationConflictException.nameTaken();
  }

  /** 저장 행 → 응답 — 자리 사용 수를 센다(기본 위치면 위치 미지정 AI 포함). */
  AgentLocationResponse withUsage(Row r) {
    return toResponse(r, locations.countRunning(r.id(), r.isDefault()));
  }

  /** 저장 행 → 응답. 미리 센 자리 사용 수와 연결 상태를 더한다. */
  private AgentLocationResponse toResponse(Row r, int used) {
    return new AgentLocationResponse(
        r.id(),
        r.name(),
        r.description(),
        r.isDefault(),
        r.capacity(),
        used,
        connectionOf(r),
        r.lastSeenAt(),
        r.tokenPrefix());
  }

  /**
   * 마지막 사용 시각으로 연결 상태 계산 — 없으면 PENDING, {@link #CONNECTED_WITHIN} 안이면 CONNECTED, 아니면 DISCONNECTED.
   */
  private static LocationConnection connectionOf(Row r) {
    if (r.lastSeenAt() == null) return LocationConnection.PENDING;
    boolean recent = r.lastSeenAt().isAfter(OffsetDateTime.now().minus(CONNECTED_WITHIN));
    return recent ? LocationConnection.CONNECTED : LocationConnection.DISCONNECTED;
  }

  /** 비었으면 null, 아니면 앞뒤 공백을 뗀 값. */
  private static String blankToNull(String s) {
    return s == null ? null : Texts.blankToNull(s.strip());
  }

  private void audit(
      long callerId, String action, long locationId, String description, Map<String, Object> meta) {
    String username =
        userRepository.findById(callerId).map(UserResponse::username).orElse("system");
    auditLogService.log(
        callerId,
        username,
        action,
        "agent_location",
        String.valueOf(locationId),
        description,
        null,
        null,
        "SUCCESS",
        null,
        meta);
  }
}
