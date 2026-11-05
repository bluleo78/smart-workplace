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
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Collectors;
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
    assertNoComma(name);
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

  /**
   * 라벨 이름에 쉼표를 막는 안내 문구(WP-1386). 이슈 목록 필터 {@code label=} 이 값을 쉼표로 나눈 이름 목록으로 읽어(SearchParams.csv),
   * 이름에 쉼표가 든 라벨은 이름으로 다시 찾을 수 없었다. 구분자는 ASCII 「,」 뿐이라 전각 쉼표(，)는 막지 않는다.
   */
  public static final String COMMA_MESSAGE = "라벨 이름에는 쉼표(,)를 쓸 수 없습니다";

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
   * 쓰기가 실패하면 함께 롤백된다(고아 라벨 없음). 이름은 대소문자를 무시해 맞춘다 — 「bug」 는 이미 있는 「Bug」 를 쓴다(유니크 인덱스 (project_id,
   * lower(name)) 와 같은 기준, WP-911). 대소문자만 다른 이름을 함께 보내면 같은 라벨 하나로 붙는다.
   *
   * <p>권한은 호출부가 확인한다 — 이슈에 라벨을 붙일 수 있는 사람(프로젝트 멤버·ADMIN)이 곧 라벨을 만들 수 있는 사람이다.
   */
  public List<Long> ensureByNames(ProjectRow project, Long callerId, List<String> names) {
    List<String> normalized = normalizeNames(names);
    if (normalized.isEmpty()) return List.of();
    NameResolution resolved = resolveNames(project.id(), normalized);
    // 키는 소문자 이름 — 대소문자만 다른 요청 이름이 같은 라벨로 모이고, 없는 이름도 한 번만 만든다. 이 호출에서 새로 만든 맵이라 그대로 채운다.
    var idByName = resolved.idByKey();
    assertCreatable(callerId, resolved.missing());
    for (String name : resolved.missing()) {
      idByName.put(caseKey(name), insertOrFind(project, callerId, name));
    }
    return normalized.stream().map(n -> idByName.get(caseKey(n))).distinct().toList();
  }

  /**
   * 이름 라벨 해석 결과 — 이미 있는 라벨(소문자 이름 → id)과 프로젝트에 없어 새로 만들어질 이름(대소문자 무시로 한 번씩, 요청 순서). 실제 생성({@link
   * #ensureByNames})과 사전검증({@link #assertNewNamesAllowed})이 같은 판정을 쓰게 한 곳에서 만든다(WP-1386).
   */
  private record NameResolution(Map<String, Long> idByKey, List<String> missing) {}

  /**
   * {@link NameResolution} 을 만든다 — 이름이 비어 있지 않으면 조회 한 번. names 는 {@link #normalizeNames} 로 다듬은 값.
   */
  private NameResolution resolveNames(Long projectId, List<String> names) {
    var idByKey = new HashMap<String, Long>();
    labelRepository
        .findByProjectAndNames(projectId, names)
        .forEach(r -> idByKey.put(caseKey(r.name()), r.id()));
    var missing =
        names.stream()
            .filter(n -> !idByKey.containsKey(caseKey(n)))
            .collect(
                Collectors.toMap(LabelService::caseKey, n -> n, (a, b) -> a, LinkedHashMap::new))
            .values()
            .stream()
            .toList();
    return new NameResolution(idByKey, missing);
  }

  /**
   * 새로 만들 이름 라벨 검증 — 권한 먼저, 그다음 이름 규칙. 라벨 관리 권한(label:manage)이 없으면 403 — 이슈 쓰기(issue:write)만 있는 역할이
   * 이 경로로 label:manage 를 우회하지 않게. 권한이 있으면 새 이름의 쉼표를 400 으로 막는다(WP-1386) — 이미 있는 쉼표 라벨은 missing 에 들지
   * 않아 이름으로 그대로 붙는다. 권한 없는 호출자가 이름 규칙 오류보다 권한 오류를 먼저 받게 순서를 고정한다.
   */
  private void assertCreatable(Long callerId, List<String> missing) {
    if (missing.isEmpty()) return;
    if (!permissionChecker.hasPermission(callerId, "label:manage")) {
      throw new ProjectAccessDeniedException("라벨을 만들 권한이 없습니다: " + String.join(", ", missing));
    }
    missing.forEach(LabelService::assertNoComma);
  }

  /**
   * 새로 만들(또는 새로 바꿀) 라벨 이름에 쉼표가 있으면 400(WP-1386). 이미 있는 쉼표 라벨은 이관하지 않으므로, 기존 이름을 그대로 쓰는 경로(색만 바꾸는
   * 수정, 이름으로 기존 라벨 붙이기)에서는 부르지 않는다.
   */
  private static void assertNoComma(String name) {
    if (hasComma(name)) throw new InvalidLabelNameException(COMMA_MESSAGE);
  }

  /** 이름에 필터 구분자인 ASCII 쉼표가 있는가(WP-1386) — 쉼표 금지와 가져오기 이름 변환이 같은 판정을 쓴다. 전각 쉼표(，)는 해당하지 않는다. */
  private static boolean hasComma(String name) {
    return name.indexOf(',') >= 0;
  }

  /**
   * 이름 라벨 사전검증(WP-1386) — 실제 생성({@link #ensureByNames})과 같은 해석·검증({@link #resolveNames} → {@link
   * #assertCreatable})을 쓰기 없이 돌린다. 그래서 이슈 생성 사전검증(dry-run)도 새로 만들 라벨이 있으면 권한(403) → 쉼표(400) 순서로 같은
   * 결과를 낸다.
   *
   * @param names {@link #normalizeNames} 로 다듬은 이름
   */
  @Transactional(readOnly = true)
  public void assertNewNamesAllowed(Long callerId, Long projectId, List<String> names) {
    if (names.isEmpty()) return;
    assertCreatable(callerId, resolveNames(projectId, names).missing());
  }

  /**
   * 가져오기 라벨 이름 해석 결과(WP-1386). name 은 이슈에 붙일·이력에 남길 이름(이미 있는 라벨이면 저장된 표기), label 은 이미 있는 라벨(없으면
   * null — 이슈 라벨이면 새로 만들 이름, 이력이면 찾지 못한 이름).
   */
  public record ImportLabel(String name, LabelRow label) {}

  /**
   * 가져오기 라벨 이름 → 쓸 이름·라벨(WP-1386). 이슈의 labelNames 와 변경 이력의 라벨 이름이 이 한 곳으로 같은 답을 얻는다. 원본 트래커의 라벨 이름에
   * 쉼표가 있어도 가져오기 전체가 실패하지 않게 한다:
   *
   * <ol>
   *   <li>원래 이름이 이미 있으면(대소문자 무시) 그 라벨 — 이관 전부터 있던 쉼표 라벨도 그대로.
   *   <li>쉼표가 있으면 ASCII 쉼표를 전각 쉼표(，)로 바꾼 이름 — 그 이름이 이미 있으면(대소문자 무시) 그 라벨, 없으면 바꾼 이름으로 새로 만든다.
   *   <li>그 밖에는 원래 이름(새로 만들 이름).
   * </ol>
   *
   * 일반 생성·메일 승격은 사람·AI 가 고칠 수 있으므로 바꾸지 않고 400 으로 알린다. 조회는 한 번.
   *
   * @param names {@link #normalizeNames} 로 다듬은 이름
   * @return 요청 이름 → 해석 결과(요청 순서)
   */
  @Transactional(readOnly = true)
  public Map<String, ImportLabel> resolveImportNames(Long projectId, List<String> names) {
    var candidates = new LinkedHashSet<String>(names);
    names.stream()
        .filter(LabelService::hasComma)
        .map(LabelService::toFullwidthComma)
        .forEach(candidates::add);
    var byKey = new HashMap<String, LabelRow>();
    labelRepository
        .findByProjectAndNames(projectId, List.copyOf(candidates))
        .forEach(r -> byKey.put(caseKey(r.name()), r));
    var out = new LinkedHashMap<String, ImportLabel>();
    for (String n : names) {
      String name = byKey.containsKey(caseKey(n)) || !hasComma(n) ? n : toFullwidthComma(n);
      LabelRow row = byKey.get(caseKey(name));
      out.put(n, new ImportLabel(row == null ? name : row.name(), row));
    }
    return out;
  }

  /** ASCII 쉼표(필터 구분자)를 전각 쉼표(U+FF0C)로(WP-1386) — 가져오기 이름 해석 전용. */
  private static String toFullwidthComma(String name) {
    return name.replace(',', '\uFF0C');
  }

  /** 대소문자 무시 비교용 키(WP-911) — DB lower() 와 같은 기준으로 소문자화한다. */
  private static String caseKey(String name) {
    return name.toLowerCase(Locale.ROOT);
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
    LabelRow current = findInProject(project, labelId);
    assertCanManage(project, callerId, current);
    String color = ColorToken.validate(req.colorToken());
    String name = req.name().trim();
    // 이름을 바꿀 때만 쉼표를 막는다(WP-1386) — 웹 편집 창은 색만 바꿔도 이름을 함께 보내므로, 쉼표가 든 기존 라벨의 색 변경까지 막지 않게
    // 지금 이름과 똑같으면 통과시킨다. 쉼표 없는 이름으로 바꾸는 것은 언제나 된다.
    if (!name.equals(current.name())) assertNoComma(name);
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
