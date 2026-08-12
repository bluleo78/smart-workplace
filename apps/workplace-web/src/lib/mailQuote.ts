// 메일 답장·전달 인용문 조립. 인용문은 Tiptap 에디터를 거치지 않고 raw HTML 로
// 보관·발송되므로(설계 §2), 스키마 정규화 손실 없이 원문 서식이 보존된다.
//
// 단 저장된 body_html 은 <html><head><style> 을 포함한 **완전 문서**다(IMAP·Graph 모두
// 무가공 저장). 그대로 다른 본문에 끼우면 원문 스타일시트가 내가 쓴 문장까지 물들이므로
// 삽입 전에 반드시 언랩한다(설계 §4.1).

import { formatDateMonthDay, formatDateTimeMinute } from '@/lib/formatters';
import type { EmailMessageDetail } from '@/types/mailMessage';

/** 인용문 조립 결과 — html 은 발송 본문·프리뷰 공용, text 는 plain-text alternative 용. */
export interface QuoteParts {
  html: string;
  text: string;
  meta: { from: string; date: string; dateShort: string; subject: string };
}

/**
 * ComposeDraft 가 들고 다니는 인용문 — buildQuote 가 mode 를 variant 로 채워 돌려주므로
 * 호출부가 variant 를 따로 적을 일이 없다(mode/variant 불일치 원천 차단).
 */
export type MailQuote = QuoteParts & { variant: 'reply' | 'forward' };

/**
 * 문서 밖으로 새어 나가는 요소들과 능동 콘텐츠 요소를 함께 제거한다.
 * style/script/link/base/meta/title 은 문서 스코프 이탈, iframe/form/object/embed 는
 * 그대로 두면 발송 본문에 실행형 콘텐츠가 살아남아 수신자에게 재전달되므로(아웃바운드
 * 하드닝) 같은 목록에서 제거한다. table·img·인라인 style·font·bgcolor 는 건드리지 않는다.
 */
const ESCAPING_TAGS = 'style, script, link, base, meta, title, iframe, form, object, embed';

/** 블록 경계로 취급해 텍스트 추출 시 개행을 넣는 태그. */
const BLOCK_TAGS = new Set([
  'P', 'DIV', 'LI', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE',
]);

/**
 * on* 이벤트 핸들러 속성과 javascript: URL 을 제거한다(아웃바운드 하드닝).
 * data:image/ 는 메일 인라인 이미지에 흔히 쓰이므로 보존하고, 그 외 data: URL 은 제거한다.
 * 이것은 sanitize 가 아니라 "능동 콘텐츠 제거" — style·표·img 등 표현 요소는 그대로 둔다.
 */
function stripActiveContent(root: Element): void {
  root.querySelectorAll('*').forEach((el) => {
    for (const name of el.getAttributeNames()) {
      if (/^on/i.test(name)) {
        el.removeAttribute(name);
        continue;
      }
      if (name === 'href' || name === 'src' || name === 'action') {
        const normalized = (el.getAttribute(name) ?? '').trim().toLowerCase();
        if (normalized.startsWith('javascript:')) {
          el.removeAttribute(name);
        } else if (normalized.startsWith('data:') && !normalized.startsWith('data:image/')) {
          el.removeAttribute(name);
        }
      }
    }
  });
}

/**
 * 메일 원문 HTML 을 파싱해 언랩·하드닝을 마친 document 를 돌려준다.
 * DOMParser 는 live DOM 에 붙지 않으므로 스크립트 실행·이미지 로드가 일어나지 않는다.
 * 연접된 다중 문서(…</html><html>…)도 하나의 body 로 병합되므로 전부 담긴다.
 * buildQuote 가 html·text 를 같은 document 에서 뽑도록(1회 파싱) export 하지 않고 내부에서만 쓴다.
 */
function parseMailHtml(html: string): Document {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // <head> 안의 것은 body 밖이라 자동 제외되지만, 파서가 잘못된 위치의 style 을
  // body 로 옮기는 경우가 있어 body 기준으로 한 번 더 제거한다.
  doc.body.querySelectorAll(ESCAPING_TAGS).forEach((el) => el.remove());
  stripActiveContent(doc.body);
  return doc;
}

/**
 * 메일 원문 HTML 을 다른 본문에 삽입 가능한 fragment 로 언랩한다.
 * sanitize 가 아니라 언랩 — 표·이미지·인라인 style·서명 색상은 전부 보존하고
 * 범위를 탈출하거나 능동적인 요소만 제거한다.
 */
