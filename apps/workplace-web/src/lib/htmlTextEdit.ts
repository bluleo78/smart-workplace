/**
 * HTML 「글자 고치기」 공용 모듈(WP-1309) — 격리 iframe 안에서 원본 화면의 글자를 눌러 그 자리에서 고치고, 고친 요소의 번호와 innerHTML 만 부모에 알린다.
 * 요소 고르기(lib/htmlPicker, WP-1301)와 같은 꼴(iframe 안 스크립트 + postMessage + 블록별 일회 토큰)이고, 같은 iframe 에 함께 넣는다.
 * HTML 문서 페이지의 「편집」(보이는 화면 편집, 설계 WP-1299 §6-3)과 노트 HTML 블록의 「글자 고치기」가 쓴다.
 *
 * 무엇을 고칠 수 있나: 부모가 원본에 단 번호(data-wp-src)·지문(data-wp-t)으로 가린다(lib/htmlTextEditSource 머리 주석).
 * iframe 은 지문이 달린 요소 중 ① 번호가 문서에 하나뿐이고 ② 자손이 모두 번호를 가졌고 ③ 지금 글자 지문이 원본과 같은 것만 고치게 한다 —
 * 스크립트가 만든 요소·스크립트가 글자를 바꾼 요소(차트 숫자 등)는 점선이 뜨지 않고 눌러도 고쳐지지 않는다(→ ◎ 고르기 + AI로 고치기).
 *
 * 메시지 검증: 고르기와 같다 — 보낸 창(event.source)과 일회 토큰. 같은 iframe 안 문서 스크립트는 토큰을 읽어 흉내 낼 수 있으므로
 * 부모는 받은 고친 것을 다시 판정·정리한다(고칠 수 있는 요소인지, 허용한 인라인 서식만 — prepareHtmlTextEdit 의 apply). 붙여넣기도 부모의 정리기를 거쳐 들어간다.
 */
import { frameMessageData, frameScriptPrelude } from './frameMessages'
import { HTML_EDIT_PARAGRAPH_TAGS, HTML_EDIT_SIG_ATTR, HTML_EDIT_SRC_ATTR, type HtmlTextEdit } from './htmlTextEditSource'

/** 메시지 종류 — iframe 안 스크립트와 부모가 같은 이름을 쓴다(고르기 wp-html-picker 와 다르다). */
export const HTML_TEXT_EDIT_MESSAGE = 'wp-html-edit'
/** 새 문단 표지 — iframe 안에서만 쓰고 원본에는 남지 않는다(되돌리기는 메시지의 ref·after 로 만든다). */
export const HTML_EDIT_NEW_ATTR = 'data-wp-new'
/** 새 문단이 붙을 앞 요소 ref — iframe 안에서만 쓴다. */
export const HTML_EDIT_AFTER_ATTR = 'data-wp-after'
/**
 * 편집 화면이 요소에 다는 표지 전부 — 원본에 없는 속성이라 고르기(htmlPicker)가 AI 에 보낼 outerHTML 에서 걷는다.
 * contenteditable 은 고치는 요소에 켜 둔 것이다(고르기를 켜는 순간 아직 꺼지지 않았을 수 있다).
 */
export const HTML_EDIT_MARK_ATTRS = [HTML_EDIT_SRC_ATTR, HTML_EDIT_SIG_ATTR, HTML_EDIT_NEW_ATTR, HTML_EDIT_AFTER_ATTR, 'contenteditable'] as const
/** 받은 고친 것 하나의 HTML 상한(UTF-16) — 문서 상한(5MB)보다 작게, 흉내 낸 큰 메시지로 부모가 오래 붙잡히지 않게. */
const MAX_EDIT_HTML = 2_000_000

/** iframe → 부모: 준비됨, 고친 것(지난번 보낸 뒤 바뀐 요소만 — 끌 때·멈출 때·flush 에 바로, 입력 중엔 잠깐 쉬면), 붙여넣기(정리해 돌려 달라). */
export type HtmlTextEditEvent =
  | { event: 'ready' }
  | { event: 'edits'; items: HtmlTextEdit[] }
  | { event: 'paste'; html: string; text: string }

