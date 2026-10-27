package com.workplace.issue.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.component.dto.ComponentSummary;
import com.workplace.global.dto.UserSummary;
import com.workplace.issue.dto.IssueAttachmentResponse;
import com.workplace.issue.dto.IssueHistoryEventType;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.repository.IssueHistoryRepository;
import com.workplace.label.dto.LabelSummary;
import com.workplace.milestone.repository.MilestoneRepository;
import com.workplace.version.dto.VersionKind;
import com.workplace.version.dto.VersionSummary;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/** 이슈 수정 시 before/after 비교 후 변경된 항목에 대해 history row 를 기록한다. body 변경은 소음 방지를 위해 기록 대상에서 제외한다. */
@Component
@RequiredArgsConstructor
public class IssueHistoryRecorder {

  private final IssueHistoryRepository historyRepository;
  private final ObjectMapper objectMapper;
  private final MilestoneRepository milestoneRepository;

  /**
   * before/after 의 주요 필드 비교 후 변경 항목별로 history row 삽입. 담당자는 별도 PUT 흐름에서 ASSIGNEES_CHANGED 로 기록된다.
   */
  public void recordChanges(Long actorId, IssueRow before, IssueRow after) {
    if (!Objects.equals(before.title(), after.title())) {
      historyRepository.insert(
          before.id(), actorId, "TITLE_CHANGED", before.title(), after.title());
    }
    // 상태는 프로젝트 상태 id 로 비교해 같은 범주 안 이동(진행 중 → 검토 중)도 남긴다(WP-807). 값은 그 시점의 상태 이름 — 나중에 이름을
    // 바꿔도 이력은 당시 이름을 보여 준다. 예전 행의 범주 코드는 웹이 범주 라벨로 표시한다.
    if (!Objects.equals(before.statusId(), after.statusId())
        || !Objects.equals(before.status(), after.status())) {
      historyRepository.insert(
          before.id(), actorId, "STATUS_CHANGED", statusLabel(before), statusLabel(after));
    }
    if (!Objects.equals(before.priority(), after.priority())) {
      historyRepository.insert(
          before.id(), actorId, "PRIORITY_CHANGED", before.priority(), after.priority());
    }
    if (!Objects.equals(before.dueDate(), after.dueDate())) {
      historyRepository.insert(
          before.id(),
          actorId,
          "DUE_DATE_CHANGED",
          stringify(before.dueDate()),
          stringify(after.dueDate()));
    }
    if (!Objects.equals(before.startDate(), after.startDate())) {
      historyRepository.insert(
          before.id(),
          actorId,
          "START_DATE_CHANGED",
          stringify(before.startDate()),
          stringify(after.startDate()));
    }
    if (!Objects.equals(before.milestoneId(), after.milestoneId())) {
      // 사람이 읽을 수 있도록 id 대신 마일스톤 이름을 기록한다. null id 는 이름도 null.
      String fromName =
          before.milestoneId() == null
              ? null
              : milestoneRepository.findById(before.milestoneId()).map(m -> m.name()).orElse(null);
      String toName =
          after.milestoneId() == null
              ? null
              : milestoneRepository.findById(after.milestoneId()).map(m -> m.name()).orElse(null);
      historyRepository.insert(before.id(), actorId, "MILESTONE_CHANGED", fromName, toName);
    }
  }

  /** 이력에 남길 상태 값 — 상태 이름, 이름을 모르는 행(서브쿼리 없이 만든 행)이면 범주 코드. */
  private static String statusLabel(IssueRow row) {
    return row.statusName() != null ? row.statusName() : row.status();
  }

  /**
   * 라벨 집합 교체를 한 건의 history 로 기록한다. diff 가 없으면 no-op. payload JSON 은 toValue 필드에 저장한다 (fromValue 는
   * null).
   */
  public void recordLabelsChanged(
      Long actorId, Long issueId, List<LabelSummary> added, List<LabelSummary> removed) {
    recordLabelsChanged(actorId, issueId, added, removed, null);
  }

