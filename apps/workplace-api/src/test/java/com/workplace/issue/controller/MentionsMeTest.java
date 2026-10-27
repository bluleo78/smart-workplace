package com.workplace.issue.controller;

import static com.workplace.jooq.Tables.CHAT_MESSAGE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.AgentWorkTestSupport;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.project.dto.CreateProjectRequest;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.JSONB;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;

/**
 * /me/issues mentionsMe(WP-719) — 담당과 상관없이, 내 마지막 글(이슈 챗 글·댓글) 이후 나를 멘션한 다른 사람 글이 있는 이슈만. 외부 AI 가
 * 담당이 아닌 이슈에서 받은 지시를 프로젝트 범위로 찾는 데 쓴다.
 */
class MentionsMeTest extends AgentWorkTestSupport {

  /** mentionsMe 로 조회한 이슈 번호들. projectKey 가 null 이면 프로젝트 횡단. */
  private List<Integer> mentionedNumbers(String token, String key) {
    var res =
        call(
            HttpMethod.GET,
            "/api/v1/me/issues?mentionsMe=true" + (key == null ? "" : "&projectKey=" + key),
            token,
            null,
            null);
    assertOk(res);
    List<Integer> out = new ArrayList<>();
    json(res).get("items").forEach(n -> out.add(n.get("number").asInt()));
    return out;
  }

  /** 시드한 이슈 — 댓글 경로는 id, 이슈 챗 경로는 번호를 쓴다. */
  private record Seeded(long id, int number) {}

  /** 사람(humanId)만 담당인 이슈를 만든다 — AI 에게는 「담당이 아닌 이슈」. */
  private Seeded createHumanIssue(String key, String title) {
    return inTenant(
        () -> {
          var issue =
              issueService.create(
                  humanId,
                  key,
                  new CreateIssueRequest(title, "본문", "MID", null, List.of(), null, null, null));
          issueAssigneeRepository.add(issue.id(), humanId, humanId);
          return new Seeded(issue.id(), issue.number());
        });
  }

  /** 이슈의 챗 스레드 id(없으면 만든다 — 사람 JWT). */
  private long threadOf(String key, int number) {
    var res =
        call(
            HttpMethod.GET,
            "/api/v1/projects/" + key + "/issues/" + number + "/chat/thread",
            jwtToken,
            null,
            null);
    assertOk(res);
    return json(res).get("threadId").asLong();
  }

  /** 이슈 챗에 글을 남긴다. */
  private void chat(String token, String key, int number, String body) {
    assertOk(
        call(
            HttpMethod.POST,
            "/api/v1/chat/threads/" + threadOf(key, number) + "/messages",
            token,
            Map.of("body", body),
            null));
  }

  /** 댓글을 남긴다. */
  private void comment(String token, long issueId, String body) {
    assertOk(
        call(
            HttpMethod.POST,
            "/api/v1/issues/" + issueId + "/comments",
            token,
            Map.of("body", body),
            TOOL));
  }

  /** 담당이 아닌 이슈에서 멘션받으면 잡히고, 이슈 챗으로 답하면 빠진다. 멘션받지 않은 사람에게는 잡히지 않는다. */
  @Test
  void mentioned_onUnassignedIssue_andClearedByMyReply() {
    int n = createHumanIssue(projectKey, "사람 담당").number();
    chat(jwtToken, projectKey, n, "<@" + agentId + "> 원인 좀 봐줘");
    assertThat(mentionedNumbers(akToken, projectKey)).contains(n);
    // 멘션받지 않은 사람에게는 잡히지 않는다(새 글 필터와 다름).
    assertThat(mentionedNumbers(otherPatToken, projectKey)).doesNotContain(n);

    chat(akToken, projectKey, n, "확인했어요 — 원인은 X 입니다");
    assertThat(mentionedNumbers(akToken, projectKey)).doesNotContain(n);
  }

  /** 멘션 없는 글은 잡히지 않는다(새 글 필터와 다름). */
  @Test
  void notMentioned_whenPostHasNoMention() {
    int n = createHumanIssue(projectKey, "멘션 없음").number();
    chat(jwtToken, projectKey, n, "그냥 메모");
    assertThat(mentionedNumbers(akToken, projectKey)).doesNotContain(n);
  }

