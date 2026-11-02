/**
 * HTML 요소 고르기 공용 모듈(WP-1301) — 격리 iframe 안의 HTML 에서 요소를 눌러 고르고, 고른 요소 정보만 부모에 알린다.
 * 노트 HTML 블록(WikiHtmlEmbedView)과 HTML 문서 페이지의 보이는 화면 편집(WP-1299 §6-3)이 같은 스크립트·메시지 형식을 쓴다.
 *
 * 왜 iframe 안 스크립트인가: 블록은 sandbox 에 allow-same-origin 이 없는 불투명 출처라 부모가 contentDocument 를 만질 수 없다.
 * 그래서 문서 끝에 고르기 스크립트를 붙여 iframe 안에서 마우스·클릭을 다루고, 부모와는 postMessage 로만 주고받는다.
 * 노트 화면·세션·쿠키에는 닿지 않는다 — 오가는 것은 고른 요소의 선택자 경로·태그·이름표·글자 일부·짧은 outerHTML·위치뿐이다.
 *
 * 메시지 검증: 양쪽 모두 보낸 창(event.source)과 블록별 일회 토큰을 본다 — origin 은 불투명 출처라 늘 "null" 이어서 가릴 수 없다.
 * 토큰은 그 블록의 srcdoc 에만 들어가므로, 다른 블록·다른 창은 같은 꼴의 메시지를 보내도 토큰이 틀려 무시된다.
 * 한계: 같은 iframe 안 블록 스크립트는 토큰을 읽을 수 있다(스크립트 글자·부모 명령 메시지) — 그 블록 자신의 고르기 상태는 흉내 낼 수 있으므로
 * 받은 고른 목록(글자·outerHTML)은 블록 소스와 같은 믿음 수준의 입력으로 다룬다.
 */

/** 메시지 종류 — iframe 안 스크립트와 부모가 같은 이름을 쓴다. */
export const HTML_PICKER_MESSAGE = 'wp-html-picker'

/** 고른 요소 하나 — 부모(칩·AI 요청)가 쓰는 정보. 요소 자체는 iframe 밖으로 나오지 않는다. */
export interface PickedElement {
  /** 문서 안 선택자 경로(`main:nth-of-type(1) > h1:nth-of-type(1)`, id 가 있으면 거기서 끊는다) — AI 요청이 고칠 곳을 짚는 데 쓴다. */
  path: string
  /** 태그 이름(소문자). */
  tag: string
  /** 화면 이름표 — 제목·카드·차트·표·버튼 등(htmlPickerKind). */
  kind: string
  /** 글자 일부(공백을 줄인 앞 80자). */
  text: string
  /** outerHTML 앞 300자. */
  html: string
  /** iframe 안 문서 기준 위치(px). */
  rect: { x: number; y: number; width: number; height: number }
}

/** iframe → 부모: 준비됨(새 문서가 떴다), 지금 상태(켜짐·고른 목록), Esc 를 눌렀다. */
export type HtmlPickerEvent =
  | { event: 'ready' }
  | { event: 'state'; enabled: boolean; items: PickedElement[] }
  | { event: 'escape' }

/** 부모 → iframe: 켜기·끄기(끄면 고른 것도 푼다), 고른 것 모두 풀기, 하나 빼기, 하나 강조. */
export type HtmlPickerCommand =
  | { cmd: 'enable' }
  | { cmd: 'disable' }
  | { cmd: 'clear' }
  | { cmd: 'remove'; index: number }
  | { cmd: 'highlight'; index: number }

/**
 * iframe 안에서 도는 순수 판정(이름표·선택자 경로·요소 정보) — 스크립트 글자 그대로 넣고, vitest 는 같은 글자를 jsdom 에서 돌려 확인한다.
 * 문자열 하나가 원본이라 테스트한 코드와 iframe 에 들어가는 코드가 어긋나지 않는다(빌드 도구가 함수를 바꿔 써도 상관없다).
 */
