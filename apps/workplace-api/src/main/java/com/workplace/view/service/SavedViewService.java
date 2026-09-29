package com.workplace.view.service;

import static com.workplace.global.realtime.ResourceChangedEvent.OP_CREATED;
import static com.workplace.global.realtime.ResourceChangedEvent.OP_DELETED;
import static com.workplace.global.realtime.ResourceChangedEvent.OP_UPDATED;

import com.workplace.project.dto.ProjectRow;
import com.workplace.project.outbound.ProjectChangeNotifier;
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
  private final ProjectChangeNotifier changeNotifier;

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
      notifyView(
          OP_CREATED, project, row.id(), callerId, callerId, false, "SHARED".equals(visibility));
      return toResponse(row, callerId);
    } catch (DuplicateKeyException e) {
      throw new SavedViewNameDuplicatedException(name);
    }
  }

  /** 수정 — owner 본인만. 타인의 PRIVATE 뷰는 존재 은닉(404), 타인의 SHARED 뷰는 권한 거부(403). */
  public SavedViewResponse update(
      Long callerId, String projectKey, Long viewId, SaveViewRequest req) {
    var project = accessGuard.assertMember(projectKey, callerId);
    var row = loadInProject(viewId, project.id());
    hidePrivateFromOthers(row, callerId);
    if (!row.ownerId().equals(callerId)) {
      throw new SavedViewAccessDeniedException("본인의 뷰만 수정할 수 있습니다");
    }
    String name = req.name().trim();
    try {
      String visibility = normalizeVisibility(req.visibility());
      repository.update(viewId, name, req.query(), visibility);
      // 공유→비공개로 바뀌면 프로젝트 멤버 화면에서도 사라져야 하므로 전/후 어느 쪽이든 SHARED 면 프로젝트에 알린다.
      notifyView(
          OP_UPDATED,
          project,
          viewId,
          callerId,
          row.ownerId(),
          "SHARED".equals(row.visibility()),
          "SHARED".equals(visibility));
    } catch (DuplicateKeyException e) {
      throw new SavedViewNameDuplicatedException(name);
    }
    return toResponse(repository.findById(viewId).orElseThrow(), callerId);
  }

  /** 삭제 — owner 본인, 또는 SHARED 뷰면 프로젝트 OWNER 도 가능(모더레이션). 타인의 PRIVATE 뷰는 존재 은닉(404). */
  public void delete(Long callerId, String projectKey, Long viewId) {
    var project = accessGuard.assertMember(projectKey, callerId);
    var row = loadInProject(viewId, project.id());
    hidePrivateFromOthers(row, callerId);
    boolean owner = row.ownerId().equals(callerId);
    boolean moderator = "SHARED".equals(row.visibility()) && isProjectOwner(projectKey, callerId);
    if (!owner && !moderator) {
      throw new SavedViewAccessDeniedException("뷰를 삭제할 권한이 없습니다");
    }
    repository.delete(viewId);
    notifyView(
        OP_DELETED,
        project,
        viewId,
        callerId,
        row.ownerId(),
        "SHARED".equals(row.visibility()),
        "SHARED".equals(row.visibility()));
  }

  /** 저장된 뷰 고정/해제. 본인 소유 뷰만 가능. */
  public SavedViewResponse togglePin(
      Long callerId, String projectKey, Long viewId, boolean pinned) {
    var project = accessGuard.assertMember(projectKey, callerId);
    var row = loadInProject(viewId, project.id());
    hidePrivateFromOthers(row, callerId);
    if (!row.ownerId().equals(callerId)) {
      throw new SavedViewAccessDeniedException("본인의 뷰만 고정할 수 있습니다");
    }
    repository.setPinned(viewId, pinned);
    boolean shared = "SHARED".equals(row.visibility());
    notifyView(OP_UPDATED, project, viewId, callerId, row.ownerId(), shared, shared);
    return toResponse(repository.findById(viewId).orElseThrow(), callerId);
  }

  /**
   * 저장된 뷰 변경 알림. 전/후 어느 한쪽이라도 SHARED 면 프로젝트 멤버 전원에게, 둘 다 PRIVATE 이면 소유자에게만 보낸다 — 개인 뷰의 존재가 다른 멤버에게
   * 새지 않게 하려는 것이다.
   */
  private void notifyView(
      String op,
      ProjectRow project,
      long viewId,
      Long callerId,
      Long ownerId,
      boolean wasShared,
      boolean isShared) {
    if (wasShared || isShared) {
      changeNotifier.changed("saved-view", op, project, viewId, callerId);
    } else {
      changeNotifier.privateView(op, project, viewId, ownerId);
    }
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

  /**
   * 타인의 PRIVATE 뷰는 존재를 은닉한다 — 목록(findVisible)에 노출되지 않으므로 수정/삭제 시도 시 403(권한 없음)이 아니라 404(없음)로 응답해 존재
   * 여부 유출을 막는다. SHARED 이거나 본인 소유면 통과.
   */
  private void hidePrivateFromOthers(SavedViewRow row, Long callerId) {
    boolean mine = row.ownerId().equals(callerId);
    if (!mine && !"SHARED".equals(row.visibility())) {
      throw new SavedViewNotFoundException(row.id());
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
        r.pinned(),
        r.createdAt(),
        r.updatedAt());
  }
}
