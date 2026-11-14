package com.workplace.cycle.service;

import static com.workplace.global.realtime.ResourceChangedEvent.OP_CREATED;
import static com.workplace.global.realtime.ResourceChangedEvent.OP_DELETED;
import static com.workplace.global.realtime.ResourceChangedEvent.OP_UPDATED;

import com.workplace.cycle.dto.CreateCycleRequest;
import com.workplace.cycle.dto.CycleCompleteRequest;
import com.workplace.cycle.dto.CycleCompleteResponse;
import com.workplace.cycle.dto.CycleResponse;
import com.workplace.cycle.dto.CycleRow;
import com.workplace.cycle.dto.CycleStatus;
import com.workplace.cycle.exception.CycleNameDuplicatedException;
import com.workplace.cycle.exception.CycleNotFoundException;
import com.workplace.cycle.exception.InvalidCycleDateRangeException;
import com.workplace.cycle.exception.InvalidCycleStatusException;
import com.workplace.cycle.repository.CycleRepository;
import com.workplace.issue.repository.IssueCycleRepository;
import com.workplace.project.outbound.ProjectChangeNotifier;
import com.workplace.project.service.ProjectAccessGuard;
import java.time.LocalDate;
import java.util.List;
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
  private final IssueCycleRepository issueCycleRepository;
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
    try {
      var row =
          cycleRepository.insert(
              project.id(), name, req.goal(), req.startDate(), req.endDate(), status);
      changeNotifier.changed(
          ProjectChangeNotifier.RESOURCE_CYCLE, OP_CREATED, project, row.id(), callerId);
      return toResponse(row);
    } catch (DuplicateKeyException e) {
      throw new CycleNameDuplicatedException(name);
    }
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
   * 사이클 완료 — OWNER 권한(WP-1578).
   *
   * <p>진행 중 사이클을 완료 처리하고, 미완료 이슈를 지정한 목적지로 이동한다(한 트랜잭션). 동작:
   *
   * <ul>
   *   <li>NONE — 사이클만 완료. 미완료 이슈는 백로그에 남는다.
   *   <li>NEW — 새 사이클(즉시 ACTIVE)을 생성하고 미완료 이슈를 거기 Attach한다. 이미 거기 붙어 있는 이슈는 건너뛴다.
   *   <li>SCHEDULED — 기존 예정 사이클로 이동. startImmediately=true(기본값)이면 대상을 ACTIVE 로 만든다. 역시 이미 거기 붙어 있는
   *       이슈는 건너뛴다.
   * </ul>
   *
   * <p>진행 중(IN_PROGRESS)이 아닌 사이클을 완료하려 하면 {@link InvalidCycleStatusException}을 던진다. 새 사이클 이름이 기존과
   * 중복되면 {@link CycleNameDuplicatedException}을 던지며 롤백한다.
   */
  public CycleCompleteResponse complete(
      Long callerId, String projectKey, Long cycleId, CycleCompleteRequest req) {
    var project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    var row = loadInProject(cycleId, project.id());

    // 진행 중 상태가 아니면 완료 불가
    if (!CycleStatus.ACTIVE.equals(row.status())) {
      throw new InvalidCycleStatusException(row.status());
    }

    // 1) 완료 처리
    cycleRepository.update(
        cycleId, row.name(), row.goal(), row.startDate(), row.endDate(), CycleStatus.COMPLETED);
    changeNotifier.changed(
        ProjectChangeNotifier.RESOURCE_CYCLE, OP_UPDATED, project, cycleId, callerId);

    // 2) 미완료 이슈 조회
    List<Long> incompleteIssueIds = issueCycleRepository.findIncompleteIssueIdsByCycle(cycleId);

    CycleResponse newCycle = null;

    // 3) 목적지 처리
    switch (req.destination()) {
      case NEW -> {
        // 새 사이클 생성 (즉시 ACTIVE)
        req.validateNewCycle();
        try {
          var newRow =
              cycleRepository.insert(
                  project.id(),
                  req.newCycleName().trim(),
                  null,
                  req.newCycleStartDate(),
                  req.newCycleEndDate(),
                  CycleStatus.ACTIVE);
          changeNotifier.changed(
              ProjectChangeNotifier.RESOURCE_CYCLE, OP_CREATED, project, newRow.id(), callerId);
          newCycle = toResponse(newRow);

          // 미완료 이슈 Attach (이미 붙어 있으면 건너뜀)
          for (Long issueId : incompleteIssueIds) {
            issueCycleRepository.add(issueId, newRow.id());
          }
        } catch (DuplicateKeyException e) {
          throw new CycleNameDuplicatedException(req.newCycleName().trim());
        }
      }
      case SCHEDULED -> {
        req.validateScheduledCycle();
        var targetRow =
            cycleRepository
                .findById(req.targetCycleId())
                .filter(r -> r.projectId().equals(project.id()))
                .orElseThrow(() -> new CycleNotFoundException(req.targetCycleId()));

        // startImmediately 기본값 true
        boolean startNow = req.startImmediately() == null || req.startImmediately();

        // 예정→진행 전환이 필요하면 상태 갱신
        if (startNow && CycleStatus.PLANNED.equals(targetRow.status())) {
          cycleRepository.update(
              targetRow.id(),
              targetRow.name(),
              targetRow.goal(),
              targetRow.startDate(),
              targetRow.endDate(),
              CycleStatus.ACTIVE);
          changeNotifier.changed(
              ProjectChangeNotifier.RESOURCE_CYCLE, OP_UPDATED, project, targetRow.id(), callerId);
        }

        // 미완료 이슈 Attach (이미 붙어 있으면 건너뜀)
        for (Long issueId : incompleteIssueIds) {
          issueCycleRepository.add(issueId, targetRow.id());
        }
      }
      case NONE -> {
        // 아무것도 하지 않음 — 완료 처리만 이미 выше에서 됨
      }
    }

    // 4) 완료된 사이클 응답
    var completed =
        cycleRepository
            .findById(cycleId)
            .map(CycleService::toResponse)
            .orElseThrow(() -> new CycleNotFoundException(cycleId));

    return new CycleCompleteResponse(completed, newCycle);
  }

  /** 시작일/종료일이 둘 다 있을 때 종료일이 시작일보다 빠르면 거부(#804). */
  private static void assertDateRangeValid(LocalDate startDate, LocalDate endDate) {
    if (startDate != null && endDate != null && endDate.isBefore(startDate)) {
      throw new InvalidCycleDateRangeException();
    }
  }

  /** 사이클이 존재하고 해당 프로젝트 소속인지 확인 후 row 반환. */
  private CycleRow loadInProject(Long cycleId, Long projectId) {
    var row =
        cycleRepository.findById(cycleId).orElseThrow(() -> new CycleNotFoundException(cycleId));
    if (!row.projectId().equals(projectId)) {
      throw new CycleNotFoundException(cycleId);
    }
    return row;
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
