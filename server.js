require('dotenv').config();
console.log('ENV CHECK:', {
  GOOGLE_CLIENT_ID: !!process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: !!process.env.GOOGLE_CLIENT_SECRET,
  RESEND_API_KEY: !!process.env.RESEND_API_KEY
});
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { Server } = require('socket.io');
const http = require('http');
const multer = require('multer');
const XLSX = require('xlsx');
const { Resend } = require('resend');
const path = require('path');
const { db, init } = require('./db');

// Resend 메일 서비스 설정
let resend = null;
if (process.env.RESEND_API_KEY) {
  resend = new Resend(process.env.RESEND_API_KEY);
  console.log('✅ Resend 메일 서비스 연결 완료');
} else {
  console.warn('⚠️  RESEND_API_KEY 없음 — 메일 발송 기능 비활성화');
}

init();

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'dashboard-secret-key-2026',
  resave: false, saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
});
app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());
io.engine.use(sessionMiddleware);

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => { done(null, db.getById('users', id) || false); });

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: '/auth/google/callback'
  }, (accessToken, refreshToken, profile, done) => {
    let user = db.findOne('users', u => u.google_id === profile.id);
    if (!user) {
      user = db.insert('users', {
        google_id: profile.id, email: profile.emails?.[0]?.value || '',
        name: profile.displayName, avatar: profile.photos?.[0]?.value || '/avatars/1',
        role: 'member', region: '서울', phone: '', claude_api_key: '', openai_api_key: '', is_online: 1,
        profile_completed: false
      });
    } else {
      // 기존 유저: 온라인 상태만 업데이트 (프로필 데이터 유지)
      db.update('users', user.id, { is_online: 1 });
      user = db.getById('users', user.id);
    }
    done(null, user);
  }));
}

function requireAuth(req, res, next) {
  if (req.isAuthenticated?.() || req.session?.userId) return next();
  res.status(401).json({ error: 'Unauthorized' });
}
function getUser(req) {
  if (req.user) return req.user;
  if (req.session?.userId) return db.getById('users', req.session.userId);
  return null;
}

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/login.html' }), (req, res) => res.redirect('/'));

app.post('/auth/demo-login', (req, res) => {
  const user = db.getById('users', req.body.userId);
  if (!user) return res.status(404).json({ error: 'Not found' });
  req.session.userId = user.id;
  db.update('users', user.id, { is_online: 1 });
  io.emit('user-status', { userId: user.id, online: true });
  res.json({ user });
});

app.post('/auth/logout', (req, res) => {
  const user = getUser(req);
  if (user) { db.update('users', user.id, { is_online: 0 }); io.emit('user-status', { userId: user.id, online: false }); }
  req.session.destroy(() => {});
  res.json({ ok: true });
});

// 계정 탈퇴 (본인 데이터 모두 삭제)
app.delete('/auth/account', requireAuth, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const uid = user.id;
  // 관련 데이터 삭제
  db.find('tasks', t => t.assignee_id === uid || t.creator_id === uid).forEach(t => db.delete('tasks', t.id));
  db.find('messages', m => m.user_id === uid).forEach(m => db.delete('messages', m.id));
  db.find('finance_entries', f => f.user_id === uid).forEach(f => db.delete('finance_entries', f.id));
  db.find('sticky_notes', n => n.user_id === uid).forEach(n => db.delete('sticky_notes', n.id));
  db.find('calendar_events', e => e.creator_id === uid).forEach(e => db.delete('calendar_events', e.id));
  db.find('upload_history', h => h.user_id === uid).forEach(h => db.delete('upload_history', h.id));
  db.delete('users', uid);
  io.emit('user-status', { userId: uid, online: false });
  req.session.destroy(() => {});
  console.log(`🗑️ 계정 탈퇴: ${user.name} (${user.email})`);
  res.json({ ok: true });
});

app.get('/auth/me', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  const { claude_api_key, openai_api_key, ...safe } = user;
  safe.hasClaudeKey = !!claude_api_key;
  safe.hasOpenaiKey = !!openai_api_key;
  res.json(safe);
});

app.get('/auth/demo-users', (req, res) => {
  res.json(db.find('users', u => u.google_id?.startsWith('demo_')).map(u => ({ id: u.id, name: u.name, role: u.role, avatar: u.avatar })));
});

// Profile — dual API keys
app.put('/api/profile', requireAuth, (req, res) => {
  const user = getUser(req);
  const { name, role, region, phone, email, claude_api_key, openai_api_key } = req.body;
  const updates = {
    name: name || user.name, role: role || user.role, region: region || user.region,
    phone: phone !== undefined ? phone : (user.phone || ''),
    email: email !== undefined ? email : (user.email || ''),
    claude_api_key: claude_api_key !== undefined ? claude_api_key : user.claude_api_key,
    openai_api_key: openai_api_key !== undefined ? openai_api_key : user.openai_api_key,
    profile_completed: true
  };
  db.update('users', user.id, updates);
  const updated = db.getById('users', user.id);
  const { claude_api_key: ck, openai_api_key: ok, ...safe } = updated;
  safe.hasClaudeKey = !!ck; safe.hasOpenaiKey = !!ok;
  res.json(safe);
});

app.get('/api/users', requireAuth, (req, res) => {
  res.json(db.getAll('users').map(u => ({ id: u.id, name: u.name, email: u.email, avatar: u.avatar, role: u.role, is_online: u.is_online })));
});

