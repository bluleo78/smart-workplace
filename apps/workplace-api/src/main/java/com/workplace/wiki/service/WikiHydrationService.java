package com.workplace.wiki.service;

import com.workplace.global.service.UserMentionHydrator;
import com.workplace.global.util.MentionParser;
import com.workplace.issue.dto.IssueRef;
import com.workplace.issue.service.IssueLookupService;
import com.workplace.wiki.dto.WikiBacklink;
import com.workplace.wiki.dto.WikiBacklinksResponse;
import com.workplace.wiki.dto.WikiMentionRef;
import com.workplace.wiki.dto.WikiReferenceRow;
import com.workplace.wiki.repository.WikiPageRepository;
import com.workplace.wiki.repository.WikiReferenceRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 위키 본문 토큰 하이드레이션 + 백링크 조회. 본문의 유저(&lt;@id&gt;)·페이지(&lt;#page:id&gt;)·이슈(&lt;#issue:id&gt;) 토큰을 칩
 * 라벨·라우트 메타로 변환하되, 비가시/비실존 대상은 드랍한다. 이슈 조회는 모듈 경계를 지켜 IssueLookupService(이슈 모듈 공개 서비스)를 호출한다.
 */
@Service
@RequiredArgsConstructor
public class WikiHydrationService {
  private final WikiPageRepository pages;
  private final WikiReferenceRepository references;
  private final WikiReferenceParser refParser;
  private final UserMentionHydrator userHydrator;
  private final IssueLookupService issueLookup;

  /**
   * 본문 토큰을 칩 메타로 하이드레이션한다. 유저→페이지→이슈 순으로 합치며, 각 타입 내부는 본문 등장 순서를 보존한다. 비가시/비실존 대상은 제외(드랍). 빈 본문이면 빈
   * 리스트.
   */
  @Transactional(readOnly = true)
  public List<WikiMentionRef> resolveMentions(long callerId, String body) {
    List<WikiMentionRef> out = new ArrayList<>();

    // 1) 유저 멘션: 실존 유저만 통과(MentionResponse.name 을 라벨로). USER 는 라우트/이슈 메타 없음.
    for (var u : userHydrator.asMentionResponses(MentionParser.parse(body))) {
      out.add(new WikiMentionRef("USER", u.id(), u.name(), null, null, null));
    }

    // 2)·3) 본문에서 page/issue 토큰을 한 번에 추출 후 타입별로 분리.
    List<WikiReferenceRow> refs = refParser.parse(0L, body);
    List<Long> pageIds = new ArrayList<>();
    List<Long> issueIds = new ArrayList<>();
    for (WikiReferenceRow r : refs) {
      if ("PAGE".equals(r.targetType())) pageIds.add(r.targetId());
      else issueIds.add(r.targetId());
    }

    // 2) 페이지: 호출자가 멤버인 스페이스의 페이지만(가시성 스코핑).
    // 배치 조회는 IN(ids) 라 DB 가 입력 순서를 보장하지 않으므로 pageIds 순서로 재정렬(본문 등장 순서 보존).
    Map<Long, WikiMentionRef> pageMap =
        pages.findVisiblePageRefs(callerId, pageIds).stream()
            .collect(Collectors.toMap(WikiMentionRef::id, r -> r));
    for (Long pid : pageIds) {
      WikiMentionRef ref = pageMap.get(pid);
      if (ref != null) out.add(ref);
    }

    // 3) 이슈: 호출자가 멤버인 프로젝트의 활성 이슈만(이슈 모듈 경계 서비스).
    // 페이지와 동일하게 issueIds 순서로 재정렬해 본문 등장 순서를 보존.
    Map<Long, IssueRef> issueMap =
        issueLookup.findVisibleByIds(callerId, issueIds).stream()
            .collect(Collectors.toMap(IssueRef::id, r -> r));
    for (Long iid : issueIds) {
      IssueRef i = issueMap.get(iid);
      if (i != null) {
        out.add(new WikiMentionRef("ISSUE", i.id(), i.title(), null, i.projectKey(), i.number()));
      }
    }
    return out;
  }

  /** 이 페이지를 참조하는 source 페이지를 백링크로 조회한다. 참조 테이블에서 source id 를 모아 호출자가 멤버인 스페이스의 페이지만 반환(가시성 필터). */
  @Transactional(readOnly = true)
  public WikiBacklinksResponse backlinks(long callerId, long pageId) {
    List<Long> sourceIds = references.findBacklinkSourcePageIds("PAGE", pageId);
    List<WikiBacklink> items = pages.findVisibleBacklinks(callerId, sourceIds);
    return new WikiBacklinksResponse(items);
  }
}
