package com.workplace.issue.service;

import com.workplace.issue.dto.CreateIssueTypeRequest;
import com.workplace.issue.dto.IssueTypeIcon;
import com.workplace.issue.dto.IssueTypeResponse;
import com.workplace.issue.dto.IssueTypeRow;
import com.workplace.issue.exception.SystemTypeImmutableException;
import com.workplace.issue.exception.TypeInUseException;
import com.workplace.issue.exception.TypeNameDuplicatedException;
import com.workplace.issue.exception.TypeNotFoundException;
import com.workplace.issue.repository.IssueTypeRepository;
import com.workplace.label.dto.ColorToken;
import com.workplace.project.service.ProjectAccessGuard;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 이슈 유형 정의 서비스. 조회는 멤버 권한, 변경(생성/수정/삭제)은 OWNER 권한. 시스템 유형(TASK/BUG/STORY/CHORE)은 수정/삭제 불가, CUSTOM
 * 유형은 사용 중일 때 삭제 차단.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class IssueTypeService {

  private final IssueTypeRepository repo;
  private final ProjectAccessGuard accessGuard;

  /**
   * 신규 프로젝트 생성 직후 시스템 5종(TASK/BUG/STORY/CHORE/SUBTASK)을 시드한다. ProjectService.create 에서 호출. SUBTASK
   * 는 Phase 4a 부터 추가된 Jira 스타일 자식 유형.
   */
  public void seedSystemTypes(Long projectId) {
    repo.insert(projectId, "TASK", "BLUE", "Circle", true, 0);
    repo.insert(projectId, "BUG", "RED", "Bug", true, 1);
    repo.insert(projectId, "STORY", "PURPLE", "BookOpen", true, 2);
    repo.insert(projectId, "CHORE", "GRAY", "Wrench", true, 3);
    repo.insert(projectId, "SUBTASK", "TEAL", "CornerDownRight", true, 4);
  }

  /** 프로젝트 내 유형 목록(유형 picker) — read 진입점. OPEN 은 테넌트 전원 조회 허용(assertReadable). */
  @Transactional(readOnly = true)
  public List<IssueTypeResponse> list(Long callerId, String projectKey) {
    var project = accessGuard.assertReadable(projectKey, callerId);
    return repo.findByProject(project.id()).stream().map(this::toResponse).toList();
  }

  /** CUSTOM 유형 생성 — OWNER 권한. 색상/아이콘 화이트리스트 검증, 이름 중복 시 409. */
  public IssueTypeResponse create(Long callerId, String projectKey, CreateIssueTypeRequest req) {
    var project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    String color = ColorToken.validate(req.colorToken());
    String icon = IssueTypeIcon.validate(req.icon());
    String name = req.name().trim();
    try {
      var row = repo.insert(project.id(), name, color, icon, false, 99);
      return toResponse(row);
    } catch (DuplicateKeyException e) {
      throw new TypeNameDuplicatedException(name);
    }
  }

  /** CUSTOM 유형 수정 — OWNER 권한. 시스템 유형은 차단. */
  public IssueTypeResponse update(
      Long callerId, String projectKey, Long typeId, CreateIssueTypeRequest req) {
    var project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    var row = repo.findById(typeId).orElseThrow(() -> new TypeNotFoundException(typeId));
    if (!row.projectId().equals(project.id())) {
      throw new TypeNotFoundException(typeId);
    }
    if (row.isSystem()) {
      throw new SystemTypeImmutableException();
    }
    String color = ColorToken.validate(req.colorToken());
    String icon = IssueTypeIcon.validate(req.icon());
    String name = req.name().trim();
    try {
      repo.update(typeId, name, color, icon);
    } catch (DuplicateKeyException e) {
      throw new TypeNameDuplicatedException(name);
    }
    return toResponse(repo.findById(typeId).orElseThrow());
  }

  /** CUSTOM 유형 삭제 — OWNER 권한. 시스템 유형 또는 사용 중 유형은 차단. */
  public void delete(Long callerId, String projectKey, Long typeId) {
    var project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    var row = repo.findById(typeId).orElseThrow(() -> new TypeNotFoundException(typeId));
    if (!row.projectId().equals(project.id())) {
      throw new TypeNotFoundException(typeId);
    }
    if (row.isSystem()) {
      throw new SystemTypeImmutableException();
    }
    int inUse = repo.countIssuesByType(typeId);
    if (inUse > 0) {
      throw new TypeInUseException(inUse);
    }
    repo.delete(typeId);
  }

  private IssueTypeResponse toResponse(IssueTypeRow r) {
    return new IssueTypeResponse(
        r.id(),
        r.projectId(),
        r.name(),
        r.colorToken(),
        r.icon(),
        r.isSystem(),
        r.position(),
        r.createdAt(),
        r.updatedAt());
  }
}