export const HTML_PICKER_CORE = `
function htmlPickerKind(el){
  var t=el.tagName.toLowerCase();
  if(/^h[1-6]$/.test(t))return '제목';
  if(t==='canvas'||t==='svg')return '차트';
  if(el.ownerSVGElement)return '차트 요소';
  if(t==='table')return '표';
  if(t==='tr')return '표 행';
  if(t==='td'||t==='th')return '표 칸';
  if(t==='button'||(t==='input'&&/^(button|submit|reset)$/i.test(el.type||'')))return '버튼';
  if(t==='a')return '링크';
  if(t==='img'||t==='picture'||t==='video')return '이미지';
  if(t==='ul'||t==='ol')return '목록';
  if(t==='li')return '목록 항목';
  if(t==='input'||t==='select'||t==='textarea')return '입력 칸';
  if(t==='p'||t==='span'||t==='strong'||t==='em'||t==='b'||t==='i'||t==='label'||t==='small')return '글';
  var cs=window.getComputedStyle(el);
  var bordered=cs.borderTopStyle!=='none'&&parseFloat(cs.borderTopWidth)>0;
  if(el.children.length>0&&(bordered||parseFloat(cs.borderTopLeftRadius)>0||(cs.boxShadow&&cs.boxShadow!=='none')))return '카드';
  return '영역';
}
// 화면에 보이는 글자(innerText — 블록 사이 줄바꿈이 들어가 「4건목표」처럼 붙지 않는다). 레이아웃이 없는 환경(jsdom)은 textContent.
function htmlPickerText(el,n){return (el.innerText||el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,n)}
function htmlPickerPath(el){
  var parts=[];
  while(el&&el.nodeType===1&&el!==el.ownerDocument.documentElement){
    var t=el.tagName.toLowerCase();
    if(el.id&&/^[A-Za-z][\\w-]*$/.test(el.id)){parts.unshift(t+'#'+el.id);break}
    var i=1,s=el.previousElementSibling;
    while(s){if(s.tagName===el.tagName)i++;s=s.previousElementSibling}
    parts.unshift(t+':nth-of-type('+i+')');
    el=el.parentElement;
  }
  return parts.join(' > ');
}
function htmlPickerInfo(el){
  var r=el.getBoundingClientRect();
  var sx=window.scrollX||0,sy=window.scrollY||0;
  return {
    path:htmlPickerPath(el),
    tag:el.tagName.toLowerCase(),
    kind:htmlPickerKind(el),
    text:htmlPickerText(el,80),
    html:(el.outerHTML||'').slice(0,300),
    rect:{x:Math.round(r.left+sx),y:Math.round(r.top+sy),width:Math.round(r.width),height:Math.round(r.height)}
  };
}
`

/**
 * 안 문서에 붙이는 고르기 스크립트 — 문서 끝에 붙인다(높이 보고 스크립트와 같은 이유: DOCTYPE 앞이면 quirks 모드).
 * - 켜짐(또는 ⌘/Ctrl+클릭): 올린 요소에 점선 + 이름표, 누르면 번호 배지 + 실선. Shift+클릭은 더하기·빼기, 그냥 클릭은 그 하나로 바꾼다.
 * - 켜져 있는 동안 클릭·제출·가운데 클릭을 잡아 블록 안 링크·버튼·폼이 움직이지 않게 한다(캡처 단계 — 블록 스크립트보다 먼저).
 * - 표시는 pointer-events 없는 덮개 하나에 그린다(문서 DOM·스타일을 건드리지 않게). 스크롤·크기 변화에 다시 그린다.
 * - Esc 는 한 단계씩 — 고른 것이 있으면 여기서 바로 푼다(부모를 거치면 빠르게 거듭 누른 Esc 가 풀기 전에 와 단계를 건너뛴다). 고른 것이 없을 때만 부모에 알려 끈다.
 * - 부모 명령은 보낸 창이 parent 이고 토큰이 맞을 때만 받는다. 보내는 쪽 대상 출처는 '*'(부모 출처를 알 수 없음) — 토큰을 실어 보낸다.
 */
