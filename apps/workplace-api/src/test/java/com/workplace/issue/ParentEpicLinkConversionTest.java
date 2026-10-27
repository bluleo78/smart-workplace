package com.workplace.issue;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_EXTERNAL_LINK;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.domain.IssueRelationBuiltIns;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.repository.IssueExternalLinkRepository;
import com.workplace.issue.repository.IssueRelationTypeRepository;
import com.workplace.issue.repository.IssueTypeRepository;
import com.workplace.issue.service.IssueService;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

/**
 * 부모 에픽 외부 링크 일괄 변환(WP-1038) 통합 테스트 — dryRun 은 아무것도 쓰지 않고, 줄마다
 * 판정(CONVERT·SKIP_HAS_PARENT·NOT_FOUND· AMBIGUOUS·NOT_EPIC·PERSONAL·SUBTASK·DONE_EPIC_OPEN_CHILD)이
 * 맞는지, 실제 변환은 부모를 붙이고 이력·감사 로그를 남기며 링크를 지우는지, 사람 관리자가 아니면 403 인지를 본다.
 *
 * <p>픽스처: 가져오기 공통 준비의 팀 프로젝트(자식 쪽, {@code key})와 소유자의 다른 팀 프로젝트 B(에픽 쪽). 판정을 자식 프로젝트로
 * 좁혀(projectKey) 다른 테스트가 남긴 링크와 섞이지 않게 한다.
 */
@Transactional
class ParentEpicLinkConversionTest extends IssueImportTestSupport {

  @Autowired IssueService issueService;
  @Autowired IssueTypeRepository typeRepository;
  @Autowired IssueExternalLinkRepository linkRepository;
  @Autowired IssueRelationTypeRepository relationTypeRepository;

  private ProjectResponse b;
  private long parentEpicTypeId;

  @BeforeEach
  void seed() {
    seedProject("PL", "링크 변환");
    String bKey =
        "PB" + UUID.randomUUID().toString().replace("-", "").substring(0, 6).toUpperCase();
    b = projectService.create(owner, new CreateProjectRequest(bKey, "에픽 쪽", "x"));
    parentEpicTypeId =
        relationTypeRepository.findByCode(IssueRelationBuiltIns.PARENT_EPIC).orElseThrow().id();
  }

  // ── 픽스처 도우미 ──────────────────────────────────────────────────────────────────────

  /** 프로젝트에 유형·같은 프로젝트 부모 번호를 골라 이슈를 만든다. */
  private IssueResponse create(
      String projectKey, long projectId, String typeName, String title, Integer parentNumber) {
    long typeId = typeRepository.findByProjectAndName(projectId, typeName).orElseThrow().id();
    return issueService.create(
        owner,
        projectKey,
        new CreateIssueRequest(title, null, null, null, null, typeId, parentNumber, null));
  }

  private IssueResponse inA(String typeName, String title) {
    return create(key, projectId, typeName, title, null);
  }

  private IssueResponse inB(String typeName, String title) {
    return create(b.key(), b.id(), typeName, title, null);
  }

  /** 이슈에 PARENT_EPIC 외부 링크를 단다 — extKey 가 null 이면 주소에서만 키를 알 수 있다. */
  private long link(IssueResponse child, String extKey, String urlKey) {
    String url = "https://jira.example.com/browse/" + urlKey;
    linkRepository.insertIfAbsent(
        child.id(), parentEpicTypeId, true, url, extKey, "상위 에픽 " + urlKey, admin);
    return linkRepository.findByIssueAndUrl(child.id(), url).orElseThrow().id();
  }

  private static String keyOf(ProjectResponse p, IssueResponse i) {
    return p.key() + "-" + i.number();
  }

  private Long parentOf(IssueResponse i) {
    return dsl.select(ISSUE.PARENT_ISSUE_ID)
        .from(ISSUE)
        .where(ISSUE.ID.eq(i.id()))
        .fetchOne(ISSUE.PARENT_ISSUE_ID);
  }

  private int linkCount() {
    return dsl.fetchCount(
        ISSUE_EXTERNAL_LINK
            .join(ISSUE)
            .on(ISSUE.ID.eq(ISSUE_EXTERNAL_LINK.ISSUE_ID))
            .where(ISSUE.PROJECT_ID.eq(projectId)));
  }