export function unwrapMailHtml(html: string): string {
  if (!html) return '';
  return parseMailHtml(html).body.innerHTML;
}

/**
 * 블록 요소 경계에 개행을 넣어 평문을 뽑는다. `textContent` 는 블록 사이 구분자가 없어
 * `<p>안녕</p><p>4분기</p>` 가 "안녕4분기" 로 붙어버리므로, p/div/li/tr/h1~6/blockquote/pre
 * 뒤에 개행, td/th 뒤에 탭을 넣는 재귀 워커로 대체한다.
 */
function extractBlockText(root: Element): string {
  const parts: string[] = [];
  function walk(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent ?? '');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (el.tagName === 'BR') {
      parts.push('\n');
      return;
    }
    el.childNodes.forEach(walk);
    if (el.tagName === 'TD' || el.tagName === 'TH') {
      parts.push('\t');
    } else if (BLOCK_TAGS.has(el.tagName)) {
      parts.push('\n');
    }
  }
  root.childNodes.forEach(walk);
  // 연속 3개 이상 개행은 2개로 압축.
  return parts.join('').replace(/\n{3,}/g, '\n\n').trim();
}

/** 원문 텍스트를 escape 해 pre 로 감싼다(HTML 본문이 없을 때의 폴백). */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 표시용 발신자 — 이름이 있으면 이름, 없으면 주소(둘 다 nullable). */
function displayFrom(detail: EmailMessageDetail): string {
  return detail.fromName?.trim() || detail.fromAddress || '';
}

/**
 * 답장/전달 인용문을 조립한다.
 * - 답장: 작성자 헤더 + blockquote. text 는 각 줄 `> ` 접두(관례)
 * - 전달: `---------- 전달된 메일 ----------` 헤더 블록. text 에 접두를 쓰지 않는다(관례)
 *
 * sentAt 이 null(원문에 발신 시각 정보가 없음)이면 date/dateShort 는 빈 문자열이고,
 * 전달 헤더에는 "날짜: " 줄 자체를 넣지 않는다(빈 값 발송 방지).
 */
export function buildQuote(detail: EmailMessageDetail, mode: 'reply' | 'forward'): MailQuote {
  const from = displayFrom(detail);
  const subject = detail.subject ?? '';
  const meta = {
    from,
    // formatDateTimeMinute 은 null 에 '-' 를 반환하므로(발송 헤더에 '날짜: -' 방지) 가드 유지.
    // formatDateMonthDay 는 무효 입력에 '' 를 반환해 가드 불필요.
    date: detail.sentAt ? formatDateTimeMinute(detail.sentAt) : '',
    dateShort: formatDateMonthDay(detail.sentAt),
    subject,
  };

  // bodyHtml 은 한 번만 파싱해 같은 document 에서 html·text 를 모두 뽑는다
  // (이전에는 unwrap ×2 + htmlToText 재파싱으로 같은 문서를 최대 3회 파싱했다).
  let innerHtml = '';
  let innerText = '';
  if (detail.bodyHtml) {
    const doc = parseMailHtml(detail.bodyHtml);
    innerHtml = doc.body.innerHTML;
    // detail.bodyText 가 비어있지 않으면 그것을 우선(빈 문자열이면 HTML 추출로 폴백).
    innerText = detail.bodyText || extractBlockText(doc.body);
  } else if (detail.bodyText) {
    innerHtml = `<pre>${escapeHtml(detail.bodyText)}</pre>`;
    innerText = detail.bodyText;
  }

  if (mode === 'forward') {
    const headerLines = [
      '보낸사람: ' + from,
      '받는사람: ' + (detail.toAddresses ?? ''),
      ...(meta.date ? ['날짜: ' + meta.date] : []),
      '제목: ' + subject,
    ];
    return {
      html:
        '<blockquote>---------- 전달된 메일 ----------<br/>' +
        headerLines.map(escapeHtml).join('<br/>') +
        '<br/><br/>' +
        innerHtml +
        '</blockquote>',
      // 전달은 인용 접두(`> `)를 붙이지 않는다.
      text: ['---------- 전달된 메일 ----------', ...headerLines, '', innerText].join('\n'),
      meta,
      variant: mode,
    };
  }

  return {
    html: `<blockquote>${escapeHtml(from)} 님이 작성:<br/>${innerHtml}</blockquote>`,
    text: [
      `${from} 님이 작성:`,
      ...innerText.split('\n').map((line) => `> ${line}`),
    ].join('\n'),
    meta,
    variant: mode,
  };
}