export function htmlPickerScript(token: string): string {
  return (
    '<script data-wp-html-picker>(function(){' +
    HTML_PICKER_CORE +
    // 토큰은 JSON 문자열로 넣되 < 를 풀어 쓴다 — 어떤 값이 와도 </script> 로 스크립트를 끊지 못하게.
    `var TOKEN=${JSON.stringify(token).replace(/</g, '\\u003c')},TYPE='${HTML_PICKER_MESSAGE}';` +
    // picks = [{el, info}] — 요소 정보는 고를 때 한 번만 만든다(상태를 보낼 때마다 outerHTML·계산 스타일을 다시 읽지 않게).
    "var enabled=false,picks=[],hover=null,hoverLabel='',layer=null,flash=-1,queued=false;" +
    "function post(m){m.type=TYPE;m.token=TOKEN;parent.postMessage(m,'*')}" +
    "function state(){post({event:'state',enabled:enabled,items:picks.map(function(p){return p.info})})}" +
    'function indexOf(el){for(var i=0;i<picks.length;i++)if(picks[i].el===el)return i;return -1}' +
    "function box(r,solid){var d=document.createElement('div');" +
    "d.style.cssText='position:absolute;box-sizing:border-box;pointer-events:none;border-radius:4px;'+" +
    "'left:'+(r.left+(window.scrollX||0)-2)+'px;top:'+(r.top+(window.scrollY||0)-2)+'px;width:'+(r.width+4)+'px;height:'+(r.height+4)+'px;'+" +
    "'border:2px '+(solid?'solid':'dashed')+' #6366f1;';return d}" +
    "function tag(text,round){var s=document.createElement('span');" +
    "s.textContent=text;s.style.cssText='position:absolute;top:-11px;'+(round?'right:-11px;min-width:20px;height:20px;border-radius:10px;text-align:center;':'left:-2px;border-radius:4px;')+" +
    "'padding:0 6px;background:#6366f1;color:#fff;font:600 11px/20px system-ui,sans-serif;white-space:nowrap';return s}" +
    // 다시 그리기는 프레임당 한 번으로 묶는다 — 스크롤·마우스 움직임마다 덮개를 새로 짓지 않게.
    'function draw(){if(queued)return;queued=true;(window.requestAnimationFrame||setTimeout)(paint)}' +
    'function paint(){queued=false;' +
    "if(!layer||!layer.isConnected){layer=document.createElement('div');layer.setAttribute('data-wp-html-picker-layer','');" +
    "layer.style.cssText='position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483647';document.documentElement.appendChild(layer)}" +
    "layer.textContent='';" +
    'picks.forEach(function(p,i){if(!p.el.isConnected)return;var b=box(p.el.getBoundingClientRect(),true);' +
    "if(i===flash)b.style.boxShadow='0 0 0 4px rgba(99,102,241,.35)';b.appendChild(tag(String(i+1),true));layer.appendChild(b)});" +
    'if(enabled&&hover&&indexOf(hover)<0&&hover.isConnected){var h=box(hover.getBoundingClientRect(),false);' +
    'h.appendChild(tag(hoverLabel,false));layer.appendChild(h)}}' +
    // 이름표는 올린 요소가 바뀔 때만 만든다(그리기마다 계산 스타일·글자를 읽지 않게).
    "function setHover(el){if(el===hover)return;hover=el;if(el){var n=htmlPickerKind(el),tx=htmlPickerText(el,12);hoverLabel=tx?n+' · '+tx:n}draw()}" +
    'function inLayer(el){return layer&&layer.contains(el)}' +
    'function target(e){var el=e.target;if(!el||el.nodeType!==1||inLayer(el))return null;' +
    'if(el===document.documentElement||el===document.body)return null;return el}' +
    "function stop(e){e.preventDefault();e.stopPropagation();if(e.stopImmediatePropagation)e.stopImmediatePropagation()}" +
    "window.addEventListener('mousemove',function(e){if(enabled)setHover(target(e))},true);" +
    "document.documentElement.addEventListener('mouseleave',function(){setHover(null)});" +
    "window.addEventListener('click',function(e){var pick=e.metaKey||e.ctrlKey;if(!enabled&&!pick)return;stop(e);" +
    // Shift+클릭이 만든 글자 선택은 지운다 — 고른 요소 위에 파란 선택이 남지 않게.
    "if(e.shiftKey&&window.getSelection)window.getSelection().removeAllRanges();" +
    'var el=target(e);if(!enabled){enabled=true;setHover(el)}if(!el){draw();state();return}' +
    'var at=indexOf(el),p={el:el,info:htmlPickerInfo(el)};if(e.shiftKey){if(at>=0)picks.splice(at,1);else picks.push(p)}else{picks=[p]}' +
    'flash=-1;draw();state()},true);' +
    "['auxclick','submit','dblclick'].forEach(function(k){window.addEventListener(k,function(e){if(enabled)stop(e)},true)});" +
    // 누름·뗌으로 움직이는 블록 처리기(드롭다운·차트 라이브러리 등)도 고르는 중엔 받지 않게 전파만 끊는다 — 기본 동작(iframe 포커스)은 남겨 Esc 를 받는다.
    "['mousedown','mouseup','pointerdown','pointerup'].forEach(function(k){window.addEventListener(k,function(e){if(enabled){e.stopPropagation();e.stopImmediatePropagation()}},true)});" +
    "window.addEventListener('keydown',function(e){if(e.key==='Escape'&&(enabled||picks.length)){stop(e);if(picks.length){picks=[];draw();state()}else post({event:'escape'})}},true);" +
    "window.addEventListener('scroll',function(){if(picks.length||hover)draw()},true);" +
    "window.addEventListener('resize',function(){if(picks.length||hover)draw()});" +
    "window.addEventListener('message',function(e){var d=e.data;if(e.source!==parent||!d||d.type!==TYPE||d.token!==TOKEN)return;" +
    "if(d.cmd==='enable'){if(!enabled){enabled=true;state()}}" +
    "else if(d.cmd==='disable'){enabled=false;setHover(null);picks=[];draw();state()}" +
    "else if(d.cmd==='clear'){picks=[];draw();state()}" +
    "else if(d.cmd==='remove'){if(d.index>=0&&d.index<picks.length){picks.splice(d.index,1);flash=-1;draw();state()}}" +
    "else if(d.cmd==='highlight'){var p=picks[d.index];if(p){flash=d.index;if(p.el.scrollIntoView)p.el.scrollIntoView({block:'nearest'});draw()}}});" +
    "post({event:'ready'})" +
    '})()</script>'
  )
}

