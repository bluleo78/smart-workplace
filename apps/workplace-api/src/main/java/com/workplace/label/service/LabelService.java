package com.workplace.label.service;

import com.workplace.label.dto.ColorToken;
import com.workplace.label.dto.CreateLabelRequest;
import com.workplace.label.dto.LabelResponse;
import com.workplace.label.exception.LabelNameDuplicatedException;
import com.workplace.label.exception.LabelNotFoundException;
import com.workplace.label.repository.LabelRepository;
import com.workplace.project.service.ProjectAccessGuard;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 라벨 CRUD 서비스. 변경은 프로젝트 OWNER, 조회는 멤버 권한. */
@Service
@Transactional
@RequiredArgsConstructor
public class LabelService {

  private final LabelRepository labelRepository;
  private final ProjectAccessGuard accessGuard;

  /**
   * 라벨 목록(라벨 picker) — read 진입점. OPEN 은 테넌트 전원 조회 허용(assertReadable). 라벨 관리(create/update/delete)는
   * OWNER 유지.
   */
  @Transactional(readOnly = true)
  public List<LabelResponse> list(Long callerId, String projectKey) {
    var project = accessGuard.assertReadable(projectKey, callerId);
    return labelRepository.findByProject(project.id()).stream()
        .map(LabelService::toResponse)
        .toList();
  }

  /** OWNER — 신규 라벨 생성. */
  public LabelResponse create(Long callerId, String projectKey, CreateLabelRequest req) {
    var project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    String color = ColorToken.validate(req.colorToken());
    String name = req.name().trim();
    try {
      var row = labelRepository.insert(project.id(), name, color);
      return toResponse(row);
    } catch (DuplicateKeyException e) {
      throw new LabelNameDuplicatedException(name);
    }
  }

  /** OWNER — 이름/색상 수정. */
  public LabelResponse update(
      Long callerId, String projectKey, Long labelId, CreateLabelRequest req) {
    var project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    var row =
        labelRepository.findById(labelId).orElseThrow(() -> new LabelNotFoundException(labelId));
    if (!row.projectId().equals(project.id())) {
      throw new LabelNotFoundException(labelId);
    }
    String color = ColorToken.validate(req.colorToken());
    String name = req.name().trim();
    try {
      labelRepository.update(labelId, name, color);
    } catch (DuplicateKeyException e) {
      throw new LabelNameDuplicatedException(name);
    }
    return toResponse(labelRepository.findById(labelId).orElseThrow());
  }

  /** OWNER — 라벨 삭제(cascade). */
  public void delete(Long callerId, String projectKey, Long labelId) {
    var project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    var row =
        labelRepository.findById(labelId).orElseThrow(() -> new LabelNotFoundException(labelId));
    if (!row.projectId().equals(project.id())) {
      throw new LabelNotFoundException(labelId);
    }
    labelRepository.delete(labelId);
  }

  /** LabelRow → LabelResponse 변환. */
  private static LabelResponse toResponse(com.workplace.label.dto.LabelRow r) {
    return new LabelResponse(
        r.id(), r.projectId(), r.name(), r.colorToken(), r.createdAt(), r.updatedAt());
  }
}