  /** 원본 키 표시 — 이관으로 가져온 이슈처럼 보이게 한다. */
  private void markSourceKey(IssueResponse i, String sourceKey) {
    dsl.update(ISSUE).set(ISSUE.IMPORT_SOURCE_KEY, sourceKey).where(ISSUE.ID.eq(i.id())).execute();
  }

  /** callerId 로 변환 API 를 부른다(가져오기와 같이 issue:write 권한을 실어 서비스의 관리자 판정을 보게). */
  private ResultActions convertAs(long callerId, Boolean dryRun) throws Exception {
    return convertAs(callerId, dryRun, key);
  }

  /** 자식 프로젝트를 골라(null 이면 워크스페이스 전체) 변환 API 를 부른다. */
  private ResultActions convertAs(long callerId, Boolean dryRun, String projectKey)
      throws Exception {
    TenantContext.set(1L);
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("projectKey", projectKey);
    body.put("dryRun", dryRun);
    var auth =
        new UsernamePasswordAuthenticationToken(
            callerId, "n/a", List.of(new SimpleGrantedAuthority("issue:write")));
    ResultActions r =
        mvc.perform(
            post("/api/v1/admin/issues/parent-epic-links/convert")
                .with(authentication(auth))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body)));
    TenantContext.set(1L);
    return r;
  }

  /** 응답의 줄들 — 링크 id → 줄. */
  private Map<Long, JsonNode> rowsByLink(ResultActions r) throws Exception {
    JsonNode json = objectMapper.readTree(r.andReturn().getResponse().getContentAsString());
    Map<Long, JsonNode> m = new HashMap<>();
    json.get("rows").forEach(n -> m.put(n.get("linkId").asLong(), n));
    return m;
  }

  // ── 테스트 ──────────────────────────────────────────────────────────────────────────

  @Test
  void dryRun_judgesEveryOutcome_andWritesNothing() throws Exception {
    IssueResponse epicB = inB("EPIC", "B 에픽");
    IssueResponse taskB = inB("TASK", "B 작업");
    IssueResponse doneEpicB = inB("EPIC", "B 완료 에픽");
    issueService.updateStatus(owner, b.key(), doneEpicB.number(), "DONE");
    IssueResponse sourceEpicB = inB("EPIC", "B 이관 에픽");
    markSourceKey(sourceEpicB, "CL-77");
    // 같은 원본 키로 가져온 이슈가 둘 — 모호하다.
    markSourceKey(inB("EPIC", "B 모호 1"), "CL-88");
    markSourceKey(inA("EPIC", "A 모호 2"), "CL-88");
    ProjectResponse personal =
        projectService.create(owner, new CreateProjectRequest(null, "개인", null, "PERSONAL"));
    // 남(소유자)의 개인 프로젝트 이슈 — 관리자도 읽을 수 없어 일반 부모 지정처럼 「찾을 수 없음」이다(키도 싣지 않는다).
    IssueResponse personalEpic =
        issueService.create(
            owner,
            personal.key(),
            new CreateIssueRequest("개인 이슈", null, null, null, null, null, null, null));

    long convert = link(inA("TASK", "변환"), keyOf(b, epicB), keyOf(b, epicB));
    long bySource = link(inA("TASK", "원본 키"), "CL-77", "CL-77");
    long byUrl = link(inA("TASK", "주소만"), null, keyOf(b, epicB));
    long ambiguous = link(inA("TASK", "모호"), "CL-88", "CL-88");
    long notFound = link(inA("TASK", "없음"), "CL-999999", "CL-999999");
    long notEpic = link(inA("TASK", "에픽 아님"), keyOf(b, taskB), keyOf(b, taskB));
    long personalRow = link(inA("TASK", "개인"), keyOf(personal, personalEpic), "P-1");
    long doneEpic = link(inA("TASK", "완료 에픽"), keyOf(b, doneEpicB), keyOf(b, doneEpicB));
    IssueResponse parentTask = inA("TASK", "하위 태스크의 부모");
    IssueResponse subtask = create(key, projectId, "SUBTASK", "하위 태스크", parentTask.number());
    long subtaskRow = link(subtask, keyOf(b, epicB), keyOf(b, epicB));
    IssueResponse epicA = inA("EPIC", "A 에픽");
    IssueResponse hasParent = create(key, projectId, "TASK", "이미 부모", epicA.number());
    long hasParentRow = link(hasParent, keyOf(b, epicB), keyOf(b, epicB));
    int historyBefore =
        dsl.fetchCount(ISSUE_HISTORY, ISSUE_HISTORY.EVENT_TYPE.eq("PARENT_CHANGED"));

    ResultActions r =
        convertAs(admin, true)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.dryRun").value(true))
            .andExpect(jsonPath("$.scanned").value(10))
            .andExpect(jsonPath("$.counts.CONVERT").value(3))
            .andExpect(jsonPath("$.counts.EPIC_CHILD").value(0));
    Map<Long, JsonNode> rows = rowsByLink(r);
    assertThat(rows.get(convert).get("outcome").asText()).isEqualTo("CONVERT");
    assertThat(rows.get(convert).get("parentKey").asText()).isEqualTo(keyOf(b, epicB));
    assertThat(rows.get(bySource).get("outcome").asText()).isEqualTo("CONVERT");
    assertThat(rows.get(bySource).get("parentKey").asText()).isEqualTo(keyOf(b, sourceEpicB));
    assertThat(rows.get(byUrl).get("outcome").asText()).isEqualTo("CONVERT");
    assertThat(rows.get(byUrl).get("extKey").asText()).isEqualTo(keyOf(b, epicB));
    assertThat(rows.get(ambiguous).get("outcome").asText()).isEqualTo("AMBIGUOUS");
    assertThat(rows.get(ambiguous).get("parentKey").isNull()).isTrue();
    assertThat(rows.get(notFound).get("outcome").asText()).isEqualTo("NOT_FOUND");
    assertThat(rows.get(notEpic).get("outcome").asText()).isEqualTo("NOT_EPIC");
    assertThat(rows.get(personalRow).get("outcome").asText()).isEqualTo("NOT_FOUND");
    assertThat(rows.get(personalRow).get("parentKey").isNull()).isTrue();
    assertThat(rows.get(doneEpic).get("outcome").asText()).isEqualTo("DONE_EPIC_OPEN_CHILD");
    assertThat(rows.get(subtaskRow).get("outcome").asText()).isEqualTo("SUBTASK");
    assertThat(rows.get(hasParentRow).get("outcome").asText()).isEqualTo("SKIP_HAS_PARENT");

    // 아무것도 쓰지 않았다 — 링크·부모·이력·감사 로그 그대로.
    assertThat(linkCount()).isEqualTo(10);
    assertThat(dsl.fetchCount(ISSUE_HISTORY, ISSUE_HISTORY.EVENT_TYPE.eq("PARENT_CHANGED")))
        .isEqualTo(historyBefore);
    assertThat(
            dsl.fetchCount(
                AUDIT_LOG, AUDIT_LOG.ACTION_TYPE.eq("ISSUE_PARENT_EPIC_LINKS_CONVERTED")))
        .isZero();
  }

  @Test
  void convert_setsParent_recordsHistory_andRemovesOnlyConvertedLinks() throws Exception {
    IssueResponse epicB = inB("EPIC", "B 에픽");
    IssueResponse taskB = inB("TASK", "B 작업");
    IssueResponse child = inA("TASK", "변환될 하위");
    IssueResponse other = inA("TASK", "남는 하위");
    long converted = link(child, keyOf(b, epicB), keyOf(b, epicB));
    long kept = link(other, keyOf(b, taskB), keyOf(b, taskB));

    convertAs(admin, false)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.dryRun").value(false))
        .andExpect(jsonPath("$.counts.CONVERT").value(1))
        .andExpect(jsonPath("$.counts.NOT_EPIC").value(1));

    assertThat(parentOf(child)).isEqualTo(epicB.id());
    assertThat(parentOf(other)).isNull();
    assertThat(linkRepository.findById(converted)).isEmpty();
    assertThat(linkRepository.findById(kept)).isPresent();
    var history =
        dsl.selectFrom(ISSUE_HISTORY)
            .where(ISSUE_HISTORY.ISSUE_ID.eq(child.id()))
            .and(ISSUE_HISTORY.EVENT_TYPE.eq("PARENT_CHANGED"))
            .fetch();
    assertThat(history).hasSize(1);
    assertThat(history.get(0).getActorId()).isEqualTo(admin);
    assertThat(history.get(0).getToValue()).contains(b.key());
    assertThat(
            dsl.fetchCount(
                AUDIT_LOG,
                AUDIT_LOG
                    .ACTION_TYPE
                    .eq("ISSUE_PARENT_EPIC_LINKS_CONVERTED")
                    .and(AUDIT_LOG.USER_ID.eq(admin))))
        .isEqualTo(1);

    // 다시 돌리면 바꾼 링크는 없고 남은 줄만 같은 판정을 받는다(되풀이해도 안전).
    convertAs(admin, false)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.scanned").value(1))
        .andExpect(jsonPath("$.counts.CONVERT").value(0));
  }

  @Test
  void personalChild_judgedPersonal() throws Exception {
    IssueResponse epicB = inB("EPIC", "B 에픽");
    ProjectResponse personal =
        projectService.create(owner, new CreateProjectRequest(null, "개인", null, "PERSONAL"));
    IssueResponse child =
        issueService.create(
            owner,
            personal.key(),
            new CreateIssueRequest("개인 하위", null, null, null, null, null, null, null));
    long row = link(child, keyOf(b, epicB), keyOf(b, epicB));

    // 개인 프로젝트로는 좁힐 수 없어(가져오기와 같은 규칙) 워크스페이스 전체로 판정한다.
    Map<Long, JsonNode> rows = rowsByLink(convertAs(admin, true, null).andExpect(status().isOk()));
    assertThat(rows.get(row).get("outcome").asText()).isEqualTo("PERSONAL");
    assertThat(rows.get(row).get("parentKey").asText()).isEqualTo(keyOf(b, epicB));
  }

  @Test
  void deletedProjects_neverFail_epicInDeletedProjectIsNotFound() throws Exception {
    // 지운 프로젝트의 에픽을 가리키는 링크 — 원본 키로도 Works 키로도 찾지 않는다.
    String dKey =
        "PD" + UUID.randomUUID().toString().replace("-", "").substring(0, 6).toUpperCase();
    ProjectResponse d =
        projectService.create(owner, new CreateProjectRequest(dKey, "지울 프로젝트", "x"));
    IssueResponse epicD = create(d.key(), d.id(), "EPIC", "지울 에픽", null);
    markSourceKey(epicD, "CL-55");
    long byKey = link(inA("TASK", "키로"), keyOf(d, epicD), keyOf(d, epicD));
    long bySource = link(inA("TASK", "원본 키로"), "CL-55", "CL-55");
    // 지운 프로젝트 이슈에 달린 링크 — 판정 대상에서 빠진다(500 이 아니다).
    String eKey =
        "PE" + UUID.randomUUID().toString().replace("-", "").substring(0, 6).toUpperCase();
    ProjectResponse e =
        projectService.create(owner, new CreateProjectRequest(eKey, "지울 자식 쪽", "x"));
    IssueResponse epicB = inB("EPIC", "B 에픽");
    long onDeleted = link(create(e.key(), e.id(), "TASK", "지울 하위", null), keyOf(b, epicB), "X-1");
    projectService.softDelete(owner, d.key());
    projectService.softDelete(owner, e.key());

    Map<Long, JsonNode> rows = rowsByLink(convertAs(admin, true).andExpect(status().isOk()));
    assertThat(rows.get(byKey).get("outcome").asText()).isEqualTo("NOT_FOUND");
    assertThat(rows.get(bySource).get("outcome").asText()).isEqualTo("NOT_FOUND");
    Map<Long, JsonNode> all = rowsByLink(convertAs(admin, true, null).andExpect(status().isOk()));
    assertThat(all).doesNotContainKey(onDeleted);
  }

  @Test
  void nonAdmin_403_evenProjectOwner() throws Exception {
    IssueResponse epicB = inB("EPIC", "B 에픽");
    IssueResponse child = inA("TASK", "하위");
    link(child, keyOf(b, epicB), keyOf(b, epicB));

    convertAs(owner, false)
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.errors.reason").value("IMPORT_ADMIN_ONLY"));
    assertThat(parentOf(child)).isNull();
    assertThat(linkCount()).isEqualTo(1);
  }

  @Test
  void dryRunMissing_400() throws Exception {
    convertAs(admin, null).andExpect(status().isBadRequest());
  }
}
