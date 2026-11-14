package com.workplace.cycle.service;

import static com.workplace.global.realtime.ResourceChangedEvent.OP_CREATED;
import static com.workplace.global.realtime.ResourceChangedEvent.OP_DELETED;
import static com.workplace.global.realtime.ResourceChangedEvent.OP_UPDATED;

import com.workplace.cycle.dto.CreateCycleRequest;
import com.workplace.cycle.dto.CycleCompleteRequest;
import com.workplace.cycle.dto.CycleCompleteRequest.Destination;
import com.workplace.cycle.dto.CycleCompleteResponse;
import com.workplace.cycle.dto.CycleResponse;
import com.workplace.cycle.dto.CycleRow;
import com.workplace.cycle.dto.CycleStatus;
import com.workplace.cycle.exception.CycleNameDuplicatedException;
import com.workplace.cycle.exception.CycleNotFoundException;
import com.workplace.cycle.exception.InvalidCycleDateRangeException;
import com.workplace.cycle.exception.InvalidCycleStatusException;
import com.workplace.cycle.repository.CycleRepository;
import com.workplace.issue.service.IssueCycleService;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.outbound.ProjectChangeNotifier;
import com.workplace.project.service.ProjectAccessGuard;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.function.Supplier;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 사이클 CRUD 서비스. 변경은 프로젝트 OWNER, 조회는 멤버 권한. */
@Service
@Transactional
@RequiredArgsConstructor
public class CycleService {

  private final CycleRepository cycleRepository;
  private final IssueCycleService issueCycleService;
  private final ProjectAccessGuard accessGuard;
  private final ProjectChangeNotifier changeNotifier;

  /** 프로젝트의 사이클 목록 — 조회 가드(OPEN 은 테넌트 전원 개방). */
  @Transactional(readOnly = true)
  public List<CycleResponse> list(Long callerId, String projectKey) {
    var project = accessGuard.assertReadable(projectKey, callerId);
    return cycleRepository.findByProject(project.id()).stream()
        .map(CycleService::toResponse)
        .toList();
  }

  /** OWNER — 신규 사이클 생성. status 미지정 시 PLANNED. */
  public CycleResponse create(Long callerId, String projectKey, CreateCycleRequest req) {
    var project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    String name = req.name().trim();
    String status = req.status() == null ? CycleStatus.DEFAULT : CycleStatus.validate(req.status());
    assertDateRangeValid(req.startDate(), req.endDate());
    return toResponse(
        insertCycle(project, callerId, name, req.goal(), req.startDate(), req.endDate(), status));
  }

  /** OWNER — 사이클 수정. status 미지정 시 기존 값 유지. */
  public CycleResponse update(
      Long callerId, String projectKey, Long cycleId, CreateCycleRequest req) {
    var project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    var row = loadInProject(cycleId, project.id());
    String name = req.name().trim();
    String status = req.status() == null ? row.status() : CycleStatus.validate(req.status());
    assertDateRangeValid(req.startDate(), req.endDate());
    try {
      cycleRepository.update(cycleId, name, req.goal(), req.startDate(), req.endDate(), status);
    } catch (DuplicateKeyException e) {
      throw new CycleNameDuplicatedException(name);
    }
    changeNotifier.changed(
        ProjectChangeNotifier.RESOURCE_CYCLE, OP_UPDATED, project, cycleId, callerId);
    // 수정 중에 다른 요청이 지웠으면 다시 읽기가 비어 있다 — 500 대신 처음 찾을 때와 같은 404(WP-755).
    return toResponse(
        cycleRepository.findById(cycleId).orElseThrow(() -> new CycleNotFoundException(cycleId)));
  }

  /** OWNER — 사이클 삭제(issue_cycle cascade). */
  public void delete(Long callerId, String projectKey, Long cycleId) {
    var project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    loadInProject(cycleId, project.id());
    cycleRepository.delete(cycleId);
    changeNotifier.changed(
        ProjectChangeNotifier.RESOURCE_CYCLE, OP_DELETED, project, cycleId, callerId);
  }