// Team member detail — profile + all assigned tasks
app.get('/api/team-member/:id', requireAuth, (req, res) => {
  const user = db.getById('users', parseInt(req.params.id));
  if (!user) return res.status(404).json({ error: 'Not found' });
  const tasks = db.getAll('tasks').filter(t => t.assignee_id === user.id)
    .sort((a, b) => {
      const order = { inprogress: 0, todo: 1, pending: 2, done: 3 };
      return (order[a.status] ?? 9) - (order[b.status] ?? 9);
    });
  const total = tasks.length;
  const done = tasks.filter(t => t.status === 'done').length;
  res.json({
    id: user.id, name: user.name, email: user.email, role: user.role,
    avatar: user.avatar, phone: user.phone || '', is_online: user.is_online,
    region: user.region,
    tasks: tasks.map(t => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, due_date: t.due_date })),
    completionRate: total > 0 ? Math.round((done / total) * 100) : 0,
    totalTasks: total, doneTasks: done
  });
});

// Change user role (leader only)
app.put('/api/users/:id/role', requireAuth, (req, res) => {
  const me = getUser(req);
  if (me.role !== 'leader') return res.status(403).json({ error: '팀장만 권한을 변경할 수 있습니다' });
  const targetId = parseInt(req.params.id);
  if (targetId === me.id) return res.status(400).json({ error: '본인의 권한은 변경할 수 없습니다' });
  const target = db.getById('users', targetId);
  if (!target) return res.status(404).json({ error: '사용자를 찾을 수 없습니다' });
  const newRole = req.body.role;
  if (!['leader', 'member'].includes(newRole)) return res.status(400).json({ error: '유효하지 않은 역할입니다' });
  db.update('users', targetId, { role: newRole });
  res.json({ ok: true, role: newRole });
});

// Team stats — current task + completion rate per user
app.get('/api/team-stats', requireAuth, (req, res) => {
  const users = db.getAll('users');
  const tasks = db.getAll('tasks');
  const stats = users.map(u => {
    const userTasks = tasks.filter(t => t.assignee_id === u.id);
    const total = userTasks.length;
    const done = userTasks.filter(t => t.status === 'done').length;
    const current = userTasks.find(t => t.status === 'inprogress') || userTasks.find(t => t.status === 'todo');
    return {
      id: u.id, name: u.name, role: u.role, avatar: u.avatar, is_online: u.is_online,
      currentTask: current ? current.title : null,
      completionRate: total > 0 ? Math.round((done / total) * 100) : 0,
      totalTasks: total, doneTasks: done
    };
  });
  res.json(stats);
});

// KPI weekly completion trend
app.get('/api/kpi/weekly', requireAuth, (req, res) => {
  const tasks = db.getAll('tasks');
  const doneTasks = tasks.filter(t => t.status === 'done');
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const dateStr = d.toISOString().split('T')[0];
    days.push({ date: dateStr, count: 0 });
  }
  // distribute done tasks across the week for demo
  doneTasks.forEach((t, i) => { days[i % 7].count++; });
  res.json(days);
});

// Tasks — with pending approval
app.get('/api/tasks', requireAuth, (req, res) => {
  const user = getUser(req);
  let tasks = user.role === 'leader' ? db.getAll('tasks') : db.find('tasks', t => t.assignee_id === user.id);
  tasks = tasks.map(t => {
    const a = t.assignee_id ? db.getById('users', t.assignee_id) : null;
    return { ...t, assignee_name: a?.name || null };
  }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(tasks);
});

app.post('/api/tasks', requireAuth, (req, res) => {
  const user = getUser(req);
  if (user.role !== 'leader') return res.status(403).json({ error: '팀장만 업무를 생성할 수 있습니다' });
  const { title, description, priority, assignee_id, due_date } = req.body;
  const task = db.insert('tasks', {
    title, description: description || '', priority: priority || 'medium',
    status: 'todo', assignee_id: assignee_id ? parseInt(assignee_id) : null,
    creator_id: user.id, due_date: due_date || null
  });
  if (due_date) db.insert('calendar_events', { title, event_date: due_date, event_type: 'deadline', task_id: task.id, creator_id: user.id });
  const a = task.assignee_id ? db.getById('users', task.assignee_id) : null;
  task.assignee_name = a?.name || null;
  io.emit('task-updated');
  res.json(task);
});

app.put('/api/tasks/:id', requireAuth, (req, res) => {
  const user = getUser(req);
  const task = db.getById('tasks', parseInt(req.params.id));
  if (!task) return res.status(404).json({ error: 'Not found' });
  if (user.role !== 'leader' && task.assignee_id !== user.id) return res.status(403).json({ error: '권한 없음' });

  const { status, title, description, priority, assignee_id, due_date } = req.body;
  const updates = {};

  if (status) {
    if (status === 'done' && user.role !== 'leader') {
      updates.status = 'pending'; // team member → pending approval
    } else {
      updates.status = status;
    }
  }

  if (user.role === 'leader') {
    if (title) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (priority) updates.priority = priority;
    if (assignee_id !== undefined) updates.assignee_id = assignee_id ? parseInt(assignee_id) : null;
    if (due_date !== undefined) updates.due_date = due_date;
  }

  db.update('tasks', task.id, updates);
  io.emit('task-updated');
  const updated = db.getById('tasks', task.id);
  const a = updated.assignee_id ? db.getById('users', updated.assignee_id) : null;
  updated.assignee_name = a?.name || null;
  res.json(updated);
});

// Approve task (leader only)
app.post('/api/tasks/:id/approve', requireAuth, (req, res) => {
  const user = getUser(req);
  if (user.role !== 'leader') return res.status(403).json({ error: '팀장만 승인 가능' });
  const task = db.getById('tasks', parseInt(req.params.id));
  if (!task || task.status !== 'pending') return res.status(400).json({ error: '승인 대기 상태가 아닙니다' });
  db.update('tasks', task.id, { status: 'done' });
  io.emit('task-updated');
  res.json({ ok: true });
});

app.delete('/api/tasks/:id', requireAuth, (req, res) => {
  const user = getUser(req);
  if (user.role !== 'leader') return res.status(403).json({ error: '팀장만 삭제 가능' });
  const taskId = parseInt(req.params.id);
  db.find('calendar_events', e => e.task_id === taskId).forEach(e => db.delete('calendar_events', e.id));
  db.delete('tasks', taskId);
  io.emit('task-updated');
  res.json({ ok: true });
});

// Chat
app.get('/api/messages', requireAuth, (req, res) => {
  const msgs = db.getAll('messages').sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).slice(-100)
    .map(m => {
      const u = db.getById('users', m.user_id);
      const acks = (m.acks || []).map(a => {
        const au = db.getById('users', a.user_id);
        return { user_id: a.user_id, user_name: au?.name || '알 수 없음' };
      });
      return { ...m, acks, user_name: u?.name || '알 수 없음', user_avatar: u?.avatar || '/avatars/1' };
    });
  res.json(msgs);
});

