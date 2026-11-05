package com.workplace.label;

import static com.workplace.jooq.Tables.LABEL;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.service.IssueLabelService;
import com.workplace.issue.service.IssueService;
import com.workplace.label.exception.InvalidLabelNameException;
import com.workplace.label.repository.LabelRepository;
import com.workplace.label.service.LabelService;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

/**
 * 라벨 이름의 쉼표 금지(WP-1386). 이슈 목록 필터 {@code label=} 이 값을 쉼표로 나눈 이름 목록으로 읽어, 이름에 쉼표가 든 라벨은 이름으로 찾을 수
 * 없었다(「라벨 'a' 을(를) 찾을 수 없습니다」). 그래서 새로 만들거나 이름을 바꿀 때 ASCII 쉼표를 400 으로 막는다. 이미 있는 쉼표 라벨은 이관하지 않으므로
 * 이름을 그대로 둔 수정(색만 변경)·쉼표 없는 이름으로 바꾸기·이름으로 기존 라벨 붙이기는 계속 된다.
 */
@Transactional
class LabelNameCommaTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired ProjectService projectService;
  @Autowired LabelRepository labelRepository;
  @Autowired IssueService issueService;
  @Autowired IssueLabelService issueLabelService;
  @Autowired ProjectMemberRepository memberRepository;

  private long userId;
  private long projectId;
  private String key;

  /** label:manage 가 있는 사용자와 그가 OWNER 인 프로젝트·이슈 1번을 만든다. */
  @BeforeEach
  void setUp() {
    userId = TestFixtures.createHuman(dsl);
    grantUserRole(userId);
    TestFixtures.activeMemberOfCurrentTenant(dsl, userId);
    key = ("LC" + UUID.randomUUID().toString().replaceAll("-", "").toUpperCase()).substring(0, 6);
    ProjectResponse proj = projectService.create(userId, new CreateProjectRequest(key, "P", "x"));
    projectId = proj.id();
    // 일반 생성으로 이슈 1번을 만든다 — 번호 시퀀스가 따라 올라가야 테스트 안의 이슈 생성이 번호 충돌 없이 라벨 검증까지 간다.
    issueService.create(userId, key, withLabelNames(null));
  }

  @Test
  void 쉼표가_든_이름으로_만들면_400_한국어_문구() throws Exception {
    createLabel("a,b")
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("라벨 이름에는 쉼표(,)를 쓸 수 없습니다"));
    assertThat(dsl.fetchCount(LABEL, LABEL.PROJECT_ID.eq(projectId))).isZero();
  }

  @Test
  void 쉼표_없는_이름과_전각_쉼표는_만들어진다() throws Exception {
    createLabel("severity:minor").andExpect(status().isOk());
    // 필터 구분자는 ASCII 쉼표뿐이라 전각 쉼표(U+FF0C)는 막지 않는다.
    createLabel("a，b").andExpect(status().isOk()).andExpect(jsonPath("$.name").value("a，b"));
  }

  @Test
  void 쉼표가_든_이름으로_바꾸면_400() throws Exception {
    long id = labelRepository.insert(projectId, "plain", "GRAY", userId).id();
    updateLabel(id, "pl,ain", "GRAY")
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value(LabelService.COMMA_MESSAGE));
    assertThat(labelRepository.findById(id).orElseThrow().name()).isEqualTo("plain");
  }

  @Test
  void 기존_쉼표_라벨은_쉼표_없는_이름으로_바꿀_수_있다() throws Exception {
    long id = labelRepository.insert(projectId, "a,b", "GRAY", userId).id();
    updateLabel(id, "a-b", "GRAY").andExpect(status().isOk());
    assertThat(labelRepository.findById(id).orElseThrow().name()).isEqualTo("a-b");
  }

  /** 웹 편집 창은 색만 바꿔도 이름을 함께 보낸다 — 이름이 그대로면 쉼표 라벨도 색을 바꿀 수 있다. */
  @Test
  void 기존_쉼표_라벨의_색만_바꾸는_수정은_된다() throws Exception {
    long id = labelRepository.insert(projectId, "a,b", "GRAY", userId).id();
    updateLabel(id, "a,b", "RED").andExpect(status().isOk());
    var row = labelRepository.findById(id).orElseThrow();
    assertThat(row.name()).isEqualTo("a,b");
    assertThat(row.colorToken()).isEqualTo("RED");
    // 다른 쉼표 이름으로 바꾸는 것은 막는다.
    updateLabel(id, "a,c", "RED").andExpect(status().isBadRequest());
  }

  /**
   * 이름으로 붙이며 만드는 경로(MCP·메일 승격이 쓰는 labelNames)도 새 쉼표 라벨을 만들지 않는다 — 사전검증·실제 생성·라벨 교체 모두. 가져오기만 전각 쉼표로
   * 바꿔 만들고(IssueImportHistoryTest), 일반 경로는 사람·AI 가 고칠 수 있게 바꾸지 않고 400 으로 알린다.
   */
  @Test
  void 이름_라벨로_쉼표_라벨을_새로_만들지_않는다() {
    assertThatThrownBy(() -> issueService.validateCreatable(userId, key, withLabelNames("x,y")))
        .isInstanceOf(InvalidLabelNameException.class)
        .hasMessage(LabelService.COMMA_MESSAGE);
    assertThatThrownBy(() -> issueService.create(userId, key, withLabelNames("x,y")))
        .isInstanceOf(InvalidLabelNameException.class);
    assertThatThrownBy(() -> issueLabelService.replace(userId, key, 1, List.of(), List.of("x,y")))
        .isInstanceOf(InvalidLabelNameException.class)
        .hasMessage(LabelService.COMMA_MESSAGE);
    assertThat(dsl.fetchCount(LABEL, LABEL.PROJECT_ID.eq(projectId))).isZero();
  }

  /**
   * 라벨 관리 권한(label:manage)이 없는 멤버가 쉼표 든 새 이름을 보내면 쉼표 400 이 아니라 권한 403 — 사전검증과 실제 실행이 같은 순서(권한 →
   * 쉼표)로 같은 답을 낸다.
   */
  @Test
  void 라벨_관리_권한이_없으면_쉼표보다_권한_오류가_먼저() {
    long member = TestFixtures.createHuman(dsl); // 역할 없음 — label:manage 없음
    TestFixtures.activeMemberOfCurrentTenant(dsl, member);
    memberRepository.insert(projectId, member, "MEMBER");
    assertThatThrownBy(() -> issueService.validateCreatable(member, key, withLabelNames("x,y")))
        .isInstanceOf(ProjectAccessDeniedException.class);
    assertThatThrownBy(() -> issueLabelService.replace(member, key, 1, List.of(), List.of("x,y")))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  /** 이미 있는 쉼표 라벨은 이름으로(대소문자 무시) 그대로 붙는다 — 사전검증도 통과한다. */
  @Test
  void 이름_라벨로_기존_쉼표_라벨은_붙는다() {
    long id = labelRepository.insert(projectId, "A,B", "GRAY", userId).id();
    issueService.validateCreatable(userId, key, withLabelNames("a,b"));
    var labels = issueLabelService.replace(userId, key, 1, List.of(), List.of("a,b"));
    assertThat(labels).extracting(l -> l.id()).containsExactly(id);
  }

  private static CreateIssueRequest withLabelNames(String name) {
    return new CreateIssueRequest(
        "t",
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        name == null ? null : List.of(name));
  }

  private ResultActions createLabel(String name) throws Exception {
    return mvc.perform(
        post("/api/v1/projects/" + key + "/labels")
            .header("Authorization", bearer())
            .contentType(MediaType.APPLICATION_JSON)
            .content(body(name, "GRAY")));
  }

  private ResultActions updateLabel(long id, String name, String color) throws Exception {
    return mvc.perform(
        patch("/api/v1/projects/" + key + "/labels/" + id)
            .header("Authorization", bearer())
            .contentType(MediaType.APPLICATION_JSON)
            .content(body(name, color)));
  }

  private String bearer() {
    return "Bearer " + jwtTokenProvider.generateAccessToken(userId, "user-" + userId);
  }

  /** 이름은 JSON 특수문자가 없는 값만 쓴다(테스트 입력 고정). */
  private static String body(String name, String color) {
    return "{\"name\":\"" + name + "\",\"colorToken\":\"" + color + "\"}";
  }
}