  /**
   * 사이클 완료 — OWNER 권한(WP-1578). 진행 중 사이클을 완료하고 미완료 이슈를 고른 곳으로 보낸다.
   *
   * <ul>
   *   <li>NONE — 사이클만 완료한다. 미완료 이슈는 완료된 사이클에 남는다.
   *   <li>NEW — 새 사이클을 진행 중으로 만들고 미완료 이슈를 붙인다.
   *   <li>SCHEDULED — 예정 사이클에 미완료 이슈를 붙이고, startImmediately(기본 true)면 그 사이클을 진행 중으로 바꾼다.
   * </ul>
   *
   * <p>완료된 사이클에서 이슈를 떼지 않는다(무엇이 있었는지 이력 보존). 요청·대상 검증은 모든 쓰기 전에 끝내 거절이면 아무것도 바뀌지 않는다. 쓰기는 클래스 트랜잭션
   * 하나라 새 사이클 이름 중복(409) 같은 중간 실패도 전부 롤백된다.
   *
   * @throws InvalidCycleStatusException 완료하려는 사이클이 진행 중이 아니거나, 보낼 사이클이 예정이 아닐 때(400)
   * @throws CycleNotFoundException 사이클·보낼 사이클이 없거나 다른 프로젝트 것일 때(404)
   * @throws IllegalArgumentException 목적지별 필수 항목이 없거나 보낼 사이클이 완료하는 사이클 자신일 때(400)
   * @throws InvalidCycleDateRangeException 새 사이클 기간이 거꾸로일 때(400)
   * @throws CycleNameDuplicatedException 새 사이클 이름이 이미 있을 때(409)
   */
  public CycleCompleteResponse complete(
      Long callerId, String projectKey, Long cycleId, CycleCompleteRequest req) {
    var project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    // 0) 완료 사이클과 보낼 예정 사이클 행을 확인 전에 잠근다 — 동시 완료 두 건이 둘 다 「진행 중」·「예정」을 보고 통과하지 않게(나중 요청은 앞
    // 요청 커밋 뒤의 상태로 판정). 잠금은 작은 id → 큰 id 순으로 걸어 서로 다른 순서로 잠그는 두 요청의 교착을 막는다. 보낼 예정 사이클이 없거나
    // 완료 사이클 자신이면 한 행만 잠근다(자신 지정은 아래 목적지 검증이 400 으로 거절한다).
    Long scheduledId = req.destination() == Destination.SCHEDULED ? req.targetCycleId() : null;
    long otherId = scheduledId == null ? cycleId : scheduledId;
    long lowId = Math.min(cycleId, otherId);
    long highId = Math.max(cycleId, otherId);
    Optional<CycleRow> lowRow = cycleRepository.findByIdForUpdate(lowId);
    Optional<CycleRow> highRow =
        lowId == highId ? lowRow : cycleRepository.findByIdForUpdate(highId);
    boolean completingLow = cycleId == lowId;
    var row = requireInProject(completingLow ? lowRow : highRow, cycleId, project.id());
    if (!CycleStatus.ACTIVE.equals(row.status())) {
      throw InvalidCycleStatusException.notActiveToComplete();
    }

    // 1) 목적지 검증 — 쓰기 전에 모두 끝낸다(거절이면 원 사이클이 진행 중 그대로 남게). 보낼 사이클 준비는 완료 뒤에 실행한다
    Supplier<Long> prepareTarget =
        resolveDestination(project, callerId, cycleId, req, completingLow ? highRow : lowRow);

    // 2) 완료 처리 — 이름·목표·기간은 그대로 두고 상태만 바꾼다
    setStatus(project, callerId, row, CycleStatus.COMPLETED);

    // 3) 보낼 사이클 준비 — 새로 만들거나, 예정 사이클을 (원하면) 시작한다. NONE 이면 null
    Long targetId = prepareTarget.get();

    // 4) 미완료 이슈를 보낼 사이클에 붙인다(issue 모듈이 이슈별 변경 알림까지 낸다)
    if (targetId != null) {
      issueCycleService.attachIncomplete(project, cycleId, targetId, callerId);
    }

    return new CycleCompleteResponse(reload(cycleId), targetId == null ? null : reload(targetId));
  }