// Chat — delete own message
app.delete('/api/messages/:id', requireAuth, (req, res) => {
  const user = getUser(req);
  const msg = db.getById('messages', parseInt(req.params.id));
  if (!msg) return res.status(404).json({ error: '메시지를 찾을 수 없습니다' });
  if (msg.user_id !== user.id) return res.status(403).json({ error: '본인 메시지만 삭제할 수 있습니다' });
  db.delete('messages', msg.id);
  io.emit('message-deleted', { id: msg.id });
  res.json({ ok: true });
});

// Chat — toggle ack (check)
app.post('/api/messages/:id/ack', requireAuth, (req, res) => {
  const user = getUser(req);
  const msg = db.getById('messages', parseInt(req.params.id));
  if (!msg) return res.status(404).json({ error: '메시지를 찾을 수 없습니다' });
  if (msg.user_id === user.id) return res.status(400).json({ error: '본인 메시지에는 체크할 수 없습니다' });
  const acks = msg.acks || [];
  const idx = acks.findIndex(a => a.user_id === user.id);
  if (idx >= 0) acks.splice(idx, 1);
  else acks.push({ user_id: user.id });
  db.update('messages', msg.id, { acks });
  const updated = db.getById('messages', msg.id);
  const ackList = (updated.acks || []).map(a => {
    const au = db.getById('users', a.user_id);
    return { user_id: a.user_id, user_name: au?.name || '알 수 없음' };
  });
  io.emit('message-ack-updated', { id: msg.id, acks: ackList });
  res.json({ ok: true });
});

// Finance
app.get('/api/finance', requireAuth, (req, res) => {
  const { period } = req.query;
  const today = new Date().toISOString().split('T')[0];
  let entries = db.getAll('finance_entries');
  if (period === 'day') entries = entries.filter(e => e.entry_date === today);
  else if (period === 'week') { const wa = new Date(Date.now() - 7*86400000).toISOString().split('T')[0]; entries = entries.filter(e => e.entry_date >= wa); }
  else if (period === 'month') entries = entries.filter(e => e.entry_date >= today.substring(0, 7) + '-01');
  else if (period === 'quarter') entries = entries.filter(e => e.entry_date >= today.substring(0, 4) + '-01-01');
  // year: 전체 데이터 반환 (필터 없음)
  entries.sort((a, b) => a.entry_date.localeCompare(b.entry_date));
  res.json(entries);
});

app.get('/api/finance/summary', requireAuth, (req, res) => {
  const { period } = req.query;
  const today = new Date().toISOString().split('T')[0];
  let entries = db.getAll('finance_entries');
  if (period === 'day') entries = entries.filter(e => e.entry_date === today);
  else if (period === 'week') { const wa = new Date(Date.now() - 7*86400000).toISOString().split('T')[0]; entries = entries.filter(e => e.entry_date >= wa); }
  else if (period === 'month') entries = entries.filter(e => e.entry_date >= today.substring(0, 7) + '-01');
  else if (period === 'quarter') entries = entries.filter(e => e.entry_date >= today.substring(0, 4) + '-01-01');
  // year: 전체
  const income = entries.filter(e => e.type === 'income').reduce((s, e) => s + e.amount, 0);
  const expense = entries.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0);
  res.json({ income, expense, net: income - expense, todayCount: db.count('finance_entries', e => e.entry_date === today) });
});

app.post('/api/finance', requireAuth, (req, res) => {
  const user = getUser(req);
  const { entry_date, item_name, amount, category, type, memo } = req.body;
  const entry = db.insert('finance_entries', {
    user_id: user.id, entry_date: entry_date || new Date().toISOString().split('T')[0],
    item_name, amount: parseFloat(amount), category, type,
    memo: memo || '', source: 'manual'
  });
  io.emit('finance-updated');
  res.json(entry);
});

const upload = multer({ storage: multer.memoryStorage() });
app.post('/api/finance/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '파일 없음' });
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    const user = getUser(req);
    for (const row of rows) {
      db.insert('finance_entries', {
        user_id: user.id,
        entry_date: row['날짜'] || row['date'] || new Date().toISOString().split('T')[0],
        item_name: row['항목'] || row['item'] || '', amount: parseFloat(row['금액'] || row['amount'] || 0),
        category: row['카테고리'] || row['category'] || '기타', type: row['유형'] || row['type'] || 'expense',
        memo: row['비고'] || row['memo'] || '', source: 'file_upload'
      });
    }
    // Save upload history
    db.insert('upload_history', { user_id: user.id, filename: req.file.originalname, count: rows.length });
    io.emit('finance-updated');
    res.json({ imported: rows.length });
  } catch { res.status(400).json({ error: '파일 파싱 실패' }); }
});