  /** 라벨 변경 기록 — {@code at} 이 있으면 그 시각(가져오기), null 이면 DB 기본값(지금). 저장 모양은 같다. */
  public void recordLabelsChanged(
      Long actorId,
      Long issueId,
      List<LabelSummary> added,
      List<LabelSummary> removed,
      OffsetDateTime at) {
    if ((added == null || added.isEmpty()) && (removed == null || removed.isEmpty())) {
      return;
    }
    String payload =
        toJson(
            Map.of(
                "added", added == null ? List.of() : added,
                "removed", removed == null ? List.of() : removed));
    historyRepository.insert(issueId, actorId, "LABELS_CHANGED", null, payload, at);
  }

  /**
   * 구성요소 집합 변경을 한 건의 history 로 기록한다(WP-933). diff 가 없으면 no-op. payload 는 라벨과 같은 모양 {@code
   * {added:[{id,name}], removed:[{id,name}]}} 이고 toValue 에 JSON 으로 저장한다 — 당시 이름을 그대로 남겨, 나중에 이름을
   * 바꾸거나 구성요소를 지워도 지난 기록은 변하지 않는다.
   */
  public void recordComponentsChanged(
      Long actorId, long issueId, List<ComponentSummary> added, List<ComponentSummary> removed) {
    recordComponentsChanged(actorId, issueId, added, removed, null);
  }

  /** 구성요소 변경 기록 — {@code at} 이 있으면 그 시각(가져오기), null 이면 DB 기본값(지금). 저장 모양은 같다. */
  public void recordComponentsChanged(
      Long actorId,
      long issueId,
      List<ComponentSummary> added,
      List<ComponentSummary> removed,
      OffsetDateTime at) {
    if ((added == null || added.isEmpty()) && (removed == null || removed.isEmpty())) {
      return;
    }
    String payload = toJson(Map.of("added", idAndName(added), "removed", idAndName(removed)));
    historyRepository.insert(
        issueId, actorId, IssueHistoryEventType.COMPONENTS_CHANGED.name(), null, payload, at);
  }

  /**
   * 수정 버전·영향 버전 변경을 한 건의 history 로 기록한다(WP-888). kind 는 FIX|AFFECTS — 종류별 유형({@code
   * FIX_VERSIONS_CHANGED}·{@code AFFECTS_VERSIONS_CHANGED})으로 나눠 남긴다. diff 가 없으면 no-op, payload 는
   * 구성요소와 같은 {@code {added:[{id,name}], removed:[{id,name}]}} 이고 당시 이름을 남긴다.
   */
  public void recordVersionsChanged(
      Long actorId,
      long issueId,
      String kind,
      List<VersionSummary> added,
      List<VersionSummary> removed) {
    recordVersionsChanged(actorId, issueId, kind, added, removed, null);
  }

  /** 버전 변경 기록 — {@code at} 이 있으면 그 시각(가져오기), null 이면 DB 기본값(지금). 저장 모양은 같다. */
  public void recordVersionsChanged(
      Long actorId,
      long issueId,
      String kind,
      List<VersionSummary> added,
      List<VersionSummary> removed,
      OffsetDateTime at) {
    if ((added == null || added.isEmpty()) && (removed == null || removed.isEmpty())) {
      return;
    }
    String type = VersionKind.historyType(kind).name();
    String payload =
        toJson(Map.of("added", versionIdAndName(added), "removed", versionIdAndName(removed)));
    historyRepository.insert(issueId, actorId, type, null, payload, at);
  }

  private static List<Map<String, Object>> versionIdAndName(List<VersionSummary> list) {
    if (list == null) return List.of();
    return list.stream().map(v -> Map.<String, Object>of("id", v.id(), "name", v.name())).toList();
  }

  /** 이력 payload 에는 id·당시 이름만 싣는다(보관 여부는 지난 기록에 의미가 없다). */
  private static List<Map<String, Object>> idAndName(List<ComponentSummary> list) {
    if (list == null) return List.of();
    return list.stream().map(c -> Map.<String, Object>of("id", c.id(), "name", c.name())).toList();
  }

