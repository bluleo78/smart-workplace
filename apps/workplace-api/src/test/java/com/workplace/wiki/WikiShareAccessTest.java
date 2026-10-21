package com.workplace.wiki;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.WIKI_PAGE;
import static com.workplace.jooq.Tables.WIKI_PAGE_ATTACHMENT;
import static com.workplace.jooq.Tables.WIKI_PAGE_SHARE;
import static com.workplace.jooq.Tables.WIKI_PAGE_SHARE_MEMBER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.file.storage.FileStore;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.dto.MovePageRequest;
import com.workplace.wiki.dto.WikiShareGrant;
import com.workplace.wiki.exception.WikiForbiddenException;
import com.workplace.wiki.exception.WikiPageNotFoundException;
import com.workplace.wiki.exception.WikiShareForbiddenException;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiShareAccess;
import com.workplace.wiki.service.WikiSpaceService;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * 노트 공유 판정 표(WP-579 Task 2) — {@link WikiShareAccess} 의 판정(멤버/WORKSPACE/PEOPLE/PUBLIC × 하위 포함 × 이동
 * × 만료 × 정책)과, {@code X-Wiki-Share-Token} 헤더가 기존 읽기 경로(페이지 GET·collab-access·첨부·mentions·제목 PUT)에
 * 실제로 연결됐는지를 함께 본다. 헤더 연결은 서비스 호출만으로는 잡히지 않으므로(빠진 {@code @RequestHeader}) MockMvc 로 확인한다.
 *
 * <p>@Transactional: MockMvc 요청이 같은 스레드의 테스트 트랜잭션에 합류해 시드를 보고, 끝나면 롤백된다. 단 이 안에서는 RLS GUC 가 JWT 의
 * 테넌트와 무관하게 트랜잭션 시작값(1)에 머무르므로, 다른 테넌트 판정은 {@link #useTenant} 로 GUC 를 바꿔 서비스 단에서 본다.
 */
@Transactional
class WikiShareAccessTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;
  @Autowired WikiShareAccess shareAccess;
  @Autowired FileStore fileStore;

  /** PNG 매직바이트 + 채움 — 첨부 업로드의 이미지 판정용. */
  private static final byte[] PNG = {
    (byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0, 0, 0, 0, 0
  };

  private long ownerId;
  private long viewerId; // 스페이스 VIEWER
  private long strangerId; // 같은 테넌트, 스페이스 비멤버
  private long listedId; // 같은 테넌트, 스페이스 비멤버, PEOPLE 공유의 지정한 사람
  private long spaceId;
  private long rootId; // 공유 루트
  private long childId; // 루트의 자식
  private long grandchildId; // 자식의 자식
  private long unrelatedId; // 같은 스페이스, 루트 밖

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    ownerId = human();
    viewerId = human();
    strangerId = human();
    listedId = human();
    spaceId = spaceService.createTeamSpace(ownerId, "공유판정-" + UUID.randomUUID()).id();
    spaceService.addMember(ownerId, spaceId, viewerId, "VIEWER");
    rootId = page(null, "제품 로드맵");
    childId = page(rootId, "1분기");
    grandchildId = page(childId, "1월");
    unrelatedId = page(null, "인사 평가");
  }

  // ── 판정 표 ─────────────────────────────────────────────────────────────

  /** 멤버 역할이 공유 역할보다 높으면 멤버 역할 — OWNER 가 보기 링크로 들어와도 OWNER. */
  @Test
  void member_role_wins_when_higher() {
    String token = share(rootId, "WORKSPACE", "VIEW", false, null);
    assertThat(shareAccess.effectiveRole(spaceId, rootId, ownerId, token, "VIEWER"))
        .isEqualTo("OWNER");
  }

  /** VIEWER 멤버가 편집 링크로 들어오면 EDITOR — 둘 중 높은 쪽. collab-access 응답 역할도 같다. */
  @Test
  void share_edit_beats_space_viewer() throws Exception {
    String token = share(rootId, "WORKSPACE", "EDIT", false, null);
    assertThat(shareAccess.effectiveRole(spaceId, rootId, viewerId, token, "EDITOR"))
        .isEqualTo("EDITOR");

    call(get("/api/v1/wiki/pages/{id}/collab-access", rootId), viewerId, token)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.role").value("EDITOR"));
    // 헤더가 없으면 지금처럼 멤버 역할 그대로.
    call(get("/api/v1/wiki/pages/{id}/collab-access", rootId), viewerId, null)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.role").value("VIEWER"));
  }

  /**
   * collab-access 는 공유가 역할을 정했을 때(멤버 역할보다 높을 때) 그 공유의 만료 시각(epoch ms, shareExpiresAt)을 싣는다 — 동기화
   * 서버가 공유로 붙은 연결을 만료 시각에 다시 판정해 닫는다(만료 = 즉시 막힘). 멤버 역할로 정해졌거나 공유가 무기한·헤더가 없으면 null(키는 있음).
   */
  @Test
  void collab_access_carries_share_expiry_only_when_share_decides_role() throws Exception {
    OffsetDateTime expires = OffsetDateTime.now().plusHours(2).withNano(123_000_000);
    String token = share(rootId, "WORKSPACE", "EDIT", false, expires);
    long expiresMs = expires.toInstant().toEpochMilli();

    // 공유가 역할을 정한다 — VIEWER 멤버의 편집 링크, 비멤버.
    call(get("/api/v1/wiki/pages/{id}/collab-access", rootId), viewerId, token)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.role").value("EDITOR"))
        .andExpect(jsonPath("$.shareExpiresAt").value(expiresMs));
    call(get("/api/v1/wiki/pages/{id}/collab-access", rootId), strangerId, token)
        .andExpect(jsonPath("$.shareExpiresAt").value(expiresMs));
    // 멤버 역할이 이기면 공유 만료와 무관하다 — 타이머를 걸지 않게 null.
    call(get("/api/v1/wiki/pages/{id}/collab-access", rootId), ownerId, token)
        .andExpect(jsonPath("$.role").value("OWNER"))
        .andExpect(jsonPath("$.shareExpiresAt").isEmpty());
    // 헤더가 없으면 null(키는 있다).
    call(get("/api/v1/wiki/pages/{id}/collab-access", rootId), viewerId, null)
        .andExpect(jsonPath("$.shareExpiresAt").isEmpty());
    // 무기한 공유도 null.
    String forever = share(childId, "WORKSPACE", "EDIT", false, null);
    call(get("/api/v1/wiki/pages/{id}/collab-access", childId), strangerId, forever)
        .andExpect(jsonPath("$.role").value("EDITOR"))
        .andExpect(jsonPath("$.shareExpiresAt").isEmpty());
  }

  /** WORKSPACE 공유는 같은 테넌트 로그인 사용자 누구나 VIEWER(보기 링크) — 페이지 GET 이 열리고, 편집(제목 PUT)은 403. */
  @Test
  void workspace_share_grants_any_tenant_user_viewer() throws Exception {
    String token = share(rootId, "WORKSPACE", "VIEW", false, null);
    WikiShareGrant g = shareAccess.grant(rootId, strangerId, token).orElseThrow();
    assertThat(g.role()).isEqualTo("VIEWER");
    assertThat(g.rootPageId()).isEqualTo(rootId);
    assertThat(g.createdBy()).isEqualTo(ownerId);
    assertThat(g.shareId()).isEqualTo(shareIdOf(token));

    call(get("/api/v1/wiki/pages/{id}", rootId), strangerId, token)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.title").value("제품 로드맵"));
    call(titlePut(rootId, "바꾼 제목"), strangerId, token).andExpect(status().isForbidden());

    // 편집 링크면 제목 PUT 이 된다(EDITOR).
    dsl.update(WIKI_PAGE_SHARE)
        .set(WIKI_PAGE_SHARE.PERMISSION, "EDIT")
        .where(WIKI_PAGE_SHARE.TOKEN.eq(token))
        .execute();
    call(titlePut(rootId, "바꾼 제목"), strangerId, token)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.title").value("바꾼 제목"));
  }

  /** PEOPLE 공유 — 지정한 사람은 열리고, 지정 안 된 로그인 사용자는 404 가 아니라 403(접근 요청 가능). */
  @Test
  void people_share_rejects_unlisted_user() throws Exception {
    String token = share(rootId, "PEOPLE", "VIEW", false, null);
    addPerson(token, listedId);

    assertThat(shareAccess.grant(rootId, listedId, token)).isPresent();
    assertThatThrownBy(() -> shareAccess.grant(rootId, strangerId, token))
        .isInstanceOf(WikiShareForbiddenException.class);
    assertThatThrownBy(
            () -> shareAccess.effectiveRole(spaceId, rootId, strangerId, token, "VIEWER"))
        .isInstanceOf(WikiShareForbiddenException.class);

    call(get("/api/v1/wiki/pages/{id}", rootId), listedId, token).andExpect(status().isOk());
    JsonNode body =
        json(
            call(get("/api/v1/wiki/pages/{id}", rootId), strangerId, token)
                .andExpect(status().isForbidden()));
    assertThat(body.get("requested").asBoolean()).isFalse();
    assertThat(body.get("message").asText()).isNotBlank();
  }

  /** PUBLIC 공유는 언제나 VIEWER — 로그인 사용자·비로그인(userId null) 모두. 편집 판정은 403. */
  @Test
  void public_share_grants_viewer_even_if_edit_requested() {
    // DB CHECK 가 PUBLIC+EDIT 행을 막으므로 판정 규칙 자체(역할 매핑)는 직접 확인한다.
    assertThat(WikiShareAccess.roleOf("PUBLIC", "EDIT")).isEqualTo("VIEWER");
    assertThat(WikiShareAccess.roleOf("WORKSPACE", "EDIT")).isEqualTo("EDITOR");
    assertThat(WikiShareAccess.roleOf("PEOPLE", "VIEW")).isEqualTo("VIEWER");

    String token = share(rootId, "PUBLIC", "VIEW", false, null);
    assertThat(shareAccess.grant(rootId, strangerId, token).orElseThrow().role())
        .isEqualTo("VIEWER");
    assertThat(shareAccess.grant(rootId, null, token).orElseThrow().role()).isEqualTo("VIEWER");
    assertThatThrownBy(
            () -> shareAccess.effectiveRole(spaceId, rootId, strangerId, token, "EDITOR"))
        .isInstanceOf(WikiForbiddenException.class);
  }

  /** 하위 포함 공유는 손자 페이지까지 연다. 하위 미포함이면 루트만. */
  @Test
  void include_children_covers_descendants() throws Exception {
    String withChildren = share(rootId, "WORKSPACE", "VIEW", true, null);
    WikiShareGrant g = shareAccess.grant(grandchildId, strangerId, withChildren).orElseThrow();
    assertThat(g.rootPageId()).isEqualTo(rootId);
    call(get("/api/v1/wiki/pages/{id}", grandchildId), strangerId, withChildren)
        .andExpect(status().isOk());

    String rootOnly = share(unrelatedId, "WORKSPACE", "VIEW", false, null);
    long under = page(unrelatedId, "평가 기준");
    assertThat(shareAccess.grant(unrelatedId, strangerId, rootOnly)).isPresent();
    assertThat(shareAccess.grant(under, strangerId, rootOnly)).isEmpty();
    call(get("/api/v1/wiki/pages/{id}", under), strangerId, rootOnly)
        .andExpect(status().isNotFound());
  }

  /**
   * Review Focus 2 — 하위 포함 범위는 지금 트리 위치로 정한다. 루트 밖으로 옮긴 페이지는 즉시 GET·collab-access·첨부가 404, 안으로 옮긴
   * 페이지는 즉시 열린다.
   */
  @Test
  void grant_follows_current_tree_position() throws Exception {
    String token = share(rootId, "WORKSPACE", "VIEW", true, null);
    long fileId = uploadPng(ownerId, childId);

    call(get("/api/v1/wiki/pages/{id}", childId), strangerId, token).andExpect(status().isOk());
    call(get("/api/v1/wiki/pages/{id}/collab-access", childId), strangerId, token)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.role").value("VIEWER"));
    call(attachmentContent(childId, fileId), strangerId, token).andExpect(status().isOk());

    // 자식을 루트 밖(스페이스 최상위)으로 옮긴다 → 그 아래 손자까지 즉시 막힌다.
    TenantContext.set(1L);
    pageService.move(ownerId, childId, new MovePageRequest(null, 0));
    call(get("/api/v1/wiki/pages/{id}", childId), strangerId, token)
        .andExpect(status().isNotFound());
    call(get("/api/v1/wiki/pages/{id}", grandchildId), strangerId, token)
        .andExpect(status().isNotFound());
    call(get("/api/v1/wiki/pages/{id}/collab-access", childId), strangerId, token)
        .andExpect(status().isNotFound());
    call(attachmentContent(childId, fileId), strangerId, token).andExpect(status().isNotFound());

    // 루트 밖이던 페이지를 안으로 옮기면 즉시 열린다.
    TenantContext.set(1L);
    pageService.move(ownerId, unrelatedId, new MovePageRequest(rootId, 0));
    call(get("/api/v1/wiki/pages/{id}", unrelatedId), strangerId, token).andExpect(status().isOk());
  }

  /** 만료된 공유는 없는 공유와 같다 — 404. */
  /**
   * 공유 헤더로 첨부 올리기 — 편집 공유는 비멤버도 올린다(201), 보기 공유는 403. 컨트롤러가 헤더를 서비스로 넘기는지(빠진
   * {@code @RequestHeader})는 HTTP 로만 잡힌다.
   */
  @Test
  void share_header_upload_edit_201_view_403() throws Exception {
    String edit = share(rootId, "WORKSPACE", "EDIT", false, null);
    MockMultipartFile f = new MockMultipartFile("file", "a.png", "image/png", PNG);
    call(multipart("/api/v1/wiki/pages/{id}/attachments", rootId).file(f), strangerId, edit)
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.fileId").isNumber());

    String view = share(unrelatedId, "WORKSPACE", "VIEW", false, null);
    call(multipart("/api/v1/wiki/pages/{id}/attachments", unrelatedId).file(f), strangerId, view)
        .andExpect(status().isForbidden());
  }

  /** 공유 헤더로 스테이징 이미지 클레임 — 편집 공유는 묶이고(200), 보기 공유는 403 이고 아무것도 묶이지 않는다. */
  @Test
  void share_header_claim_edit_ok_view_403() throws Exception {
    String edit = share(rootId, "WORKSPACE", "EDIT", false, null);
    long staged = seedStaged(strangerId);
    call(claim(rootId, staged), strangerId, edit)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].fileId").value(staged));

    String view = share(unrelatedId, "WORKSPACE", "VIEW", false, null);
    long other = seedStaged(strangerId);
    call(claim(unrelatedId, other), strangerId, view).andExpect(status().isForbidden());
    assertThat(dsl.fetchCount(WIKI_PAGE_ATTACHMENT, WIKI_PAGE_ATTACHMENT.FILE_ID.eq(other)))
        .isZero();
  }

  @Test
  void expired_share_is_404() throws Exception {
    String token = share(rootId, "WORKSPACE", "VIEW", false, dbNow().minusMinutes(1));
    assertThat(shareAccess.grant(rootId, strangerId, token)).isEmpty();
    assertThatThrownBy(
            () -> shareAccess.effectiveRole(spaceId, rootId, strangerId, token, "VIEWER"))
        .isInstanceOf(WikiPageNotFoundException.class);
    call(get("/api/v1/wiki/pages/{id}", rootId), strangerId, token)
        .andExpect(status().isNotFound());

    // 만료가 미래면 열린다(대조).
    String later = share(childId, "WORKSPACE", "VIEW", false, dbNow().plusDays(1));
    assertThat(shareAccess.grant(childId, strangerId, later)).isPresent();
  }

  /** 테넌트가 외부 공유를 끄면 PUBLIC 링크는 로그인 사용자에게도 404(정책이 꺼진 동안 PUBLIC 은 없는 공유). */
  @Test
  void public_share_404_when_policy_off() throws Exception {
    String token = share(rootId, "PUBLIC", "VIEW", false, null);
    assertThat(shareAccess.grant(rootId, strangerId, token)).isPresent();

    dsl.execute("UPDATE tenant SET wiki_external_share_enabled = false WHERE id = 1");
    assertThat(shareAccess.grant(rootId, strangerId, token)).isEmpty();
    assertThat(shareAccess.grant(rootId, null, token)).isEmpty();
    call(get("/api/v1/wiki/pages/{id}", rootId), strangerId, token)
        .andExpect(status().isNotFound());
  }

  /**
   * Review Focus 3 — 토큰은 그 공유 범위 밖 페이지의 열쇠가 아니다: 같은 스페이스·다른 스페이스의 페이지는 404, PEOPLE 토큰도 범위 밖이면 403 이
   * 아니라 404(토큰 유효성을 드러내지 않음), 다른 테넌트 사용자는 RLS 로 공유 자체가 안 보여 404.
   */
  @Test
  void token_does_not_unlock_unrelated_page() throws Exception {
    String token = share(rootId, "WORKSPACE", "EDIT", true, null);
    call(get("/api/v1/wiki/pages/{id}", unrelatedId), strangerId, token)
        .andExpect(status().isNotFound());
    call(get("/api/v1/wiki/pages/{id}/collab-access", unrelatedId), strangerId, token)
        .andExpect(status().isNotFound());

    TenantContext.set(1L);
    long otherSpace = spaceService.createTeamSpace(ownerId, "다른팀-" + UUID.randomUUID()).id();
    TenantContext.set(1L);
    long otherPage =
        pageService.create(ownerId, otherSpace, new CreatePageRequest(null, "남의 문서")).id();
    call(get("/api/v1/wiki/pages/{id}", otherPage), strangerId, token)
        .andExpect(status().isNotFound());

    String people = share(unrelatedId, "PEOPLE", "VIEW", false, null);
    TenantContext.set(1L);
    assertThat(shareAccess.grant(rootId, strangerId, people)).isEmpty();
    call(get("/api/v1/wiki/pages/{id}", rootId), strangerId, people)
        .andExpect(status().isNotFound());

    // 다른 테넌트 사용자 — 그 테넌트 컨텍스트(GUC)에서는 공유 행이 RLS 로 보이지 않는다.
    long otherTenant = ensureFixtureTenant("wsh-access-other");
    long outsider = TestFixtures.createHuman(dsl);
    TestFixtures.addMember(dsl, outsider, otherTenant);
    useTenant(otherTenant);
    assertThat(shareAccess.grant(rootId, outsider, token)).isEmpty();
    assertThatThrownBy(() -> shareAccess.effectiveRole(spaceId, rootId, outsider, token, "VIEWER"))
        .isInstanceOf(WikiPageNotFoundException.class);
    useTenant(1L);
  }

  /** 헤더가 없으면 지금과 똑같다 — 비멤버 404. 헤더를 받지 않는 엔드포인트(백링크·버전 기록·트리)는 유효한 토큰이 있어도 404. */
  @Test
  void no_header_behaves_exactly_as_before() throws Exception {
    String token = share(rootId, "WORKSPACE", "EDIT", true, null);
    JsonNode noHeader =
        json(
            call(get("/api/v1/wiki/pages/{id}", rootId), strangerId, null)
                .andExpect(status().isNotFound()));
    JsonNode missing =
        json(
            call(get("/api/v1/wiki/pages/{id}", rootId + 1_000_000), strangerId, token)
                .andExpect(status().isNotFound()));
    // 존재 은닉 문구는 헤더 유무·사유와 무관하게 하나다.
    assertThat(noHeader.get("message").asText()).isEqualTo(missing.get("message").asText());
    call(get("/api/v1/wiki/pages/{id}/collab-access", rootId), strangerId, null)
        .andExpect(status().isNotFound());
    assertThat(shareAccess.grant(rootId, strangerId, null)).isEmpty();

    call(get("/api/v1/wiki/pages/{id}/backlinks", rootId), strangerId, token)
        .andExpect(status().isNotFound());
    call(get("/api/v1/wiki/pages/{id}/revisions", rootId), strangerId, token)
        .andExpect(status().isNotFound());
    call(get("/api/v1/wiki/spaces/{id}/pages", spaceId), strangerId, token)
        .andExpect(status().isNotFound());
  }

  /**
   * 공유로 들어온 사람의 mentions — 공유 범위 안 페이지는 제목을 보이고, 범위 밖 페이지·볼 수 없는 이슈는 label=null·inaccessible=true 로
   * 가린다. 멤버는 헤더가 있어도 지금과 같다(볼 수 없는 대상은 목록에서 뺀다).
   */
  @Test
  void share_viewer_mentions_mask_targets_outside_scope() throws Exception {
    String token = share(rootId, "WORKSPACE", "VIEW", true, null);
    dsl.update(WIKI_PAGE)
        .set(
            WIKI_PAGE.BODY,
            "<#page:" + childId + "> <#page:" + unrelatedId + "> <#issue:987654321>")
        .where(WIKI_PAGE.ID.eq(rootId))
        .execute();

    JsonNode refs =
        json(
            call(get("/api/v1/wiki/pages/{id}/mentions", rootId), strangerId, token)
                .andExpect(status().isOk()));
    assertThat(refs).hasSize(3);
    assertThat(refs.get(0).get("id").asLong()).isEqualTo(childId);
    assertThat(refs.get(0).get("label").asText()).isEqualTo("1분기");
    assertThat(refs.get(0).get("inaccessible").asBoolean()).isFalse();
    assertThat(refs.get(1).get("id").asLong()).isEqualTo(unrelatedId);
    assertThat(refs.get(1).get("label").isNull()).isTrue();
    assertThat(refs.get(1).get("spaceId").isNull()).isTrue();
    assertThat(refs.get(1).get("inaccessible").asBoolean()).isTrue();
    assertThat(refs.get(2).get("type").asText()).isEqualTo("ISSUE");
    assertThat(refs.get(2).get("inaccessible").asBoolean()).isTrue();

    // 멤버(OWNER)는 헤더가 있어도 기존 동작 — 두 페이지 모두 제목, 없는 이슈는 뺀다.
    JsonNode member =
        json(
            call(get("/api/v1/wiki/pages/{id}/mentions", rootId), ownerId, token)
                .andExpect(status().isOk()));
    assertThat(member).hasSize(2);
    assertThat(member.get(1).get("label").asText()).isEqualTo("인사 평가");
  }

  // ── 시드·요청 도우미 ─────────────────────────────────────────────────────

  /** 테넌트#1 ACTIVE 멤버인 사람 사용자. */
  private long human() {
    return withMembership(TestFixtures.createHuman(dsl));
  }

  private long page(Long parentId, String title) {
    TenantContext.set(1L);
    return pageService.create(ownerId, spaceId, new CreatePageRequest(parentId, title)).id();
  }

  /** 공유 행을 직접 만든다(설정 API 는 다음 작업) — 토큰을 돌려준다. */
  private String share(
      long pageId, String audience, String permission, boolean children, OffsetDateTime expires) {
    String token = "wsh_test" + UUID.randomUUID().toString().replace("-", "");
    long pageSpace =
        dsl.select(WIKI_PAGE.SPACE_ID)
            .from(WIKI_PAGE)
            .where(WIKI_PAGE.ID.eq(pageId))
            .fetchOne(0, Long.class);
    dsl.insertInto(WIKI_PAGE_SHARE)
        .set(WIKI_PAGE_SHARE.PAGE_ID, pageId)
        .set(WIKI_PAGE_SHARE.SPACE_ID, pageSpace)
        .set(WIKI_PAGE_SHARE.TOKEN, token)
        .set(WIKI_PAGE_SHARE.AUDIENCE, audience)
        .set(WIKI_PAGE_SHARE.PERMISSION, permission)
        .set(WIKI_PAGE_SHARE.INCLUDE_CHILDREN, children)
        .set(WIKI_PAGE_SHARE.EXPIRES_AT, expires)
        .set(WIKI_PAGE_SHARE.CREATED_BY, ownerId)
        .execute();
    return token;
  }

  private long shareIdOf(String token) {
    return dsl.select(WIKI_PAGE_SHARE.ID)
        .from(WIKI_PAGE_SHARE)
        .where(WIKI_PAGE_SHARE.TOKEN.eq(token))
        .fetchOne(0, Long.class);
  }

  private void addPerson(String token, long userId) {
    dsl.insertInto(WIKI_PAGE_SHARE_MEMBER)
        .set(WIKI_PAGE_SHARE_MEMBER.SHARE_ID, shareIdOf(token))
        .set(WIKI_PAGE_SHARE_MEMBER.USER_ID, userId)
        .set(WIKI_PAGE_SHARE_MEMBER.ADDED_BY, ownerId)
        .execute();
  }

  /** 사용자 JWT(테넌트 1) + 공유 헤더(null 이면 생략)로 요청한다. */
  private ResultActions call(MockHttpServletRequestBuilder req, long userId, String shareToken)
      throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(userId, "u-" + userId, 1L));
    if (shareToken != null) {
      req.header(WikiShareAccess.HEADER, shareToken);
    }
    return mvc.perform(req);
  }

  private MockHttpServletRequestBuilder titlePut(long pageId, String title) {
    return put("/api/v1/wiki/pages/{id}", pageId)
        .contentType(MediaType.APPLICATION_JSON)
        .content("{\"title\":\"" + title + "\"}");
  }

  private MockHttpServletRequestBuilder attachmentContent(long pageId, long fileId) {
    return get("/api/v1/wiki/pages/{p}/attachments/{f}/content", pageId, fileId);
  }

  private MockHttpServletRequestBuilder claim(long pageId, long fileId) throws Exception {
    return post("/api/v1/wiki/pages/{id}/attachments/claim", pageId)
        .contentType(MediaType.APPLICATION_JSON)
        .content(om.writeValueAsString(Map.of("fileIds", List.of(fileId))));
  }

  /** 먼저 올려 둔 스테이징 PNG(만료 있는 ATTACHMENT) — WikiImageClaimTest 와 같은 시드. */
  private long seedStaged(long uploader) {
    String path = "tenant-1/staged/" + UUID.randomUUID();
    fileStore.storeBytes(path, PNG);
    return dsl.insertInto(FILE)
        .set(FILE.ORIGINAL_NAME, "a.png")
        .set(FILE.STORED_NAME, path)
        .set(FILE.STORAGE_PATH, path)
        .set(FILE.MIME_TYPE, "image/png")
        .set(FILE.SIZE_BYTES, (long) PNG.length)
        .set(FILE.CATEGORY, "ATTACHMENT")
        .set(FILE.UPLOADED_BY, uploader)
        .set(FILE.EXPIRES_AT, OffsetDateTime.now().plusHours(24))
        .returning(FILE.ID)
        .fetchOne()
        .getId();
  }

  /** 멤버(헤더 없음)로 PNG 를 올리고 file id 를 돌려준다. */
  private long uploadPng(long userId, long pageId) throws Exception {
    MockMultipartFile f = new MockMultipartFile("file", "a.png", "image/png", PNG);
    JsonNode res =
        json(
            call(multipart("/api/v1/wiki/pages/{id}/attachments", pageId).file(f), userId, null)
                .andExpect(status().isCreated()));
    return res.get("fileId").asLong();
  }

  private JsonNode json(ResultActions r) throws Exception {
    return om.readTree(r.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
  }
}