app.get('/api/finance/today', requireAuth, (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const entries = db.getAll('finance_entries').filter(e => e.entry_date === today)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map(e => {
      const owner = db.getById('users', e.user_id);
      return { ...e, user_name: owner?.name || '알 수 없음' };
    });
  res.json(entries);
});

// Finance entry edit/delete (본인 또는 팀장만)
app.patch('/api/finance/:id', requireAuth, (req, res) => {
  const user = getUser(req);
  const entry = db.getById('finance_entries', parseInt(req.params.id));
  if (!entry) return res.status(404).json({ error: '항목을 찾을 수 없습니다' });
  if (entry.user_id !== user.id && user.role !== 'leader') {
    return res.status(403).json({ error: '본인 또는 팀장만 수정할 수 있습니다' });
  }
  const { item_name, amount, category, type, memo } = req.body;
  const updates = {};
  if (item_name !== undefined) updates.item_name = item_name;
  if (amount !== undefined) updates.amount = parseFloat(amount);
  if (category !== undefined) updates.category = category;
  if (type !== undefined) updates.type = type;
  if (memo !== undefined) updates.memo = memo;
  db.update('finance_entries', entry.id, updates);
  io.emit('finance-updated');
  res.json(db.getById('finance_entries', entry.id));
});

app.delete('/api/finance/:id', requireAuth, (req, res) => {
  const user = getUser(req);
  const entry = db.getById('finance_entries', parseInt(req.params.id));
  if (!entry) return res.status(404).json({ error: '항목을 찾을 수 없습니다' });
  if (entry.user_id !== user.id && user.role !== 'leader') {
    return res.status(403).json({ error: '본인 또는 팀장만 삭제할 수 있습니다' });
  }
  db.delete('finance_entries', entry.id);
  io.emit('finance-updated');
  res.json({ ok: true });
});

app.get('/api/upload-history', requireAuth, (req, res) => {
  res.json(db.getAll('upload_history').sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5));
});

// Sticky Notes
app.get('/api/notes', requireAuth, (req, res) => {
  res.json(db.getAll('sticky_notes').sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map(n => { const a = db.getById('users', n.user_id); return { ...n, author_name: a?.name || '알 수 없음' }; }));
});
app.post('/api/notes', requireAuth, (req, res) => {
  const user = getUser(req);
  const note = db.insert('sticky_notes', { user_id: user.id, content: req.body.content, color: req.body.color || 'yellow', position_x: 0, position_y: 0 });
  note.author_name = user.name;
  io.emit('notes-updated');
  res.json(note);
});
app.put('/api/notes/:id', requireAuth, (req, res) => {
  const updates = {};
  if (req.body.content !== undefined) updates.content = req.body.content;
  if (req.body.color !== undefined) updates.color = req.body.color;
  db.update('sticky_notes', parseInt(req.params.id), updates);
  io.emit('notes-updated');
  res.json({ ok: true });
});
app.delete('/api/notes/:id', requireAuth, (req, res) => {
  db.delete('sticky_notes', parseInt(req.params.id));
  io.emit('notes-updated');
  res.json({ ok: true });
});

// Calendar
app.get('/api/calendar', requireAuth, (req, res) => {
  const { year, month } = req.query;
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const em = parseInt(month) === 12 ? 1 : parseInt(month) + 1;
  const ey = parseInt(month) === 12 ? parseInt(year) + 1 : parseInt(year);
  const end = `${ey}-${String(em).padStart(2, '0')}-01`;
  res.json(db.find('calendar_events', e => e.event_date >= start && e.event_date < end)
    .sort((a, b) => a.event_date.localeCompare(b.event_date))
    .map(e => { const c = db.getById('users', e.creator_id); return { ...e, creator_name: c?.name || '' }; }));
});

app.get('/api/calendar/day', requireAuth, (req, res) => {
  const { date } = req.query;
  const events = db.find('calendar_events', e => e.event_date === date).map(e => { const c = db.getById('users', e.creator_id); return { ...e, creator_name: c?.name || '' }; });
  const tasks = db.find('tasks', t => t.due_date === date).map(t => { const a = t.assignee_id ? db.getById('users', t.assignee_id) : null; return { ...t, assignee_name: a?.name || '' }; });
  res.json({ events, tasks });
});

app.post('/api/calendar', requireAuth, (req, res) => {
  const user = getUser(req);
  const ev = db.insert('calendar_events', { title: req.body.title, event_date: req.body.event_date, event_type: req.body.event_type || 'event', description: req.body.description || '', creator_id: user.id, task_id: null });
  io.emit('calendar-updated');
  res.json(ev);
});

app.delete('/api/calendar/:id', requireAuth, (req, res) => {
  const user = getUser(req);
  if (user.role !== 'leader') return res.status(403).json({ error: '팀장만 삭제 가능' });
  db.delete('calendar_events', parseInt(req.params.id));
  io.emit('calendar-updated');
  res.json({ ok: true });
});

