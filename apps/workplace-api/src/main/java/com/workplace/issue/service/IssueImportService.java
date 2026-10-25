package com.workplace.issue.service;

import com.workplace.audit.service.AuditLogService;
import com.workplace.component.dto.ComponentRow;
import com.workplace.component.dto.ComponentSummary;
import com.workplace.component.repository.ComponentRepository;
import com.workplace.global.dto.UserSummary;
import com.workplace.global.util.SingleLineTitles;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.ImportIssueRequest;
import com.workplace.issue.dto.IssueFieldEntry;
import com.workplace.issue.dto.IssuePriorities;
import com.workplace.issue.dto.IssueRelationTypeRow;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.dto.IssueStatuses;
import com.workplace.issue.dto.IssueTypeRow;
import com.workplace.issue.dto.IssueTypeSummary;
import com.workplace.issue.dto.ProjectStatusRow;
import com.workplace.issue.dto.ResolvedExternalLink;
import com.workplace.issue.exception.IssueImportException;
import com.workplace.issue.outbound.IssueChangeNotifier;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueCommentRepository;
import com.workplace.issue.repository.IssueFieldValueRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.repository.IssueTypeRepository;
import com.workplace.issue.repository.ProjectStatusRepository;
import com.workplace.issue.service.IssueService.CreateIssuePlan;
import com.workplace.label.dto.LabelRow;
import com.workplace.label.dto.LabelSummary;
import com.workplace.label.repository.LabelRepository;
import com.workplace.label.service.LabelService;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.repository.ProjectIssueSequenceRepository;
import com.workplace.user.dto.UserResponse;
import com.workplace.watcher.repository.IssueWatcherRepository;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import lombok.RequiredArgsConstructor;
import org.postgresql.util.PSQLException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 이슈 가져오기(WP-883 원작성자·원시각 보존, WP-884 알림 억제) — 다른 트래커의 이슈 한 건을 원래 보고자·시각·담당자·워처·필드와 함께 한 트랜잭션으로 넣는다.
 * 남의 이름으로 기록을 남기는 기능이라 워크스페이스 관리자(사람)만 쓸 수 있다.
 *
 * <p>일반 생성({@link IssueService#create})과 검증(planCreate)은 공유하되 후속부는 따로 둔다 — 인박스 알림·웹 푸시·AI 착수의 원인이
 * 되는 도메인 이벤트(IssueCreated·IssueAssigned·WatcherAdded·AgentToolWrite)와 시작 전 AI 작업, 워처 자동 등록을 처음부터
 * 만들지 않는다. 플래그로 거르는 방식은 {@code @Async} 리스너에 전달되지 않아 쓰지 않는다. 내는 것은 화면 갱신 이벤트 한 번과 감사 로그뿐이다.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class IssueImportService {

  /** 감사 로그 행위 종류 — 이슈마다 한 건. */
  static final String AUDIT_ACTION = "ISSUE_IMPORTED";

  /** 원본 키 부분 고유 인덱스 이름(V212) — 이슈 INSERT 의 중복 위반을 번호 중복과 가른다. */
  private static final String SOURCE_KEY_CONSTRAINT = "uq_issue_project_import_source_key";

  private final IssueService issueService;
  private final IssueFieldValueService fieldValueService;
  private final ImportUserResolver userResolver;
  private final IssueRepository issueRepository;
  private final IssueAssigneeRepository assigneeRepository;
  private final IssueWatcherRepository watcherRepository;
  private final IssueCommentRepository commentRepository;
  private final IssueAttachmentService attachmentService;
  private final IssueBodyImageService bodyImageService;
  private final ProjectIssueSequenceRepository sequenceRepository;
  private final IssueImportGuard importGuard;
  private final IssueRelationTypeService relationTypeService;
  private final IssueExternalLinkService externalLinkService;
  private final LabelRepository labelRepository;
  private final ComponentRepository componentRepository;
  private final ProjectStatusRepository statusRepository;
  private final IssueTypeRepository typeRepository;
  private final IssueFieldValueRepository fieldValueRepository;
  private final IssueHistoryRecorder historyRecorder;
  private final IssueChangeNotifier changeNotifier;
  private final AuditLogService auditLogService;

  /**
   * 이슈 한 건을 가져온다. 어느 검증이든 실패하면 아무것도 남지 않는다(한 트랜잭션).
   *
   * @return 만든 이슈(원래 시각·담당자·필드가 반영된 요약)
   * @throws IssueImportException 관리자·사람이 아님(403), 개인 프로젝트·맞지 않는 사용자·시각(400), 번호·원본 키 중복(409)
   */
  public IssueResponse importIssue(long callerId, String projectKey, ImportIssueRequest req) {
    // 1) 권한 — 테넌트 ADMIN 역할의 사람만. 프로젝트 OWNER 도 안 된다(누구나 프로젝트를 만들면 소유자라 사실상 모두에게 열린다).
    UserResponse caller = importGuard.requireHumanAdmin(callerId);

    // 2) 프로젝트 — 개인 프로젝트에는 ADMIN 우회가 없어 가져오지 않는다.
    ProjectRow project = importGuard.resolveImportProject(projectKey);

    // 3) 시각 — 수정·댓글·첨부·이력 시각의 순서를 쓰기 전에 걸러 부분 저장을 피한다. 종료 시각은 상태가 정해진 뒤(5)에 본다.
    validateTimes(req);

    // 3-1) 외부 링크 — 유형·방향·주소를 쓰기 전에 풀어 둔다(틀리면 이슈 INSERT 전에 400 으로 끝난다). 숨긴 유형도 쓸 수 있다.
    List<ResolvedExternalLink> externalLinks = resolveExternalLinks(req.externalLinks());

    // 3-2) 구성요소 — 이름으로 프로젝트에 이미 있는 것을 찾는다(대소문자 무시, 보관된 것도 허용). 없는 이름은 만들지 않고 이슈 INSERT 전에 400.
    //      담당자 자동 지정은 일반 생성(IssueService.create)에만 있어 이 경로는 타지 않는다.
    List<Long> componentIds = resolveComponentIds(project, req.componentNames());

    // 4) 사람 — 요청에 나온 username 을 모두 이 프로젝트 활성 멤버로 해석한다(하나라도 아니면 전부 나열해 400). 멤버 행을 공유 잠금하므로
    //    쓰기 트랜잭션 안에서 부른다.
    Map<String, UserSummary> users = userResolver.resolve(project.id(), req.referencedUsernames());
    long reporterId = users.get(req.reporter()).id();
    List<Long> assigneeIds = idsOf(users, req.assignees());

    // 5) 일반 생성과 같은 검증 — 완료 사이클·완료 에픽 아래 미완료 하위만 풀어 준다(IMPORT).
    CreateIssueRequest createReq = toCreateRequest(req, assigneeIds, componentIds);
    CreateIssuePlan plan =
        issueService.lockComponentsForShare(
            issueService.planCreate(
                callerId, projectKey, createReq, IssueService.CreateMode.IMPORT),
            true);
    OffsetDateTime closedAt = resolveClosedAt(req, plan.status().category());
    // 부모가 지금도 살아 있는지 공유 잠금으로 다시 본다(WP-759, 일반 생성과 같음). 완료 에픽 규칙은 가져오기라 다시 보지 않는다.
    issueService.lockParentForShare(plan);

    // 6) 원본 키 — 같은 원본을 두 번 가져오지 않는다(시간 초과 뒤 재시도가 이슈를 두 번 만들지 않게). 앞뒤 공백은 다듬고 빈 값은 없는 것으로.
    //    여기는 이미 커밋된 가져오기를 빨리 거르는 길이고, 아직 커밋 전인 같은 원본은 번호를 잡은 뒤(7) 다시 본다.
    String sourceKey = normalizeSourceKey(req.sourceKey());
    requireSourceKeyFree(project, sourceKey);

    // 7) 번호 — 시퀀스 행을 잡아(같은 프로젝트의 진행 중 가져오기가 끝날 때까지 기다린다) 번호를 정한다. 잡은 뒤에는 앞선 요청의 커밋이 보이므로 원본 키를
    //    다시 본다 — 시간 초과 뒤 재시도가 첫 요청 커밋 전에 들어왔다면 여기서 「이미 가져옴」(409 원본 키)을 받는다. 번호·첨부 중복보다 먼저 봐야
    //    스크립트가 받는 답이 재시도 신호(원본 키)로 일정하다.
    int number = lockNumber(project, req.number());
    requireSourceKeyFree(project, sourceKey);
    if (req.number() != null
        && issueRepository.existsNumberIncludingDeleted(project.id(), req.number())) {
      throw IssueImportException.numberTaken(req.number());
    }

    // 8) 이슈 본체 — 보고자는 원래 사람. 원래 시각·가져옴 표시·원본 키까지 이 INSERT 한 번에 쓴다. 뒤의 자식 쓰기(라벨·사이클·필드·담당자·워처·
    //    첨부·본문 이미지·댓글·이력)는 이슈 행의 수정 시각을 건드리지 않아 덮어쓸 UPDATE 가 따로 필요 없다.
    var marks =
        new IssueRepository.ImportMarks(
            req.createdAt(), updatedAtOf(req), closedAt, callerId, sourceKey);
    IssueRow row = insertIssue(plan, number, createReq, reporterId, marks);

    // 9) 딸린 것들 — 라벨·사이클·필드·담당자·워처. 모두 이벤트·이력 없이 넣는다.
    issueService.linkLabelsAndCycles(callerId, row.id(), plan);
    fieldValueService.importValues(project.id(), row.id(), req.fields());
    for (Long uid : assigneeIds) {
      // 지정자는 호출자(관리자) — 원래 지정자는 이력(history)으로 옮긴다.
      assigneeRepository.add(row.id(), uid, callerId);
    }
    // 워처는 넘긴 목록 그대로 — 일반 생성과 달리 보고자·담당자를 자동으로 넣지 않는다(원본과 달라지고 이관 뒤 알림이 간다).
    for (Long uid : idsOf(users, req.watchers())) {
      watcherRepository.add(row.id(), uid);
    }
    // 외부 링크 — 이력·실시간 신호 없이 같은 트랜잭션에(가져온 이슈의 이력은 요청의 history 가 정한다).
    if (!externalLinks.isEmpty()) {
      externalLinkService.insertForImport(row.id(), callerId, externalLinks);
    }
    // 본문 이미지 — 호출자가 올려 둔 이미지를 이 이슈에 연결하고 올린 사람·시각을 보고자·생성 시각으로 되돌린다.
    bodyImageService.claimForImport(
        project, row.id(), callerId, req.body(), reporterId, req.createdAt());
    // 첨부 — 원 첨부자·시각으로, 이력·알림 없이.
    int attachmentCount = 0;
    if (req.attachments() != null && !req.attachments().isEmpty()) {
      attachmentCount =
          attachmentService.attachImported(
              row.id(),
              callerId,
              req.attachments().stream()
                  .map(
                      a ->
                          new IssueAttachmentService.ImportedAttachment(
                              a.fileId(), users.get(a.attachedBy()).id(), a.attachedAt()))
                  .toList(),
              ImportIssueRequest.MAX_ATTACHMENTS);
    }
    // 댓글 — 원작성자·원시각·가져옴 표시로 한 번에 넣고, 댓글 이미지를 작성자·작성 시각으로 되돌린다. 댓글 이벤트·워처 자동 등록은 일부러 거치지 않는다
    // (일반 댓글 작성 경로를 쓰지 않고 저장소에 바로 넣는다).
    if (req.comments() != null) {
      for (ImportIssueRequest.Comment c : req.comments()) {
        long authorId = users.get(c.author()).id();
        commentRepository.insertImported(
            row.id(),
            authorId,
            c.body(),
            c.createdAt(),
            c.updatedAt() != null ? c.updatedAt() : c.createdAt(),
            callerId);
        bodyImageService.claimForImport(
            project, row.id(), callerId, c.body(), authorId, c.createdAt());
      }
    }
    // 변경 이력 — 원래 행위자·시각으로. 라벨이 이미 붙은 뒤라 LABELS_CHANGED 의 이름 조회가 이번 요청의 라벨까지 본다. 전부 검증한 뒤에 넣는다.
    importHistory(project, row.id(), users, req.history());

    // 10) 화면 갱신 한 번(AI 터치 없음)과 감사 로그.
    changeNotifier.imported(project, number, row.id(), callerId);
    String issueKey = project.key() + "-" + number;
    auditLogService.log(
        callerId,
        caller.username(),
        AUDIT_ACTION,
        "issue",
        issueKey,
        "이슈 가져오기",
        null,
        null,
        "SUCCESS",
        null,
        auditMetadata(req, sourceKey));

    // 11) 응답 — INSERT 가 돌려준 행이 이미 최종 값이라 상세 조회(댓글·이력까지)를 다시 하지 않고 요약만 채운다. 담당자는 상세 조회와 같은 순서(이름순)로.
    List<UserSummary> assignees =
        assigneeIds.isEmpty() ? List.of() : assigneeRepository.findByIssue(row.id());
    List<IssueFieldEntry> customFields =
        req.fields() == null || req.fields().isEmpty()
            ? List.of()
            : fieldValueRepository
                .findByIssueIds(List.of(row.id()))
                .getOrDefault(row.id(), List.of());
    return issueService.newIssueSummary(
        project,
        row,
        assignees,
        attachmentCount,
        customFields,
        plan.components().stream().map(ComponentRow::toSummary).toList());
  }

  /**
   * 변경 이력 가져오기 — 모든 항목을 먼저 검증해 쓰기 동작으로 바꿔 두고, 받은 순서대로 넣는다. 검증을 쓰기보다 먼저 끝내는 이유: 한 항목이라도 틀리면 아무것도 쓰지
   * 않은 채 그 항목 번호로 400 을 돌려줘, 스크립트가 받는 오류가 앞선 쓰기와 섞이지 않는다. 저장 모양은 일반 변경이 남기는 행과 같다 (활동 목록·홈 활동이 그대로
   * 그린다). 알림·이벤트는 만들지 않는다.
   */
  private void importHistory(
      ProjectRow project,
      long issueId,
      Map<String, UserSummary> users,
      List<ImportIssueRequest.HistoryEntry> entries) {
    if (entries == null || entries.isEmpty()) return;
    HistoryLookups lookups = loadLookups(project, entries);
    List<Runnable> writes = new ArrayList<>();
    for (int i = 0; i < entries.size(); i++) {
      writes.add(prepareHistory(i, entries.get(i), issueId, users, lookups));
    }
    writes.forEach(Runnable::run);
  }

  /**
   * 라벨·구성요소 이력의 추가/제거 이름 — 항목마다 각 이름 규칙(공백 정리·한 줄)으로 한 번만 정리해 둔다. 조회와 항목별 변환이 같은 이름을 써 같은 요청이 만든
   * 라벨도 찾는다.
   */
  private record AddedRemovedNames(List<String> added, List<String> removed) {

    Stream<String> all() {
      return Stream.concat(added.stream(), removed.stream());
    }
  }

  /**
   * 이력 검증에 쓰는 조회 결과 — 요청 전체에서 한 번씩만 읽는다. 상태·유형은 그 유형의 이력이 있을 때만, 라벨 이름은 항목 순서(index)대로 정리한 값(라벨 이력이
   * 아니면 null).
   */
  private record HistoryLookups(
      Map<Long, ProjectStatusRow> statuses,
      Map<Long, IssueTypeSummary> types,
      List<AddedRemovedNames> labelNames,
      Map<String, LabelRow> labels,
      List<AddedRemovedNames> componentNames,
      Map<String, ComponentRow> components) {}

  /** 이력 검증용 조회를 한 번에 — 라벨 이름 정리와 없는 라벨(전부 나열해 400) 확인까지 항목별 검증보다 먼저 한다. */
  private HistoryLookups loadLookups(
      ProjectRow project, List<ImportIssueRequest.HistoryEntry> entries) {
    // 상태는 이력에 나온 id 만 읽고 프로젝트 소속은 아래에서 거른다 — 다른 프로젝트 상태는 「이 프로젝트의 상태가 아님」.
    Set<Long> statusIds =
        entries.stream()
            .filter(h -> "STATUS_CHANGED".equals(h.type()))
            .flatMap(h -> Stream.of(h.fromStatusId(), h.toStatusId()))
            .filter(Objects::nonNull)
            .collect(Collectors.toSet());
    Map<Long, ProjectStatusRow> statuses =
        statusRepository.findByIds(statusIds).stream()
            .filter(st -> st.projectId().equals(project.id()))
            .collect(Collectors.toMap(ProjectStatusRow::id, st -> st));
    // 유형 묶음 조회(findByIds)는 프로젝트를 싣지 않아, 이 프로젝트 유형 전부(몇 개 안 된다)를 한 번 읽어 소속 판정을 겸한다.
    Map<Long, IssueTypeSummary> types =
        entries.stream().noneMatch(h -> "TYPE_CHANGED".equals(h.type()))
            ? Map.of()
            : typeRepository.findByProject(project.id()).stream()
                .collect(
                    Collectors.toMap(
                        IssueTypeRow::id,
                        t -> new IssueTypeSummary(t.id(), t.name(), t.colorToken(), t.icon())));
    List<AddedRemovedNames> labelNames =
        entries.stream()
            .map(
                h ->
                    "LABELS_CHANGED".equals(h.type())
                        ? new AddedRemovedNames(
                            LabelService.normalizeNames(h.added()),
                            LabelService.normalizeNames(h.removed()))
                        : null)
            .toList();
    List<String> names =
        labelNames.stream()
            .filter(Objects::nonNull)
            .flatMap(AddedRemovedNames::all)
            .distinct()
            .toList();
    Map<String, LabelRow> labels =
        labelRepository.findByProjectAndNames(project.id(), names).stream()
            .collect(Collectors.toMap(LabelRow::name, l -> l));
    List<String> missing = names.stream().filter(n -> !labels.containsKey(n)).toList();
    if (!missing.isEmpty()) throw IssueImportException.unknownLabels(missing);
    // 구성요소 이력 — 이름은 라벨처럼 정리해 항목 순서대로 두고, 프로젝트에 없는 이름은 전부 모아 400 (이력에서도 구성요소를 만들지 않는다).
    List<AddedRemovedNames> componentNames =
        entries.stream()
            .map(
                h ->
                    "COMPONENTS_CHANGED".equals(h.type())
                        ? new AddedRemovedNames(
                            normalizeComponentNames(h.added()),
                            normalizeComponentNames(h.removed()))
                        : null)
            .toList();
    Map<String, ComponentRow> components =
        findComponents(
            project,
            componentNames.stream()
                .filter(Objects::nonNull)
                .flatMap(AddedRemovedNames::all)
                .distinct()
                .toList());
    return new HistoryLookups(statuses, types, labelNames, labels, componentNames, components);
  }

  /** 이력 한 건 검증 — 유형별 규칙(설계 표)대로 값을 해석하고, 통과하면 넣는 동작을 돌려준다. */
  private Runnable prepareHistory(
      int index,
      ImportIssueRequest.HistoryEntry h,
      long issueId,
      Map<String, UserSummary> users,
      HistoryLookups lookups) {
    long actorId = users.get(h.actor()).id();
    OffsetDateTime at = h.at();
    String type = h.type();
    switch (type) {
      case "ASSIGNEES_CHANGED" -> {
        List<UserSummary> added = summaries(users, h.added());
        List<UserSummary> removed = summaries(users, h.removed());
        requireChange(index, added.isEmpty() && removed.isEmpty());
        return () -> historyRecorder.recordAssigneesChanged(actorId, issueId, added, removed, at);
      }
      case "LABELS_CHANGED" -> {
        AddedRemovedNames names = lookups.labelNames().get(index);
        List<LabelSummary> added = labelSummaries(lookups.labels(), names.added());
        List<LabelSummary> removed = labelSummaries(lookups.labels(), names.removed());
        requireChange(index, added.isEmpty() && removed.isEmpty());
        return () -> historyRecorder.recordLabelsChanged(actorId, issueId, added, removed, at);
      }
      case "COMPONENTS_CHANGED" -> {
        // 당시 이름은 프로젝트에 있는 구성요소의 이름(대소문자는 저장된 표기)으로 남긴다. 보관된 것도 지난 기록이라 허용.
        AddedRemovedNames names = lookups.componentNames().get(index);
        List<ComponentSummary> added = componentSummaries(lookups.components(), names.added());
        List<ComponentSummary> removed = componentSummaries(lookups.components(), names.removed());
        requireChange(index, added.isEmpty() && removed.isEmpty());
        return () -> historyRecorder.recordComponentsChanged(actorId, issueId, added, removed, at);
      }
      case "TYPE_CHANGED" -> {
        IssueTypeSummary from = typeSummary(index, lookups.types(), h.fromTypeId());
        IssueTypeSummary to = typeSummary(index, lookups.types(), h.toTypeId());
        requireDifferent(index, Objects.equals(h.fromTypeId(), h.toTypeId()));
        return () -> historyRecorder.recordTypeChanged(actorId, issueId, from, to, at);
      }
      default -> {
        // 단순 값 이력(상태·우선순위·제목·일정)은 (이전, 이후) 문자열 한 쌍으로 같은 방식으로 넣는다.
        ValueChange v = valueChange(index, h, lookups.statuses());
        return () ->
            historyRecorder.recordImportedValue(issueId, actorId, type, v.from(), v.to(), at);
      }
    }
  }

  /** 단순 값 이력의 저장 값 — 일반 변경({@link IssueHistoryRecorder#recordChanges})이 남기는 from/to 와 같은 문자열. */
  private record ValueChange(String from, String to) {}

  /** 상태·우선순위·제목·일정 이력을 검증해 저장할 (이전, 이후) 값으로. 그 밖의 유형은 지원하지 않는다(400). */
  private static ValueChange valueChange(
      int index, ImportIssueRequest.HistoryEntry h, Map<Long, ProjectStatusRow> statuses) {
    switch (h.type()) {
      case "STATUS_CHANGED" -> {
        // 값은 그 상태의 지금 이름 — 원본의 당시 이름이 아니라 id 로 받아 한 상태가 둘로 쪼개지지 않게 한다. from 은 첫 전이라 없을 수 있다.
        if (h.toStatusId() == null)
          throw IssueImportException.invalidHistory(index, "toStatusId 가 필요합니다");
        String to = statusName(index, statuses, h.toStatusId());
        String from =
            h.fromStatusId() == null ? null : statusName(index, statuses, h.fromStatusId());
        requireDifferent(index, Objects.equals(h.fromStatusId(), h.toStatusId()));
        return new ValueChange(from, to);
      }
      case "PRIORITY_CHANGED" -> {
        if (h.to() == null) throw IssueImportException.invalidHistory(index, "to 가 필요합니다");
        requirePriority(index, h.to());
        if (h.from() != null) requirePriority(index, h.from());
        requireDifferent(index, Objects.equals(h.from(), h.to()));
        return new ValueChange(h.from(), h.to());
      }
      case "TITLE_CHANGED" -> {
        if (h.to() == null || h.to().isBlank()) {
          throw IssueImportException.invalidHistory(index, "to 가 필요합니다");
        }
        requireDifferent(index, Objects.equals(h.from(), h.to()));
        return new ValueChange(h.from(), h.to());
      }
      case "DUE_DATE_CHANGED", "START_DATE_CHANGED" -> {
        String from = date(index, h.from());
        String to = date(index, h.to());
        requireDifferent(index, Objects.equals(from, to));
        return new ValueChange(from, to);
      }
      default -> throw IssueImportException.invalidHistory(index, "지원하지 않는 이력 유형입니다: " + h.type());
    }
  }

  private static String statusName(int index, Map<Long, ProjectStatusRow> statuses, Long id) {
    ProjectStatusRow s = statuses.get(id);
    if (s == null) {
      throw IssueImportException.invalidHistory(index, "이 프로젝트의 상태가 아닙니다: " + id);
    }
    return s.name();
  }

  private static void requirePriority(int index, String code) {
    if (!IssuePriorities.ORDER.contains(code)) {
      throw IssueImportException.invalidHistory(index, "알 수 없는 우선순위입니다: " + code);
    }
  }

  /** YYYY-MM-DD 검증 — null 은 그대로(날짜를 비움), 형식이 틀리면 400. */
  private static String date(int index, String raw) {
    if (raw == null) return null;
    try {
      return LocalDate.parse(raw).toString();
    } catch (DateTimeParseException e) {
      throw IssueImportException.invalidHistory(index, "날짜 형식이 올바르지 않습니다(YYYY-MM-DD): " + raw);
    }
  }

  /** 담당자 이력의 username 목록 → 사람 요약(요청 시작에서 이미 해석됨). */
  private static List<UserSummary> summaries(Map<String, UserSummary> users, List<String> names) {
    if (names == null) return List.of();
    return names.stream().map(users::get).toList();
  }

  /** 라벨 이력의 정리된 이름 목록 → 라벨 요약(이름은 검증 단계에서 모두 있음을 확인했다). */
  private static List<LabelSummary> labelSummaries(
      Map<String, LabelRow> labels, List<String> names) {
    return names.stream()
        .map(labels::get)
        .map(l -> new LabelSummary(l.id(), l.name(), l.colorToken()))
        .toList();
  }

  /**
   * 구성요소 이름 정리 — 저장 이름과 같은 한 줄 정규화({@link SingleLineTitles#normalize})를 거쳐 빈 값을 버리며, 대소문자만 다른 중복은
   * 먼저 나온 표기 하나로 합친다. 구성요소 이름이 프로젝트 안에서 대소문자 무시로 유일하기 때문에 같은 구성요소를 두 번 붙이려는 요청이 연결 테이블 중복 위반(500)이
   * 되지 않게 한다.
   */
  private static List<String> normalizeComponentNames(List<String> raw) {
    if (raw == null) return List.of();
    Map<String, String> byLower = new LinkedHashMap<>();
    for (String n : raw) {
      if (n == null) continue;
      // 저장된 이름과 같은 규칙(NFC·양방향 제어 문자 제거·줄바꿈→공백·앞뒤 보이지 않는 문자 제거)으로 맞춘다 — 분해형 한글이나 끝에 줄바꿈이 붙은 이름도 찾게.
      String trimmed = SingleLineTitles.normalize(n);
      if (!trimmed.isEmpty()) byLower.putIfAbsent(trimmed.toLowerCase(Locale.ROOT), trimmed);
    }
    return List.copyOf(byLower.values());
  }

  /**
   * 정리된 이름들을 프로젝트의 구성요소(보관 포함)로 찾아 소문자 이름 → 행으로 돌려준다. 하나라도 없으면 없는 이름을 전부 모아 400 — 이슈를 쓰기 전에 거절하려고
   * 호출부가 먼저 부른다.
   */
  private Map<String, ComponentRow> findComponents(ProjectRow project, List<String> names) {
    if (names.isEmpty()) return Map.of();
    Map<String, ComponentRow> found =
        componentRepository.findByNamesIgnoreCase(project.id(), names).stream()
            .collect(Collectors.toMap(c -> c.name().toLowerCase(Locale.ROOT), c -> c));
    List<String> missing =
        names.stream().filter(n -> !found.containsKey(n.toLowerCase(Locale.ROOT))).toList();
    if (!missing.isEmpty()) throw IssueImportException.unknownComponents(missing);
    return found;
  }

  /** 요청의 componentNames → 연결할 구성요소 id(요청 순서, 중복 합침). 없으면 빈 목록. */
  private List<Long> resolveComponentIds(ProjectRow project, List<String> rawNames) {
    List<String> names = normalizeComponentNames(rawNames);
    Map<String, ComponentRow> found = findComponents(project, names);
    return names.stream().map(n -> found.get(n.toLowerCase(Locale.ROOT)).id()).toList();
  }

  /** 구성요소 이력의 정리된 이름 → 요약(이름은 검증 단계에서 모두 있음을 확인했다). */
  private static List<ComponentSummary> componentSummaries(
      Map<String, ComponentRow> components, List<String> names) {
    return names.stream()
        .map(n -> components.get(n.toLowerCase(Locale.ROOT)))
        .map(c -> new ComponentSummary(c.id(), c.name(), c.archived()))
        .toList();
  }

  /** 유형 이력의 유형 id → 요약. 없거나 이 프로젝트 유형이 아니면 400(미리 읽은 표는 이 프로젝트 유형뿐이다). */
  private static IssueTypeSummary typeSummary(
      int index, Map<Long, IssueTypeSummary> types, Long typeId) {
    if (typeId == null) throw IssueImportException.invalidHistory(index, "유형 id 가 필요합니다");
    IssueTypeSummary t = types.get(typeId);
    if (t == null) {
      throw IssueImportException.invalidHistory(index, "이 프로젝트의 유형이 아닙니다: " + typeId);
    }
    return t;
  }

  /** 이전 값과 이후 값이 같으면 바뀐 게 없다 — 활동 목록에 의미 없는 행이 남지 않게 입력 오류로 알린다. */
  private static void requireDifferent(int index, boolean same) {
    if (same) throw IssueImportException.invalidHistory(index, "from 과 to 가 같아 변경이 없습니다");
  }

  /** 추가·제거가 모두 비면 기록할 변경이 없다 — 기록기가 조용히 건너뛰므로 입력 오류로 알린다. */
  private static void requireChange(int index, boolean empty) {
    if (empty) throw IssueImportException.invalidHistory(index, "added 또는 removed 가 필요합니다");
  }

  /**
   * 외부 링크 요청 → 유형·방향·주소를 푼 줄. 유형은 코드(기본 유형)나 이름으로 찾고(없으면 400), 방향은 {@code source}·{@code target}(그
   * 밖은 400), 주소는 http/https 만(아니면 400)이다. 같은 요청 안의 같은 주소 줄은 유형·방향이 같으면 삽입 단계가 건너뛰고, 다르면 400 으로
   * 거절한다.
   */
  private List<ResolvedExternalLink> resolveExternalLinks(
      List<ImportIssueRequest.ExternalLink> links) {
    if (links == null || links.isEmpty()) return List.of();
    List<ResolvedExternalLink> resolved = new ArrayList<>();
    for (ImportIssueRequest.ExternalLink l : links) {
      IssueRelationTypeRow type =
          relationTypeService
              .resolveByCodeOrName(l.type())
              .orElseThrow(() -> IssueImportException.unknownRelationType(l.type()));
      boolean issueIsSource = IssueRelationService.parseSide(l.side());
      // 이슈 INSERT 전에 걸러 가져오기 오류(errors.reason)로 알린다 — 삽입 단계의 같은 검사는 일반 API 용 방어로 남는다.
      if (!IssueRelationService.isSideAllowed(type, issueIsSource)) {
        throw IssueImportException.relationSideNotAllowed(l.type());
      }
      String url = IssueExternalLinkService.normalizeUrl(l.url());
      // 같은 주소가 다른 유형·방향이면 모호하다 — 이슈 INSERT 전에 400. 유형·방향까지 같은 줄은 삽입 단계가 건너뛴다.
      for (ResolvedExternalLink prev : resolved) {
        if (prev.url().equals(url)
            && (prev.typeId() != type.id() || prev.issueIsSource() != issueIsSource)) {
          throw IssueImportException.duplicateExternalLink(url);
        }
      }
      resolved.add(new ResolvedExternalLink(type.id(), issueIsSource, url, l.key(), l.title()));
    }
    return resolved;
  }

  /** 가져오기 요청을 일반 생성 요청 모양으로 — 검증(planCreate)을 공유하려는 것. 첨부는 가져오기가 원 첨부자·시각으로 따로 넣으므로 비운다. */
  private static CreateIssueRequest toCreateRequest(
      ImportIssueRequest req, List<Long> assigneeIds, List<Long> componentIds) {
    return new CreateIssueRequest(
        req.title(),
        req.body(),
        req.priority(),
        req.dueDate(),
        assigneeIds,
        req.typeId(),
        req.parentNumber(),
        req.startDate(),
        req.labelIds(),
        req.milestoneId(),
        req.cycleIds(),
        req.labelNames(),
        null,
        req.status(),
        req.statusId(),
        componentIds);
  }

  /**
   * 원본 시각의 순서 검증 — 수정은 생성 이후, 댓글 수정은 작성 이후, 댓글·첨부·이력은 이슈 생성 이후여야 한다(아니면 400). 종료 시각은 상태 범주가 정해져야 볼
   * 수 있어 {@link #resolveClosedAt} 이 같은 규칙 도구(requireNotBefore)로 따로 본다 — 사용자·생성 검증과의 오류 우선순위를 그대로
   * 두려고 호출 위치도 예전과 같다.
   */
  private static void validateTimes(ImportIssueRequest req) {
    OffsetDateTime createdAt = req.createdAt();
    requireNotBefore(updatedAtOf(req), createdAt, "수정 시각이 생성 시각보다 이릅니다");
    for (ImportIssueRequest.Comment c : orEmpty(req.comments())) {
      if (c.updatedAt() != null) {
        requireNotBefore(c.updatedAt(), c.createdAt(), "댓글 수정 시각이 작성 시각보다 이릅니다");
      }
      requireNotBefore(c.createdAt(), createdAt, "댓글 작성 시각이 이슈 생성 시각보다 이릅니다");
    }
    for (ImportIssueRequest.Attachment a : orEmpty(req.attachments())) {
      requireNotBefore(a.attachedAt(), createdAt, "첨부 시각이 이슈 생성 시각보다 이릅니다");
    }
    for (ImportIssueRequest.HistoryEntry h : orEmpty(req.history())) {
      requireNotBefore(h.at(), createdAt, "이력 시각이 이슈 생성 시각보다 이릅니다");
    }
  }

  /** 종료 시각 해석 — 종료 범주(완료·취소) 상태일 때만 받고, 없으면 수정 시각. 종료가 아닌데 주거나 생성 시각보다 이르면 400. 종료가 아니면 null. */
  private static OffsetDateTime resolveClosedAt(ImportIssueRequest req, String statusCategory) {
    if (!IssueStatuses.isClosed(statusCategory)) {
      if (req.closedAt() != null) {
        throw IssueImportException.invalidTimes("종료 상태가 아닌 이슈에는 종료 시각을 줄 수 없습니다");
      }
      return null;
    }
    OffsetDateTime updatedAt = updatedAtOf(req);
    OffsetDateTime closedAt = req.closedAt() != null ? req.closedAt() : updatedAt;
    requireNotBefore(closedAt, req.createdAt(), "종료 시각이 생성 시각보다 이릅니다");
    // 종료도 변경이라 수정 시각은 종료 시각 이후여야 한다(수정이 더 이르면 목록 정렬·갱신 시각이 어긋난다).
    requireNotBefore(updatedAt, closedAt, "종료 시각이 수정 시각보다 늦습니다");
    return closedAt;
  }

  /** time 이 floor 보다 이르면 시각 오류(400) — 같은 시각은 허용한다. */
  private static void requireNotBefore(OffsetDateTime time, OffsetDateTime floor, String message) {
    if (time.isBefore(floor)) throw IssueImportException.invalidTimes(message);
  }

  /** 수정 시각 — 없으면 생성 시각. */
  private static OffsetDateTime updatedAtOf(ImportIssueRequest req) {
    return req.updatedAt() != null ? req.updatedAt() : req.createdAt();
  }

  private static <T> List<T> orEmpty(List<T> list) {
    return list == null ? List.of() : list;
  }

  /**
   * 이슈 번호를 정하며 프로젝트 번호 시퀀스 행을 잠근다 — 지정했으면 시퀀스를 그 다음 번호 이상으로 올리고(이후 일반 생성과 겹치지 않게), 지정하지 않으면 평소처럼 다음
   * 번호를 받는다. 어느 쪽이든 시퀀스 행 갱신이 같은 프로젝트의 진행 중 발급(커밋 전 가져오기 포함)을 기다리므로, 이 뒤의 존재 확인(원본 키·번호)은 그 결과까지
   * 본다. 지정 번호의 중복 확인은 호출자가 원본 키 확인 뒤에 한다.
   */
  private int lockNumber(ProjectRow project, Integer requested) {
    if (requested == null) return sequenceRepository.allocateNext(project.id());
    sequenceRepository.raiseTo(project.id(), requested + 1);
    return requested;
  }

  /** 같은 원본 키로 이미 가져온 이슈가 있으면 409. 원본 키가 없으면 보지 않는다. */
  private void requireSourceKeyFree(ProjectRow project, String sourceKey) {
    if (sourceKey != null && issueRepository.existsImportSourceKey(project.id(), sourceKey)) {
      throw IssueImportException.sourceKeyTaken(sourceKey);
    }
  }

  /**
   * 이슈 행 INSERT(가져오기 표시 포함) — 같은 번호나 같은 원본 키를 동시에 가져오면 고유 제약이 막으므로 그 경합도 409 로 돌려준다(500 대신). 트랜잭션이
   * 이미 중단돼 다시 조회할 수 없어, 어느 제약에 걸렸는지는 DB 가 알려 준 제약 이름으로 가른다.
   */
  private IssueRow insertIssue(
      CreateIssuePlan plan,
      int number,
      CreateIssueRequest req,
      long reporterId,
      IssueRepository.ImportMarks marks) {
    try {
      return issueService.insertFromPlan(plan, number, req, reporterId, marks);
    } catch (DuplicateKeyException e) {
      if (SOURCE_KEY_CONSTRAINT.equals(violatedConstraint(e))) {
        throw IssueImportException.sourceKeyTaken(marks.sourceKey());
      }
      // 이 INSERT 에서 걸릴 다른 고유 제약은 (프로젝트, 번호)뿐이다.
      throw IssueImportException.numberTaken(number);
    }
  }

  /** 고유 제약 위반의 제약 이름(PostgreSQL 이 알려 준 값) — 알 수 없으면 null. */
  private static String violatedConstraint(DuplicateKeyException e) {
    return e.getMostSpecificCause() instanceof PSQLException p && p.getServerErrorMessage() != null
        ? p.getServerErrorMessage().getConstraint()
        : null;
  }

  /** username 목록 → 해석된 사용자 id(중복 제거, 순서 유지). 목록이 없으면 빈 목록. */
  private static List<Long> idsOf(Map<String, UserSummary> users, List<String> usernames) {
    if (usernames == null) return List.of();
    var ids = new LinkedHashSet<Long>();
    for (String name : usernames) ids.add(users.get(name).id());
    return List.copyOf(ids);
  }

  /** 감사 로그 메타데이터 — 원본 키(없으면 null)·보고자·딸린 항목 개수. Map.of 는 null 값을 받지 않아 순서 있는 맵으로 만든다. */
  private static Map<String, Object> auditMetadata(ImportIssueRequest req, String sourceKey) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("sourceKey", sourceKey);
    m.put("reporter", req.reporter());
    m.put("comments", sizeOf(req.comments()));
    m.put("attachments", sizeOf(req.attachments()));
    m.put("history", sizeOf(req.history()));
    m.put("externalLinks", sizeOf(req.externalLinks()));
    return m;
  }

  /** 원본 키 정리 — 공백만 있으면 없는 것으로 본다(빈 문자열이 고유 키로 저장돼 두 번째 가져오기를 막지 않게). */
  private static String normalizeSourceKey(String raw) {
    return raw == null || raw.isBlank() ? null : raw.trim();
  }

  private static int sizeOf(List<?> list) {
    return list == null ? 0 : list.size();
  }
}
