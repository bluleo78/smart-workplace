package com.workplace.issue.service;

import static com.workplace.global.realtime.ResourceChangedEvent.OP_CREATED;
import static com.workplace.global.realtime.ResourceChangedEvent.OP_DELETED;
import static com.workplace.global.realtime.ResourceChangedEvent.OP_UPDATED;

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
import com.workplace.project.outbound.ProjectChangeNotifier;
import com.workplace.project.service.ProjectAccessGuard;
import java.util.List;
import java.util.Locale;
import java.util.Map;
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
  private final ProjectChangeNotifier changeNotifier;

  /**
   * 시스템 유형 코드 → 화면 이름(웹 {@code lib/issueTypeLabels.ts} 와 같은 표). 유형 고르기·필터는 시스템 유형을 이 이름으로 그리므로, 새
   * 유형 이름이 코드나 이 이름과 겹치면 같은 「버그」가 두 번 보였다(WP-614).
   */
  static final Map<String, String> SYSTEM_TYPE_LABELS =
      Map.of(
          "TASK", "태스크",
          "BUG", "버그",
          "STORY", "스토리",
          "CHORE", "기타",
          "SUBTASK", "하위 태스크",
          "EPIC", "에픽");

  /**
   * 신규 프로젝트 생성 직후 시스템 유형을 시드한다. ProjectService.create / PersonalProjectProvisioner.createPersonal
   * 에서 호출. includeEpic=true 면 EPIC 을 6번째로 추가 시드(TEAM/OPEN 공유 프로젝트 전용) — PERSONAL 프로젝트는 false 로 호출해
   * EPIC 을 시드하지 않는다. SUBTASK 는 Phase 4a 부터 추가된 Jira 스타일 자식 유형.
   */
  public void seedSystemTypes(Long projectId, boolean includeEpic) {
    repo.insert(projectId, "TASK", "BLUE", "Circle", true, 0);
    repo.insert(projectId, "BUG", "RED", "Bug", true, 1);
    repo.insert(projectId, "STORY", "PURPLE", "BookOpen", true, 2);
    repo.insert(projectId, "CHORE", "GRAY", "Wrench", true, 3);
    repo.insert(projectId, "SUBTASK", "TEAL", "CornerDownRight", true, 4);
    if (includeEpic) {
      repo.insert(projectId, "EPIC", "INDIGO", "Flag", true, 5);
    }
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
    assertNameDistinct(project.id(), name, null);
    try {
      var row = repo.insert(project.id(), name, color, icon, false, 99);
      changeNotifier.changed(
          ProjectChangeNotifier.RESOURCE_ISSUE_TYPE, OP_CREATED, project, row.id(), callerId);
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
    assertNameDistinct(project.id(), name, typeId);
    try {
      repo.update(typeId, name, color, icon);
    } catch (DuplicateKeyException e) {
      throw new TypeNameDuplicatedException(name);
    }
    changeNotifier.changed(
        ProjectChangeNotifier.RESOURCE_ISSUE_TYPE, OP_UPDATED, project, typeId, callerId);
    // 수정 중에 다른 요청이 지웠으면 다시 읽기가 비어 있다 — 500 대신 처음 찾을 때와 같은 404(WP-755).
    return toResponse(repo.findById(typeId).orElseThrow(() -> new TypeNotFoundException(typeId)));
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
    changeNotifier.changed(
        ProjectChangeNotifier.RESOURCE_ISSUE_TYPE, OP_DELETED, project, typeId, callerId);
  }

  /**
   * 화면에서 다른 유형과 같은 이름으로 보이는가 — 대소문자를 무시하고, 시스템 유형은 코드(BUG)와 화면 이름(버그)을 모두, 사용자 유형은 이름을 비교한다. 시스템
   * 유형은 프로젝트에 없더라도(개인 프로젝트의 에픽) 늘 본다. DB 유일 제약은 글자 그대로만 막아 「bug」·「버그」가 따로 들어갔다(WP-614).
   *
   * @param excludeId 고치는 유형 자신(만들 때는 null)
   */
  private void assertNameDistinct(Long projectId, String name, Long excludeId) {
    String key = nameKey(name);
    boolean clash =
        SYSTEM_TYPE_LABELS.entrySet().stream()
                .anyMatch(e -> key.equals(nameKey(e.getKey())) || key.equals(nameKey(e.getValue())))
            || repo.findByProject(projectId).stream()
                .anyMatch(t -> !t.id().equals(excludeId) && key.equals(nameKey(t.name())));
    if (clash) throw new TypeNameDuplicatedException(name);
  }

  /** 이름 비교 키 — 대소문자 무시. */
  private static String nameKey(String name) {
    return name.toLowerCase(Locale.ROOT);
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