  /**
   * 사이클 완료의 목적지를 한 번 풀어 목적지별 요청·대상을 검증하고, 완료 처리 뒤에 실행할 「보낼 사이클 준비」를 돌려준다. 준비는 보낼 사이클 id 를 내고 NONE
   * 이면 null 을 낸다.
   *
   * <p>검증은 여기서 모두 끝나 쓰기 전에 거절된다. 준비(새 사이클 생성·예정 사이클 시작)를 바로 하지 않고 미루는 것은 완료 처리 알림이 먼저 나가게 하려서다.
   *
   * @param lockedTarget SCHEDULED 일 때 잠가 읽은 보낼 사이클(없으면 비어 있음 — 404). 다른 목적지에서는 쓰지 않는다
   */
  private Supplier<Long> resolveDestination(
      ProjectRow project,
      Long callerId,
      Long cycleId,
      CycleCompleteRequest req,
      Optional<CycleRow> lockedTarget) {
    return switch (req.destination()) {
      case NEW -> {
        // 사이클 생성과 같게 이름·시작일·종료일이 모두 있어야 한다(WP-1316). 없으면 400(전역 처리기가 IllegalArgumentException 을 400
        // 으로)
        if (req.newCycleName() == null || req.newCycleName().isBlank()) {
          throw new IllegalArgumentException("새 사이클 이름을 입력해 주세요");
        }
        if (req.newCycleStartDate() == null) {
          throw new IllegalArgumentException("새 사이클 시작일을 입력해 주세요");
        }
        if (req.newCycleEndDate() == null) {
          throw new IllegalArgumentException("새 사이클 종료일을 입력해 주세요");
        }
        assertDateRangeValid(req.newCycleStartDate(), req.newCycleEndDate());
        yield () ->
            insertCycle(
                    project,
                    callerId,
                    req.newCycleName(),
                    null,
                    req.newCycleStartDate(),
                    req.newCycleEndDate(),
                    CycleStatus.ACTIVE)
                .id();
      }
      case SCHEDULED -> {
        if (req.targetCycleId() == null) {
          throw new IllegalArgumentException("이슈를 보낼 예정 사이클을 골라 주세요");
        }
        if (req.targetCycleId().equals(cycleId)) {
          throw new IllegalArgumentException("완료하는 사이클로는 이슈를 보낼 수 없습니다");
        }
        var target = requireInProject(lockedTarget, req.targetCycleId(), project.id());
        if (!CycleStatus.PLANNED.equals(target.status())) {
          throw InvalidCycleStatusException.targetNotPlanned();
        }
        yield () -> {
          if (req.startImmediatelyOrDefault()) {
            setStatus(project, callerId, target, CycleStatus.ACTIVE);
          }
          return target.id();
        };
      }
      // 보낼 곳이 없으니 더 볼 것도, 준비할 것도 없다
      case NONE -> () -> null;
    };
  }

  /** 사이클 행을 넣고 생성 알림을 낸다 — 사이클 생성과 사이클 완료의 NEW 목적지가 함께 쓴다. 이름이 겹치면(대소문자 무시) 409. */
  private CycleRow insertCycle(
      ProjectRow project,
      Long callerId,
      String name,
      String goal,
      LocalDate startDate,
      LocalDate endDate,
      String status) {
    try {
      var row = cycleRepository.insert(project.id(), name, goal, startDate, endDate, status);
      changeNotifier.changed(
          ProjectChangeNotifier.RESOURCE_CYCLE, OP_CREATED, project, row.id(), callerId);
      return row;
    } catch (DuplicateKeyException e) {
      throw new CycleNameDuplicatedException(name);
    }
  }

  /** 사이클 상태만 바꾸고(이름·목표·기간은 그대로) 수정 알림을 낸다 — 완료 처리와 예정 사이클 시작이 함께 쓴다. */
  private void setStatus(ProjectRow project, Long callerId, CycleRow row, String status) {
    cycleRepository.update(
        row.id(), row.name(), row.goal(), row.startDate(), row.endDate(), status);
    changeNotifier.changed(
        ProjectChangeNotifier.RESOURCE_CYCLE, OP_UPDATED, project, row.id(), callerId);
  }

  /** 쓰기 뒤 사이클을 다시 읽어 응답으로 바꾼다. 그 사이 지워졌으면 404(update 와 같은 처리, WP-755). */
  private CycleResponse reload(Long cycleId) {
    return toResponse(
        cycleRepository.findById(cycleId).orElseThrow(() -> new CycleNotFoundException(cycleId)));
  }

  /** 시작일/종료일이 둘 다 있을 때 종료일이 시작일보다 빠르면 거부(#804). */
  private static void assertDateRangeValid(LocalDate startDate, LocalDate endDate) {
    if (startDate != null && endDate != null && endDate.isBefore(startDate)) {
      throw new InvalidCycleDateRangeException();
    }
  }

  /** 사이클이 존재하고 해당 프로젝트 소속인지 확인 후 row 반환. */
  private CycleRow loadInProject(Long cycleId, Long projectId) {
    return requireInProject(cycleRepository.findById(cycleId), cycleId, projectId);
  }

  /**
   * 읽은(또는 잠가 읽은) 사이클 행이 없거나 다른 프로젝트 것이면 404 — 다른 프로젝트 사이클의 존재를 드러내지 않으려 「없음」과 같게 다룬다. 일반 조회({@link
   * #loadInProject})와 완료의 잠금 경로가 같은 판정을 쓴다.
   */
  private static CycleRow requireInProject(Optional<CycleRow> found, Long cycleId, Long projectId) {
    return found
        .filter(r -> r.projectId().equals(projectId))
        .orElseThrow(() -> new CycleNotFoundException(cycleId));
  }

  /** CycleRow → CycleResponse 변환. */
  private static CycleResponse toResponse(CycleRow r) {
    return new CycleResponse(
        r.id(),
        r.projectId(),
        r.name(),
        r.goal(),
        r.startDate(),
        r.endDate(),
        r.status(),
        r.createdAt(),
        r.updatedAt());
  }
}
