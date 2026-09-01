/**
 * 새가족 등록 저장 프록시 — 구글시트(Apps Script 웹앱)로 전달 (Netlify 형식)
 *
 * Vercel용 `api/register.js` 와 동작은 같고 함수 시그니처만 다르다.
 * 둘 중 실제 배포하는 쪽 하나만 있으면 된다.
 *
 * netlify.toml 의 리다이렉트를 통해 /api/register 로 노출된다.
 *
 * ── 필요한 환경변수 ───────────────────────────────────────────────────
 *   SHEETS_WEBHOOK_URL   = Apps Script 웹 앱 URL (.../exec)
 *   SHEETS_WEBHOOK_TOKEN = Apps Script 스크립트 속성의 SHARED_TOKEN 과 동일한 값
 */

const ALLOWED_FIELDS = [
  "name",
  "gender",
  "birth_date",
  "phone",
  "prior_church_status",
  "prior_church_name",
  "prior_church_location",
  "prior_church_denomination",
  "prior_church_has_youth_group",
  "baptism_status",
  "visit_source",
  "visit_source_etc",
  "attendance_wish",
  "prior_church_naver"
];

const MAX_LEN = 500;
const MAX_JSON_LEN = 4000;

function clean(value, limit) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    const s = JSON.stringify(value);
    return s.length > MAX_JSON_LEN ? s.slice(0, MAX_JSON_LEN) : s;
  }
  const s = String(value).trim();
  return s.length > limit ? s.slice(0, limit) : s;
}

function pick(body) {
  const out = {};
  for (const key of ALLOWED_FIELDS) {
    out[key] = clean(body[key], key === "prior_church_naver" ? MAX_JSON_LEN : MAX_LEN);
  }
  return out;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body)
  };
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed" });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return json(400, { ok: false, error: "bad_json" });
  }

  const data = pick(body);
  if (!data.name || !data.phone) {
    return json(400, { ok: false, error: "missing_required" });
  }

  const url = process.env.SHEETS_WEBHOOK_URL;
  const token = process.env.SHEETS_WEBHOOK_TOKEN;
  if (!url || !token) {
    console.error("[register] SHEETS_WEBHOOK_URL / SHEETS_WEBHOOK_TOKEN 미설정");
    return json(503, { ok: false, error: "sheets_credentials_missing" });
  }

  try {
    // Apps Script 웹앱은 302로 한 번 넘긴 뒤 실제 응답을 준다 — fetch가 알아서 따라간다.
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, data })
    });

    if (!res.ok) {
      console.error("[register] Apps Script HTTP 오류", res.status);
      return json(502, { ok: false, error: "sheet_unreachable" });
    }

    // Apps Script는 HTTP 상태코드를 못 바꾸므로 항상 200이다. 본문의 ok로 판단한다.
    let payload;
    try {
      payload = await res.json();
    } catch (e) {
      console.error("[register] Apps Script 응답을 JSON으로 못 읽음", e);
      return json(502, { ok: false, error: "sheet_bad_response" });
    }

    if (!payload || payload.ok !== true) {
      console.error("[register] Apps Script 거부", payload);
      return json(502, { ok: false, error: (payload && payload.error) || "sheet_rejected" });
    }

    return json(200, { ok: true });
  } catch (err) {
    console.error("[register] 실패", err);
    return json(500, { ok: false, error: "proxy_failed" });
  }
};
