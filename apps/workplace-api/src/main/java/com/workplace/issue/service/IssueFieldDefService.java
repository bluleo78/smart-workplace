package com.workplace.issue.service;

import static com.workplace.global.realtime.ResourceChangedEvent.OP_CREATED;
import static com.workplace.global.realtime.ResourceChangedEvent.OP_DELETED;
import static com.workplace.global.realtime.ResourceChangedEvent.OP_UPDATED;

import com.fasterxml.jackson.databind.JsonNode;
import com.workplace.issue.dto.CreateIssueFieldDefRequest;
import com.workplace.issue.dto.FieldType;
import com.workplace.issue.dto.FieldTypeValidator;
import com.workplace.issue.dto.IssueFieldDefResponse;
import com.workplace.issue.dto.IssueFieldDefRow;
import com.workplace.issue.exception.FieldNameDuplicatedException;
import com.workplace.issue.exception.FieldNotFoundException;
import com.workplace.issue.exception.FieldOptionInUseException;
import com.workplace.issue.exception.TypeImmutableException;
import com.workplace.issue.repository.IssueFieldDefRepository;
import com.workplace.issue.repository.IssueFieldValueRepository;
import com.workplace.project.outbound.ProjectChangeNotifier;
import com.workplace.project.service.ProjectAccessGuard;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 프로젝트 custom field 정의 서비스. 조회는 멤버, CUD 는 OWNER 권한. type 은 immutable — PATCH 에서 변경 시도 시 400. 삭제는
 * issue_field_value 를 FK cascade 로 함께 제거. SELECT/MULTI_SELECT 는 옵션이 줄어드는 PATCH 시 참조 중인 이슈가 있으면 하드
 * 블록한다(#707, #678 과 동일 정책 — 참조 삭제 전에는 옵션 자체를 지울 수 없음).
 */
@Service
@Transactional
@RequiredArgsConstructor
public class IssueFieldDefService {

  private final IssueFieldDefRepository repo;
  private final IssueFieldValueRepository valueRepo;
  private final ProjectAccessGuard accessGuard;
  private final ProjectChangeNotifier changeNotifier;

  /** 프로젝트 내 필드 정의 목록 — 조회 가드(OPEN 은 테넌트 전원 개방). */
  @Transactional(readOnly = true)
  public List<IssueFieldDefResponse> list(Long callerId, String projectKey) {
    var project = accessGuard.assertReadable(projectKey, callerId);
    return repo.findByProject(project.id()).stream().map(this::toResponse).toList();
  }

  /** 필드 정의 신규 생성 — OWNER. type/options 검증 후 INSERT. 이름 중복은 409. */
  public IssueFieldDefResponse create(
      Long callerId, String projectKey, CreateIssueFieldDefRequest req) {
    var project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    String type = FieldType.validate(req.type());
    FieldTypeValidator.validateOptions(type, req.options());
    String name = req.name().trim();
    try {
      var row = repo.insert(project.id(), name, type, req.options(), 99);
      changeNotifier.changed("field-def", OP_CREATED, project, row.id(), callerId);
      return toResponse(row);
    } catch (DuplicateKeyException e) {
      throw new FieldNameDuplicatedException(name);
    }
  }

  /** 필드 정의 수정 — OWNER. type 은 변경 불가 (요청 type 이 기존과 다르면 400). 이름/옵션만 갱신. 옵션 검증은 row.type() 기준. */
  public IssueFieldDefResponse update(
      Long callerId, String projectKey, Long fieldId, CreateIssueFieldDefRequest req) {
    var project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    var row = repo.findById(fieldId).orElseThrow(() -> new FieldNotFoundException(fieldId));
    if (!row.projectId().equals(project.id())) {
      throw new FieldNotFoundException(fieldId);
    }
    if (req.type() != null && !row.type().equals(req.type())) {
      throw new TypeImmutableException();
    }
    FieldTypeValidator.validateOptions(row.type(), req.options());
    if (FieldType.hasOptions(row.type())) {
      Set<String> removed = removedOptions(row.options(), req.options());
      if (!removed.isEmpty()) {
        int refCount = valueRepo.countReferencingOptions(fieldId, row.type(), removed);
        if (refCount > 0) {
          throw new FieldOptionInUseException(refCount, removed);
        }
      }
    }
    String name = req.name().trim();
    try {
      repo.update(fieldId, name, req.options());
    } catch (DuplicateKeyException e) {
      throw new FieldNameDuplicatedException(name);
    }
    changeNotifier.changed("field-def", OP_UPDATED, project, fieldId, callerId);
    return toResponse(repo.findById(fieldId).orElseThrow());
  }

  /** 이전 options 에는 있었지만 새 options 에는 없는 옵션 집합 (삭제 대상). */
  private Set<String> removedOptions(JsonNode oldOptions, JsonNode newOptions) {
    Set<String> before = toStringSet(oldOptions);
    before.removeAll(toStringSet(newOptions));
    return before;
  }

  private Set<String> toStringSet(JsonNode options) {
    Set<String> set = new LinkedHashSet<>();
    if (options != null && options.isArray()) {
      for (JsonNode n : options) {
        if (n.isTextual()) {
          set.add(n.asText());
        }
      }
    }
    return set;
  }

  /** 필드 정의 삭제 — OWNER. 값들은 FK cascade 로 자동 삭제. */
  public void delete(Long callerId, String projectKey, Long fieldId) {
    var project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    var row = repo.findById(fieldId).orElseThrow(() -> new FieldNotFoundException(fieldId));
    if (!row.projectId().equals(project.id())) {
      throw new FieldNotFoundException(fieldId);
    }
    repo.delete(fieldId);
    changeNotifier.changed("field-def", OP_DELETED, project, fieldId, callerId);
  }

  private IssueFieldDefResponse toResponse(IssueFieldDefRow r) {
    return new IssueFieldDefResponse(
        r.id(),
        r.projectId(),
        r.name(),
        r.type(),
        r.options(),
        r.position(),
        r.createdAt(),
        r.updatedAt());
  }
}
