package com.workplace.issue.service;

import com.workplace.audit.service.AuditLogService;
import com.workplace.global.util.SingleLineTitles;
import com.workplace.issue.domain.IssueRelationBuiltIns;
import com.workplace.issue.dto.IssueRelationTypeAdminResponse;
import com.workplace.issue.dto.IssueRelationTypeResponse;
import com.workplace.issue.dto.IssueRelationTypeRow;
import com.workplace.issue.dto.SaveIssueRelationTypeRequest;
import com.workplace.issue.exception.IssueRelationException;
import com.workplace.issue.repository.IssueRelationTypeRepository;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 이슈 관계 유형(WP-887) 서비스 — 로그인 사용자용 목록, 워크스페이스 관리자용 추가·편집·숨김·삭제, 그리고 관계·외부 링크·가져오기·MCP 가 쓰는 조회({@link
 * #require}, {@link #resolveByCodeOrName}). 권한은 컨트롤러({@code issue_relation_type:manage})가 건다.
 *
 * <p>기본 유형(코드 있음)은 편집·삭제할 수 없고, {@code BLOCKS} 외에는 숨길 수 있다. 사용자 정의 유형은 워크스페이스당 {@value #MAX_CUSTOM}
 * 개까지.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class IssueRelationTypeService {

  /** 워크스페이스당 사용자 정의 유형 상한. */
  static final int MAX_CUSTOM = 50;

  /** 감사 로그 리소스 이름. */
  private static final String AUDIT_RESOURCE = "issue_relation_type";

  private final IssueRelationTypeRepository repo;
  private final AuditLogService auditLogService;
  private final UserRepository userRepository;

  // ── 조회 ────────────────────────────────────────────────────────────────────────────────

  /** 유형 목록(숨김 포함, 정렬값·id 순) — 로그인 사용자 누구나. */
  @Transactional(readOnly = true)
  public List<IssueRelationTypeResponse> list() {
    return repo.findAll().stream().map(IssueRelationTypeResponse::from).toList();
  }

  /**
   * 관리자용 목록 — 유형별 사용 건수(내부 관계·외부 링크)를 더한다. 차단(BLOCKS)의 관계 건수는 저장 위치가 달라 issue_dependency 행 수를 쓴다.
   */
  @Transactional(readOnly = true)
  public List<IssueRelationTypeAdminResponse> listForAdmin() {
    Map<Long, Long> relationCounts = repo.relationCountsByType();
    Map<Long, Long> linkCounts = repo.externalLinkCountsByType();
    long dependencyCount = repo.countDependencies();
    return repo.findAll().stream()
        .map(
            t ->
                IssueRelationTypeAdminResponse.from(
                    t,
                    IssueRelationBuiltIns.BLOCKS.equals(t.code())
                        ? dependencyCount
                        : relationCounts.getOrDefault(t.id(), 0L),
                    linkCounts.getOrDefault(t.id(), 0L)))
        .toList();
  }

  /** id 로 유형을 읽는다 — 없으면 404. 관계·외부 링크 서비스가 쓴다. */
  @Transactional(readOnly = true)
  public IssueRelationTypeRow require(long id) {
    return repo.findById(id).orElseThrow(IssueRelationException::notFound);
  }

  /**
   * 코드(기본 유형, 정확 일치)를 먼저, 그다음 이름(대소문자 무시)으로 유형을 찾는다 — AI·MCP·가져오기가 「RELATES」 같은 코드나 사용자 정의 유형 이름으로
   * 부른다.
   */
  @Transactional(readOnly = true)
  public Optional<IssueRelationTypeRow> resolveByCodeOrName(String codeOrName) {
    // 저장할 때와 같은 규칙으로 다듬어 찾는다(WP-1106) — 「관련」 끝에 제로폭 공백이 붙어 와도 저장된 「관련」을 찾는다.
    String key = SingleLineTitles.normalize(codeOrName);
    if (key == null || key.isEmpty()) {
      return Optional.empty();
    }
    return repo.findByCode(key).or(() -> repo.findByNameIgnoreCase(key));
  }

  // ── 관리 ────────────────────────────────────────────────────────────────────────────────

  /** 사용자 정의 유형 추가 — 이름 중복(기본 유형 이름 포함)·상한 검사. 정렬값은 기본 유형 뒤(1000). */
  public IssueRelationTypeResponse create(long callerId, SaveIssueRelationTypeRequest req) {
    Fields f = normalize(req);
    if (repo.countCustom() >= MAX_CUSTOM) {
      throw IssueRelationException.limit(MAX_CUSTOM);
    }
    assertNameFree(f.name(), 0);
    IssueRelationTypeRow row;
    try {
      row =
          repo.insertCustom(
              callerId,
              f.name(),
              f.directed(),
              f.outwardLabel(),
              f.inwardLabel(),
              IssueRelationBuiltIns.CUSTOM_SORT_ORDER);
    } catch (DuplicateKeyException e) {
      // 동시 요청이 같은 이름을 먼저 넣은 경우 — 사전 검사를 빠져나간 레이스.
      throw IssueRelationException.nameTaken(f.name());
    }
    audit(callerId, "ISSUE_RELATION_TYPE_CREATED", "관계 유형 추가", row.id(), metaOf(row));
    return IssueRelationTypeResponse.from(row);
  }

  /** 사용자 정의 유형 편집 — 이름·말은 언제든, 방향 있음↔없음은 쓰이는 관계(내부+외부)가 0건일 때만. 기본 유형은 400. */
  public IssueRelationTypeResponse update(
      long callerId, long id, SaveIssueRelationTypeRequest req) {
    // 쓰기 잠금 — 같은 순간 관계를 넣는 쪽(FOR SHARE)과 차례를 세운다. 잠그지 않으면 사용 건수 0 을 본 뒤 들어온 관계가 방향만 바뀐 유형에 남는다.
    IssueRelationTypeRow cur =
        repo.findByIdForUpdate(id).orElseThrow(IssueRelationException::notFound);
    if (cur.code() != null) {
      throw IssueRelationException.builtIn();
    }
    Fields f = normalize(req);
    assertNameFree(f.name(), id);
    if (f.directed() != cur.directed() && usageCount(id) > 0) {
      throw IssueRelationException.directionLocked();
    }
    try {
      repo.update(id, f.name(), f.directed(), f.outwardLabel(), f.inwardLabel());
    } catch (DuplicateKeyException e) {
      throw IssueRelationException.nameTaken(f.name());
    }
    IssueRelationTypeRow after = require(id);
    audit(callerId, "ISSUE_RELATION_TYPE_UPDATED", "관계 유형 편집", id, metaOf(after));
    return IssueRelationTypeResponse.from(after);
  }

  /** 숨김 켜고 끄기 — 기본 유형도 되지만 차단(BLOCKS)은 안 된다(블로커 계산이 기대는 유형). */
  public IssueRelationTypeResponse setHidden(long callerId, long id, boolean hidden) {
    // 쓰기 잠금 — 같은 순간의 편집·삭제와 차례를 세운다(update·delete 와 같음).
    IssueRelationTypeRow cur =
        repo.findByIdForUpdate(id).orElseThrow(IssueRelationException::notFound);
    if (IssueRelationBuiltIns.BLOCKS.equals(cur.code())) {
      throw IssueRelationException.blocksLocked();
    }
    repo.setHidden(id, hidden);
    IssueRelationTypeRow after = require(id);
    Map<String, Object> meta = metaOf(after);
    meta.put("hidden", hidden);
    audit(callerId, "ISSUE_RELATION_TYPE_HIDDEN", hidden ? "관계 유형 숨김" : "관계 유형 숨김 해제", id, meta);
    return IssueRelationTypeResponse.from(after);
  }

  /**
   * 사용자 정의 유형 삭제. 쓰이는 관계가 없으면 그냥 지우고, 있으면 {@code moveTo}(다른 유형으로 옮기기)나 {@code deleteLinks}(관계도 함께
   * 삭제) 중 하나가 있어야 한다. 옮기기·삭제와 유형 삭제는 한 트랜잭션이고, 이슈 이력은 남기지 않고 감사 로그 한 줄(건수 포함)만 남긴다.
   *
   * @param moveTo 관계·외부 링크를 옮길 유형 id(없으면 null)
   * @param deleteLinks true 면 관계·외부 링크도 함께 지운다
   */
  public void delete(long callerId, long id, Long moveTo, boolean deleteLinks) {
    // 옮길 대상이 이 유형보다 id 가 작으면 대상을 먼저 공유 잠금한다 — 두 유형을 언제나 id 오름차순으로 잠가, 서로를 옮길 곳으로 고른 엇갈린
    // 삭제(A→B·B→A)가
    // 교착하지 않고 한쪽이 기다렸다가 「대상 유형이 없습니다」 400 을 받게 한다.
    if (moveTo != null && moveTo < id) {
      repo.findByIdForShare(moveTo);
    }
    // 쓰기 잠금 — 같은 순간 관계를 넣는 쪽(FOR SHARE)이 끝나기를 기다렸다가 그 관계까지 세어 옮기거나 지운다(WP-887). 잠그지 않으면 센 뒤 넣은 관계가
    // 유형 삭제의 RESTRICT 에 걸려 500 이 났다.
    IssueRelationTypeRow cur =
        repo.findByIdForUpdate(id).orElseThrow(IssueRelationException::notFound);
    if (cur.code() != null) {
      throw IssueRelationException.builtIn();
    }
    if (moveTo != null && deleteLinks) {
      throw IssueRelationException.badMoveTarget("옮기기와 함께 삭제를 동시에 고를 수 없습니다");
    }
    IssueRelationTypeRow target = moveTo == null ? null : requireMoveTarget(cur, moveTo);

    long relations = repo.countRelations(id);
    long links = repo.countExternalLinks(id);
    long used = relations + links;
    if (used > 0 && target == null && !deleteLinks) {
      throw IssueRelationException.inUse(used);
    }

    long moved = 0;
    long deleted = 0;
    if (target != null) {
      // 실제로 옮겨진 행 수 — 대상에 이미 있는 쌍은 합쳐져 세지 않는다.
      int copied = repo.copyRelations(id, target.id(), target.directed());
      repo.deleteRelations(id);
      int movedLinks = repo.moveExternalLinks(id, target.id(), target.directed());
      moved = (long) copied + movedLinks;
    } else if (deleteLinks) {
      deleted = used;
      repo.deleteRelations(id);
      repo.deleteExternalLinks(id);
    }
    repo.delete(id);

    Map<String, Object> meta = metaOf(cur);
    meta.put("moved", moved);
    meta.put("deleted", deleted);
    if (target != null) {
      meta.put("moveTo", target.id());
    }
    audit(callerId, "ISSUE_RELATION_TYPE_DELETED", "관계 유형 삭제", id, meta);
  }

  // ── 내부 ────────────────────────────────────────────────────────────────────────────────

  /**
   * 옮길 대상 검증 — 없음·자기 자신·차단·외부 전용·숨김은 400. 대상은 공유 잠금(FOR SHARE)으로 읽는다 — 옮기는 동안 대상이 지워지면 옮긴 행이 FK 에
   * 걸려 500 이 난다.
   */
  private IssueRelationTypeRow requireMoveTarget(IssueRelationTypeRow from, long moveTo) {
    if (moveTo == from.id()) {
      throw IssueRelationException.badMoveTarget("자기 자신으로 옮길 수 없습니다");
    }
    IssueRelationTypeRow t =
        repo.findByIdForShare(moveTo)
            .orElseThrow(() -> IssueRelationException.badMoveTarget("대상 유형이 없습니다"));
    if (IssueRelationBuiltIns.BLOCKS.equals(t.code())) {
      throw IssueRelationException.badMoveTarget("차단으로 옮길 수 없습니다");
    }
    if (t.externalOnly()) {
      throw IssueRelationException.badMoveTarget("외부 링크 전용 유형으로 옮길 수 없습니다");
    }
    if (t.hidden()) {
      throw IssueRelationException.badMoveTarget("숨긴 유형으로 옮길 수 없습니다");
    }
    // 방향 없는 관계는 (작은 id, 큰 id) 로 저장돼 A·B 가 정해져 있지 않다 — 방향 있는 유형으로 옮기면 방향이 임의로 생긴다.
    if (!from.directed() && t.directed()) {
      throw IssueRelationException.moveDirection();
    }
    return t;
  }

  private long usageCount(long typeId) {
    return repo.countRelations(typeId) + repo.countExternalLinks(typeId);
  }

  private void assertNameFree(String name, long exceptId) {
    if (repo.existsNameExcept(name, exceptId)) {
      throw IssueRelationException.nameTaken(name);
    }
  }

  /** 저장할 값 — 이름·말은 한 줄 제목처럼 다듬고, 방향 없는 유형은 B 쪽 말을 버린다. */
  private record Fields(String name, boolean directed, String outwardLabel, String inwardLabel) {}

  /**
   * 이름·말을 한 줄 제목 규칙({@link SingleLineTitles#normalize})으로 다듬는다 — 앞뒤의 공백·제로폭 공백·점자 빈칸을 지우고(WP-1106),
   * 그려지는 글자가 없으면 빈 값이 된다. 이름 중복 검사도 이 값으로 해 「관련​」(끝에 제로폭 공백)이 기본 유형 「관련」을 빠져나가지 않는다. 이름·A 쪽 말이 비는
   * 경우는 요청 검증({@code @VisibleText})이 먼저 막고, B 쪽 말은 방향 있는 유형에서만 여기서 막는다.
   */
  private Fields normalize(SaveIssueRelationTypeRequest req) {
    String inward = Objects.requireNonNullElse(SingleLineTitles.normalize(req.inwardLabel()), "");
    if (req.directed() && inward.isEmpty()) {
      throw IssueRelationException.inwardLabelRequired();
    }
    return new Fields(
        SingleLineTitles.normalize(req.name()),
        req.directed(),
        SingleLineTitles.normalize(req.outwardLabel()),
        req.directed() ? inward : null);
  }

  private Map<String, Object> metaOf(IssueRelationTypeRow t) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("typeId", t.id());
    m.put("name", t.name());
    m.put("directed", t.directed());
    return m;
  }

  /** 감사 로그 한 줄 — 행위자 이름은 사용자 테이블에서 읽는다. */
  private void audit(
      long callerId, String actionType, String description, long typeId, Map<String, Object> meta) {
    String username =
        userRepository.findById(callerId).map(UserResponse::username).orElse("system");
    auditLogService.log(
        callerId,
        username,
        actionType,
        AUDIT_RESOURCE,
        String.valueOf(typeId),
        description,
        null,
        null,
        "SUCCESS",
        null,
        meta);
  }
}