/** 부모 → iframe: 멈추기(고르기 중 — 편집을 끝내고 점선을 끈다)·다시 켜기, 고친 것 바로 보내기, 정리한 붙여넣기 넣기. */
export type HtmlTextEditCommand = { cmd: 'pause' } | { cmd: 'resume' } | { cmd: 'flush' } | { cmd: 'insert'; html: string }

/**
 * iframe 안에서 도는 순수 판정 — 문자열 하나가 원본이라 테스트(같은 글자를 jsdom 에서 돌린다)와 iframe 에 들어가는 코드가 어긋나지 않는다.
 * - wpSig: 글자 지문(lib/htmlTextEditSource 의 htmlTextSignature 와 같은 계산).
 * - wpBarPos(t, c, w, h, vw, vh, cost): 떠 있는 서식 도구 자리(창 좌표). t 는 고치는 요소 상자, c 는 그 글자가 차지한 상자(Range),
 *   w·h 는 도구 크기, vw·vh 는 창 크기, cost(사각형) 는 그 자리가 가리는 남의 글자 넓이(iframe 이 elementFromPoint 로 잰다).
 *   후보는 ① 요소 위(8px 띄움) ② 글자 오른쪽(같은 줄 높이) ③ 요소 아래 — 창 안에 들고 고치는 글자(c)와 겹치지 않는 것 중
 *   남의 글자를 가리지 않는 첫 후보, 없으면 가장 덜 가리는 후보. 셋 다 안 들면(창보다 큰 요소) 창 안에 붙여 둔다(pinned).
 *   요소 바로 위 줄(카드의 이름표 등)을 가리면 글자 오른쪽·아래로 옮긴다 — 라이브 검증에서 값 위 이름표가 가려졌다.
 * - wpBarFits: 이미 둔 자리를 그대로 써도 되나(창 안·고치는 글자와 안 겹침) — 입력마다 도구가 뛰지 않게 iframe 은 자리를 기억하고 이것으로만 다시 본다.
 */
export const HTML_TEXT_EDIT_CORE = `
function wpSig(t){var s=String(t).replace(/\\s+/g,' ').trim(),h=0x811c9dc5;
for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0}
return h.toString(36)}
function wpHit(a,b){return a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom}
function wpRect(l,t,w,h){return{left:l,top:t,right:l+w,bottom:t+h}}
function wpBarFits(l,t,c,w,h,vw,vh){var M=4,G=2;return l>=M&&t>=M&&l+w<=vw-M&&t+h<=vh-M&&
!wpHit(wpRect(l,t,w,h),{left:c.left-G,top:c.top-G,right:c.right+G,bottom:c.bottom+G})}
function wpBarPos(t,c,w,h,vw,vh,cost){var G=8,M=4,x=Math.max(M,Math.min(t.left,vw-w-M));
var cs=[['above',x,t.top-h-G],['right',c.right+G,c.top+(c.bottom-c.top-h)/2],['below',x,t.bottom+G]],best=null,bc=Infinity;
for(var i=0;i<cs.length;i++){var k=cs[i];if(!wpBarFits(k[1],k[2],c,w,h,vw,vh))continue;var v=cost?cost(wpRect(k[1],k[2],w,h)):0;
if(v<=0)return{side:k[0],left:k[1],top:k[2]};if(v<bc){bc=v;best={side:k[0],left:k[1],top:k[2]}}}
return best||{side:'pinned',left:x,top:Math.max(M,Math.min(t.top-h-G,vh-h-M))}}
`

/** 서식 도구 「색」의 견본 — 원본 문서 배경을 알 수 없어 밝은·어두운 배경 모두에서 읽히는 중간 밝기 색만 둔다. iframe 안 문서라 앱 토큰을 쓸 수 없다. */
const TEXT_COLORS: ReadonlyArray<[string, string]> = [
  ['검정', '#111827'],
  ['빨강', '#dc2626'],
  ['주황', '#ea580c'],
  ['초록', '#16a34a'],
  ['파랑', '#2563eb'],
  ['보라', '#7c3aed'],
  ['회색', '#6b7280'],
]

