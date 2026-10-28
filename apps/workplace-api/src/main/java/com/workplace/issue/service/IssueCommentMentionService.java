package com.workplace.issue.service;

import com.workplace.global.dto.MentionResponse;
import com.workplace.global.service.UserMentionHydrator;
import com.workplace.global.tenant.MembershipGuard;
import com.workplace.global.util.MentionParser;
import com.workplace.issue.dto.IssueCommentResponse;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * 이슈 코멘트 응답에 본문 멘션 토큰({@code <@id>})이 가리키는 사용자를 싣는다(WP-1095).
 *
 * <p>왜: 화면이 프로젝트 멤버 목록만으로 멘션 이름을 찾아, 프로젝트에서 빠진 사람을 멘션한 지난 코멘트가 모두 「알 수 없음」으로 보였다. 채팅·팀 채팅처럼 서버가
 * 사용자를 풀어 준다. 반응 집계({@link IssueCommentReactionService#enrich})와 같이 응답을 만드는 경로(목록·작성·수정·이슈 상세)에서만
 * 부른다.
 *
 * <p>코멘트 본문의 토큰은 누구나 쓸 수 있으므로 지금 워크스페이스의 활성 멤버만 싣는다 — 사용자 테이블은 워크스페이스를 가리지 않아, 거르지 않으면 다른 워크스페이스
 * 사용자의 이름이 토큰 하나로 보인다. 그 밖의 id(탈퇴·다른 워크스페이스·없는 id)는 빠지고 화면은 「알 수 없음」으로 그린다.
 */
@Service
@RequiredArgsConstructor
public class IssueCommentMentionService {

  private final UserMentionHydrator mentionHydrator;
  private final MembershipGuard membershipGuard;

  /** 코멘트들의 멘션 사용자를 채운다 — 전체 코멘트의 멘션 id 를 모아 멤버 확인·사용자 조회를 한 번씩만 한다. 멘션이 없으면 조회하지 않는다. */
  public List<IssueCommentResponse> enrich(List<IssueCommentResponse> comments) {
    List<List<Long>> idsPerComment =
        comments.stream().map(c -> MentionParser.parse(c.body())).toList();
    List<Long> ids = idsPerComment.stream().flatMap(List::stream).distinct().toList();
    if (ids.isEmpty()) return comments;
    var foreign = new HashSet<>(membershipGuard.foreignUserIds(ids));
    Map<Long, MentionResponse> users =
        mentionHydrator
            .asMentionResponses(ids.stream().filter(id -> !foreign.contains(id)).toList())
            .stream()
            .collect(Collectors.toMap(MentionResponse::id, Function.identity()));
    if (users.isEmpty()) return comments;
    return IntStream.range(0, comments.size())
        .mapToObj(
            i ->
                comments
                    .get(i)
                    .withMentions(
                        idsPerComment.get(i).stream()
                            .map(users::get)
                            .filter(Objects::nonNull)
                            .toList()))
        .toList();
  }

  /** 코멘트 하나 — 작성·수정 응답. */
  public IssueCommentResponse enrich(IssueCommentResponse comment) {
    return enrich(List.of(comment)).getFirst();
  }
}