// Weather
app.get('/api/weather', async (req, res) => {
  const apiKey = process.env.WEATHER_API_KEY;
  const city = req.query.region || '서울';
  if (!apiKey) return res.json({ temp: 22, desc: '맑음', icon: '01d', city });
  try {
    const resp = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric&lang=kr`);
    const data = await resp.json();
    res.json({ temp: Math.round(data.main?.temp || 22), desc: data.weather?.[0]?.description || '맑음', icon: data.weather?.[0]?.icon || '01d', city });
  } catch { res.json({ temp: 22, desc: '맑음', icon: '01d', city }); }
});

// AI — dual key support
// 기본 응답 시스템 (API 키 없을 때)
function getBasicResponse(message, tab, user) {
  const msg = message.toLowerCase();
  if (tab === 'work') {
    const tc = { todo: 0, inprogress: 0, pending: 0, done: 0 };
    db.getAll('tasks').forEach(t => { if (tc[t.status] !== undefined) tc[t.status]++; });
    const total = tc.todo + tc.inprogress + tc.pending + tc.done;
    const rate = total > 0 ? Math.round((tc.done / total) * 100) : 0;

    if (msg.includes('현황') || msg.includes('상태') || msg.includes('요약') || msg.includes('리포트')) {
      return `📊 현재 업무 현황입니다:\n• 전체: ${total}건\n• 대기: ${tc.todo}건\n• 진행 중: ${tc.inprogress}건\n• 승인 대기: ${tc.pending}건\n• 완료: ${tc.done}건\n• 완료율: ${rate}%\n\n${rate >= 70 ? '✅ 순조롭게 진행되고 있습니다!' : rate >= 40 ? '⚡ 진행 중인 업무에 집중해주세요.' : '🔥 대기 업무가 많습니다. 우선순위를 정리해보세요.'}`;
    }
    if (msg.includes('우선순위') || msg.includes('중요')) {
      const highTasks = db.getAll('tasks').filter(t => t.priority === 'high' && t.status !== 'done');
      return highTasks.length > 0
        ? `🔴 높은 우선순위 업무 ${highTasks.length}건:\n${highTasks.map(t => `• ${t.title} (${t.status === 'todo' ? '대기' : '진행 중'})`).join('\n')}\n\n이 업무들을 먼저 처리하는 것을 권장합니다.`
        : '✅ 현재 높은 우선순위 업무가 없습니다. 잘 관리하고 계시네요!';
    }
    if (msg.includes('지연') || msg.includes('마감') || msg.includes('기한')) {
      const today = new Date().toISOString().split('T')[0];
      const overdue = db.getAll('tasks').filter(t => t.due_date && t.due_date < today && t.status !== 'done');
      return overdue.length > 0
        ? `⚠️ 기한 초과 업무 ${overdue.length}건:\n${overdue.map(t => `• ${t.title} (마감: ${t.due_date})`).join('\n')}\n\n빠른 처리가 필요합니다.`
        : '✅ 기한이 초과된 업무가 없습니다!';
    }
    if (msg.includes('팀') || msg.includes('팀원') || msg.includes('인원')) {
      const users = db.getAll('users');
      const online = users.filter(u => u.is_online);
      return `👥 팀 현황:\n• 전체 인원: ${users.length}명\n• 현재 온라인: ${online.length}명\n${users.map(u => `• ${u.name} (${u.role === 'leader' ? '팀장' : '팀원'}) - ${u.is_online ? '🟢 온라인' : '⚫ 오프라인'}`).join('\n')}`;
    }
    if (msg.includes('결산') || msg.includes('수입') || msg.includes('지출') || msg.includes('재무')) {
      const today = new Date().toISOString().split('T')[0];
      const entries = db.getAll('finance_entries').filter(e => e.entry_date === today);
      const income = entries.filter(e => e.type === 'income').reduce((s, e) => s + e.amount, 0);
      const expense = entries.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0);
      return `💰 오늘의 결산 현황:\n• 수입: ${income.toLocaleString()}원\n• 지출: ${expense.toLocaleString()}원\n• 순이익: ${(income - expense).toLocaleString()}원\n• 입력 건수: ${entries.length}건`;
    }
    if (msg.includes('회의') || msg.includes('일정') || msg.includes('캘린더')) {
      const events = db.getAll('calendar_events');
      const upcoming = events.filter(e => e.date >= new Date().toISOString().split('T')[0]).slice(0, 5);
      return upcoming.length > 0
        ? `📅 다가오는 일정:\n${upcoming.map(e => `• ${e.date} - ${e.title} (${e.type === 'meeting' ? '회의' : e.type === 'deadline' ? '마감' : '이벤트'})`).join('\n')}`
        : '📅 등록된 다가오는 일정이 없습니다.';
    }
    if (msg.includes('도움') || msg.includes('뭘 할 수') || msg.includes('기능') || msg.includes('안녕')) {
      return `안녕하세요, ${user.name}님! 저는 업무 어시스턴트입니다. 다음과 같은 질문에 답변할 수 있어요:\n\n• "업무 현황 알려줘" — 전체 업무 요약\n• "우선순위 높은 업무" — 중요 업무 목록\n• "지연된 업무 있어?" — 마감 초과 확인\n• "팀 현황" — 팀원 상태\n• "오늘 결산" — 재무 현황\n• "다가오는 일정" — 캘린더 확인\n\n💡 API 키를 등록하면 더 자연스러운 대화가 가능합니다.`;
    }
    return `📋 "${message}"에 대해 기본 모드에서는 상세한 답변이 어렵습니다.\n\n다음 키워드로 질문해보세요:\n• 업무 현황 / 우선순위 / 지연 업무\n• 팀 현황 / 결산 현황 / 일정\n\n💡 프로필에서 Claude 또는 OpenAI API 키를 등록하면 자유로운 대화가 가능합니다.`;
  } else {
    // 법률 자문 탭
    if (msg.includes('근로') || msg.includes('노동') || msg.includes('퇴직') || msg.includes('해고')) {
      return '⚖️ 근로기준법 기본 안내:\n\n• 근로시간: 1주 40시간, 연장근로 포함 최대 52시간\n• 퇴직금: 1년 이상 근속 시 30일분 이상의 평균임금\n• 해고 예고: 30일 전 통보 또는 30일분 통상임금 지급\n• 연차 휴가: 1년 80% 이상 출근 시 15일\n\n⚠️ 이 정보는 일반적인 안내이며, 구체적인 사안은 전문 변호사 상담을 권장합니다.';
    }
    if (msg.includes('계약') || msg.includes('계약서')) {
      return '📝 계약 관련 기본 안내:\n\n• 근로계약서: 임금, 근로시간, 휴일 등 반드시 명시\n• 계약 변경: 양 당사자 합의 필요\n• 수습 기간: 3개월 이내, 최저임금 90% 이상\n• 비밀유지 조항: 합리적 범위 내에서 유효\n\n⚠️ 구체적인 법률 검토는 전문가와 상담하세요.';
    }
    if (msg.includes('개인정보') || msg.includes('정보보호')) {
      return '🔒 개인정보보호법 기본 안내:\n\n• 수집 시 동의 필수 (목적, 항목, 기간 고지)\n• 목적 외 이용·제3자 제공 시 별도 동의\n• 파기: 보유 기간 경과 시 지체 없이 파기\n• 위반 시 과태료 및 형사처벌 가능\n• 개인정보 처리방침 공개 의무\n\n⚠️ 정확한 법률 적용은 전문가와 상담하세요.';
    }
    if (msg.includes('저작권') || msg.includes('지적재산') || msg.includes('특허')) {
      return '©️ 지적재산권 기본 안내:\n\n• 저작권: 창작과 동시에 발생 (등록 불요)\n• 특허: 출원 후 심사를 거쳐 등록\n• 상표: 10년 단위 갱신 가능\n• 업무상 저작물: 회사 명의로 공표 시 회사가 저작자\n• 소프트웨어: 저작권법으로 보호\n\n⚠️ 구체적인 권리 분쟁은 전문가와 상담하세요.';
    }
    if (msg.includes('세금') || msg.includes('세무') || msg.includes('부가세') || msg.includes('소득세')) {
      return '💵 세무 기본 안내:\n\n• 부가가치세: 매출세액 - 매입세액 (분기별 신고)\n• 법인세: 사업연도 종료 후 3개월 내 신고\n• 원천징수: 급여 지급 시 소득세 원천징수 의무\n• 4대 보험: 국민연금, 건강보험, 고용보험, 산재보험\n\n⚠️ 정확한 세무 처리는 세무사와 상담하세요.';
    }
    if (msg.includes('도움') || msg.includes('뭘 할 수') || msg.includes('기능') || msg.includes('안녕')) {
      return '안녕하세요! 법률 자문 어시스턴트입니다. 다음 분야에 대해 기본 안내를 제공합니다:\n\n• "근로기준법" — 근로시간, 퇴직금, 해고\n• "계약 관련" — 근로계약서, 수습 기간\n• "개인정보보호" — 수집·이용·파기 규정\n• "저작권" — 지적재산권 기본\n• "세금/세무" — 부가세, 법인세 기본\n\n💡 API 키를 등록하면 더 상세한 법률 상담이 가능합니다.';
    }
    return `⚖️ "${message}"에 대해 기본 모드에서는 상세한 답변이 어렵습니다.\n\n다음 키워드로 질문해보세요:\n• 근로기준법 / 계약 / 개인정보보호\n• 저작권 / 세금·세무\n\n💡 API 키를 등록하면 자유로운 법률 상담이 가능합니다.';
  }
}

app.post('/api/ai/chat', requireAuth, async (req, res) => {
  const user = getUser(req);
  const { message, tab, provider } = req.body;
  const apiKey = provider === 'openai' ? user.openai_api_key : user.claude_api_key;

  // API 키 없으면 기본 응답 시스템 사용
  if (!apiKey) {
    const reply = getBasicResponse(message, tab, user);
    return res.json({ reply, basic: true });
  }

  let systemPrompt;
  if (tab === 'work') {
    const tc = { todo: 0, inprogress: 0, pending: 0, done: 0 };
    db.getAll('tasks').forEach(t => { if (tc[t.status] !== undefined) tc[t.status]++; });
    systemPrompt = `당신은 업무 대시보드 AI 어시스턴트입니다. 한국어로 응답하세요.\n현재 업무: 대기 ${tc.todo}, 진행중 ${tc.inprogress}, 승인대기 ${tc.pending}, 완료 ${tc.done}\n사용자: ${user.name} (${user.role === 'leader' ? '팀장' : '팀원'})`;
  } else {
    systemPrompt = '당신은 한국 법률 자문 AI 어시스턴트입니다. 한국어로 응답하세요. 한국 법률에 대한 질문에 답변하세요.';
  }

  try {
    let reply;
    if (provider === 'openai') {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: message }], max_tokens: 1024 })
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message);
      reply = data.choices[0].message.content;
    } else {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1024, system: systemPrompt, messages: [{ role: 'user', content: message }] })
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message);
      reply = data.content[0].text;
    }
    res.json({ reply });
  } catch (e) { res.status(500).json({ error: e.message || 'AI 요청 실패' }); }
});