/**
 * 안 문서에 붙이는 글자 고치기 스크립트 — 고르기 스크립트 뒤(문서 끝)에 붙인다. 고르기가 켜져 있으면 고르기가 클릭을 먼저 잡고(캡처 단계, 먼저 등록),
 * 부모가 「pause」 를 보내 점선·편집을 끈다.
 * - 올리면: 고칠 수 있는 요소에 점선. 누르면(mousedown 에서 contenteditable 을 켜 브라우저가 그 자리에 커서를 둔다) 실선 + 떠 있는 서식 도구.
 *   고칠 수 있는 요소 위의 누름·클릭은 문서 스크립트에 넘기지 않고 링크도 열지 않는다. 다른 곳은 그대로(탭 단추 등은 동작한다).
 * - 서식 도구: 굵게·기울임(execCommand), 링크(주소 칸 — http(s)·mailto 만), 색(견본), 문단 추가(뒤에 새 문단 — 목록이면 새 항목).
 *   자리는 wpBarPos(HTML_TEXT_EDIT_CORE) 가 고른다 — 고치는 글자와 겹치지 않고 남의 글자(바로 위 이름표 등)를 가리지 않는 위·오른쪽·아래 중 하나. 고른 자리는 기억해 입력마다 뛰지 않는다.
 *   단추 mousedown 은 기본 동작을 막아 커서·선택이 고치는 요소에 남는다. 대화상자(prompt)는 sandbox 가 막아 쓰지 않는다.
 * - Enter: 문단 요소면 커서 뒤를 새 문단으로 나누고, 그 밖(표 칸·인라인)은 줄바꿈. Shift+Enter 는 늘 줄바꿈. IME 조합 중 Enter 는 건드리지 않는다.
 *   Esc 는 편집을 끝낸다(열린 주소·색 칸이 있으면 칸만 닫는다). 고치는 동안 키는 문서 스크립트에 넘기지 않는다(슬라이드 넘김 등).
 * - 붙여넣기: 기본 동작을 막고 클립보드 HTML·글자를 부모에 보내, 정리기를 거친 HTML 을 받아 커서 자리에 넣는다 — 웹에서 복사한 굵게·기울임·링크·색이 남는다.
 *   끌어다 놓기는 막는다(정리기를 거치지 않은 HTML 이 들어오지 않게).
 * - 보내기: 입력이 300ms 쉬면, 그리고 편집을 끝낼 때·부모의 flush 에 지난번 보낸 뒤 바뀐 요소의 innerHTML 만 보낸다(부모가 ref 별로 합친다).
 *   flush 에는 바뀐 것이 없어도 빈 목록으로 답한다 — 부모가 답을 기다린다.
 * - 고칠 수 있나 판정(문서를 훑는다)은 요소별로 기억하고, 문서가 바뀌면(MutationObserver — 표시·서식 도구 변화는 빼고) 잊는다.
 * - 표시는 pointer-events 없는 덮개와 서식 도구 하나 — 둘 다 <html> 의 자식이라 고치는 요소의 innerHTML 에 섞이지 않는다.
 */
