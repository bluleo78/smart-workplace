package com.workplace.view.service;

import com.workplace.project.service.ProjectAccessGuard;
import com.workplace.view.dto.SaveViewRequest;
import com.workplace.view.dto.SavedViewResponse;
import com.workplace.view.dto.SavedViewRow;
import com.workplace.view.exception.SavedViewAccessDeniedException;
import com.workplace.view.exception.SavedViewNameDuplicatedException;
import com.workplace.view.exception.SavedViewNotFoundException;
import com.workplace.view.repository.SavedViewRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 저장된 뷰 CRUD. 조회/생성은 멤버 누구나(자기 뷰), 수정은 owner 본인, 삭제는 owner 본인 또는 SHARED 뷰에 한해 프로젝트 OWNER(모더레이션).
 */
@Service
@Transactional
@RequiredArgsConstructor
public class SavedViewService {

  private final SavedViewRepository repository;
  private final ProjectAccessGuard accessGuard;

  /** 멤버용 — 호출자에게 보이는 뷰 목록(내 것 + SHARED). */
  @Transactional(readOnly = true)
  public List<SavedViewResponse> list(Long callerId, String projectKey) {
    var project = accessGuard.assertMember(projectKey, callerId);
    return repository.findVisible(project.id(), callerId).stream()
        .map(r -> toResponse(r, callerId))
        .toList();
  }

  /** 멤버 — 새 뷰 생성(소유자=호출자). */
  public SavedViewResponse create(Long callerId, String projectKey, SaveViewRequest req) {
    var project = accessGuard.assertMember(projectKey, callerId);
    String name = req.name().trim();
    String visibility = normalizeVisibility(req.visibility());
    try {
      var row = repository.insert(project.id(), callerId, name, req.query(), visibility);
      return toResponse(row, callerId);
    } catch (DuplicateKeyException e) {
      throw new SavedViewNameDuplicatedException(name);
    }
  }

  /** 수정 — owner 본인만. */
  public SavedViewResponse update(
      Long callerId, String projectKey, Long viewId, SaveViewRequest req) {
    var project = accessGuard.assertMember(projectKey, callerId);
    var row = loadInProject(viewId, project.id());
    if (!row.ownerId().equals(callerId)) {
      throw new SavedViewAccessDeniedException("본인의 뷰만 수정할 수 있습니다");
    }
    String name = req.name().trim();
    try {
      repository.update(viewId, name, req.query(), normalizeVisibility(req.visibility()));
    } catch (DuplicateKeyException e) {
      throw new SavedViewNameDuplicatedException(name);
    }
    return toResponse(repository.findById(viewId).orElseThrow(), callerId);
  }

  /** 삭제 — owner 본인, 또는 SHARED 뷰면 프로젝트 OWNER 도 가능(모더레이션). */
  public void delete(Long callerId, String projectKey, Long viewId) {
    var project = accessGuard.assertMember(projectKey, callerId);
    var row = loadInProject(viewId, project.id());
    boolean owner = row.ownerId().equals(callerId);
    boolean moderator = "SHARED".equals(row.visibility()) && isProjectOwner(projectKey, callerId);
    if (!owner && !moderator) {
      throw new SavedViewAccessDeniedException("뷰를 삭제할 권한이 없습니다");
    }
    repository.delete(viewId);
  }

  /** 호출자가 프로젝트 OWNER 역할인지 — assertWithRole 통과 여부로 판정. */
  private boolean isProjectOwner(String projectKey, Long callerId) {
    try {
      accessGuard.assertWithRole(projectKey, callerId, "OWNER");
      return true;
    } catch (com.workplace.project.exception.ProjectAccessDeniedException e) {
      return false;
    }
  }

  /** 뷰 단건 로드 + 프로젝트 스코프 검증(다른 프로젝트면 404). */
  private SavedViewRow loadInProject(Long viewId, Long projectId) {
    var row = repository.findById(viewId).orElseThrow(() -> new SavedViewNotFoundException(viewId));
    if (!row.projectId().equals(projectId)) {
      throw new SavedViewNotFoundException(viewId);
    }
    return row;
  }

  /** visibility 정규화 — SHARED 외 모든 값은 PRIVATE. */
  private static String normalizeVisibility(String v) {
    return "SHARED".equals(v) ? "SHARED" : "PRIVATE";
  }

  /** SavedViewRow → 응답. mine = 호출자가 owner 인지. */
  private static SavedViewResponse toResponse(SavedViewRow r, Long callerId) {
    return new SavedViewResponse(
        r.id(),
        r.name(),
        r.query(),
        r.visibility(),
        r.ownerId(),
        r.ownerId().equals(callerId),
        r.createdAt(),
        r.updatedAt());
  }
}
