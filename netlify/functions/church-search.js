/**
 * 교회 검색 프록시 — 네이버 지역검색 API (Netlify Functions 형식)
 *
 * Vercel에 배포한다면 이 파일 대신 `api/church-search.js`가 쓰인다.
 * 둘 중 실제 배포하는 쪽 하나만 있으면 되고, 로직은 동일하다.
 * 프록시가 왜 필요한지에 대한 설명은 `api/church-search.js` 상단 주석 참고.
 *
 * 필요한 환경변수(둘 중 한 세트, 둘 다 있으면 API HUB 우선):
 *   [신규/권장] NAVER_APIHUB_KEY_ID, NAVER_APIHUB_KEY   ← ncloud.com 콘솔 → NAVER API HUB
 *   [기존 키]   NAVER_CLIENT_ID, NAVER_CLIENT_SECRET     ← developers.naver.com (2027-06-30까지)
 * netlify.toml의 리다이렉트 덕분에 /api/church-search 로 호출된다.
 */

const NAVER_APIHUB_ENDPOINT = "https://naverapihub.apigw.ntruss.com/search/v1/local";
const NAVER_LEGACY_ENDPOINT = "https://openapi.naver.com/v1/search/local.json";
const DISPLAY = 5; // 지역검색 API의 display 최댓값

function decodeEntities(s) {
  return String(s == null ? "" : s)
    .replace(/<[^>]*>/g, "")
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
    mapy: item.mapy || ""
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

function json(statusCode, body, extraHeaders) {
  return {
    statusCode: statusCode,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, extraHeaders || {}),
    body: JSON.stringify(body)
  };
}

exports.handler = async function (event) {
  const q = String(((event.queryStringParameters || {}).q) || "").trim();

  if (q.length < 2 || q.length > 50) {
    return json(400, { error: "query_length", items: [] });
  }

  const cred = naverCredentials();
  if (!cred) {
    console.error("[church-search] 네이버 인증 환경변수가 없습니다 (NAVER_APIHUB_KEY_ID/KEY 또는 NAVER_CLIENT_ID/SECRET).");
    return json(503, { error: "naver_credentials_missing", items: [] });
  }

  const query = q.indexOf("교회") !== -1 ? q : q + " 교회";
  const url = cred.url + "?query=" + encodeURIComponent(query) + "&display=" + DISPLAY + cred.extraParams;

  try {
    const res = await fetch(url, { headers: cred.headers });

    if (!res.ok) {
      const body = await res.text();
      console.error("[church-search] 네이버 API 오류", res.status, body);
      return json(502, { error: "naver_api_error", items: [] });
    }

    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items.map(normalize) : [];
    const churches = items.filter(looksLikeChurch);

    return json(200, { items: churches.length ? churches : items },
                { "Cache-Control": "public, max-age=300" });
  } catch (err) {
    console.error("[church-search] 실패", err);
    return json(500, { error: "proxy_failed", items: [] });
  }
};
