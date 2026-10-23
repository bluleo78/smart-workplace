package com.workplace.issue.service;

import com.workplace.cycle.dto.CycleRow;
import com.workplace.cycle.repository.CycleRepository;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.IssueStatuses;
import com.workplace.issue.dto.IssueTypeRow;
import com.workplace.issue.dto.ProjectStatusRow;
import com.workplace.issue.exception.InvalidIssueFilterException;
import com.workplace.issue.repository.IssueTypeRepository;
import com.workplace.issue.repository.ProjectStatusRepository;
import com.workplace.label.dto.LabelRow;
import com.workplace.label.repository.LabelRepository;
import com.workplace.member.repository.MemberDirectoryRepository;
import com.workplace.milestone.dto.MilestoneRow;
import com.workplace.milestone.repository.MilestoneRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.BiPredicate;
import java.util.function.Function;
import java.util.function.Supplier;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 이슈 검색 필터의 사람 친화 토큰(라벨·유형·마일스톤·사이클 이름, username)을 숫자 id 로 해석한다(#841).
 *
 * <p>웹 UI 는 숫자 id 를 보내지만 AI 도구는 쓰기 도구와 같은 어휘(이름·username)로 필터를 건다. 예전에는 숫자가 아닌 토큰을 조용히 버려 "필터가 빠진
 * 결과"를 정답처럼 돌려줬으므로, 여기서 이름을 해석하고 해석 불가 값은 {@link InvalidIssueFilterException}(400)으로 거부한다. 숫자 토큰은
 * 기존 UI 호환을 위해 그대로 통과한다(존재 검증 없음 — 없는 id 는 빈 결과).
 *
 * <p>이름 해석 스코프: 단일 프로젝트 검색이면 그 프로젝트, 횡단 검색이면 호출자가 멤버인 프로젝트 전체. 후보 조회는 이름 토큰이 있을 때만 수행해 UI 의 일반 경로에
 * 쿼리를 더하지 않는다.
 */
@Component
@RequiredArgsConstructor
class IssueFilterResolver {

  /** 해석 실패 메시지에 나열할 사용 가능 값 상한 — 라벨이 많은 테넌트에서 메시지가 비대해지지 않게. */
  private static final int MAX_LISTED = 30;

  private final MemberDirectoryRepository memberDirectoryRepository;
  private final LabelRepository labelRepository;
  private final IssueTypeRepository typeRepository;
  private final MilestoneRepository milestoneRepository;
  private final CycleRepository cycleRepository;
  private final ProjectStatusRepository projectStatusRepository;

  /**
   * 담당자·작성자 토큰 → userId. "me" 는 호출자, 숫자는 그대로, 그 외는 현재 테넌트 구성원 username(대소문자 무시). "null"(미지정) 리터럴은
   * 필드마다 의미가 달라 호출측이 먼저 걸러낸다.
   */
  List<Long> resolveUsers(String field, List<String> tokens, Long callerId) {
    List<Long> ids = new ArrayList<>();
    List<String> usernames = new ArrayList<>();
    for (String tok : tokens) {
      if ("me".equalsIgnoreCase(tok)) {
        ids.add(callerId);
      } else {
        Long numeric = parseLongOrNull(tok);
        if (numeric != null) ids.add(numeric);
        else usernames.add(tok);
      }
    }
    if (usernames.isEmpty()) return ids;
    List<Map.Entry<String, Long>> found =
        memberDirectoryRepository.findByUsernamesIgnoreCase(TenantContext.require(), usernames);
    for (String u : usernames) {
      ids.add(pickUser(field, u, found));
    }
    return ids;
  }

  /**
   * 정확히 일치하는 username 을 우선하고, 없으면 대소문자 무시 일치가 하나일 때만 채택한다. username UNIQUE 가 대소문자를 구분해 "Kim"·"kim"
   * 이 공존할 수 있으므로, 여럿이면 임의로 고르지 않고 후보를 담아 400 으로 되묻는다.
   */
  private static Long pickUser(String field, String username, List<Map.Entry<String, Long>> found) {
    for (Map.Entry<String, Long> e : found) {
      if (e.getKey().equals(username)) return e.getValue();
    }
    List<Map.Entry<String, Long>> matches =
        found.stream().filter(e -> e.getKey().equalsIgnoreCase(username)).toList();
    if (matches.size() == 1) return matches.get(0).getValue();
    if (matches.isEmpty()) {
      throw new InvalidIssueFilterException(
          field, "구성원 username '" + username + "' 을(를) 찾을 수 없습니다. 표시 이름이 아닌 username 으로 지정하세요.");
    }
    throw new InvalidIssueFilterException(
        field,
        "username '"
            + username
            + "' 이(가) 대소문자만 다른 여러 구성원과 일치합니다. 정확한 username 을 지정하세요: "
            + String.join(", ", matches.stream().map(Map.Entry::getKey).toList()));
  }

  /** 라벨 토큰 → 토큰별 id 그룹. 이름 하나가 횡단 스코프에서 여러 프로젝트의 동명 라벨로 풀릴 수 있어 그룹(OR)으로 반환한다. */
  List<List<Long>> resolveLabelGroups(List<String> tokens, Long projectId, Long callerId) {
    Supplier<List<LabelRow>> candidates =
        () ->
            projectId != null
                ? labelRepository.findByProject(projectId)
                : labelRepository.findByMemberProjects(callerId);
    return resolveByName("label", "라벨", tokens, candidates, LabelRow::name, LabelRow::id);
  }

  /** 유형 토큰 → id 목록(유형 필터는 전체가 OR 이라 그룹을 평탄화). */
  List<Long> resolveTypeIds(List<String> tokens, Long projectId, Long callerId) {
    Supplier<List<IssueTypeRow>> candidates =
        () ->
            projectId != null
                ? typeRepository.findByProject(projectId)
                : typeRepository.findByMemberProjects(callerId);
    return flatten(
        resolveByName("type", "유형", tokens, candidates, IssueTypeRow::name, IssueTypeRow::id));
  }

  /** 마일스톤 토큰 → id 목록(OR). 예전엔 숫자가 아닌 토큰을 버려 필터 없는 전체 목록을 돌려줬다(WP-735). */
  List<Long> resolveMilestoneIds(List<String> tokens, Long projectId, Long callerId) {
    Supplier<List<MilestoneRow>> candidates =
        () ->
            projectId != null
                ? milestoneRepository.findByProject(projectId)
                : milestoneRepository.findByMemberProjects(callerId);
    return flatten(
        resolveByName(
            "milestone", "마일스톤", tokens, candidates, MilestoneRow::name, MilestoneRow::id));
  }

  /** 사이클 토큰 → id 목록(OR). 약속된 토큰(null·none)은 호출측이 먼저 걸러낸다(WP-735). */
  List<Long> resolveCycleIds(List<String> tokens, Long projectId, Long callerId) {
    Supplier<List<CycleRow>> candidates =
        () ->
            projectId != null
                ? cycleRepository.findByProject(projectId)
                : cycleRepository.findByMemberProjects(callerId);
    return flatten(resolveByName("cycle", "사이클", tokens, candidates, CycleRow::name, CycleRow::id));
  }

  /**
   * 개별 상태 필터(WP-807) → 프로젝트 상태 id 합집합. statusId 토큰은 숫자만 받고(아니면 400, 없는 id 는 빈 결과), statusName 토큰은
   * 범위 안 상태 중 이름이 서버 이름 규칙({@link IssueStatuses#statusNameKey}: 앞뒤 공백·대소문자 무시)으로 같은 것을 모두 고른다 — CSV
   * 파싱의 trim 이 못 지우는 전각 공백도 무시하고, 중복 판정과 같은 규칙이라 「같은 이름」의 뜻이 어긋나지 않는다. 횡단 검색이면 여러 프로젝트의 같은 이름 상태가
   * 함께 풀린다. 이름 하나라도 못 찾으면 범위 안 상태 이름을 담아 400. 범위는 단일 프로젝트 검색이면 그 프로젝트, 횡단 검색이면 호출자가 멤버인 프로젝트 전체이고,
   * 후보는 한 번만 읽는다.
   */
  List<Long> resolveStatusIds(
      List<String> idTokens, List<String> nameTokens, Long projectId, Long callerId) {
    List<Long> ids = new ArrayList<>();
    for (String tok : idTokens) {
      Long numeric = parseLongOrNull(tok);
      if (numeric == null) {
        throw new InvalidIssueFilterException(
            "statusId", "statusId '" + tok + "' 은(는) 숫자 상태 id 여야 합니다.");
      }
      ids.add(numeric);
    }
    Supplier<List<ProjectStatusRow>> candidates =
        () ->
            projectId != null
                ? projectStatusRepository.findByProject(projectId)
                : projectStatusRepository.findByMemberProjects(callerId);
    // 이름 토큰은 숫자여도 이름으로 본다(「2025」 같은 상태 이름) — id 는 statusId 로만 받는다.
    ids.addAll(
        flatten(
            resolveByName(
                "statusName",
                "상태",
                nameTokens,
                candidates,
                ProjectStatusRow::name,
                ProjectStatusRow::id,
                false,
                (a, b) -> IssueStatuses.statusNameKey(a).equals(IssueStatuses.statusNameKey(b)))));
    return ids;
  }

  private static List<Long> flatten(List<List<Long>> groups) {
    return groups.stream().flatMap(List::stream).toList();
  }

  /** 숫자 토큰은 단일 그룹, 이름 토큰은 대소문자 무시 동명 후보 전체를 그룹으로. 후보는 이름 토큰을 처음 만날 때 한 번만 조회한다. */
  private static <T> List<List<Long>> resolveByName(
      String field,
      String kind,
      List<String> tokens,
      Supplier<List<T>> candidateSupplier,
      Function<T, String> nameOf,
      Function<T, Long> idOf) {
    return resolveByName(
        field, kind, tokens, candidateSupplier, nameOf, idOf, true, String::equalsIgnoreCase);
  }

  /**
   * {@link #resolveByName} 본체. numericAsId 가 false 면 숫자 토큰도 이름으로 비교한다 — id 를 따로 받는 필터(상태
   * statusName)용. sameName 은 (후보 이름, 토큰) 이 같은 이름인지 — 상태는 서버 이름 규칙으로, 그 밖은 대소문자 무시로 비교한다.
   */
  private static <T> List<List<Long>> resolveByName(
      String field,
      String kind,
      List<String> tokens,
      Supplier<List<T>> candidateSupplier,
      Function<T, String> nameOf,
      Function<T, Long> idOf,
      boolean numericAsId,
      BiPredicate<String, String> sameName) {
    List<List<Long>> groups = new ArrayList<>();
    List<T> candidates = null;
    for (String tok : tokens) {
      Long numeric = numericAsId ? parseLongOrNull(tok) : null;
      if (numeric != null) {
        groups.add(List.of(numeric));
        continue;
      }
      if (candidates == null) candidates = candidateSupplier.get();
      List<Long> ids =
          candidates.stream().filter(c -> sameName.test(nameOf.apply(c), tok)).map(idOf).toList();
      if (ids.isEmpty()) {
        List<String> available =
            candidates.stream().map(nameOf).distinct().limit(MAX_LISTED).toList();
        throw new InvalidIssueFilterException(
            field,
            kind
                + " '"
                + tok
                + "' 을(를) 찾을 수 없습니다. 사용 가능: "
                + (available.isEmpty() ? "(없음)" : String.join(", ", available)));
      }
      groups.add(ids);
    }
    return groups;
  }

  private static Long parseLongOrNull(String tok) {
    try {
      return Long.parseLong(tok);
    } catch (NumberFormatException e) {
      return null;
    }
  }
}
