package com.workplace.wiki.dto;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.util.List;

/**
 * 동기화 서버 문서 저장 요청(WP-286).
 *
 * <p>두 가지 저장이 있다.
 *
 * <ul>
 *   <li><b>파생 저장</b>(body 있음) — 실제 편집 뒤의 저장. body 를 wiki_page.body 로 파생 저장하고 version 을 올린다.
 *   <li><b>상태만 저장</b>(body 없음, bodyVersion 있음) — 편집 없이 저장된 body 로 만든 상태(최초 이관·body 앞섬 반영).
 *       body·version· 백링크·첨부는 건드리지 않고 상태와 body_version 만 기록한다. 재직렬화 body 는 원문과 다를 수 있어(원문
 *       HTML·체크리스트 등) 편집 없이 열기만 해도 본문이 손실되거나 version 이 오르면 안 되기 때문이다.
 * </ul>
 *
 * @param state Yjs 문서 상태(base64) — 원본
 * @param body state 에서 직렬화한 마크다운 — wiki_page.body 로 파생 저장. null 이면 상태만 저장
 * @param editorIds 이번 저장 구간의 편집자들(순서대로). 마지막 값이 updated_by 가 된다. 비면 직전 수정자를 유지(파생 저장만)
 * @param bodyVersion 상태만 저장할 때, 상태를 만든 body 의 version(로드 시 받은 값). 그사이 body 가 바뀌었으면 더 낮게 남아 다음 로드가
 *     stale 로 반영한다
 * @param snapshot 이 저장 직전 판을 시간 규칙과 무관하게 리비전으로 남긴다(AI·복원 적용 저장 — 동기화 서버가 적용 직전 미저장분을 먼저 저장한 뒤 실어
 *     보낸다, 스펙 §6.1). 없으면 false — 시간 규칙(5분 정적·30분)만 적용
 * @param snapshotReason snapshot 의 사유 — {@code "AI"}·{@code "RESTORE"}. null 이면(사유를 싣지 않는 구버전 동기화
 *     서버) AI 로 본다(판정 R7 — 구버전이 snapshot 을 싣는 경우는 AI 적용뿐). 그 밖의 값은 400
 * @param aiActorId AI 적용을 요청한 사용자 — 스냅샷 행의 ✦ 귀속. null 이면 editorIds 의 마지막 값
 */
public record StoreCollabDocRequest(
    @NotNull String state,
    String body,
    List<Long> editorIds,
    Integer bodyVersion,
    boolean snapshot,
    @Pattern(regexp = "AI|RESTORE", message = "snapshotReason 은 AI 또는 RESTORE 여야 합니다")
        String snapshotReason,
    Long aiActorId) {

  /** 상태만 저장인가(body 없음). */
  public boolean stateOnly() {
    return body == null;
  }

  /** body 도 bodyVersion 도 없으면 어떤 저장인지 알 수 없다 — 400. */
  @AssertTrue(message = "body 또는 bodyVersion 중 하나는 있어야 합니다")
  public boolean isKindKnown() {
    return body != null || bodyVersion != null;
  }
}
