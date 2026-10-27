package com.workplace.issue.dto;

import java.util.List;
import java.util.Map;

/**
 * 부모 에픽 외부 링크 일괄 변환(WP-1038) 결과 — 판정별 건수와 줄별 결과. dryRun 이면 CONVERT 는 「바꿀 수 있음」이고 아무것도 쓰지 않았다.
 *
 * @param dryRun 판정만 했는지
 * @param scanned 본 링크 수(limit 이하)
 * @param counts 판정 → 건수(판정 순서대로, 0 건도 싣는다)
 * @param rows 링크마다 한 줄(링크 id 순)
 * @param nextAfterLinkId 뒤에 볼 링크가 더 있으면 이번에 본 마지막 링크 id — 다음 요청의 afterLinkId 로 넘긴다. 더 없으면 null
 */
public record ConvertParentEpicLinksResponse(
    boolean dryRun,
    int scanned,
    Map<Outcome, Integer> counts,
    List<Row> rows,
    Long nextAfterLinkId) {

  /**
   * 링크 한 줄의 판정.
   *
   * <ul>
   *   <li>CONVERT — 부모로 붙였다(dryRun 이면 붙일 수 있다). 링크는 지운다
   *   <li>SKIP_HAS_PARENT — 자식에 이미 부모가 있다(링크는 그대로 둔다)
   *   <li>NOT_FOUND — 원본 키·Works 키 어느 쪽으로도 에픽을 찾지 못했다(이관되지 않았거나 지워짐), 에픽 프로젝트를 호출자가 읽을 수 없다(남의 개인
   *       프로젝트 등 — 일반 부모 지정과 같다), 또는 그사이 자식·자식 프로젝트가 지워졌다(childKey 없음)
   *   <li>AMBIGUOUS — 같은 원본 키로 가져온 이슈가 여럿이다
   *   <li>NOT_EPIC — 찾은 이슈가 에픽이 아니다
   *   <li>PERSONAL — 자식이나 에픽이 개인 프로젝트에 있고 둘이 다른 프로젝트다
   *   <li>SUBTASK — 자식이 하위 태스크다(하위 태스크는 에픽을 부모로 둘 수 없다)
   *   <li>EPIC_CHILD — 자식이 에픽이다(에픽은 부모를 가질 수 없다)
   *   <li>DONE_EPIC_OPEN_CHILD — 완료된 에픽 아래에 미완료 자식을 넣게 된다
   *   <li>CHANGED — 판정 뒤 쓰기 전에 바뀌었다(자식이 지워졌거나, 에픽이 완료·삭제됐거나, 에픽 프로젝트가 지워짐 등) — 쓰지 않고 링크도 남긴다. 다시
   *       돌리면 바뀐 상태로 다시 판정한다
   * </ul>
   */
  public enum Outcome {
    CONVERT,
    SKIP_HAS_PARENT,
    NOT_FOUND,
    AMBIGUOUS,
    NOT_EPIC,
    PERSONAL,
    SUBTASK,
    EPIC_CHILD,
    DONE_EPIC_OPEN_CHILD,
    CHANGED
  }

  /**
   * 줄별 결과.
   *
   * @param linkId 외부 링크 id
   * @param childKey 링크가 달린 이슈(자식) 키 — 그사이 지워졌으면 null
   * @param extKey 링크가 가리키는 원본 키(링크의 키, 없으면 주소의 마지막 경로)
   * @param outcome 판정
   * @param parentKey 찾은 에픽의 Works 키 — 찾지 못했거나 모호하면 null
   */
  public record Row(
      long linkId, String childKey, String extKey, Outcome outcome, String parentKey) {}
}
