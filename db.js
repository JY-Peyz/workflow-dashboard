const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data.json');

const defaultData = {
  users: [], tasks: [], messages: [], finance_entries: [],
  sticky_notes: [], calendar_events: [], upload_history: [],
  _counters: { users: 0, tasks: 0, messages: 0, finance_entries: 0, sticky_notes: 0, calendar_events: 0, upload_history: 0 }
};

let data;

function load() {
  try {
    if (fs.existsSync(DB_PATH)) {
      data = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
      for (const key of Object.keys(defaultData)) {
        if (!data[key]) data[key] = key === '_counters' ? { ...defaultData._counters } : [];
      }
    } else {
      data = JSON.parse(JSON.stringify(defaultData));
    }
  } catch { data = JSON.parse(JSON.stringify(defaultData)); }
}

function save() {
  try { fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8'); } catch {}
}

function nextId(table) { data._counters[table] = (data._counters[table] || 0) + 1; return data._counters[table]; }

const db = {
  getAll(table) { return data[table] || []; },
  getById(table, id) { return (data[table] || []).find(r => r.id === id); },
  find(table, fn) { return (data[table] || []).filter(fn); },
  findOne(table, fn) { return (data[table] || []).find(fn); },
  insert(table, row) {
    row.id = nextId(table);
    row.created_at = row.created_at || new Date().toISOString();
    data[table].push(row);
    save();
    return row;
  },
  update(table, id, updates) {
    const idx = data[table].findIndex(r => r.id === id);
    if (idx === -1) return null;
    Object.assign(data[table][idx], updates);
    save();
    return data[table][idx];
  },
  delete(table, id) {
    const idx = data[table].findIndex(r => r.id === id);
    if (idx === -1) return false;
    data[table].splice(idx, 1);
    save();
    return true;
  },
  count(table, fn) { return fn ? (data[table] || []).filter(fn).length : (data[table] || []).length; },
  insertMany(table, rows) {
    for (const row of rows) { row.id = nextId(table); row.created_at = row.created_at || new Date().toISOString(); data[table].push(row); }
    save();
  }
};

function init() { load(); if (data.users.length === 0) seedDemoData(); }

function seedDemoData() {
  db.insertMany('users', [
    { google_id: 'demo_1', email: 'sarah@example.com', name: 'Sarah Kim', avatar: '/avatars/1', role: 'leader', region: '서울', phone: '010-1234-5678', claude_api_key: '', openai_api_key: '', is_online: 1 },
    { google_id: 'demo_2', email: 'daniel@example.com', name: 'Daniel Lee', avatar: '/avatars/2', role: 'member', region: '서울', phone: '010-2345-6789', claude_api_key: '', openai_api_key: '', is_online: 1 },
    { google_id: 'demo_3', email: 'jessica@example.com', name: 'Jessica Park', avatar: '/avatars/3', role: 'member', region: '서울', phone: '010-3456-7890', claude_api_key: '', openai_api_key: '', is_online: 1 },
    { google_id: 'demo_4', email: 'mike@example.com', name: 'Mike Johnson', avatar: '/avatars/4', role: 'member', region: '서울', phone: '010-4567-8901', claude_api_key: '', openai_api_key: '', is_online: 1 },
    { google_id: 'demo_5', email: 'olivia@example.com', name: 'Olivia Chen', avatar: '/avatars/5', role: 'member', region: '서울', phone: '010-5678-9012', claude_api_key: '', openai_api_key: '', is_online: 0 },
  ]);

  const today = new Date().toISOString().split('T')[0];
  db.insertMany('tasks', [
    { title: '디자인 시스템 업데이트', description: '디자인 시스템 컴포넌트 업데이트', status: 'todo', priority: 'high', assignee_id: 2, creator_id: 1, due_date: today },
    { title: '사용자 리서치 분석', description: '사용자 리서치 분석 보고서 작성', status: 'todo', priority: 'medium', assignee_id: 3, creator_id: 1, due_date: today },
    { title: 'Q2 로드맵 준비', description: 'Q2 로드맵 준비', status: 'todo', priority: 'low', assignee_id: 1, creator_id: 1, due_date: today },
    { title: '홈페이지 리디자인', description: '홈페이지 리디자인 작업', status: 'inprogress', priority: 'high', assignee_id: 2, creator_id: 1, due_date: today },
    { title: 'API 연동', description: 'API 연동 작업', status: 'inprogress', priority: 'medium', assignee_id: 4, creator_id: 1, due_date: today },
    { title: '온보딩 플로우 개선', description: '온보딩 플로우 개선', status: 'inprogress', priority: 'low', assignee_id: 3, creator_id: 1, due_date: today },
    { title: '로고 컨셉 탐색', description: '로고 컨셉 탐색', status: 'done', priority: 'high', assignee_id: 2, creator_id: 1, due_date: today },
    { title: '시장 트렌드 보고서', description: '시장 트렌드 보고서', status: 'done', priority: 'medium', assignee_id: 3, creator_id: 1, due_date: today },
    { title: '버그 수정 스프린트 #24', description: '버그 수정 스프린트 #24', status: 'done', priority: 'low', assignee_id: 4, creator_id: 1, due_date: today },
  ]);

  const now = new Date();
  db.insertMany('messages', [
    { user_id: 1, content: '안녕하세요 팀! 오늘 새 홈페이지 디자인 리뷰 가능할까요?', created_at: new Date(now - 360000).toISOString() },
    { user_id: 2, content: '네, 오후 2시 어떠세요?', created_at: new Date(now - 300000).toISOString() },
    { user_id: 1, content: '좋아요! 그때 봐요 👍', created_at: new Date(now - 240000).toISOString() },
    { user_id: 3, content: '저도 참석하겠습니다. 리서치 자료 준비해갈게요.', created_at: new Date(now - 180000).toISOString() },
    { user_id: 4, content: '개발 견적도 함께 공유드리겠습니다.', created_at: new Date(now - 120000).toISOString() },
    { user_id: 5, content: '캘린더 초대 보내드릴게요.', created_at: new Date(now - 60000).toISOString() },
  ]);

  const finData = [];
  const rnd = (min, max) => min + Math.round(Math.random() * (max - min));
  const incomeNames = ['클라이언트 계약금', '외주 프로젝트 수익', '컨설팅 수입', '라이센스 수익', '기술지원 수입'];
  const expenseNames = ['인건비 지급', '외주비 결제', '재료비 구매', '마케팅 광고비', '사무용품'];
  const expenseCats = ['인건비', '외주비', '재료비', '마케팅비', '기타'];
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  // 오늘 포함 최근 7일 (주간/일간용)
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    const ds = d.toISOString().split('T')[0];
    finData.push({ user_id: 1, entry_date: ds, item_name: pick(incomeNames), amount: rnd(200000, 350000), category: '기타', type: 'income', memo: '', source: 'manual' });
    finData.push({ user_id: 1, entry_date: ds, item_name: pick(expenseNames), amount: rnd(80000, 150000), category: pick(expenseCats), type: 'expense', memo: '', source: 'manual' });
  }
  // 이번 달 초 (월간 차이용)
  for (let d = 1; d <= 14; d += 3) {
    const dt = new Date(now.getFullYear(), now.getMonth(), d);
    if (dt >= new Date(now.getTime() - 6 * 86400000)) continue;
    const ds = dt.toISOString().split('T')[0];
    finData.push({ user_id: 1, entry_date: ds, item_name: pick(incomeNames), amount: rnd(150000, 280000), category: '기타', type: 'income', memo: '', source: 'manual' });
    finData.push({ user_id: 1, entry_date: ds, item_name: pick(expenseNames), amount: rnd(60000, 140000), category: pick(expenseCats), type: 'expense', memo: '', source: 'manual' });
  }
  // 올해 전체 월별 데이터 (분기용 - Q1~Q4 집계)
  const thisYear = now.getFullYear();
  for (let m = 0; m < now.getMonth(); m++) {
    for (let w = 0; w < 2; w++) {
      const dt = new Date(thisYear, m, 5 + w * 14);
      const ds = dt.toISOString().split('T')[0];
      finData.push({ user_id: 1, entry_date: ds, item_name: pick(incomeNames), amount: rnd(180000, 350000), category: '기타', type: 'income', memo: '', source: 'manual' });
      finData.push({ user_id: 1, entry_date: ds, item_name: pick(expenseNames), amount: rnd(90000, 180000), category: pick(expenseCats), type: 'expense', memo: '', source: 'manual' });
    }
  }
  // 과거 2년 데이터 (연간용 - 연도별 집계)
  for (let y = thisYear - 2; y < thisYear; y++) {
    for (let q = 0; q < 4; q++) {
      const dt = new Date(y, q * 3 + 1, 15);
      const ds = dt.toISOString().split('T')[0];
      const scale = y === thisYear - 1 ? 1.0 : 0.8;
      finData.push({ user_id: 1, entry_date: ds, item_name: pick(incomeNames), amount: Math.round(rnd(800000, 1500000) * scale), category: '기타', type: 'income', memo: '', source: 'manual' });
      finData.push({ user_id: 1, entry_date: ds, item_name: pick(expenseNames), amount: Math.round(rnd(400000, 800000) * scale), category: pick(expenseCats), type: 'expense', memo: '', source: 'manual' });
    }
  }
  db.insertMany('finance_entries', finData);

  db.insertMany('sticky_notes', [
    { user_id: 1, content: '인터랙티브 튜토리얼로 온보딩 경험을 개선하세요.', color: 'yellow', position_x: 0, position_y: 0 },
    { user_id: 2, content: '다크 모드 토글을 사용자 설정에 추가할 것.', color: 'green', position_x: 1, position_y: 0 },
    { user_id: 5, content: 'Q3 경쟁사 가격 전략을 조사하세요.', color: 'blue', position_x: 0, position_y: 1 },
    { user_id: 4, content: '빠른 로드 시간을 위해 API 성능 최적화 필요.', color: 'pink', position_x: 1, position_y: 1 },
  ]);

  db.insertMany('calendar_events', [
    { title: '팀 스탠드업', event_date: today, event_type: 'meeting', creator_id: 1 },
    { title: '스프린트 리뷰', event_date: today, event_type: 'meeting', creator_id: 1 },
    { title: '디자인 마감', event_date: today, event_type: 'deadline', creator_id: 1 },
    { title: '회사 이벤트', event_date: new Date(now.getFullYear(), now.getMonth(), 8).toISOString().split('T')[0], event_type: 'event', creator_id: 1 },
    { title: '분기 리뷰', event_date: new Date(now.getFullYear(), now.getMonth(), 22).toISOString().split('T')[0], event_type: 'meeting', creator_id: 1 },
    { title: '프로젝트 마감', event_date: new Date(now.getFullYear(), now.getMonth(), 28).toISOString().split('T')[0], event_type: 'deadline', creator_id: 1 },
  ]);
}

module.exports = { db, init };