export function htmlTextEditScript(token: string): string {
  const colors = TEXT_COLORS.map(([name, value]) => `['${name}','${value}']`).join(',')
  return (
    '<script data-wp-html-edit>(function(){' +
    HTML_TEXT_EDIT_CORE +
    // TOKEN·TYPE·post·fromParent — 고르기 스크립트와 같은 머리(lib/frameMessages).
    frameScriptPrelude(HTML_TEXT_EDIT_MESSAGE, token) +
    `var SRC='${HTML_EDIT_SRC_ATTR}',SIG='${HTML_EDIT_SIG_ATTR}',NEW='${HTML_EDIT_NEW_ATTR}',AFTER='${HTML_EDIT_AFTER_ATTR}',UI='data-wp-html-edit-ui';` +
    `var PARA=/^(${HTML_EDIT_PARAGRAPH_TAGS.join('|')})$/,COLORS=[${colors}];` +
    // 새 문단 id 는 이 문서마다 다른 앞머리를 붙인다 — iframe 이 다시 떠도 앞서 받은 새 문단 ref 와 겹치지 않게.
    "var paused=false,active=null,hover=null,dirty=[],pending=[],verdict=new WeakMap(),seq=0,run=Math.random().toString(36).slice(2,8),layer=null,bar=null,paraBtn=null,linkRow=null,linkInput=null,colorRow=null,panel='',saved=null,timer=0,queued=false,barAt=null;" +
    "function tagOf(el){return el.tagName.toLowerCase()}" +
    'function inUi(n){while(n){if(n.nodeType===1&&n.hasAttribute(UI))return true;n=n.parentNode}return false}' +
    'function isDirty(el){return dirty.indexOf(el)>=0}' +
    // 고친 요소 표시 — dirty(한 번이라도 고침: 지문이 바뀌어도 계속 고칠 수 있다)와 pending(다음 보내기에 실을 것).
    'function mark(el){if(!isDirty(el))dirty.push(el);if(pending.indexOf(el)<0)pending.push(el)}' +
    // 원본 요소 판정 — 번호가 하나뿐 + 자손 모두 번호 + 글자 지문이 원본과 같을 때. 문서를 훑으므로 결과를 verdict 에 기억한다.
    'function check(el){var k=el.getAttribute(SRC);if(k==null||!/^\\d+$/.test(k))return false;' +
    "if(document.querySelectorAll('['+SRC+'=\"'+k+'\"]').length!==1)return false;" +
    'var all=el.getElementsByTagName(\'*\');for(var i=0;i<all.length;i++)if(!all[i].hasAttribute(SRC))return false;' +
    'return wpSig(el.textContent||\'\')===el.getAttribute(SIG)}' +
    // 고칠 수 있나 — 새 문단·이미 고친 요소는 그대로, 원본 요소는 기억한 판정(없으면 check).
    'function ok(el){if(el.hasAttribute(NEW)||isDirty(el))return true;var v=verdict.get(el);if(v===undefined){v=check(el);verdict.set(el,v)}return v}' +
    // 문서가 바뀌면(문서 스크립트가 요소를 만들거나 글자를 바꿈·번호 속성 변화) 기억한 판정을 잊는다 — 표시 덮개·서식 도구 안 변화는 뺀다(그리기마다 잊지 않게).
    'function uiOnly(ns){for(var i=0;i<ns.length;i++)if(!inUi(ns[i]))return false;return true}' +
    "new MutationObserver(function(rs){for(var i=0;i<rs.length;i++){var r=rs[i];if(inUi(r.target))continue;" +
    "if(r.type==='childList'&&uiOnly(r.addedNodes)&&uiOnly(r.removedNodes))continue;verdict=new WeakMap();return}})" +
    '.observe(document.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:[SRC,SIG]});' +
    'function editable(t){while(t&&t.nodeType!==1)t=t.parentNode;if(!t||inUi(t)||!t.closest)return null;if(active&&active.contains(t))return active;' +
    "var el=t.closest('['+NEW+'],['+SIG+']');return el&&ok(el)?el:null}" +
    "function ref(el){return el.hasAttribute(NEW)?'n:'+el.getAttribute(NEW):'s:'+el.getAttribute(SRC)}" +
    // 보내기 — 지난번 보낸 뒤 바뀐 요소만(문서에서 떨어진 것은 뺀다). 새 문단은 만든 순서(pending 순서)라 앞 문단이 먼저 온다 — 부모가 처음 받은 순서로 넣는다.
    'function send(){clearTimeout(timer);timer=0;var items=[];pending.forEach(function(el){if(!el.isConnected)return;' +
    "if(el.hasAttribute(NEW))items.push({ref:ref(el),after:el.getAttribute(AFTER),cls:el.getAttribute('class')||undefined,html:el.innerHTML});" +
    "else items.push({ref:ref(el),html:el.innerHTML})});pending=[];post({event:'edits',items:items})}" +
    'function schedule(){clearTimeout(timer);timer=setTimeout(send,300)}' +
    'function touched(){if(!active)return;mark(active);schedule();draw()}' +
    // 표시 — 점선(올린 것)·실선(고치는 것). 프레임당 한 번만 다시 그린다.
    "function mk(t){return document.createElement(t)}" +
    "function box(r,solid){var d=mk('div');d.style.cssText='position:absolute;box-sizing:border-box;pointer-events:none;border-radius:4px;'+" +
    "'left:'+(r.left+(window.scrollX||0)-3)+'px;top:'+(r.top+(window.scrollY||0)-3)+'px;width:'+(r.width+6)+'px;height:'+(r.height+6)+'px;'+" +
    "'border:'+(solid?'2px solid':'1.5px dashed')+' #6366f1';return d}" +
    'function draw(){if(queued)return;queued=true;(window.requestAnimationFrame||setTimeout)(paint)}' +
    'function paint(){queued=false;' +
    "if(!layer||!layer.isConnected){layer=mk('div');layer.setAttribute(UI,'');layer.setAttribute('data-wp-html-edit-layer','');" +
    "layer.style.cssText='position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483646';document.documentElement.appendChild(layer)}" +
    "layer.textContent='';if(!paused&&hover&&hover!==active&&hover.isConnected)layer.appendChild(box(hover.getBoundingClientRect(),false));" +
    "if(active&&active.isConnected){layer.appendChild(box(active.getBoundingClientRect(),true));placeBar()}else if(bar)bar.style.display='none'}" +
    // 서식 도구 — 어두운 막대(원본 배경과 상관없이 보이게). 단추 mousedown 은 막아 선택을 지킨다.
    "var BTN='all:unset;box-sizing:border-box;cursor:pointer;padding:6px 8px;border-radius:5px;color:#fff;font:600 12px/1 system-ui,sans-serif;white-space:nowrap';" +
    // noHover — 견본처럼 배경이 곧 내용인 단추는 올려도 배경을 바꾸지 않는다.
    "function btn(label,title,fn,extra,noHover){var b=mk('button');b.type='button';b.textContent=label;b.title=title;b.setAttribute('aria-label',title);" +
    "b.style.cssText=BTN+(extra||'');b.addEventListener('mousedown',function(e){e.preventDefault();e.stopPropagation()});" +
    "b.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();fn()});" +
    "if(!noHover){b.addEventListener('mouseenter',function(){b.style.background='rgba(255,255,255,.15)'});b.addEventListener('mouseleave',function(){b.style.background='transparent'})}return b}" +
    'function makeBar(){' +
    "bar=mk('div');bar.setAttribute(UI,'');bar.setAttribute('data-wp-html-edit-bar','');bar.setAttribute('role','toolbar');bar.setAttribute('aria-label','서식');" +
    "bar.style.cssText='position:absolute;z-index:2147483647;display:none;flex-direction:column;gap:4px;padding:4px;background:#111827;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.3)';" +
    "var row=mk('div');row.style.cssText='display:flex;gap:2px;align-items:center';" +
    "row.appendChild(btn('B','굵게',function(){exec('bold')},'font-weight:800'));" +
    "row.appendChild(btn('I','기울임',function(){exec('italic')},'font-style:italic;font-family:Georgia,serif'));" +
    "row.appendChild(btn('링크','링크',function(){toggle('link')}));" +
    "row.appendChild(btn('색','글자색',function(){toggle('color')}));" +
    "paraBtn=btn('+ 문단','문단 추가',function(){addPara(false)});row.appendChild(paraBtn);bar.appendChild(row);" +
    "linkRow=mk('div');linkRow.style.cssText='display:none;gap:4px;align-items:center';linkInput=mk('input');linkInput.type='url';linkInput.placeholder='https://';" +
    "linkInput.setAttribute('aria-label','링크 주소');linkInput.style.cssText='all:unset;box-sizing:border-box;width:200px;padding:5px 7px;border-radius:5px;background:#fff;color:#111827;font:12px/1.2 system-ui,sans-serif';" +
    "linkInput.addEventListener('keydown',function(e){e.stopPropagation();if(e.key==='Enter'&&!e.isComposing){e.preventDefault();applyLink()}else if(e.key==='Escape'){e.preventDefault();closePanel(true)}});" +
    "linkRow.appendChild(linkInput);linkRow.appendChild(btn('적용','링크 적용',applyLink));bar.appendChild(linkRow);" +
    "colorRow=mk('div');colorRow.style.cssText='display:none;gap:4px;align-items:center;padding:2px';" +
    "COLORS.forEach(function(c){colorRow.appendChild(btn('',c[0],function(){color(c[1])},'width:20px;height:20px;padding:0;border-radius:10px;border:2px solid #fff;background:'+c[1],true))});" +
    'bar.appendChild(colorRow);document.documentElement.appendChild(bar)}' +
    // 자리 — 기억한 자리(문서 좌표 barAt)가 아직 맞으면(창 안·고치는 글자와 안 겹침) 그대로, 아니면 wpBarPos 로 새로 고른다(입력마다 뛰지 않게).
    "function textBox(el,r){var g=document.createRange();g.selectNodeContents(el);var c=g.getBoundingClientRect();return c.width||c.height?c:r}" +
    // 가리는 남의 글자 넓이 — 후보 안 12점의 맨 위 요소(도구는 잠깐 숨긴다)마다 글자 줄 상자와 겹친 넓이를 더한다. 그림·svg 등은 요소 상자째.
    "function overlap(a,b){return Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top))}" +
    "function covers(rc){var seen=[],sum=0,root=document.documentElement;bar.style.visibility='hidden';" +
    'for(var i=0;i<4;i++)for(var j=0;j<3;j++){var e=document.elementFromPoint(rc.left+(i+.5)*(rc.right-rc.left)/4,rc.top+(j+.5)*(rc.bottom-rc.top)/3);' +
    'if(!e||e===root||e===document.body||inUi(e)||seen.indexOf(e)>=0)continue;seen.push(e);' +
    "if(e.namespaceURI!=='http://www.w3.org/1999/xhtml'||/^(img|canvas|video|iframe|object|embed|input|button|select|textarea)$/.test(tagOf(e))){sum+=overlap(e.getBoundingClientRect(),rc);continue}" +
    'var tw=document.createTreeWalker(e,4),n,k=0,g=document.createRange();while((n=tw.nextNode())&&k++<200){if(!/\\S/.test(n.data))continue;' +
    "g.selectNodeContents(n);var ls=g.getClientRects();for(var q=0;q<ls.length;q++)sum+=overlap(ls[q],rc)}}bar.style.visibility='';return sum}" +
    'function placeBar(){if(!bar)makeBar();bar.style.display=\'flex\';var r=active.getBoundingClientRect(),c=textBox(active,r),sx=window.scrollX||0,sy=window.scrollY||0;' +
    'var h=bar.offsetHeight||32,w=bar.offsetWidth||200,vw=window.innerWidth||800,vh=window.innerHeight||600;' +
    'if(!barAt||!wpBarFits(barAt.x-sx,barAt.y-sy,c,w,h,vw,vh)){var p=wpBarPos(r,c,w,h,vw,vh,covers);barAt={x:p.left+sx,y:p.top+sy}}' +
    "bar.style.top=barAt.y+'px';bar.style.left=barAt.x+'px';" +
    "var can=PARA.test(tagOf(active));paraBtn.disabled=!can;paraBtn.style.opacity=can?'1':'.4';paraBtn.style.cursor=can?'pointer':'default'}" +
    // 선택 저장·되돌리기 — 주소 칸으로 포커스가 옮겨 가도 고칠 자리를 잃지 않게.
    'function saveRange(){var s=window.getSelection();saved=s&&s.rangeCount&&active&&active.contains(s.getRangeAt(0).commonAncestorContainer)?s.getRangeAt(0).cloneRange():null}' +
    'function restore(){if(!saved)return;var s=window.getSelection();s.removeAllRanges();s.addRange(saved)}' +
    "function toggle(p){if(panel===p){closePanel(true);return}saveRange();panel=p;linkRow.style.display=p==='link'?'flex':'none';colorRow.style.display=p==='color'?'flex':'none';" +
    "if(p==='link'){linkInput.value='';linkInput.focus()}draw()}" +
    "function closePanel(refocus){panel='';if(linkRow){linkRow.style.display='none';colorRow.style.display='none'}if(refocus&&active){active.focus();restore()}draw()}" +
    'function exec(cmd,val){if(!active)return;document.execCommand(cmd,false,val);touched()}' +
    "function color(c){if(!active)return;document.execCommand('styleWithCSS',false,true);exec('foreColor',c);document.execCommand('styleWithCSS',false,false);closePanel(true)}" +
    "function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;')}" +
    "function applyLink(){var v=(linkInput.value||'').trim();closePanel(true);if(!v||!active)return;if(!/^[a-z][a-z0-9+.-]*:/i.test(v))v='https://'+v;" +
    'if(!/^(https?:\\/\\/|mailto:)/i.test(v)||/[\\s<>"]/.test(v))return;var s=window.getSelection();' +
    "if(!s.rangeCount||s.isCollapsed)exec('insertHTML','<a href=\"'+esc(v)+'\">'+esc(v)+'</a>');else exec('createLink',v)}" +
    // 편집 켜기·끄기 — 끌 때 바로 보낸다(부모 「저장」 이 쉬는 300ms 를 기다리지 않게).
    "function activate(el){if(active===el)return;if(active)deactivate();active=el;barAt=null;el.setAttribute('contenteditable','true');draw()}" +
    "function deactivate(){var el=active;active=null;barAt=null;closePanel(false);if(el)el.removeAttribute('contenteditable');if(timer)send();draw()}" +
    // 문단 추가 — split 이면 커서 뒤 글자를 새 문단으로 옮긴다(Enter). 새 문단은 앞 문단의 class 를 이어받는다(같은 태그일 때).
    'function addPara(split){var a=active;if(!a||!PARA.test(tagOf(a))||!a.parentNode)return;var t=tagOf(a)===\'li\'?\'li\':\'p\',n=mk(t);' +
    "if(tagOf(a)===t&&a.getAttribute('class'))n.setAttribute('class',a.getAttribute('class'));n.setAttribute(NEW,run+(++seq));n.setAttribute(AFTER,ref(a));" +
    'if(split){var s=window.getSelection();if(s.rangeCount){var r=s.getRangeAt(0);if(a.contains(r.startContainer)&&a.contains(r.endContainer)){r.deleteContents();' +
    'var tail=document.createRange();tail.setStart(r.endContainer,r.endOffset);tail.setEnd(a,a.childNodes.length);var f=tail.extractContents();' +
    "if((f.textContent||'').trim()||(f.querySelector&&f.querySelector('img')))n.appendChild(f)}}}" +
    "if(!n.firstChild)n.appendChild(mk('br'));a.parentNode.insertBefore(n,a.nextSibling);mark(a);mark(n);activate(n);n.focus();" +
    'var g=document.createRange();g.setStart(n,0);g.collapse(true);var sel=window.getSelection();sel.removeAllRanges();sel.addRange(g);schedule();draw()}' +
    // 정리된 붙여넣기 넣기 — 커서 자리(없으면 끝)에 넣고 커서를 그 뒤로.
    'function insertHtml(html){if(!active)return;active.focus();restore();var s=window.getSelection(),r=s.rangeCount?s.getRangeAt(0):null;' +
    'if(!r||!active.contains(r.commonAncestorContainer)){r=document.createRange();r.selectNodeContents(active);r.collapse(false)}' +
    "r.deleteContents();var t=mk('template');t.innerHTML=html;var f=t.content,last=f.lastChild;r.insertNode(f);" +
    'if(last){r.setStartAfter(last);r.collapse(true);s.removeAllRanges();s.addRange(r)}touched()}' +
    'function within(t){return active&&t&&(t===active||active.contains(t))}' +
    "function stop(e){e.stopPropagation();if(e.stopImmediatePropagation)e.stopImmediatePropagation()}" +
    // 고치는 요소 표시용 스타일 — 브라우저 포커스 테두리 대신 실선 상자를 쓴다. iframe 문서에만 있고 원본에는 들어가지 않는다.
    "var st=mk('style');st.setAttribute(UI,'');st.textContent='['+NEW+'],[contenteditable=\"true\"]['+SRC+']{outline:none;cursor:text}';(document.head||document.documentElement).appendChild(st);" +
    // 같은 요소 위의 움직임은 다시 판정하지 않는다(판정이 문서를 훑는다 — 큰 문서에서 마우스마다 돌지 않게).
    "var lastT=null;window.addEventListener('mousemove',function(e){if(paused||e.target===lastT)return;lastT=e.target;var el=editable(e.target);if(el!==hover){hover=el;draw()}},true);" +
    "document.documentElement.addEventListener('mouseleave',function(){lastT=null;if(hover){hover=null;draw()}});" +
    "window.addEventListener('mousedown',function(e){if(paused||e.button!==0||e.metaKey||e.ctrlKey||inUi(e.target))return;var el=editable(e.target);if(!el)return;stop(e);if(el!==active)activate(el)},true);" +
    "window.addEventListener('click',function(e){if(paused||inUi(e.target))return;if(!editable(e.target))return;e.preventDefault();stop(e)},true);" +
    "['mouseup','pointerdown','pointerup','dblclick'].forEach(function(k){window.addEventListener(k,function(e){if(!paused&&!inUi(e.target)&&within(e.target))stop(e)},true)});" +
    // 고치는 요소에서 포커스가 문서 안 다른 곳으로 가면 끝낸다. 창 밖(부모 화면 단추)으로 가면 그대로 둔다 — 부모가 flush 로 받아 간다.
    "document.addEventListener('focusout',function(e){if(!active||e.target!==active||inUi(e.relatedTarget))return;setTimeout(function(){" +
    'if(!active)return;var ae=document.activeElement;if(ae===active||inUi(ae)||!document.hasFocus())return;deactivate()},0)},true);' +
    "document.addEventListener('keydown',function(e){if(!within(e.target))return;stop(e);" +
    "if(e.key==='Escape'){e.preventDefault();if(panel){closePanel(true);return}var el=active;deactivate();if(el.blur)el.blur();return}" +
    "if(e.key==='Enter'&&!e.isComposing&&e.keyCode!==229){e.preventDefault();if(e.shiftKey||!PARA.test(tagOf(active)))exec('insertLineBreak');else addPara(true)}},true);" +
    "['keyup','keypress'].forEach(function(k){document.addEventListener(k,function(e){if(within(e.target))stop(e)},true)});" +
    "document.addEventListener('input',function(e){if(within(e.target))touched()},true);" +
    "document.addEventListener('paste',function(e){if(!within(e.target))return;e.preventDefault();stop(e);var d=e.clipboardData;if(!d)return;saveRange();" +
    "var h=d.getData('text/html')||'';post({event:'paste',html:h.length>2000000?'':h,text:d.getData('text/plain')||''})},true);" +
    "['dragover','drop'].forEach(function(k){document.addEventListener(k,function(e){if(within(e.target)){e.preventDefault();stop(e)}},true)});" +
    "window.addEventListener('scroll',function(){if(active||hover)draw()},true);" +
    "window.addEventListener('resize',function(){if(active||hover)draw()});" +
    "window.addEventListener('message',function(e){var d=fromParent(e);if(!d)return;" +
    "if(d.cmd==='pause'){paused=true;hover=null;lastT=null;if(active)deactivate();draw()}" +
    "else if(d.cmd==='resume'){paused=false}" +
    "else if(d.cmd==='flush'){send()}" +
    "else if(d.cmd==='insert'&&typeof d.html==='string'){insertHtml(d.html)}});" +
    "post({event:'ready'})" +
    '})()</script>'
  )
}

