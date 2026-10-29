// HTML 조립에 쓰는 공용 도구. 그림(figure.mjs)과 책 렌더링(render.mjs)이 같은 이스케이프를 쓰게 한 곳에 둔다.

// HTML 특수문자 이스케이프(제목·alt·속성 값을 안전하게 넣기 위해). 숫자 등 문자열이 아닌 값도 받도록 String() 으로 감싼다.
export const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
