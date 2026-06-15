package com.workplace.wiki.service;

import com.workplace.wiki.dto.WikiReferenceRow;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

/** 본문 마크다운에서 page/issue 참조 토큰(&lt;#page:id&gt; · &lt;#issue:id&gt;)을 추출. 유저(&lt;@id&gt;)는 제외. */
@Component
public class WikiReferenceParser {
  // <#page:123> 또는 <#issue:123> — id 18자리 이내.
  private static final Pattern TOKEN = Pattern.compile("<#(page|issue):(\\d{1,18})>");

  /** 본문에서 page/issue 토큰을 중복 제거(순서 보존)해 추출. source 페이지 id 를 각 행에 채운다. */
  public List<WikiReferenceRow> parse(long sourcePageId, String body) {
    if (body == null || body.isEmpty()) return List.of();
    Set<WikiReferenceRow> seen = new LinkedHashSet<>();
    Matcher m = TOKEN.matcher(body);
    while (m.find()) {
      String type = m.group(1).equals("page") ? "PAGE" : "ISSUE";
      seen.add(new WikiReferenceRow(sourcePageId, type, Long.parseLong(m.group(2))));
    }
    return new ArrayList<>(seen);
  }
}