// KPI — only leader-approved tasks count as done
app.get('/api/kpi', requireAuth, (req, res) => {
  const tasks = db.getAll('tasks');
  const total = tasks.length;
  const done = tasks.filter(t => t.status === 'done').length;
  const pending = tasks.filter(t => t.status === 'pending').length;
  const today = new Date().toISOString().split('T')[0];
  const overdue = tasks.filter(t => t.due_date && t.due_date < today && t.status !== 'done').length;
  res.json({
    total, inprogress: tasks.filter(t => t.status === 'inprogress').length,
    done, pending, todo: tasks.filter(t => t.status === 'todo').length, overdue,
    completionRate: total > 0 ? Math.round((done / total) * 100) : 0
  });
});

// 결산 리포트 HTML 생성 함수
function buildReportData(user) {
  const today = new Date().toISOString().split('T')[0];
  const entries = db.getAll('finance_entries').filter(e => e.entry_date === today);
  const income = entries.filter(e => e.type === 'income').reduce((s, e) => s + e.amount, 0);
  const expense = entries.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0);
  const net = income - expense;
  const fmt = v => `₩${Math.round(v).toLocaleString('ko-KR')}`;
  const d = new Date();
  const dateStr = `${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일`;
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const dayStr = dayNames[d.getDay()];
  const timeStr = `${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
  const teamSize = db.getAll('users').length;

  const greetings = [
    '오늘도 한 걸음 더 성장한 하루였습니다.',
    '함께해서 더 빛나는 하루, 수고 많으셨습니다.',
    '오늘의 노력이 내일의 성과가 됩니다.',
    '팀의 열정이 돋보이는 하루였습니다.',
    '작은 성과들이 모여 큰 결과를 만듭니다.'
  ];
  const greeting = greetings[d.getDate() % greetings.length];

  const subject = `[WorkFlow] ${dateStr}(${dayStr}) 일일 결산 리포트`;
  const textBody = `일일 결산 리포트 — ${dateStr}\n\n[요약]\n- 입력 건수: ${entries.length}건\n- 총 수입: ${fmt(income)}\n- 총 지출: ${fmt(expense)}\n- 순이익: ${fmt(net)}\n\n${greeting}`;

  const detailRows = entries.map(e => {
    const owner = db.getById('users', e.user_id);
    return `<tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;color:#333;">${e.item_name}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:center;color:#666;">${e.category}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:600;color:${e.type==='income'?'#22D3A7':'#FF5C5C'};">${fmt(e.amount)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:center;">${e.type==='income'?'<span style="background:#e6f9f1;color:#22D3A7;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">수입</span>':'<span style="background:#ffe8e8;color:#FF5C5C;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">지출</span>'}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:center;color:#666;">${owner?.name||'-'}</td>
    </tr>`;
  }).join('');

  const html = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:'Apple SD Gothic Neo','Malgun Gothic','맑은 고딕',sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:32px 16px;">

    <!-- 헤더 -->
    <div style="background:linear-gradient(135deg,#4F6AFF 0%,#7C3AED 100%);border-radius:16px 16px 0 0;padding:32px;text-align:center;">
      <div style="display:inline-block;background:rgba(255,255,255,0.2);border-radius:12px;padding:6px 16px;margin-bottom:16px;">
        <span style="color:white;font-size:13px;font-weight:600;letter-spacing:1px;">W O R K F L O W</span>
      </div>
      <h1 style="color:white;margin:0 0 4px;font-size:22px;font-weight:700;">일일 결산 리포트</h1>
      <p style="color:rgba(255,255,255,0.85);margin:0;font-size:14px;">${dateStr} (${dayStr}) · ${timeStr} 발송</p>
    </div>

    <!-- 인사말 -->
    <div style="background:white;padding:24px 32px;border-bottom:1px solid #f0f0f0;">
      <p style="margin:0;color:#333;font-size:15px;line-height:1.6;">
        안녕하세요, <strong>${user.name}</strong>님!<br>
        오늘 하루도 수고 많으셨습니다. 아래 결산 내역을 확인해주세요.
      </p>
    </div>

    <!-- 요약 카드 -->
    <div style="background:white;padding:24px 32px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="width:33%;text-align:center;padding:16px 8px;">
            <div style="background:#e6f9f1;border-radius:12px;padding:20px 12px;">
              <div style="font-size:12px;color:#22D3A7;font-weight:600;margin-bottom:6px;">총 수입</div>
              <div style="font-size:20px;font-weight:800;color:#22D3A7;">${fmt(income)}</div>
            </div>
          </td>
          <td style="width:33%;text-align:center;padding:16px 8px;">
            <div style="background:#ffe8e8;border-radius:12px;padding:20px 12px;">
              <div style="font-size:12px;color:#FF5C5C;font-weight:600;margin-bottom:6px;">총 지출</div>
              <div style="font-size:20px;font-weight:800;color:#FF5C5C;">${fmt(expense)}</div>
            </div>
          </td>
          <td style="width:33%;text-align:center;padding:16px 8px;">
            <div style="background:${net>=0?'#eef0ff':'#fff3e0'};border-radius:12px;padding:20px 12px;">
              <div style="font-size:12px;color:${net>=0?'#4F6AFF':'#F59E0B'};font-weight:600;margin-bottom:6px;">순이익</div>
              <div style="font-size:20px;font-weight:800;color:${net>=0?'#4F6AFF':'#F59E0B'};">${fmt(net)}</div>
            </div>
          </td>
        </tr>
      </table>

      <!-- 부가 정보 -->
      <div style="display:flex;margin-top:8px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:8px 0;color:#999;font-size:12px;">입력 건수</td>
            <td style="padding:8px 0;text-align:right;font-weight:600;font-size:13px;color:#333;">${entries.length}건</td>
            <td style="width:32px;"></td>
            <td style="padding:8px 0;color:#999;font-size:12px;">팀 인원</td>
            <td style="padding:8px 0;text-align:right;font-weight:600;font-size:13px;color:#333;">${teamSize}명</td>
          </tr>
        </table>
      </div>
    </div>

    <!-- 상세 내역 -->
    ${entries.length > 0 ? `
    <div style="background:white;padding:24px 32px;border-top:1px solid #f0f0f0;">
      <h3 style="margin:0 0 16px;font-size:15px;color:#333;font-weight:700;">상세 내역</h3>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:#f8f9fa;">
              <th style="padding:10px 12px;text-align:left;color:#666;font-weight:600;border-bottom:2px solid #e9ecef;">항목</th>
              <th style="padding:10px 12px;text-align:center;color:#666;font-weight:600;border-bottom:2px solid #e9ecef;">카테고리</th>
              <th style="padding:10px 12px;text-align:right;color:#666;font-weight:600;border-bottom:2px solid #e9ecef;">금액</th>
              <th style="padding:10px 12px;text-align:center;color:#666;font-weight:600;border-bottom:2px solid #e9ecef;">유형</th>
              <th style="padding:10px 12px;text-align:center;color:#666;font-weight:600;border-bottom:2px solid #e9ecef;">담당자</th>
            </tr>
          </thead>
          <tbody>${detailRows}</tbody>
        </table>
      </div>
    </div>` : `
    <div style="background:white;padding:32px;border-top:1px solid #f0f0f0;text-align:center;">
      <p style="color:#aaa;font-size:14px;margin:0;">오늘 입력된 결산 내역이 없습니다.</p>
    </div>`}

    <!-- 푸터 인사 -->
    <div style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);border-radius:0 0 16px 16px;padding:28px 32px;text-align:center;">
      <p style="color:white;font-size:16px;font-weight:600;margin:0 0 6px;line-height:1.5;">${greeting}</p>
      <p style="color:rgba(255,255,255,0.7);font-size:12px;margin:0;">WorkFlow 대시보드에서 자동 생성된 리포트입니다.</p>
    </div>

  </div>
</body></html>`;

  return { subject, textBody, html, to: user.email, report: { entries: entries.length, income, expense, net } };
}

