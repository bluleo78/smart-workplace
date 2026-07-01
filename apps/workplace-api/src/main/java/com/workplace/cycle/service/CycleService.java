package com.workplace.cycle.service;

import com.workplace.cycle.dto.CreateCycleRequest;
import com.workplace.cycle.dto.CycleResponse;
import com.workplace.cycle.dto.CycleRow;
import com.workplace.cycle.dto.CycleStatus;
import com.workplace.cycle.exception.CycleNameDuplicatedException;
import com.workplace.cycle.exception.CycleNotFoundException;
import com.workplace.cycle.repository.CycleRepository;
import com.workplace.project.service.ProjectAccessGuard;
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
  private final ProjectAccessGuard accessGuard;

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
    try {
      var row =
          cycleRepository.insert(
              project.id(), name, req.goal(), req.startDate(), req.endDate(), status);
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
    try {
      cycleRepository.update(cycleId, name, req.goal(), req.startDate(), req.endDate(), status);
    } catch (DuplicateKeyException e) {
      throw new CycleNameDuplicatedException(name);
    }
    return toResponse(cycleRepository.findById(cycleId).orElseThrow());
  }

  /** OWNER — 사이클 삭제(issue_cycle cascade). */
  public void delete(Long callerId, String projectKey, Long cycleId) {
    var project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    loadInProject(cycleId, project.id());
    cycleRepository.delete(cycleId);
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
