package com.workplace.issue;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.repository.IssueTypeRepository;
import com.workplace.issue.service.EpicColors;
import com.workplace.issue.service.IssueService;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

/**
 * 에픽 색(WP-1017) 통합 테스트 — 새 에픽의 자동 색(가장 덜 쓰인 팔레트 색, 팔레트 순으로 돌고 11개 뒤엔 처음부터), 유형 변경으로 에픽이 될 때의 자동
 * 색·되돌아올 때 유지, 색 바꾸기 API(PUT epic-color — 에픽이 아니거나 허용되지 않은 토큰은 400), 하위 이슈의 부모 요약 유형 색이 에픽 색을
 * 따르는지(옛 에픽은 따르지 않는지), 가져오기로 만든 에픽도 색을 받는지를 본다.
 */
@Transactional
class EpicColorTest extends IssueImportTestSupport {

  @Autowired IssueService issueService;
  @Autowired IssueTypeRepository typeRepository;

  private long epicTypeId;
  private long taskTypeId;
  private long subtaskTypeId;

  @BeforeEach
  void seed() {
    seedProject("EC", "에픽 색");
    epicTypeId = typeRepository.findByProjectAndName(projectId, "EPIC").orElseThrow().id();
    taskTypeId = typeRepository.findByProjectAndName(projectId, "TASK").orElseThrow().id();
    subtaskTypeId = typeRepository.findByProjectAndName(projectId, "SUBTASK").orElseThrow().id();
  }

  /** 유형·부모를 정해 이슈를 만든다. */
  private IssueResponse create(String title, long typeId, Integer parentNumber) {
    return issueService.create(
        owner,
        key,
        new CreateIssueRequest(title, null, null, null, null, typeId, parentNumber, null));
  }

  /** 상세 조회 요약 — 저장된 값을 다시 읽어 단언한다. */
  private IssueResponse detail(int number) {
    return issueService.get(owner, key, number).summary();
  }

