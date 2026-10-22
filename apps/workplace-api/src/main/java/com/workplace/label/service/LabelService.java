package com.workplace.label.service;

import static com.workplace.global.realtime.ResourceChangedEvent.OP_CREATED;
import static com.workplace.global.realtime.ResourceChangedEvent.OP_DELETED;
import static com.workplace.global.realtime.ResourceChangedEvent.OP_UPDATED;

import com.workplace.global.security.PermissionChecker;
import com.workplace.global.util.SingleLineTitles;
import com.workplace.issue.repository.IssueLabelRepository;
import com.workplace.issue.service.IssueHistoryRecorder;
import com.workplace.label.dto.ColorToken;
import com.workplace.label.dto.CreateLabelRequest;
import com.workplace.label.dto.LabelResponse;
import com.workplace.label.dto.LabelRow;
import com.workplace.label.dto.LabelSummary;
import com.workplace.label.exception.InvalidLabelNameException;
import com.workplace.label.exception.LabelNameDuplicatedException;
import com.workplace.label.exception.LabelNotFoundException;
import com.workplace.label.repository.LabelRepository;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.outbound.ProjectChangeNotifier;
import com.workplace.project.service.ProjectAccessGuard;
import java.util.HashMap;
import java.util.LinkedHashSet;
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
  private final PermissionChecker permissionChecker;
  private final IssueLabelRepository issueLabelRepository;
  private final IssueHistoryRecorder historyRecorder;

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
      notifyCreated(project, row.id(), callerId);
      return toResponse(row, true);
    } catch (DuplicateKeyException e) {
      throw new LabelNameDuplicatedException(name);
    }
  }

  /** 이름으로 붙이며 만드는 새 라벨의 색 — 웹 선택기·MCP 와 같은 기본값. */
  private static final String DEFAULT_COLOR = "GRAY";

  /** 라벨 이름 상한(label.name VARCHAR(40), CreateLabelRequest @Size 와 같다). */
  private static final int NAME_MAX = 40;

  /** 한 요청에서 이름으로 붙일 수 있는 라벨 수 상한 — 없는 이름은 새로 만들어지므로 한 요청이 라벨을 수백 개 만들지 않게 한다(WP-750). */
  private static final int NAMES_MAX = 20;

  /**
   * 이름으로 붙일 라벨 목록 정규화(WP-394) — 라벨 생성 API 와 같이 한 줄로 다듬고(줄바꿈은 공백, 앞뒤 공백·제로폭 문자 제거, WP-750) 같은 이름은
   * 하나로(순서 유지). 비었거나 40자를 넘거나 {@value #NAMES_MAX}개를 넘으면 400. 쓰기 없이 검증만 하므로 이슈 생성 사전검증(dry-run)에서도
   * 쓴다.
   */
  public static List<String> normalizeNames(List<String> names) {
    if (names == null || names.isEmpty()) return List.of();
    if (names.size() > NAMES_MAX) {
      throw new InvalidLabelNameException("라벨 이름은 한 번에 " + NAMES_MAX + "개까지 보낼 수 있습니다");
    }
    var out = new LinkedHashSet<String>();
    for (String raw : names) {
      String name = raw == null ? "" : SingleLineTitles.normalize(raw);
      if (name.isEmpty()) throw new InvalidLabelNameException("라벨 이름이 비어 있습니다");
      if (name.length() > NAME_MAX) {
        throw new InvalidLabelNameException("라벨 이름은 " + NAME_MAX + "자 이하여야 합니다: '" + name + "'");
      }
      out.add(name);
    }
    return List.copyOf(out);
  }

  /**
   * 이름 → 라벨 id(WP-394). 프로젝트에 없는 이름은 기본 색으로 만들고 요청자를 만든 사람으로 기록한다 — 이슈 생성·라벨 교체와 같은 트랜잭션에서 불려 이슈
   * 쓰기가 실패하면 함께 롤백된다(고아 라벨 없음). 이름은 정확 일치(대소문자 구분, UNIQUE(project_id, name) 와 같은 기준).
   *
   * <p>권한은 호출부가 확인한다 — 이슈에 라벨을 붙일 수 있는 사람(프로젝트 멤버·ADMIN)이 곧 라벨을 만들 수 있는 사람이다.
   */
  public List<Long> ensureByNames(ProjectRow project, Long callerId, List<String> names) {
    List<String> normalized = normalizeNames(names);
    if (normalized.isEmpty()) return List.of();
    var idByName = new HashMap<String, Long>();
    labelRepository
        .findByProjectAndNames(project.id(), normalized)
        .forEach(r -> idByName.put(r.name(), r.id()));
    var missing = normalized.stream().filter(n -> !idByName.containsKey(n)).toList();
    if (!missing.isEmpty()) {
      // 새로 만드는 건 라벨 관리 권한이 있을 때만 — 이슈 쓰기(issue:write)만 있는 역할이 이 경로로 label:manage 를 우회하지 않게.
      if (!permissionChecker.hasPermission(callerId, "label:manage")) {
        throw new ProjectAccessDeniedException("라벨을 만들 권한이 없습니다: " + String.join(", ", missing));
      }
      for (String name : missing) {
        idByName.put(name, insertOrFind(project, callerId, name));
      }
    }
    return normalized.stream().map(idByName::get).toList();
  }

  /** 이미 확인한 라벨 id 와 이름 라벨(없으면 생성)을 순서를 지켜 한 목록으로 — 이슈 생성·라벨 교체가 같이 쓴다. */
  public List<Long> mergeWithNames(
      ProjectRow project, Long callerId, List<Long> labelIds, List<String> labelNames) {
    var merged = new LinkedHashSet<Long>(labelIds == null ? List.of() : labelIds);
    merged.addAll(ensureByNames(project, callerId, labelNames));
    return List.copyOf(merged);
  }

  /**
   * 없는 이름 하나를 만들어 id 를 돌려준다. 그 사이 같은 이름이 생겼으면(ON CONFLICT) 다시 읽어 그 라벨을 쓰고, 다시 읽기 전에 지워졌으면 한 번 더
   * 만든다. 그래도 못 잡으면(동시 생성·삭제가 계속 겹침) 409 로 알려 다시 시도하게 한다.
   */
  private Long insertOrFind(ProjectRow project, Long callerId, String name) {
    for (int attempt = 0; attempt < 2; attempt++) {
      var created = labelRepository.insertIfAbsent(project.id(), name, DEFAULT_COLOR, callerId);
      if (created.isPresent()) {
        notifyCreated(project, created.get().id(), callerId);
        return created.get().id();
      }
      var existing = labelRepository.findByProjectAndNames(project.id(), List.of(name));
      if (!existing.isEmpty()) return existing.get(0).id();
    }
    throw new IllegalStateException("라벨 '" + name + "' 을(를) 만들지 못했습니다. 다시 시도해 주세요");
  }

  /** 라벨 생성 실시간 알림 — 설정 화면·선택기 목록이 새 라벨을 다시 읽게 한다. */
  private void notifyCreated(ProjectRow project, Long labelId, Long callerId) {
    changeNotifier.changed(
        ProjectChangeNotifier.RESOURCE_LABEL, OP_CREATED, project, labelId, callerId);
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
    // 수정 중에 다른 요청이 지웠으면 다시 읽기가 비어 있다 — 500 대신 처음 찾을 때와 같은 404(WP-755).
    return toResponse(
        labelRepository.findById(labelId).orElseThrow(() -> new LabelNotFoundException(labelId)),
        true);
  }

  /** OWNER·ADMIN 또는 만든 멤버 — 라벨 삭제(cascade, 다른 사람이 붙인 이슈에서도 빠진다). */
  public void delete(Long callerId, String projectKey, Long labelId) {
    var project = accessGuard.assertMember(projectKey, callerId);
    LabelRow label = findInProject(project, labelId);
    assertCanManage(project, callerId, label);
    // 붙어 있던 이슈마다 「라벨 제거」 이력을 남긴다(WP-488) — cascade 로 조용히 빠지면 이슈에서 이유를 알 수 없다. cascade 전에 읽는다.
    var summary = new LabelSummary(label.id(), label.name(), label.colorToken());
    for (Long issueId : issueLabelRepository.findIssueIdsByLabel(labelId)) {
      historyRecorder.recordLabelsChanged(callerId, issueId, List.of(), List.of(summary));
    }
    labelRepository.delete(labelId);
    changeNotifier.changed(
        ProjectChangeNotifier.RESOURCE_LABEL, OP_DELETED, project, labelId, callerId);
  }

  /** 이 라벨이 붙은 (삭제되지 않은) 이슈 수 — 라벨 삭제 확인창의 영향 안내(WP-488). 라벨 목록과 같은 읽기 권한. */
  @Transactional(readOnly = true)
  public int issueCount(Long callerId, String projectKey, Long labelId) {
    var project = accessGuard.assertReadable(projectKey, callerId);
    return issueLabelRepository.countLiveIssuesByLabel(findInProject(project, labelId).id());
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
