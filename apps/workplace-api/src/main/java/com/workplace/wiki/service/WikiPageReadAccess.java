package com.workplace.wiki.service;

import com.workplace.wiki.dto.WikiPageCard;
import com.workplace.wiki.exception.WikiPageNotFoundException;
import com.workplace.wiki.repository.WikiPageRepository;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 「이 사람이 이 노트를 읽을 수 있나」를 다른 모듈(calendar)에 내주는 읽기 포트(WP-1701). 규칙은 노트 목록·검색과 같은 스페이스 실효 멤버십(직접 또는
 * 조직도 부서, WP-1052) 하나 — 토큰(공유 링크) 없이 VIEWER 로 열 수 있는 노트만 읽을 수 있다. 여러 id 를 쿼리 한 번에 판정해 목록 응답이 N+1 이
 * 되지 않게 한다.
 */
@Component
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class WikiPageReadAccess {
  private final WikiPageRepository pages;

  /** pageIds 중 userId 가 읽을 수 있는 노트의 카드. 읽을 수 없는·없는·다른 테넌트(RLS) id 는 결과에서 빠진다. 빈 입력은 쿼리 없이 빈 맵. */
  public Map<Long, WikiPageCard> readableCards(long userId, Collection<Long> pageIds) {
    return pages.findReadableCards(userId, pageIds);
  }

  /**
   * 읽을 수 없으면(없는 노트와 구분되지 않게) {@link WikiPageNotFoundException}. 거절이 호출자의 쓰기 트랜잭션을 rollback-only 로
   * 만들지 않게 noRollbackFor 를 둔다 — 호출자가 예외를 그대로 올리면 어차피 롤백되지만, 잡아서 처리할 때 공통 tx 가 죽지 않도록.
   */
  // 메서드 애너테이션은 클래스 것을 대체하므로 readOnly 를 다시 쓴다(noRollbackFor 만 더하려면 필요, WP-1701).
  @Transactional(readOnly = true, noRollbackFor = WikiPageNotFoundException.class)
  public void requireReadable(long userId, long pageId) {
    if (!readableCards(userId, List.of(pageId)).containsKey(pageId)) {
      throw new WikiPageNotFoundException(pageId);
    }
  }
}