  /** issue:write 권한으로 인증해 에픽 색 바꾸기를 부른다. 요청 처리가 테넌트 문맥을 지우므로 뒤에서 다시 심는다. */
  private ResultActions putColor(long callerId, int number, Object colorToken) throws Exception {
    TenantContext.set(1L);
    var auth =
        new UsernamePasswordAuthenticationToken(
            callerId, "n/a", List.of(new SimpleGrantedAuthority("issue:write")));
    var body = new java.util.HashMap<String, Object>();
    body.put("colorToken", colorToken);
    ResultActions r =
        mvc.perform(
            put("/api/v1/projects/" + key + "/issues/" + number + "/epic-color")
                .with(authentication(auth))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body)));
    TenantContext.set(1L);
    return r;
  }

  @Test
  void consecutiveEpics_getPaletteColorsInOrder_andWrapAfterEleven() {
    List<String> colors = new ArrayList<>();
    for (int i = 0; i < 12; i++) {
      colors.add(create("에픽 " + i, epicTypeId, null).epicColor());
    }
    // 앞 11개는 팔레트 순서 그대로(서로 다르다), 12번째는 모두 1번씩 쓰여 다시 처음 색.
    assertThat(colors.subList(0, 11)).containsExactlyElementsOf(EpicColors.PALETTE);
    assertThat(colors.get(11)).isEqualTo("BLUE");
    // 저장된 값도 같다.
    var first = create("에픽 13", epicTypeId, null);
    assertThat(detail(first.number()).epicColor()).isEqualTo(first.epicColor()).isEqualTo("ORANGE");
    // 에픽이 아닌 이슈는 색이 없다.
    assertThat(create("태스크", taskTypeId, null).epicColor()).isNull();
  }

  @Test
  void autoColor_picksLeastUsed_notRoundRobin() throws Exception {
    var e1 = create("에픽 1", epicTypeId, null);
    create("에픽 2", epicTypeId, null);
    assertThat(e1.epicColor()).isEqualTo("BLUE");
    // 첫 에픽을 ORANGE 로 바꾸면 BLUE 가 비므로 다음 에픽은 (차례대로라면 GREEN 이지만) BLUE 를 받는다.
    putColor(owner, e1.number(), "ORANGE").andExpect(status().isOk());
    assertThat(create("에픽 3", epicTypeId, null).epicColor()).isEqualTo("BLUE");
    // 사람이 고른 GRAY 는 팔레트 밖이라 세지 않는다 — e1 을 GRAY 로 바꾸면 ORANGE 1·BLUE 1, 나머지 0 → GREEN.
    putColor(owner, e1.number(), "GRAY").andExpect(status().isOk());
    assertThat(create("에픽 4", epicTypeId, null).epicColor()).isEqualTo("GREEN");
  }

  @Test
  void putEpicColor_changesColor_andAllowsGray() throws Exception {
    var epic = create("에픽", epicTypeId, null);
    putColor(owner, epic.number(), "PINK")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.colorToken").value("PINK"));
    assertThat(detail(epic.number()).epicColor()).isEqualTo("PINK");

    putColor(owner, epic.number(), "GRAY").andExpect(status().isOk());
    assertThat(detail(epic.number()).epicColor()).isEqualTo("GRAY");
  }

  @Test
  void putEpicColor_onNonEpic_400() throws Exception {
    var task = create("태스크", taskTypeId, null);
    putColor(owner, task.number(), "RED")
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("에픽에만 색을 정할 수 있습니다"));
    assertThat(detail(task.number()).epicColor()).isNull();
  }

  @Test
  void putEpicColor_invalidOrBlankToken_400() throws Exception {
    var epic = create("에픽", epicTypeId, null);
    putColor(owner, epic.number(), "MAGENTA").andExpect(status().isBadRequest());
    putColor(owner, epic.number(), "").andExpect(status().isBadRequest());
    putColor(owner, epic.number(), null).andExpect(status().isBadRequest());
    assertThat(detail(epic.number()).epicColor()).isEqualTo("BLUE");
  }

  @Test
  void putEpicColor_nonMember_rejected() throws Exception {
    var epic = create("에픽", epicTypeId, null);
    long stranger = human();
    putColor(stranger, epic.number(), "RED").andExpect(status().is4xxClientError());
    assertThat(detail(epic.number()).epicColor()).isEqualTo("BLUE");
  }

  @Test
  void childParentRef_carriesEpicColor_andFollowsChange() throws Exception {
    create("에픽 1", epicTypeId, null);
    var epic = create("에픽 2", epicTypeId, null);
    var child = create("하위", taskTypeId, epic.number());
    assertThat(detail(child.number()).parent().type().colorToken()).isEqualTo("ORANGE");

    putColor(owner, epic.number(), "TEAL").andExpect(status().isOk());
    assertThat(detail(child.number()).parent().type().colorToken()).isEqualTo("TEAL");
  }

  @Test
  void setTypeToEpic_assignsColor_keepsItOnReturn_andFormerEpicDoesNotPaintChild() {
    create("에픽 1", epicTypeId, null);
    var task = create("태스크", taskTypeId, null);
    assertThat(task.epicColor()).isNull();

    // 처음 에픽이 되면 덜 쓰인 색(ORANGE)을 받는다.
    issueService.setType(owner, key, task.number(), epicTypeId);
    assertThat(detail(task.number()).epicColor()).isEqualTo("ORANGE");

    // 태스크로 갔다 돌아와도 원래 색 그대로.
    issueService.setType(owner, key, task.number(), taskTypeId);
    issueService.setType(owner, key, task.number(), epicTypeId);
    assertThat(detail(task.number()).epicColor()).isEqualTo("ORANGE");

    // 태스크가 된 옛 에픽 아래 하위 태스크의 부모 요약은 유형(TASK) 색이다 — 남은 에픽 색으로 칠하지 않는다.
    issueService.setType(owner, key, task.number(), taskTypeId);
    var sub = create("하위 태스크", subtaskTypeId, task.number());
    String taskColor = typeRepository.findById(taskTypeId).orElseThrow().colorToken();
    assertThat(detail(sub.number()).parent().type().colorToken()).isEqualTo(taskColor);
  }

  @Test
  void importedEpic_getsAutoColor() throws Exception {
    create("에픽 1", epicTypeId, null);
    Map<String, Object> epic = body("가져온 에픽");
    epic.put("typeId", epicTypeId);
    int number = numberOf(importAs(admin, epic).andExpect(status().isCreated()));
    TenantContext.set(1L);
    assertThat(detail(number).epicColor()).isEqualTo("ORANGE");
  }
}