  /**
   * 이슈 첨부 추가/제거를 한 건의 history 로 기록한다. added/removed 모두 비면 no-op. payload JSON 은 toValue 에 저장
   * ({@code LABELS_CHANGED} 와 동일한 패턴).
   */
  public void recordAttachmentsChanged(
      Long actorId,
      Long issueId,
      List<IssueAttachmentResponse> added,
      List<IssueAttachmentResponse> removed) {
    boolean noAdd = added == null || added.isEmpty();
    boolean noRem = removed == null || removed.isEmpty();
    if (noAdd && noRem) {
      return;
    }
    String payload =
        toJson(
            Map.of(
                "added",
                added == null
                    ? List.of()
                    : added.stream()
                        .map(a -> Map.of("fileId", a.fileId(), "originalName", a.originalName()))
                        .toList(),
                "removed",
                removed == null
                    ? List.of()
                    : removed.stream()
                        .map(a -> Map.of("fileId", a.fileId(), "originalName", a.originalName()))
                        .toList()));
    historyRepository.insert(issueId, actorId, "ATTACHMENTS_CHANGED", null, payload);
  }

  /**
   * 보고자 변경 한 건을 기록한다(WP-944). 이전·새 보고자 이름을 from/to 에 그대로 남긴다 — 이름이 나중에 바뀌어도 그때 누구였는지가 이력에 남는다. 이전
   * 보고자 사용자 행이 없으면 from 은 null(화면은 「없음」).
   */
  public void recordReporterChanged(Long actorId, Long issueId, UserSummary from, UserSummary to) {
    historyRepository.insert(
        issueId, actorId, "REPORTER_CHANGED", from == null ? null : from.name(), to.name());
  }

  /**
   * 담당자 집합 교체를 한 건의 history 로 기록한다. diff 0 이면 no-op. payload JSON 은 toValue 필드에 저장한다 (fromValue 는
   * null). 라벨/첨부와 동일한 패턴.
   */
  public void recordAssigneesChanged(
      Long actorId, Long issueId, List<UserSummary> added, List<UserSummary> removed) {
    recordAssigneesChanged(actorId, issueId, added, removed, null);
  }

  /** 담당자 변경 기록 — {@code at} 이 있으면 그 시각(가져오기), null 이면 DB 기본값(지금). 저장 모양은 같다. */
  public void recordAssigneesChanged(
      Long actorId,
      Long issueId,
      List<UserSummary> added,
      List<UserSummary> removed,
      OffsetDateTime at) {
    boolean noAdd = added == null || added.isEmpty();
    boolean noRem = removed == null || removed.isEmpty();
    if (noAdd && noRem) {
      return;
    }
    String payload = assigneesPayload(added, removed, Map.of());
    historyRepository.insert(issueId, actorId, "ASSIGNEES_CHANGED", null, payload, at);
  }

  /**
   * 구성요소 담당자 자동 지정 한 건을 기록한다(WP-933 §4.3). 담당자 변경과 같은 {@code ASSIGNEES_CHANGED} 유형·모양에 이유를 더한다 —
   * {@code {added:[UserSummary], removed:[], reason:"COMPONENT_DEFAULT", componentId,
   * componentName}}. 화면은 이유가 있으면 「구성요소 X 담당자로 자동 지정」으로 그린다. 구성요소 이름은 당시 값을 남긴다.
   */
  public void recordComponentDefaultAssigned(
      Long actorId, long issueId, UserSummary assignee, long componentId, String componentName) {
    Map<String, Object> extra = new LinkedHashMap<>();
    extra.put("reason", "COMPONENT_DEFAULT");
    extra.put("componentId", componentId);
    extra.put("componentName", componentName);
    String payload = assigneesPayload(List.of(assignee), List.of(), extra);
    historyRepository.insert(issueId, actorId, "ASSIGNEES_CHANGED", null, payload);
  }