// 결산 리포트 미리보기
app.get('/api/finance/report-preview', requireAuth, (req, res) => {
  const user = getUser(req);
  const { html } = buildReportData(user);
  res.send(html);
});

// 결산 리포트 발송
app.post('/api/finance/send-report', requireAuth, async (req, res) => {
  const user = getUser(req);
  if (user.role !== 'leader') return res.status(403).json({ error: '팀장 전용' });
  const data = buildReportData(user);

  if (!resend) {
    console.log('=== 일일 결산 리포트 (Resend 미설정) ===\n', data.subject);
    return res.json({ ok: true, message: 'RESEND_API_KEY가 설정되지 않아 메일 발송이 불가합니다.', report: data.report, sent: false });
  }

  try {
    const fromAddr = process.env.RESEND_FROM || 'WorkFlow <onboarding@resend.dev>';
    await resend.emails.send({
      from: fromAddr,
      to: [data.to],
      subject: data.subject,
      html: data.html
    });
    console.log(`✅ 결산 리포트 발송 완료 → ${data.to}`);
    res.json({ ok: true, message: '결산 메일이 발송되었습니다', report: data.report, sent: true });
  } catch (err) {
    console.error('메일 발송 실패:', err.message);
    res.status(500).json({ ok: false, message: `메일 발송 실패: ${err.message}`, report: data.report, sent: false });
  }
});

