package com.workplace.milestone.service;

import static com.workplace.global.realtime.ResourceChangedEvent.OP_CREATED;
import static com.workplace.global.realtime.ResourceChangedEvent.OP_DELETED;
import static com.workplace.global.realtime.ResourceChangedEvent.OP_UPDATED;

import com.workplace.milestone.dto.CreateMilestoneRequest;
import com.workplace.milestone.dto.MilestoneResponse;
import com.workplace.milestone.dto.MilestoneRow;
import com.workplace.milestone.exception.MilestoneNameDuplicatedException;
import com.workplace.milestone.exception.MilestoneNotFoundException;
import com.workplace.milestone.repository.MilestoneRepository;
import com.workplace.project.outbound.ProjectChangeNotifier;
import com.workplace.project.service.ProjectAccessGuard;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 마일스톤 CRUD 서비스. 조회는 프로젝트 읽기 권한(assertReadable), 변경은 프로젝트 OWNER 만(assertWithRole OWNER) — 버전·사이클과
 * 같은 규칙으로 맞춘다(WP-1008). 예전에는 멤버면 누구나 바꿀 수 있었다.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class MilestoneService {

  private final MilestoneRepository milestoneRepository;
  private final ProjectAccessGuard accessGuard;
  private final ProjectChangeNotifier changeNotifier;

  /** 프로젝트의 마일스톤 목록 — 읽기 가드. */
  @Transactional(readOnly = true)
  public List<MilestoneResponse> list(Long callerId, String projectKey) {
    var project = accessGuard.assertReadable(projectKey, callerId);
    return milestoneRepository.findByProject(project.id()).stream()
        .map(MilestoneService::toResponse)
        .toList();
  }

  /** OWNER — 신규 마일스톤 생성. */
  public MilestoneResponse create(Long callerId, String projectKey, CreateMilestoneRequest req) {
    var project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    String name = req.name().trim();
    try {
      var row = milestoneRepository.insert(project.id(), name, req.dueDate(), req.description());
      changeNotifier.changed(
          ProjectChangeNotifier.RESOURCE_MILESTONE, OP_CREATED, project, row.id(), callerId);
      return toResponse(row);
    } catch (DuplicateKeyException e) {
      throw new MilestoneNameDuplicatedException(name);
    }
  }

  /** OWNER — 마일스톤 수정. */
  public MilestoneResponse update(
      Long callerId, String projectKey, Long milestoneId, CreateMilestoneRequest req) {
    var project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    loadInProject(milestoneId, project.id());
    String name = req.name().trim();
    try {
      milestoneRepository.update(milestoneId, name, req.dueDate(), req.description());
    } catch (DuplicateKeyException e) {
      throw new MilestoneNameDuplicatedException(name);
    }
    changeNotifier.changed(
        ProjectChangeNotifier.RESOURCE_MILESTONE, OP_UPDATED, project, milestoneId, callerId);
    // 수정 중에 다른 요청이 지웠으면 다시 읽기가 비어 있다 — 500 대신 처음 찾을 때와 같은 404(WP-755).
    return toResponse(
        milestoneRepository
            .findById(milestoneId)
            .orElseThrow(() -> new MilestoneNotFoundException(milestoneId)));
  }

  /** OWNER — 마일스톤 삭제(issue.milestone_id ON DELETE SET NULL). */
  public void delete(Long callerId, String projectKey, Long milestoneId) {
    var project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    loadInProject(milestoneId, project.id());
    milestoneRepository.deleteById(milestoneId);
    changeNotifier.changed(
        ProjectChangeNotifier.RESOURCE_MILESTONE, OP_DELETED, project, milestoneId, callerId);
  }

  /** 마일스톤이 존재하고 해당 프로젝트 소속인지 확인 후 row 반환. Task 4 의 이슈 milestoneId 검증(다른 프로젝트 마일스톤 연결 차단)이 재사용한다. */
  public MilestoneRow loadInProject(Long milestoneId, Long projectId) {
    var row =
        milestoneRepository
            .findById(milestoneId)
            .filter(m -> m.projectId().equals(projectId))
            .orElseThrow(() -> new MilestoneNotFoundException(milestoneId));
    return row;
  }

  /** MilestoneRow → MilestoneResponse 변환. */
  private static MilestoneResponse toResponse(MilestoneRow r) {
    return new MilestoneResponse(
        r.id(),
        r.projectId(),
        r.name(),
        r.dueDate(),
        r.description(),
        r.createdAt(),
        r.updatedAt());
  }
}