  /**
   * ASSIGNEES_CHANGED payload — {@code {added, removed}} 에 extra(자동 지정의 이유 등)를 더한다. 일반 변경과 구성요소 자동
   * 지정이 같은 모양을 쓰게 한 곳에서 만든다.
   */
  private String assigneesPayload(
      List<UserSummary> added, List<UserSummary> removed, Map<String, Object> extra) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("added", added == null ? List.of() : added);
    body.put("removed", removed == null ? List.of() : removed);
    body.putAll(extra);
    return toJson(body);
  }

  /**
   * 유형 변경 한 건을 기록. 동일 유형은 호출 안 됨 보장(서비스). payload JSON 은 toValue 필드에 저장하고 fromValue 는 null
   * (라벨/첨부/담당자와 동일 패턴).
   */
  public void recordTypeChanged(
      Long actorId,
      Long issueId,
      com.workplace.issue.dto.IssueTypeSummary from,
      com.workplace.issue.dto.IssueTypeSummary to) {
    recordTypeChanged(actorId, issueId, from, to, null);
  }

  /** 유형 변경 기록 — {@code at} 이 있으면 그 시각(가져오기), null 이면 DB 기본값(지금). 저장 모양은 같다. */
  public void recordTypeChanged(
      Long actorId,
      Long issueId,
      com.workplace.issue.dto.IssueTypeSummary from,
      com.workplace.issue.dto.IssueTypeSummary to,
      OffsetDateTime at) {
    String payload =
        toJson(
            Map.of(
                "from", Map.of("id", from.id(), "name", from.name()),
                "to", Map.of("id", to.id(), "name", to.name())));
    historyRepository.insert(issueId, actorId, "TYPE_CHANGED", null, payload, at);
  }

  /**
   * 부모 변경/해제 한 건을 기록. from/to 는 null 가능 (설정/해제/교체 모두). diff 0 호출은 서비스에서 사전 차단. payload JSON 의 to 값은
   * type 정보 제외 — 렌더링은 응답의 parent.type 으로 처리한다. 부모 프로젝트 키(projectKey)도 남긴다(WP-1038) — 에픽이 다른 프로젝트일 수
   * 있어 키를 만들고, 조회자가 그 프로젝트를 읽을 수 없으면 이력 조회 때 가린다(IssueRelationService.redactHistory).
   */
  public void recordParentChanged(
      Long actorId,
      Long issueId,
      com.workplace.issue.dto.ParentRef from,
      com.workplace.issue.dto.ParentRef to) {
    Map<String, Object> body = new HashMap<>();
    body.put("from", parentPayload(from));
    body.put("to", parentPayload(to));
    String payload = toJson(body);
    historyRepository.insert(issueId, actorId, "PARENT_CHANGED", null, payload);
  }

  /** 부모 변경 이력의 한쪽 값 — 번호·제목, 아는 경우 프로젝트 키. null 이면 null(부모 없음). */
  private static Map<String, Object> parentPayload(com.workplace.issue.dto.ParentRef ref) {
    if (ref == null) return null;
    Map<String, Object> m = new HashMap<>();
    m.put("number", ref.number());
    m.put("title", ref.title());
    if (ref.projectKey() != null) m.put("projectKey", ref.projectKey());
    return m;
  }

  /**
   * 의존성 추가 한 건 기록 (Phase 4b). direction = "blocks" | "blockedBy" — 화살표 방향은 호출자가 결정. payload toValue
   * JSON = {other: {number, title}, direction}.
   */
  public void recordDependencyAdded(
      Long actorId, Long issueId, int otherNumber, String otherTitle, String direction) {
    writeDependency(actorId, issueId, otherNumber, otherTitle, direction, "DEPENDENCY_ADDED");
  }

  /** 의존성 제거 한 건 기록 (Phase 4b). 0건 삭제 시 호출 안 됨 — 서비스에서 사전 가드. */
  public void recordDependencyRemoved(
      Long actorId, Long issueId, int otherNumber, String otherTitle, String direction) {
    writeDependency(actorId, issueId, otherNumber, otherTitle, direction, "DEPENDENCY_REMOVED");
  }

  /** 의존성 add/remove 공통 payload 직렬화 + insert. eventType 만 분기. */
  private void writeDependency(
      Long actorId,
      Long issueId,
      int otherNumber,
      String otherTitle,
      String direction,
      String eventType) {
    String payload =
        toJson(
            Map.of(
                "other",
                Map.of("number", otherNumber, "title", otherTitle),
                "direction",
                direction));
    historyRepository.insert(issueId, actorId, eventType, null, payload);
  }

  /**
   * 이슈 사이 관계 추가·삭제 한 건 기록(WP-887) — 관계의 두 이슈 각각에 한 번씩, 각자 쪽 말로 부른다. toValue JSON = {typeId, label,
   * other: {projectKey, number, title}}. 상대 정보는 당시 값을 그대로 남기고, 읽을 수 없는 조회자에겐 상세 조립이 가린다.
   *
   * @param eventType {@code RELATION_ADDED} 또는 {@code RELATION_REMOVED}
   * @param label 이 이슈 쪽 말(당시 값)
   */
  public void recordRelation(
      String eventType,
      Long actorId,
      long issueId,
      long typeId,
      String label,
      String otherProjectKey,
      int otherNumber,
      String otherTitle) {
    Map<String, Object> other = new LinkedHashMap<>();
    other.put("projectKey", otherProjectKey);
    other.put("number", otherNumber);
    other.put("title", otherTitle);
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("typeId", typeId);
    body.put("label", label);
    body.put("other", other);
    historyRepository.insert(issueId, actorId, eventType, null, toJson(body));
  }

  /**
   * 외부 링크 추가·수정·삭제 한 건 기록(WP-887). toValue JSON = {label, key, title, url}(삭제면 지운 값), 수정이면
   * fromValue 에 이전 값을 같은 모양으로 남긴다. 외부 주소는 프로젝트 권한과 무관해 가리지 않는다.
   *
   * @param eventType {@code EXTERNAL_LINK_ADDED|UPDATED|REMOVED}
   * @param from 수정 전 값(수정 때만, 나머지는 null)
   */
  public void recordExternalLink(
      String eventType,
      Long actorId,
      long issueId,
      ExternalLinkSnapshot from,
      ExternalLinkSnapshot to) {
    historyRepository.insert(
        issueId,
        actorId,
        eventType,
        from == null ? null : externalLinkJson(from),
        externalLinkJson(to));
  }

  /** 외부 링크 이력에 남기는 한 시점의 값 — label 은 이 이슈 쪽 말(당시 값). */
  public record ExternalLinkSnapshot(String label, String key, String title, String url) {}

  private String externalLinkJson(ExternalLinkSnapshot s) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("label", s.label());
    body.put("key", s.key());
    body.put("title", s.title());
    body.put("url", s.url());
    return toJson(body);
  }

  /**
   * Phase 4c — 프로젝트 custom field 값 변경 한 건 기록. from/to 는 null 가능 (신규 설정/삭제). payload toValue JSON =
   * {defId, name, type, from, to}. HashMap 사용은 Map.of 가 null value 를 허용하지 않기 때문.
   */
  public void recordCustomFieldChanged(
      Long actorId,
      Long issueId,
      Long defId,
      String name,
      String type,
      com.fasterxml.jackson.databind.JsonNode from,
      com.fasterxml.jackson.databind.JsonNode to) {
    Map<String, Object> body = new HashMap<>();
    body.put("defId", defId);
    body.put("name", name);
    body.put("type", type);
    body.put("from", from);
    body.put("to", to);
    historyRepository.insert(issueId, actorId, "CUSTOM_FIELD_CHANGED", null, toJson(body));
  }

  /**
   * 단순 값 이력(상태·우선순위·제목·일정)을 원래 시각으로 기록 — 가져오기용. 일반 변경({@link #recordChanges})이 남기는 행과 같은 from/to
   * 문자열을 넣는다.
   */
  public void recordImportedValue(
      long issueId, long actorId, String eventType, String from, String to, OffsetDateTime at) {
    historyRepository.insert(issueId, actorId, eventType, from, to, at);
  }

  /** payload → JSON 문자열. 직렬화에 실패하면 빈 객체 {@code "{}"} — 이력 기록 실패가 본 작업을 막지 않게 한다. */
  private String toJson(Object payload) {
    try {
      return objectMapper.writeValueAsString(payload);
    } catch (Exception e) {
      return "{}";
    }
  }

  /** 객체 → 문자열 (null 보존). */
  private static String stringify(Object v) {
    return v == null ? null : v.toString();
  }
}