/**
 * 받은 message 이벤트가 이 iframe·이 토큰의 고르기 메시지면 내용을, 아니면 null.
 * 보낸 창이 그 iframe 의 contentWindow 이고 토큰이 같아야 한다 — 다른 블록·다른 창·토큰이 틀린 메시지는 무시한다.
 * 고른 목록은 모양을 다시 가려 꼴이 맞는 것만 받는다(같은 iframe 의 블록 스크립트는 토큰을 읽을 수 있어 흉내 낼 수 있다 — 모듈 머리 「한계」).
 */
export function htmlPickerEventFromMessage(
  event: Pick<MessageEvent, 'source' | 'data'>,
  frameWindow: Window | null | undefined,
  token: string,
): HtmlPickerEvent | null {
  if (!frameWindow || event.source !== frameWindow) return null
  const data = event.data as Record<string, unknown> | null
  if (!data || typeof data !== 'object' || data.type !== HTML_PICKER_MESSAGE || data.token !== token) return null
  if (data.event === 'ready' || data.event === 'escape') return { event: data.event }
  if (data.event !== 'state' || typeof data.enabled !== 'boolean' || !Array.isArray(data.items)) return null
  return { event: 'state', enabled: data.enabled, items: data.items.filter(isPickedElement) }
}

function isPickedElement(v: unknown): v is PickedElement {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  const r = o.rect as Record<string, unknown> | null
  return (
    typeof o.path === 'string' &&
    typeof o.tag === 'string' &&
    typeof o.kind === 'string' &&
    typeof o.text === 'string' &&
    typeof o.html === 'string' &&
    !!r &&
    typeof r === 'object' &&
    ['x', 'y', 'width', 'height'].every((k) => typeof r[k] === 'number')
  )
}

/** 부모 → iframe 명령 보내기 — 토큰을 실어 보낸다(iframe 은 불투명 출처라 대상 출처는 '*'). */
export function postHtmlPickerCommand(frameWindow: Window, token: string, command: HtmlPickerCommand): void {
  frameWindow.postMessage({ type: HTML_PICKER_MESSAGE, token, ...command }, '*')
}

/** 칩 글자 — 이름표와 글자 앞부분(「제목 · 3분기 회고」). 글자가 없으면 이름표만. */
export function pickedLabel(item: Pick<PickedElement, 'kind' | 'text'>, max = 16): string {
  // 코드 포인트 단위로 자른다 — 이모지 같은 서로게이트 쌍이 반쪽으로 잘려 깨진 글자가 되지 않게.
  const chars = Array.from(item.text)
  const text = chars.length > max ? `${chars.slice(0, max).join('')}…` : item.text
  return text ? `${item.kind} · ${text}` : item.kind
}