// Avatar SVG
app.get('/avatars/:id', (req, res) => {
  const colors = ['#4F6AFF', '#22D3A7', '#FF5C5C', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'];
  const id = parseInt(req.params.id);
  const user = db.getById('users', id);
  let initials = '?';
  if (user && user.name) {
    const name = user.name.trim();
    // 한국어 이름: 첫 글자 사용 (예: 이준엽 → 이)
    // 영어 이름: 첫글자 + 성 첫글자 (예: Jun Yeop Lee → JL, Sarah Kim → SK)
    const isKorean = /[가-힣]/.test(name);
    if (isKorean) {
      initials = name.charAt(0);
    } else {
      const parts = name.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) {
        initials = (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
      } else {
        initials = name.substring(0, 2).toUpperCase();
      }
    }
  }
  const color = colors[(id - 1) % colors.length];
  const fontSize = initials.length === 1 ? 28 : 22;
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><circle cx="40" cy="40" r="40" fill="${color}"/><text x="40" y="45" text-anchor="middle" dominant-baseline="middle" fill="white" font-family="'Pretendard','Inter',sans-serif" font-size="${fontSize}" font-weight="600">${initials}</text></svg>`);
});

// Socket.io
io.on('connection', (socket) => {
  const sess = socket.request.session;
  const userId = sess?.passport?.user || sess?.userId;
  if (userId) { db.update('users', userId, { is_online: 1 }); io.emit('user-status', { userId, online: true }); }
  socket.on('chat-message', (data) => {
    if (!userId) return;
    const msg = db.insert('messages', { user_id: userId, content: data.content });
    const u = db.getById('users', userId);
    io.emit('new-message', { ...msg, user_name: u?.name || '알 수 없음', user_avatar: u?.avatar || '/avatars/1' });
  });
  socket.on('disconnect', () => { if (userId) { db.update('users', userId, { is_online: 0 }); io.emit('user-status', { userId, online: false }); } });
});

server.listen(process.env.PORT || 3000, () => console.log(`Dashboard running on port ${process.env.PORT || 3000}`));
