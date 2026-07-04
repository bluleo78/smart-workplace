package com.workplace.milestone.service;

import com.workplace.milestone.dto.CreateMilestoneRequest;
import com.workplace.milestone.dto.MilestoneResponse;
import com.workplace.milestone.dto.MilestoneRow;
import com.workplace.milestone.exception.MilestoneNameDuplicatedException;
import com.workplace.milestone.exception.MilestoneNotFoundException;
import com.workplace.milestone.repository.MilestoneRepository;
import com.workplace.project.service.ProjectAccessGuard;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 마일스톤 CRUD 서비스. 조회는 프로젝트 읽기 권한(assertReadable), 변경은 멤버 권한(assertMember) — 사이클의 OWNER 가드보다 완화된
 * 스펙(누구나 멤버면 마일스톤 관리 가능).
 */
@Service
@Transactional
@RequiredArgsConstructor
public class MilestoneService {

  private final MilestoneRepository milestoneRepository;
  private final ProjectAccessGuard accessGuard;

  /** 프로젝트의 마일스톤 목록 — 읽기 가드. */
  @Transactional(readOnly = true)
  public List<MilestoneResponse> list(Long callerId, String projectKey) {
    var project = accessGuard.assertReadable(projectKey, callerId);
    return milestoneRepository.findByProject(project.id()).stream()
        .map(MilestoneService::toResponse)
        .toList();
  }

  /** 멤버 — 신규 마일스톤 생성. */
  public MilestoneResponse create(Long callerId, String projectKey, CreateMilestoneRequest req) {
    var project = accessGuard.assertMember(projectKey, callerId);
    String name = req.name().trim();
    try {
      var row = milestoneRepository.insert(project.id(), name, req.dueDate(), req.description());
      return toResponse(row);
    } catch (DuplicateKeyException e) {
      throw new MilestoneNameDuplicatedException(name);
    }
  }

  /** 멤버 — 마일스톤 수정. */
  public MilestoneResponse update(
      Long callerId, String projectKey, Long milestoneId, CreateMilestoneRequest req) {
    var project = accessGuard.assertMember(projectKey, callerId);
    loadInProject(milestoneId, project.id());
    String name = req.name().trim();
    try {
      milestoneRepository.update(milestoneId, name, req.dueDate(), req.description());
    } catch (DuplicateKeyException e) {
      throw new MilestoneNameDuplicatedException(name);
    }
    return toResponse(milestoneRepository.findById(milestoneId).orElseThrow());
  }

  /** 멤버 — 마일스톤 삭제(issue.milestone_id ON DELETE SET NULL). */
  public void delete(Long callerId, String projectKey, Long milestoneId) {
    var project = accessGuard.assertMember(projectKey, callerId);
    loadInProject(milestoneId, project.id());
    milestoneRepository.deleteById(milestoneId);
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
