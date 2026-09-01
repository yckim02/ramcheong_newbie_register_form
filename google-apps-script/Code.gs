var SHEET_NAME = '새가족 등록폼 data';

/* 시트 컬럼 정의 */
var FIELDS = [
  ['submitted_at',                  '접수일시'],
  ['name',                          '이름'],
  ['gender',                        '성별'],
  ['birth_date',                    '생년월일'],
  ['phone',                         '연락처'],
  ['prior_church_status',           '다니던 교회'],
  ['prior_church_name',             '교회명'],
  ['prior_church_location',         '교회 위치'],
  ['prior_church_denomination',     '교단'],
  ['prior_church_has_youth_group',  '청년부'],
  ['baptism_status',                '세례 여부'],
  ['visit_source',                  '방문경로'],
  ['visit_source_etc',              '방문경로(기타)'],
  ['attendance_wish',               '참석 희망'],
  ['contacted',                     '응대 여부'],
  ['leader_memo',                    '메모'],
  ['prior_church_naver',            '네이버 검색 원본']
];

/* 리더가 직접 채우는 칸 — 폼에서 값이 와도 무시하고 항상 비워둠. */
var LEADER_ONLY = { contacted: true, leader_memo: true };

/* 연락처는 "01012345678" 처럼 들어오면 시트가 숫자로 인식해 앞자리 0을 날려버린다.
 * 그래서 이 열들은 서식을 텍스트(@)로 고정한다. */
var TEXT_COLUMNS = ['phone', 'prior_church_naver'];

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** 배포가 살아있는지 확인용. 데이터는 아무것도 돌려주지 않는다. */
function doGet() {
  return jsonOut({ ok: true, service: 'ramcheong-new-family', sheet: SHEET_NAME });
}

/** '새가족 등록폼 data' 시트를 찾고, 없으면 머리글까지 갖춰서 새로 만든다. */
function getOrCreateSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    var headers = FIELDS.map(function (f) { return f[1]; });
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);

    // 텍스트로 고정할 열 서식 지정 (데이터가 들어오기 전에 해둬야 의미가 있다)
    TEXT_COLUMNS.forEach(function (key) {
      var idx = indexOfField(key);
      if (idx >= 0) {
        sheet.getRange(2, idx + 1, sheet.getMaxRows() - 1, 1).setNumberFormat('@');
      }
    });

    // '응대 여부'는 리더가 체크하며 쓰는 칸이라 체크박스로 만들어둔다
    var contactedIdx = indexOfField('contacted');
    if (contactedIdx >= 0) {
      try {
        sheet.getRange(2, contactedIdx + 1, sheet.getMaxRows() - 1, 1).insertCheckboxes();
      } catch (e) {
        // 체크박스는 있으면 편한 정도라, 실패해도 등록 자체는 계속 진행한다
        console.warn('체크박스 삽입 실패: ' + e);
      }
    }

    sheet.autoResizeColumns(1, headers.length);
  }

  return sheet;
}

function indexOfField(key) {
  for (var i = 0; i < FIELDS.length; i++) {
    if (FIELDS[i][0] === key) return i;
  }
  return -1;
}

function toCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

function doPost(e) {
  // 1) 요청 본문 파싱
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return jsonOut({ ok: false, error: 'bad_json' });
  }

  // 2) 토큰 검사 — 토큰을 모르는 요청은 여기서 끝
  var expected = PropertiesService.getScriptProperties().getProperty('SHARED_TOKEN');
  if (!expected) {
    return jsonOut({ ok: false, error: 'token_not_configured' });
  }
  if (body.token !== expected) {
    return jsonOut({ ok: false, error: 'unauthorized' });
  }

  var data = body.data || {};

  // 3) 최소 검증 — 이름/연락처 없는 행은 받지 않는다
  if (!String(data.name || '').trim() || !String(data.phone || '').trim()) {
    return jsonOut({ ok: false, error: 'missing_required' });
  }

  // 4) 동시에 두 명이 제출해도 행이 겹치지 않도록 잠금
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return jsonOut({ ok: false, error: 'busy' });
  }

  try {
    var sheet = getOrCreateSheet();

    // 접수일시는 새가족를 믿지 않고 서버(시트 시간대) 기준으로 찍는다
    var now = Utilities.formatDate(
      new Date(),
      SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(),
      'yyyy-MM-dd HH:mm:ss'
    );

    var row = FIELDS.map(function (f) {
      var key = f[0];
      if (key === 'submitted_at') return now;
      if (LEADER_ONLY[key]) return key === 'contacted' ? false : '';
      return toCell(data[key]);
    });

    sheet.appendRow(row);
    return jsonOut({ ok: true, row: sheet.getLastRow() });
  } catch (err) {
    console.error('등록 저장 실패: ' + err);
    return jsonOut({ ok: false, error: 'sheet_write_failed' });
  } finally {
    lock.releaseLock();
  }
}