/** ref 꼴 — 원본 요소 `s:<번호>` 또는 새 문단 `n:<id>`. */
const EDIT_REF = /^(s:\d{1,9}|n:[\w-]{1,40})$/

function isHtmlTextEdit(v: unknown): v is HtmlTextEdit {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.ref === 'string' &&
    EDIT_REF.test(o.ref) &&
    typeof o.html === 'string' &&
    o.html.length <= MAX_EDIT_HTML &&
    (o.after === undefined || o.after === null || (typeof o.after === 'string' && EDIT_REF.test(o.after))) &&
    (o.cls === undefined || o.cls === null || typeof o.cls === 'string')
  )
}

/**
 * 받은 message 이벤트가 이 iframe·이 토큰의 글자 고치기 메시지면 내용을, 아니면 null.
 * 보낸 창이 그 iframe 의 contentWindow 이고 토큰이 같아야 한다. 고친 목록은 꼴이 맞는 것만 받는다(ref 꼴·크기 상한).
 */
export function htmlTextEditEventFromMessage(
  event: Pick<MessageEvent, 'source' | 'data'>,
  frameWindow: Window | null | undefined,
  token: string,
): HtmlTextEditEvent | null {
  const data = frameMessageData(event, frameWindow, HTML_TEXT_EDIT_MESSAGE, token)
  if (!data) return null
  if (data.event === 'ready') return { event: 'ready' }
  if (data.event === 'paste') {
    if (typeof data.html !== 'string' || typeof data.text !== 'string') return null
    return { event: 'paste', html: data.html.slice(0, MAX_EDIT_HTML), text: data.text.slice(0, MAX_EDIT_HTML) }
  }
  if (data.event !== 'edits' || !Array.isArray(data.items)) return null
  const items = data.items.filter(isHtmlTextEdit).map((o) => {
    const item: HtmlTextEdit = { ref: o.ref, html: o.html }
    if (typeof o.after === 'string') item.after = o.after
    if (typeof o.cls === 'string') item.cls = o.cls
    return item
  })
  return { event: 'edits', items }
}
