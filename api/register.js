/**
 * 새가족 등록 저장 프록시 — 구글시트(Apps Script 웹앱)로 전달 (Vercel 형식)
 *
 * 배포 후 엔드포인트: POST /api/register
 *
 * ── 왜 프록시를 거치나 ────────────────────────────────────────────────
 * 폼에서 Apps Script 웹앱 URL을 직접 부를 수도 있지만, 그러면
 *   1) 웹앱 URL이 페이지 소스에 그대로 노출되어 누구나 우리 시트에 행을 넣을 수 있고,
 *   2) 그 URL을 지키는 토큰도 같이 노출되어 토큰의 의미가 사라진다.
 * 그래서 URL과 토큰은 서버 환경변수에만 두고, 이 함수가 대신 호출한다.
 * (교회 검색이 /api/church-search 를 쓰는 것과 같은 구조다.)
 *
 * ── 필요한 환경변수 (배포 대시보드에서 설정) ──────────────────────────
 *   SHEETS_WEBHOOK_URL   = Apps Script 웹 앱 URL (.../exec)
 *   SHEETS_WEBHOOK_TOKEN = Apps Script 스크립트 속성의 SHARED_TOKEN 과 동일한 값
 */

// 시트에 넣을 필드만 통과시킨다. 폼이 보내지 않은 키가 섞여 들어와도 무시된다.
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

const MAX_LEN = 500;        // 일반 텍스트 한 칸 상한
const MAX_JSON_LEN = 4000;  // 네이버 응답 원본 상한

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

async function forwardToSheet(data) {
  const url = process.env.SHEETS_WEBHOOK_URL;
  const token = process.env.SHEETS_WEBHOOK_TOKEN;

  if (!url || !token) {
    const err = new Error("sheets_credentials_missing");
    err.statusCode = 503;
    throw err;
  }

  // Apps Script 웹앱은 302로 한 번 넘긴 뒤 실제 응답을 준다 — fetch가 알아서 따라간다.
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, data })
  });

  if (!res.ok) {
    console.error("[register] Apps Script HTTP 오류", res.status);
    const err = new Error("sheet_unreachable");
    err.statusCode = 502;
    throw err;
  }

  // Apps Script는 HTTP 상태코드를 못 바꾸므로 항상 200이다. 본문의 ok로 판단한다.
  let payload;
  try {
    payload = await res.json();
  } catch (e) {
    console.error("[register] Apps Script 응답을 JSON으로 못 읽음", e);
    const err = new Error("sheet_bad_response");
    err.statusCode = 502;
    throw err;
  }

  if (!payload || payload.ok !== true) {
    console.error("[register] Apps Script 거부", payload);
    const err = new Error(payload && payload.error ? payload.error : "sheet_rejected");
    err.statusCode = 502;
    throw err;
  }

  return payload;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (!body || typeof body !== "object") {
    res.status(400).json({ ok: false, error: "bad_json" });
    return;
  }

  const data = pick(body);
  if (!data.name || !data.phone) {
    res.status(400).json({ ok: false, error: "missing_required" });
    return;
  }

  try {
    await forwardToSheet(data);
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ ok: false, error: err.message });
  }
};

module.exports.pick = pick;
module.exports.clean = clean;