  /** 댓글 본문의 멘션도 잡히고, 댓글로 답해도 빠진다. */
  @Test
  void mentioned_byComment_andClearedByMyComment() {
    Seeded issue = createHumanIssue(projectKey, "댓글 멘션");
    int n = issue.number();
    comment(jwtToken, issue.id(), "<@" + agentId + "> 이거 처리해 줄래?");
    assertThat(mentionedNumbers(akToken, projectKey)).contains(n);

    comment(akToken, issue.id(), "네, 담당 지정 부탁드려요");
    assertThat(mentionedNumbers(akToken, projectKey)).doesNotContain(n);
  }

  /** 내가 나를 멘션한 내 글은 잡히지 않는다. */
  @Test
  void notMentioned_whenOnlyMySelfMention() {
    int n = createHumanIssue(projectKey, "자기 멘션").number();
    chat(akToken, projectKey, n, "<@" + agentId + "> 메모");
    assertThat(mentionedNumbers(akToken, projectKey)).doesNotContain(n);
  }

  /** 다른 프로젝트의 멘션은 프로젝트 키로 거르면 빠진다 — work-loop 세션은 자기 프로젝트만 본다. */
  @Test
  void otherProjectMention_excluded_whenFilteredByProjectKey() {
    String otherKey =
        inTenant(
            () -> {
              String suffix =
                  UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 6);
              var p =
                  projectService.create(
                      humanId, new CreateProjectRequest("MB" + suffix, "P-mb", "x"));
              projectMemberRepository.insert(p.id(), agentId, "MEMBER");
              return p.key();
            });
    int n = createHumanIssue(otherKey, "다른 프로젝트").number();
    chat(jwtToken, otherKey, n, "<@" + agentId + "> 이쪽도 봐줘");

    assertThat(mentionedNumbers(akToken, otherKey)).contains(n);
    // 이슈 번호는 프로젝트마다 1부터라 겹칠 수 있다 — 첫 프로젝트 조회에 다른 프로젝트 이슈가 섞이지 않는지는 키로 확인한다.
    var res =
        call(
            HttpMethod.GET,
            "/api/v1/me/issues?mentionsMe=true&projectKey=" + projectKey,
            akToken,
            null,
            null);
    assertOk(res);
    List<String> keys = new ArrayList<>();
    json(res).get("items").forEach(i -> keys.add(i.path("projectKey").asText()));
    assertThat(keys).doesNotContain(otherKey);
  }

  /** 조회 권한이 없는(멤버가 아닌) 프로젝트의 멘션은 잡히지 않는다. */
  @Test
  void notMentioned_whenProjectNotVisible() {
    // AI 가 멤버가 아닌 프로젝트 — 멘션 글은 직접 시드한다(작성 경로의 멤버 검증과 무관하게 조회 권한만 본다).
    String closedKey =
        inTenant(
            () -> {
              String suffix =
                  UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 6);
              return projectService
                  .create(humanId, new CreateProjectRequest("MC" + suffix, "P-mc", "x"))
                  .key();
            });
    int n = createHumanIssue(closedKey, "비공개").number();
    long thread = threadOf(closedKey, n);
    inTenant(
        () ->
            dsl.insertInto(CHAT_MESSAGE)
                .set(CHAT_MESSAGE.THREAD_ID, thread)
                .set(CHAT_MESSAGE.AUTHOR_ID, humanId)
                .set(CHAT_MESSAGE.BODY, "<@" + agentId + "> 비밀")
                .set(CHAT_MESSAGE.MENTIONS, JSONB.valueOf("[" + agentId + "]"))
                .execute());

    var res = call(HttpMethod.GET, "/api/v1/me/issues?mentionsMe=true", akToken, null, null);
    assertOk(res);
    List<String> keys = new ArrayList<>();
    json(res).get("items").forEach(i -> keys.add(i.path("projectKey").asText()));
    assertThat(keys).doesNotContain(closedKey);
  }
}
