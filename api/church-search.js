/**
 * 교회 검색 프록시 — 네이버 지역검색 API (Vercel Serverless Function 형식)
 *
 * 배포 후 엔드포인트: GET /api/church-search?q=검색어
 *
 * ── 왜 프록시가 필요한가 ────────────────────────────────────────────────
 * 등록폼(정적 HTML)에서 openapi.naver.com 을 직접 fetch 할 수 없다.
 *   1) 네이버 오픈API는 브라우저 origin에 CORS를 허용하지 않는다 → 브라우저가 차단.
 *   2) 호출에 Client Secret이 필요한데, 프론트에 넣으면 누구나 열람 가능 → 유출.
 * 그래서 키는 서버 환경변수에만 두고, 이 함수가 대신 호출해서 결과만 돌려준다.
 *
 * ── 필요한 환경변수 (배포 대시보드에서 설정) ──────────────────────────
 * 2026년 7월부터 검색 API 신규 신청은 개발자센터가 아니라 "NAVER API HUB"
 * (네이버클라우드 콘솔)에서만 받는다. 그래서 두 방식을 모두 지원한다:
 *   [신규/권장] NAVER_APIHUB_KEY_ID, NAVER_APIHUB_KEY
 *               발급: ncloud.com 콘솔 → NAVER API HUB → 이용 신청 → Application 등록("검색" 선택)
 *   [기존 키]   NAVER_CLIENT_ID, NAVER_CLIENT_SECRET (developers.naver.com 발급분, 2027-06-30까지)
 */

const NAVER_APIHUB_ENDPOINT = "https://naverapihub.apigw.ntruss.com/search/v1/local";
const NAVER_LEGACY_ENDPOINT = "https://openapi.naver.com/v1/search/local.json";

// 지역검색 API는 display 최댓값이 5다. (그 이상 요청하면 에러)
const DISPLAY = 5;

function decodeEntities(s) {
  return String(s == null ? "" : s)
    .replace(/<[^>]*>/g, "") // 네이버는 검색어 부분을 <b>로 감싸서 준다
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function normalize(item) {
  return {
    name: decodeEntities(item.title),
    address: decodeEntities(item.address),
    roadAddress: decodeEntities(item.roadAddress),
    category: decodeEntities(item.category),
    telephone: decodeEntities(item.telephone),
    link: item.link || "",
    mapx: item.mapx || "",
    mapy: item.mapy || "",
  };
}

function looksLikeChurch(c) {
  return c.category.indexOf("교회") !== -1 || c.name.indexOf("교회") !== -1;
}

/* 인증 방식 2가지를 모두 지원한다. 둘 다 설정돼 있으면 API HUB 쪽을 쓴다.
 *  [신규/권장] NAVER API HUB — 네이버클라우드 콘솔에서 발급 (2026-07부터 신규 신청은 이쪽만 가능)
 *  [기존 키]   developers.naver.com 발급분 — 2027-06-30까지 한시 지원 */
function naverCredentials() {
  const hubId = process.env.NAVER_APIHUB_KEY_ID;
  const hubKey = process.env.NAVER_APIHUB_KEY;
  if (hubId && hubKey) {
    return {
      url: NAVER_APIHUB_ENDPOINT,
      headers: { "X-NCP-APIGW-API-KEY-ID": hubId, "X-NCP-APIGW-API-KEY": hubKey },
      extraParams: "&format=json"
    };
  }
  const id = process.env.NAVER_CLIENT_ID;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if (id && secret) {
    return {
      url: NAVER_LEGACY_ENDPOINT,
      headers: { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret },
      extraParams: ""
    };
  }
  return null;
}

async function searchChurches(q) {
  const cred = naverCredentials();
  if (!cred) {
    const err = new Error("naver_credentials_missing");
    err.statusCode = 503;
    throw err;
  }

  // 검색어에 "교회"가 없으면 붙여서 교회 위주로 결과가 나오게 한다.
  const query = q.indexOf("교회") !== -1 ? q : q + " 교회";
  const url =
    cred.url +
    "?query=" +
    encodeURIComponent(query) +
    "&display=" +
    DISPLAY +
    cred.extraParams;

  const res = await fetch(url, { headers: cred.headers });

  if (!res.ok) {
    const body = await res.text();
    console.error("[church-search] 네이버 API 오류", res.status, body);
    const err = new Error("naver_api_error");
    err.statusCode = 502;
    throw err;
  }

  const data = await res.json();
  const items = Array.isArray(data.items) ? data.items.map(normalize) : [];
  const churches = items.filter(looksLikeChurch);
  // 교회로 안 걸러지면(예: 주소로만 검색한 경우) 원본 결과라도 보여준다.
  return churches.length ? churches : items;
}

module.exports = async function handler(req, res) {
  const q = String((req.query && req.query.q) || "").trim();

  if (q.length < 2 || q.length > 50) {
    res.status(400).json({ error: "query_length", items: [] });
    return;
  }

  try {
    const items = await searchChurches(q);
    // 같은 검색어 반복 호출을 줄이기 위한 짧은 캐시 (개인정보 아님)
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
    res.status(200).json({ items });
  } catch (err) {
    console.error("[church-search] 실패", err);
    res.status(err.statusCode || 500).json({ error: err.message, items: [] });
  }
};

module.exports.searchChurches = searchChurches;
module.exports.normalize = normalize;
