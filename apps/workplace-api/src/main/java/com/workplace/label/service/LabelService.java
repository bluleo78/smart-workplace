package com.workplace.label.service;

import static com.workplace.global.realtime.ResourceChangedEvent.OP_CREATED;
import static com.workplace.global.realtime.ResourceChangedEvent.OP_DELETED;
import static com.workplace.global.realtime.ResourceChangedEvent.OP_UPDATED;

import com.workplace.label.dto.ColorToken;
import com.workplace.label.dto.CreateLabelRequest;
import com.workplace.label.dto.LabelResponse;
import com.workplace.label.dto.LabelRow;
import com.workplace.label.exception.LabelNameDuplicatedException;
import com.workplace.label.exception.LabelNotFoundException;
import com.workplace.label.repository.LabelRepository;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.outbound.ProjectChangeNotifier;
import com.workplace.project.service.ProjectAccessGuard;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 라벨 CRUD 서비스. 조회는 읽기 권한, 생성은 프로젝트 멤버(이슈에 라벨을 붙일 수 있는 사람과 같은 범위), 수정·삭제는 OWNER·ADMIN 또는 그 라벨을 만든
 * 멤버(WP-394). 만든 사람 기록이 없는 기존 라벨은 OWNER·ADMIN 만 고친다.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class LabelService {

  private final LabelRepository labelRepository;
  private final ProjectAccessGuard accessGuard;
  private final ProjectChangeNotifier changeNotifier;

  /**
   * 라벨 목록(라벨 picker) — read 진입점. OPEN 은 테넌트 전원 조회 허용(assertReadable). 항목마다 요청자의 수정·삭제 가능 여부를 함께 준다
   * — 설정 화면이 버튼을 그릴지 정하는 데 쓴다.
   */
  @Transactional(readOnly = true)
  public List<LabelResponse> list(Long callerId, String projectKey) {
    var project = accessGuard.assertReadable(projectKey, callerId);
    // 판정 재료(역할)는 목록 전체에 같으므로 한 번만 조회한다.
    String role = accessGuard.viewerRole(project, callerId);
    return labelRepository.findByProject(project.id()).stream()
        .map(r -> toResponse(r, canManage(r, callerId, role)))
        .toList();
  }

  /** 멤버 — 신규 라벨 생성. 만든 사람을 기록해 이후 본인이 수정·삭제할 수 있게 한다. */
  public LabelResponse create(Long callerId, String projectKey, CreateLabelRequest req) {
    var project = accessGuard.assertMember(projectKey, callerId);
    String color = ColorToken.validate(req.colorToken());
    String name = req.name().trim();
    try {
      var row = labelRepository.insert(project.id(), name, color, callerId);
      changeNotifier.changed(
          ProjectChangeNotifier.RESOURCE_LABEL, OP_CREATED, project, row.id(), callerId);
      return toResponse(row, true);
    } catch (DuplicateKeyException e) {
      throw new LabelNameDuplicatedException(name);
    }
  }

  /** OWNER·ADMIN 또는 만든 멤버 — 이름/색상 수정. */
  public LabelResponse update(
      Long callerId, String projectKey, Long labelId, CreateLabelRequest req) {
    var project = accessGuard.assertMember(projectKey, callerId);
    assertCanManage(project, callerId, findInProject(project, labelId));
    String color = ColorToken.validate(req.colorToken());
    String name = req.name().trim();
    try {
      labelRepository.update(labelId, name, color);
    } catch (DuplicateKeyException e) {
      throw new LabelNameDuplicatedException(name);
    }
    changeNotifier.changed(
        ProjectChangeNotifier.RESOURCE_LABEL, OP_UPDATED, project, labelId, callerId);
    return toResponse(labelRepository.findById(labelId).orElseThrow(), true);
  }

  /** OWNER·ADMIN 또는 만든 멤버 — 라벨 삭제(cascade, 다른 사람이 붙인 이슈에서도 빠진다). */
  public void delete(Long callerId, String projectKey, Long labelId) {
    var project = accessGuard.assertMember(projectKey, callerId);
    assertCanManage(project, callerId, findInProject(project, labelId));
    labelRepository.delete(labelId);
    changeNotifier.changed(
        ProjectChangeNotifier.RESOURCE_LABEL, OP_DELETED, project, labelId, callerId);
  }

  /** 프로젝트에 속한 라벨을 찾는다 — 다른 프로젝트 라벨 id 는 없는 것과 같게 404. */
  private LabelRow findInProject(ProjectRow project, Long labelId) {
    var row =
        labelRepository.findById(labelId).orElseThrow(() -> new LabelNotFoundException(labelId));
    if (!row.projectId().equals(project.id())) {
      throw new LabelNotFoundException(labelId);
    }
    return row;
  }

  /** 수정·삭제 가드 — 멤버가 아니면(탈퇴 포함) 만든 사람이어도 막는다. */
  private void assertCanManage(ProjectRow project, Long callerId, LabelRow row) {
    if (!canManage(row, callerId, accessGuard.viewerRole(project, callerId))) {
      throw new ProjectAccessDeniedException("권한이 부족합니다: OWNER 또는 라벨을 만든 사람 필요");
    }
  }

  /** 수정·삭제 가능 판정 한 곳 — OWNER·ADMIN 이거나, 멤버이면서 그 라벨을 만든 사람. role 은 viewerRole(멤버가 아니면 null). */
  private static boolean canManage(LabelRow row, Long callerId, String role) {
    if ("OWNER".equals(role) || "ADMIN".equals(role)) {
      return true;
    }
    return role != null && callerId.equals(row.createdBy());
  }

  /** LabelRow → LabelResponse 변환. */
  private static LabelResponse toResponse(LabelRow r, boolean viewerCanManage) {
    return new LabelResponse(
        r.id(),
        r.projectId(),
        r.name(),
        r.colorToken(),
        r.createdAt(),
        r.updatedAt(),
        viewerCanManage);
  }
}
