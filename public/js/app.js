/* ========================================
   WorkFlow Dashboard — app.js (Revised)
======================================== */

let currentUser = null;
let allUsers = [];
let allTasks = [];
let financeChart = null;
let currentFinPeriod = 'week';
let calYear, calMonth;
let selectedCalDate = null;
let currentAITab = 'work';
let currentAIProvider = 'claude';
let deleteTaskId = null;
let weatherInfo = null;
const socket = io();

const PRIORITY_LABEL = { high: '높음', medium: '보통', low: '낮음' };
const STATUS_LABEL = { todo: '대기', inprogress: '진행 중', pending: '완료 대기', done: '완료' };

// ── Init ──────────────────────────────────────────
async function init() {
  try {
    const resp = await fetch('/auth/me');
    if (!resp.ok) { window.location.href = '/login.html'; return; }
    currentUser = await resp.json();
  } catch { window.location.href = '/login.html'; return; }

  if (currentUser.role === 'leader') document.body.classList.add('is-leader');
  else document.body.classList.remove('is-leader');

  document.getElementById('header-avatar-img').src = `/avatars/${currentUser.id}`;
  document.getElementById('dropdown-name').textContent = currentUser.name;
  document.getElementById('dropdown-role').textContent = currentUser.role === 'leader' ? '팀장' : '팀원';

  const savedTheme = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);

  const now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth() + 1;

  updateDateTime();
  setInterval(updateDateTime, 60000);

  initCustomSelects();
  setupEntryDefaults();

  loadWeather();
  loadKPI();
  loadTasks();
  loadUsers();
  loadMessages();
  loadFinance();
  loadNotes();
  loadCalendar();
  loadUploadHistory();
  setupEvents();
  setupSocket();

  // 첫 로그인 시 프로필 설정 유도 (Google 가입 후 phone 미입력 상태)
  if (currentUser.profile_completed === false || (!currentUser.phone && !currentUser.google_id?.startsWith('demo_'))) {
    setTimeout(() => openProfileModal(true), 500);
  }
}

// ── Custom Dropdown ──────────────────────────────
function initCustomSelects() {
  document.querySelectorAll('.custom-select').forEach(sel => {
    sel.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasOpen = sel.classList.contains('open');
      closeAllDropdowns();
      if (!wasOpen) sel.classList.add('open');
    });

    sel.querySelectorAll('.cs-option').forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        const value = opt.dataset.value;
        const label = opt.textContent;
        sel.querySelector('.cs-label').textContent = label;
        sel.querySelector('input[type="hidden"]').value = value;
        sel.querySelectorAll('.cs-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        sel.classList.remove('open');
      });
    });
  });

  document.addEventListener('click', () => closeAllDropdowns());
}

function closeAllDropdowns() {
  document.querySelectorAll('.custom-select.open').forEach(s => s.classList.remove('open'));
}

function setCustomSelect(targetId, value, label) {
  const hidden = document.getElementById(targetId);
  if (!hidden) return;
  hidden.value = value;
  const sel = hidden.closest('.custom-select') || document.querySelector(`[data-target="${targetId}"]`);
  if (sel) {
    const csLabel = sel.querySelector('.cs-label');
    if (csLabel) csLabel.textContent = label;
    sel.querySelectorAll('.cs-option').forEach(o => {
      o.classList.toggle('selected', o.dataset.value === value);
    });
  }
}

// ── Date/Time & Weather ─────────────────────────
function updateDateTime() {
  const now = new Date();
  const dateStr = now.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
  const timeStr = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  let display = `${dateStr} ${timeStr}`;
  if (weatherInfo) display += ` · ${weatherInfo.city} ${weatherInfo.temp}°C ${weatherInfo.desc}`;
  document.getElementById('header-datetime').textContent = display;
}

async function loadWeather() {
  try {
    const region = currentUser?.region || '서울';
    const resp = await fetch(`/api/weather?region=${encodeURIComponent(region)}`);
    weatherInfo = await resp.json();
    updateDateTime();
  } catch {
    weatherInfo = { temp: 22, desc: '맑음', city: '서울' };
    updateDateTime();
  }
}

// ── KPI ──────────────────────────────────────────
async function loadKPI() {
  try {
    const resp = await fetch('/api/kpi');
    const kpi = await resp.json();
    document.getElementById('kpi-total').textContent = kpi.total;
    document.getElementById('kpi-progress').textContent = kpi.inprogress;
    document.getElementById('kpi-done').textContent = kpi.done;
    document.getElementById('kpi-overdue').textContent = kpi.overdue;
    document.getElementById('kpi-rate').textContent = kpi.completionRate + '%';
    document.getElementById('kpi-bar').style.width = kpi.completionRate + '%';

    // Change texts
    document.getElementById('kpi-total-change').textContent = '▲ 12.5% 전월 대비';
    document.getElementById('kpi-progress-change').textContent = '▲ 8.7% 전월 대비';
    document.getElementById('kpi-done-change').textContent = '▲ 5.4% 전월 대비';

    // Dynamic overdue icon color
    const overdueIcon = document.getElementById('kpi-overdue-icon');
    const overdueChange = document.getElementById('kpi-overdue-change');
    if (kpi.overdue > 0) {
      overdueIcon.className = 'kpi-icon kpi-icon-red';
      overdueChange.className = 'kpi-change down';
      overdueChange.textContent = `▼ ${kpi.overdue}건 지연`;
    } else {
      overdueIcon.className = 'kpi-icon kpi-icon-gray';
      overdueChange.className = 'kpi-change';
      overdueChange.textContent = '지연 없음 ✓';
    }

  } catch {}
}

// ── Tasks / Kanban ──────────────────────────────
async function loadTasks() {
  try {
    const resp = await fetch('/api/tasks');
    allTasks = await resp.json();
    renderMiniKanban();
  } catch {}
}

function renderMiniKanban() {
  const groups = { todo: [], inprogress: [], done: [] };
  allTasks.forEach(t => {
    if (t.status === 'pending' || t.status === 'done') groups.done.push(t);
    else if (groups[t.status]) groups[t.status].push(t);
  });

  const cols = [
    { key: 'todo', label: '대기' },
    { key: 'inprogress', label: '진행 중' },
    { key: 'done', label: '완료' }
  ];

  const grid = document.getElementById('kanban-mini-grid');
  grid.innerHTML = cols.map(col => {
    const items = groups[col.key].slice(0, 3);
    return `
      <div class="kanban-mini-col"
           ondragover="event.preventDefault();event.stopPropagation();this.classList.add('drag-over')"
           ondragleave="this.classList.remove('drag-over')"
           ondrop="event.stopPropagation();dropMiniTask(event,'${col.key}')">
        <div class="kanban-mini-col-header">
          <span>${col.label}</span>
          <span class="kanban-count">${groups[col.key].length}</span>
        </div>
        <div class="kanban-mini-items">
          ${items.map(t => `
            <div class="kanban-mini-card" draggable="true" ondragstart="event.stopPropagation();dragTask(event,${t.id})">
              <div class="kanban-card-title">${escapeHtml(t.title)}</div>
              <div class="kanban-card-priority">
                <span class="priority-dot priority-${t.priority}"></span>
                ${PRIORITY_LABEL[t.priority] || '보통'}
                ${t.status === 'pending' ? ' · 완료 대기' : t.status === 'done' ? ' · Done' : ''}
              </div>
            </div>
          `).join('')}
        </div>
        <button class="kanban-mini-add leader-only" onclick="event.stopPropagation();openAddTaskModal()">+ 업무 추가</button>
      </div>
    `;
  }).join('');
}

function openKanbanModal() {
  renderFullKanban();
  openModal('modal-kanban');
}

function renderFullKanban() {
  const groups = { todo: [], inprogress: [], pending: [], done: [] };
  allTasks.forEach(t => { if (groups[t.status]) groups[t.status].push(t); });

  const cols = [
    { key: 'todo', label: '대기', dropStatus: 'todo' },
    { key: 'inprogress', label: '진행 중', dropStatus: 'inprogress' },
    { key: 'pending', label: '완료 대기', dropStatus: 'pending' },
    { key: 'done', label: '완료', dropStatus: 'done' }
  ];

  const container = document.getElementById('kanban-full');
  container.style.gridTemplateColumns = 'repeat(4, 1fr)';

  container.innerHTML = cols.map(col => `
    <div class="kanban-full-col"
         ondragover="event.preventDefault();this.classList.add('drag-over')"
         ondragleave="this.classList.remove('drag-over')"
         ondrop="dropTask(event,'${col.dropStatus}')">
      <div class="kanban-full-col-header">
        <span>${col.label}</span>
        <span class="kanban-count">${groups[col.key].length}</span>
      </div>
      <div class="kanban-full-items">
        ${groups[col.key].map(t => renderFullKanbanCard(t)).join('')}
      </div>
    </div>
  `).join('');
}

function renderFullKanbanCard(t) {
  const priorityLabel = PRIORITY_LABEL[t.priority] || '보통';

  const statusOptions = ['todo', 'inprogress', 'done'].map(s => {
    const selected = t.status === s || (t.status === 'pending' && s === 'done') ? 'selected' : '';
    return `<option value="${s}" ${selected}>${STATUS_LABEL[s]}</option>`;
  }).join('');

  let actions = `<select class="kf-status-select" onchange="event.stopPropagation();changeTaskStatus(${t.id}, this.value)">${statusOptions}</select>`;

  if (t.status === 'pending' && currentUser.role === 'leader') {
    actions += `<button class="kf-btn kf-approve" onclick="event.stopPropagation();approveTask(${t.id})">✓ 승인</button>`;
  }
  if (currentUser.role === 'leader') {
    actions += `<button class="kf-btn kf-delete" onclick="event.stopPropagation();requestDeleteTask(${t.id})">삭제</button>`;
  }

  const statusBadge = t.status === 'pending'
    ? '<span class="kf-status-badge kf-status-pending" style="margin-left:6px">완료 대기</span>'
    : t.status === 'done'
    ? '<span class="kf-status-badge kf-status-done" style="margin-left:6px">완료</span>'
    : '';

  return `
    <div class="kanban-full-card p-${t.priority}" draggable="true" ondragstart="dragTask(event,${t.id})">
      <div class="kf-title">${escapeHtml(t.title)}${statusBadge}</div>
      <div class="kf-meta">
        <span class="kf-priority kf-priority-${t.priority}">${priorityLabel}</span>
        <span>${t.assignee_name || '미배정'}</span>
      </div>
      <div class="kf-actions">${actions}</div>
    </div>
  `;
}

function dragTask(e, taskId) {
  e.dataTransfer.setData('taskId', taskId);
  e.dataTransfer.effectAllowed = 'move';
}

async function dropMiniTask(e, newStatus) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const taskId = e.dataTransfer.getData('taskId');
  if (!taskId) return;
  await fetch(`/api/tasks/${taskId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: newStatus })
  });
  await loadTasks();
  await loadKPI();
  showToast('업무 상태가 변경되었습니다');
}

async function dropTask(e, newStatus) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const taskId = e.dataTransfer.getData('taskId');
  if (!taskId) return;
  await fetch(`/api/tasks/${taskId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: newStatus })
  });
  await loadTasks();
  await loadKPI();
  renderFullKanban();
}

async function changeTaskStatus(taskId, newStatus) {
  await fetch(`/api/tasks/${taskId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: newStatus })
  });
  await loadTasks();
  await loadKPI();
  if (document.getElementById('modal-kanban').classList.contains('show')) renderFullKanban();
}

async function approveTask(id) {
  await fetch(`/api/tasks/${id}/approve`, { method: 'POST' });
  await loadTasks();
  await loadKPI();
  renderFullKanban();
  showToast('업무가 승인되었습니다');
}

function requestDeleteTask(id) {
  deleteTaskId = id;
  openModal('modal-delete-confirm');
}

async function confirmDeleteTask() {
  if (!deleteTaskId) return;
  await fetch(`/api/tasks/${deleteTaskId}`, { method: 'DELETE' });
  deleteTaskId = null;
  closeModal('modal-delete-confirm');
  await loadTasks();
  await loadKPI();
  await loadCalendar();
  if (document.getElementById('modal-kanban').classList.contains('show')) renderFullKanban();
  showToast('업무가 삭제되었습니다');
}

function openAddTaskModal() {
  document.getElementById('task-title').value = '';
  document.getElementById('task-desc').value = '';
  setCustomSelect('task-priority', 'medium', '보통');
  document.getElementById('task-due').value = new Date().toISOString().split('T')[0];
  populateAssigneeSelect('task-assignee');
  openModal('modal-add-task');
}

function populateAssigneeSelect(selectId) {
  const sel = document.getElementById(selectId);
  sel.innerHTML = '<option value="">미배정</option>' +
    allUsers.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
}

async function createTask() {
  const title = document.getElementById('task-title').value.trim();
  if (!title) return showToast('제목을 입력해주세요');
  await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      description: document.getElementById('task-desc').value,
      priority: document.getElementById('task-priority').value,
      assignee_id: document.getElementById('task-assignee').value || null,
      due_date: document.getElementById('task-due').value || null
    })
  });
  closeModal('modal-add-task');
  await loadTasks();
  await loadKPI();
  await loadCalendar();
  if (document.getElementById('modal-kanban').classList.contains('show')) renderFullKanban();
  showToast('업무가 생성되었습니다');
}

// ── Users / Team ────────────────────────────────
async function loadUsers() {
  try {
    const [usersResp, statsResp] = await Promise.all([
      fetch('/api/users'),
      fetch('/api/team-stats')
    ]);
    allUsers = await usersResp.json();
    const teamStats = await statsResp.json();
    renderTeamList(teamStats);
    updateOnlineCount();
  } catch {}
}

function renderTeamList(stats) {
  const container = document.getElementById('team-list');
  const data = stats || allUsers;
  container.innerHTML = data.map(u => {
    const taskLine = u.currentTask
      ? `<div class="team-task">${escapeHtml(u.currentTask)}</div>`
      : `<div class="team-task no-task">배정된 업무 없음</div>`;
    const rate = u.completionRate || 0;
    const total = u.totalTasks || 0;
    const done = u.doneTasks || 0;
    const isOn = u.is_online;
    return `
      <div class="team-member" onclick="openMemberProfile(${u.id})">
        <div class="team-avatar">
          <img src="/avatars/${u.id}" alt="${escapeHtml(u.name)}">
          <span class="online-dot ${isOn ? 'on' : 'off'}"></span>
        </div>
        <div class="team-info">
          <div class="team-name-row">
            <span class="team-name">${escapeHtml(u.name)}</span>
            <span class="team-role-badge">${u.role === 'leader' ? '팀장' : '팀원'}</span>
            <span class="team-status ${isOn ? 'on' : 'off'}">${isOn ? '온라인' : '오프라인'}</span>
          </div>
          ${taskLine}
        </div>
        <div class="team-right">
          <div class="team-progress-wrap">
            <div class="team-progress-bar"><div class="team-progress-fill" style="width:${rate}%"></div></div>
            <span class="team-progress-pct">${rate}%</span>
          </div>
          <span class="team-task-count">${done}/${total}건 완료</span>
        </div>
      </div>
    `;
  }).join('');
}

async function openMemberProfile(userId) {
  try {
    const resp = await fetch(`/api/team-member/${userId}`);
    const m = await resp.json();
    const statusLabel = m.is_online ? '온라인' : '오프라인';
    const statusColor = m.is_online ? '#34C759' : '#8E92A4';

    const taskItems = m.tasks.length > 0
      ? m.tasks.map(t => {
          const sLabel = { todo: '대기', inprogress: '진행 중', pending: '완료 대기', done: '완료' };
          return `<div class="mp-task-item p-${t.priority}">
            <span class="mp-task-title">${escapeHtml(t.title)}</span>
            <span class="mp-task-status s-${t.status}">${sLabel[t.status] || t.status}</span>
          </div>`;
        }).join('')
      : '<div class="mp-empty">배정된 업무가 없습니다</div>';

    const isLeader = currentUser.role === 'leader';
    const isNotMe = m.id !== currentUser.id;
    const roleBtn = (isLeader && isNotMe) ? `
      <button class="mp-role-btn ${m.role === 'leader' ? 'demote' : 'promote'}" onclick="changeUserRole(${m.id}, '${m.role === 'leader' ? 'member' : 'leader'}')">
        ${m.role === 'leader' ? '팀원으로 변경' : '팀장으로 임명'}
      </button>` : '';

    document.getElementById('member-profile-content').innerHTML = `
      <div class="mp-header">
        <div class="mp-avatar">
          <img src="/avatars/${m.id}" alt="${escapeHtml(m.name)}">
          <span class="mp-status" style="background:${statusColor}"></span>
        </div>
        <div>
          <div class="mp-name">${escapeHtml(m.name)}</div>
          <div class="mp-role">${m.role === 'leader' ? '팀장' : '팀원'} · ${statusLabel}</div>
        </div>
        ${roleBtn}
      </div>
      <div class="mp-info-grid">
        <div class="mp-info-item"><span class="mp-info-label">이메일</span><span class="mp-info-value">${escapeHtml(m.email || '-')}</span></div>
        <div class="mp-info-item"><span class="mp-info-label">전화번호</span><span class="mp-info-value">${escapeHtml(m.phone || '-')}</span></div>
        <div class="mp-info-item"><span class="mp-info-label">지역</span><span class="mp-info-value">${escapeHtml(m.region || '-')}</span></div>
        <div class="mp-info-item"><span class="mp-info-label">배정 업무</span><span class="mp-info-value">${m.totalTasks}건</span></div>
      </div>
      <div class="mp-progress">
        <span style="font-size:12px;color:var(--text-secondary)">업무 진행률</span>
        <div class="mp-progress-bar"><div class="mp-progress-fill" style="width:${m.completionRate}%"></div></div>
        <span class="mp-progress-text">${m.completionRate}%</span>
      </div>
      <div class="mp-tasks-title">배정 업무 목록 (${m.totalTasks})</div>
      <div class="mp-task-list">${taskItems}</div>
    `;
    openModal('modal-member-profile');
  } catch {}
}

async function changeUserRole(userId, newRole) {
  const label = newRole === 'leader' ? '팀장으로 임명' : '팀원으로 변경';
  if (!confirm(`이 팀원을 ${label}하시겠습니까?`)) return;
  try {
    const resp = await fetch(`/api/users/${userId}/role`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: newRole })
    });
    const result = await resp.json();
    if (result.ok) {
      showToast(`${label} 완료`);
      closeModal('modal-member-profile');
      await loadUsers();
    } else {
      showToast(result.error || '권한 변경 실패');
    }
  } catch { showToast('권한 변경에 실패했습니다'); }
}

function updateOnlineCount() {
  const count = allUsers.filter(u => u.is_online).length;
  const el = document.getElementById('online-count');
  if (el) el.textContent = `${count}명 온라인`;
}

function openTeamModal() {
  const container = document.getElementById('team-full-list');
  container.innerHTML = allUsers.map(u => `
    <div class="team-member" onclick="openMemberProfile(${u.id})" style="padding:10px 0;border-bottom:1px solid var(--border)">
      <div class="team-avatar"><img src="/avatars/${u.id}" alt="${escapeHtml(u.name)}"><span class="online-dot ${u.is_online ? 'on' : 'off'}"></span></div>
      <div class="team-info">
        <div class="team-name-row">
          <span class="team-name">${escapeHtml(u.name)}</span>
          <span class="team-role-badge">${u.role === 'leader' ? '팀장' : '팀원'}</span>
          <span class="team-status ${u.is_online ? 'on' : 'off'}">${u.is_online ? '온라인' : '오프라인'}</span>
        </div>
        <div class="team-task" style="font-size:11px;color:var(--text-secondary)">${u.email || ''}</div>
      </div>
    </div>
  `).join('');
  openModal('modal-team');
}

// ── Chat ─────────────────────────────────────────
let chatMessages = [];

async function loadMessages() {
  try {
    const resp = await fetch('/api/messages');
    chatMessages = await resp.json();
    renderChatPreview();
  } catch {}
}

function renderChatPreview() {
  const container = document.getElementById('chat-preview');
  container.innerHTML = chatMessages.map(m => {
    const isMine = m.user_id === currentUser.id;
    const time = new Date(m.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    const acks = m.acks || [];
    const ackHtml = acks.length > 0
      ? `<div class="chat-ack-mini"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> ${acks.length}</div>`
      : '';
    return `
      <div class="chat-msg-preview ${isMine ? 'chat-msg-mine' : ''}">
        <div class="chat-avatar"><img src="/avatars/${m.user_id}" alt=""></div>
        <div class="chat-msg-bubble">
          <div class="chat-msg-header">
            <span class="chat-msg-name">${isMine ? 'You' : escapeHtml(m.user_name)}</span>
            <span class="chat-msg-time">${time}</span>
          </div>
          <span class="chat-msg-text">${escapeHtml(m.content)}</span>
          ${ackHtml}
        </div>
      </div>`;
  }).join('');
  container.scrollTop = container.scrollHeight;
}

function renderFullChat() {
  const container = document.getElementById('chat-messages');
  container.innerHTML = chatMessages.map(m => {
    const isMine = m.user_id === currentUser.id;
    const time = new Date(m.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    const acks = m.acks || [];
    const myAcked = acks.some(a => a.user_id === currentUser.id);
    const ackNames = acks.map(a => a.user_name).join(', ');

    // 체크 버튼 (본인 메시지가 아닌 경우만)
    const ackBtn = !isMine
      ? `<button class="chat-ack-btn ${myAcked ? 'acked' : ''}" onclick="toggleMessageAck(${m.id})" title="${ackNames || '확인 표시'}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        </button>`
      : '';

    // 체크 카운트 (체크한 사람이 있으면)
    const ackInfo = acks.length > 0
      ? `<span class="chat-ack-btn acked" onclick="showAckList(${m.id})" style="cursor:pointer" title="${ackNames}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          <span class="chat-ack-count">${acks.length}</span>
        </span>`
      : '';

    // 삭제 버튼 (본인 메시지만)
    const deleteBtn = isMine
      ? `<button class="chat-delete-btn" onclick="deleteMessage(${m.id})" title="삭제">삭제</button>`
      : '';

    return `
      <div class="chat-msg ${isMine ? 'mine' : ''}" data-msg-id="${m.id}">
        <div class="chat-msg-avatar"><img src="/avatars/${m.user_id}" alt=""></div>
        <div class="chat-msg-body">
          <div class="chat-msg-info">
            <span class="name">${isMine ? 'You' : escapeHtml(m.user_name)}</span>
            <span class="time">${time}</span>
          </div>
          <div class="chat-msg-content">${escapeHtml(m.content)}</div>
          <div class="chat-msg-actions">${ackBtn}${ackInfo}${deleteBtn}</div>
        </div>
      </div>`;
  }).join('');
  container.scrollTop = container.scrollHeight;

  const onlineContainer = document.getElementById('chat-online-users');
  const onlineUsers = allUsers.filter(u => u.is_online);
  onlineContainer.innerHTML = onlineUsers.map(u =>
    `<div class="online-dot"><img src="/avatars/${u.id}" alt="${escapeHtml(u.name)}"></div>`
  ).join('');
}

async function toggleMessageAck(msgId) {
  try { await fetch(`/api/messages/${msgId}/ack`, { method: 'POST' }); } catch {}
}

let pendingDeleteMsgId = null;

function deleteMessage(msgId) {
  pendingDeleteMsgId = msgId;
  openModal('modal-delete-msg');
}

async function confirmDeleteMessage() {
  if (!pendingDeleteMsgId) return;
  try {
    const resp = await fetch(`/api/messages/${pendingDeleteMsgId}`, { method: 'DELETE' });
    if (resp.ok) {
      chatMessages = chatMessages.filter(m => m.id !== pendingDeleteMsgId);
      renderChatPreview();
      if (document.getElementById('panel-chat').classList.contains('show')) renderFullChat();
    }
  } catch {}
  pendingDeleteMsgId = null;
  closeModal('modal-delete-msg');
}

function showAckList(msgId) {
  const msg = chatMessages.find(m => m.id === msgId);
  if (!msg || !msg.acks || msg.acks.length === 0) return;
  const names = msg.acks.map(a => a.user_name).join(', ');
  showToast(`확인: ${names}`);
}

function openChatPanel() {
  renderFullChat();
  document.getElementById('panel-chat').classList.add('show');
  document.getElementById('chat-backdrop').classList.add('show');
}

function closeChatPanel() {
  document.getElementById('panel-chat').classList.remove('show');
  document.getElementById('chat-backdrop').classList.remove('show');
}

function sendMiniChat() {
  const input = document.getElementById('chat-input-mini');
  if (!input.value.trim()) return;
  socket.emit('chat-message', { content: input.value.trim() });
  input.value = '';
}

function sendFullChat() {
  const input = document.getElementById('chat-input-full');
  if (!input.value.trim()) return;
  socket.emit('chat-message', { content: input.value.trim() });
  input.value = '';
}

// ── Finance ──────────────────────────────────────
async function loadFinance() {
  try {
    const [entriesResp, summaryResp] = await Promise.all([
      fetch(`/api/finance?period=${currentFinPeriod}`),
      fetch(`/api/finance/summary?period=${currentFinPeriod}`)
    ]);
    const entries = await entriesResp.json();
    const summary = await summaryResp.json();

    document.getElementById('fin-income').textContent = `₩${Math.round(summary.income).toLocaleString()}`;
    document.getElementById('fin-expense').textContent = `₩${Math.round(summary.expense).toLocaleString()}`;
    const net = summary.income - summary.expense;
    document.getElementById('fin-net').textContent = `₩${Math.round(net).toLocaleString()}`;
    document.getElementById('entry-today-count').textContent = summary.todayCount;

    // 순이익 색상 표시
    const netEl = document.getElementById('fin-net');
    if (netEl) netEl.style.color = net >= 0 ? '#34C759' : '#FF5C5C';

    renderFinanceChart(entries);
  } catch {}
}

function renderFinanceChart(entries) {
  const chartEmpty = document.getElementById('chart-empty');
  const canvas = document.getElementById('finance-chart');

  if (!entries || entries.length === 0) {
    chartEmpty.style.display = 'flex';
    canvas.style.display = 'none';
    if (financeChart) { financeChart.destroy(); financeChart = null; }
    return;
  }
  chartEmpty.style.display = 'none';
  canvas.style.display = 'block';

  // 기간별 그룹핑 키 생성
  function groupKey(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    if (currentFinPeriod === 'year') {
      return `${d.getFullYear()}`;
    }
    if (currentFinPeriod === 'quarter') {
      const q = Math.floor(d.getMonth() / 3) + 1;
      return `Q${q}`;
    }
    if (currentFinPeriod === 'month') {
      const weekNum = Math.ceil(d.getDate() / 7);
      return `${weekNum}주차`;
    }
    return dateStr; // day, week: 일별
  }

  const grouped = {};
  entries.forEach(e => {
    const key = groupKey(e.entry_date);
    if (!grouped[key]) grouped[key] = { income: 0, expense: 0 };
    if (e.type === 'income') grouped[key].income += e.amount;
    else grouped[key].expense += e.amount;
  });

  // 정렬된 라벨
  let sortedKeys;
  if (currentFinPeriod === 'quarter') {
    sortedKeys = ['Q1', 'Q2', 'Q3', 'Q4'].filter(k => grouped[k]);
  } else if (currentFinPeriod === 'year') {
    sortedKeys = Object.keys(grouped).sort();
  } else if (currentFinPeriod === 'month') {
    sortedKeys = ['1주차', '2주차', '3주차', '4주차', '5주차'].filter(k => grouped[k]);
  } else {
    sortedKeys = Object.keys(grouped).sort();
  }

  const incomeData = sortedKeys.map(k => Math.round(grouped[k].income));
  const expenseData = sortedKeys.map(k => Math.round(grouped[k].expense));

  // 라벨 포맷
  const shortLabels = sortedKeys.map(k => {
    if (currentFinPeriod === 'quarter' || currentFinPeriod === 'month') return k;
    if (currentFinPeriod === 'year') return `${k}년`;
    const date = new Date(k + 'T00:00:00');
    return `${date.getMonth() + 1}/${date.getDate()}`;
  });

  if (financeChart) financeChart.destroy();

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const textColor = isDark ? '#6B7082' : '#8E92A4';

  financeChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: shortLabels,
      datasets: [
        {
          label: '수입',
          data: incomeData,
          backgroundColor: 'rgba(34,211,167,0.7)',
          borderRadius: 6,
          barPercentage: 0.6,
        },
        {
          label: '지출',
          data: expenseData,
          backgroundColor: 'rgba(79,106,255,0.7)',
          borderRadius: 6,
          barPercentage: 0.6,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 10, family: 'Inter' }, color: textColor }
        },
        y: {
          grid: { color: gridColor },
          ticks: {
            font: { size: 10, family: 'Inter' },
            color: textColor,
            callback: v => v >= 10000 ? `₩${(v / 10000).toFixed(0)}만` : `₩${v.toLocaleString()}`
          }
        }
      }
    }
  });
}

function setupEntryDefaults() {
  const ownerLabel = document.getElementById('entry-owner-label');
  const ownerHidden = document.getElementById('entry-owner');
  if (ownerLabel && currentUser) ownerLabel.textContent = currentUser.name;
  if (ownerHidden && currentUser) ownerHidden.value = currentUser.name;
  const dateEl = document.getElementById('entry-date');
  if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
}

async function saveFinanceEntry() {
  const name = document.getElementById('entry-name').value.trim();
  const amount = parseFloat(document.getElementById('entry-amount').value);
  const entryDate = document.getElementById('entry-date').value;
  const memo = document.getElementById('entry-memo').value.trim();
  if (!name || !amount) return showToast('항목명과 금액을 입력해주세요');
  await fetch('/api/finance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      item_name: name,
      amount,
      entry_date: entryDate || new Date().toISOString().split('T')[0],
      category: document.getElementById('entry-category').value,
      type: document.getElementById('entry-type').value,
      memo
    })
  });
  document.getElementById('entry-name').value = '';
  document.getElementById('entry-amount').value = '';
  document.getElementById('entry-memo').value = '';
  await loadFinance();
  showToast('저장되었습니다');
}

async function uploadFile(input) {
  if (!input.files[0]) return;
  const formData = new FormData();
  formData.append('file', input.files[0]);
  try {
    const resp = await fetch('/api/finance/upload', { method: 'POST', body: formData });
    const result = await resp.json();
    if (result.imported) {
      showToast(`${result.imported}건 가져오기 완료`);
      await loadFinance();
      await loadUploadHistory();
    } else {
      showToast(result.error || '파일 처리 실패');
    }
  } catch {
    showToast('파일 업로드 실패');
  }
  input.value = '';
}

function switchEntryTab(tab) {
  document.querySelectorAll('.entry-tab').forEach((el, i) => {
    el.classList.toggle('active', (tab === 'direct' && i === 0) || (tab === 'upload' && i === 1) || (tab === 'today' && i === 2));
  });
  document.getElementById('entry-direct').style.display = tab === 'direct' ? 'flex' : 'none';
  document.getElementById('entry-upload').style.display = tab === 'upload' ? 'flex' : 'none';
  document.getElementById('entry-today').style.display = tab === 'today' ? 'flex' : 'none';
  if (tab === 'today') loadTodayEntries();
}

async function loadTodayEntries() {
  try {
    const resp = await fetch('/api/finance/today');
    const entries = await resp.json();
    const container = document.getElementById('today-entries-list');
    if (entries.length === 0) {
      container.innerHTML = '<p class="upload-empty">오늘 입력된 내역이 없습니다</p>';
    } else {
      container.innerHTML = entries.map(e => {
        const time = new Date(e.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
        const typeClass = e.type === 'income' ? 'income' : 'expense';
        const typeLabel = e.type === 'income' ? '수입' : '지출';
        const sourceIcon = e.source === 'file_upload' ? ' 📎' : '';
        const canEdit = (e.user_id === currentUser.id || currentUser.role === 'leader');
        const actions = canEdit ? `<div class="today-entry-actions">
            <button class="te-btn te-edit" onclick="openEditEntry(${e.id})" title="수정">수정</button>
            <button class="te-btn te-del" onclick="deleteEntry(${e.id})" title="삭제">삭제</button>
          </div>` : '';
        return `<div class="today-entry-item" id="te-${e.id}">
          <div class="today-entry-top">
            <span class="today-entry-name">${escapeHtml(e.user_name)}${sourceIcon}</span>
            <span class="today-entry-right">
              <span class="today-entry-time">${time}</span>
              ${actions}
            </span>
          </div>
          <div class="today-entry-detail">
            <span class="today-entry-title">${escapeHtml(e.item_name)}</span>
            <span class="today-entry-amount ${typeClass}">
              ${e.type === 'income' ? '+' : '-'}₩${Math.round(e.amount).toLocaleString()}
            </span>
          </div>
          <div class="today-entry-meta">${escapeHtml(e.category)} · ${typeLabel}${e.memo ? ' · ' + escapeHtml(e.memo) : ''}</div>
        </div>`;
      }).join('');
    }
  } catch {}
}

// 오늘 내역 수정 (인라인 폼으로 전환)
async function openEditEntry(id) {
  const resp = await fetch('/api/finance/today');
  const entries = await resp.json();
  const entry = entries.find(e => e.id === id);
  if (!entry) return showToast('항목을 찾을 수 없습니다');

  const container = document.getElementById(`te-${id}`);
  if (!container) return;

  const cats = ['인건비','외주비','재료비','마케팅비','기타'];
  const catOptions = cats.map(c => `<option value="${c}" ${entry.category === c ? 'selected' : ''}>${c}</option>`).join('');

  container.innerHTML = `
    <div class="te-edit-form">
      <div class="te-edit-row">
        <input type="text" class="te-input" id="te-edit-name-${id}" value="${escapeHtml(entry.item_name)}" placeholder="항목명">
        <input type="number" class="te-input te-input-amount" id="te-edit-amount-${id}" value="${entry.amount}" placeholder="금액">
      </div>
      <div class="te-edit-row">
        <select class="te-select" id="te-edit-cat-${id}">${catOptions}</select>
        <select class="te-select" id="te-edit-type-${id}">
          <option value="income" ${entry.type === 'income' ? 'selected' : ''}>수입</option>
          <option value="expense" ${entry.type === 'expense' ? 'selected' : ''}>지출</option>
        </select>
        <input type="text" class="te-input" id="te-edit-memo-${id}" value="${escapeHtml(entry.memo || '')}" placeholder="비고">
      </div>
      <div class="te-edit-actions">
        <button class="te-btn te-save" onclick="saveEditEntry(${id})">저장</button>
        <button class="te-btn te-cancel" onclick="loadTodayEntries()">취소</button>
      </div>
    </div>`;
}

async function saveEditEntry(id) {
  const item_name = document.getElementById(`te-edit-name-${id}`).value.trim();
  const amount = parseFloat(document.getElementById(`te-edit-amount-${id}`).value);
  const category = document.getElementById(`te-edit-cat-${id}`).value;
  const type = document.getElementById(`te-edit-type-${id}`).value;
  const memo = document.getElementById(`te-edit-memo-${id}`).value.trim();

  if (!item_name || !amount) return showToast('항목명과 금액을 입력해주세요');

  try {
    const resp = await fetch(`/api/finance/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_name, amount, category, type, memo })
    });
    if (!resp.ok) {
      const err = await resp.json();
      return showToast(err.error || '수정 실패');
    }
    await loadFinance();
    await loadTodayEntries();
    showToast('수정되었습니다');
  } catch { showToast('수정 실패'); }
}

async function deleteEntry(id) {
  if (!confirm('이 항목을 삭제하시겠습니까?')) return;
  try {
    const resp = await fetch(`/api/finance/${id}`, { method: 'DELETE' });
    if (!resp.ok) {
      const err = await resp.json();
      return showToast(err.error || '삭제 실패');
    }
    await loadFinance();
    await loadTodayEntries();
    showToast('삭제되었습니다');
  } catch { showToast('삭제 실패'); }
}

async function loadUploadHistory() {
  try {
    const resp = await fetch('/api/upload-history');
    const history = await resp.json();
    const container = document.getElementById('upload-history');
    if (history.length === 0) {
      container.innerHTML = '<p class="upload-empty">아직 업로드된 파일이 없습니다</p>';
    } else {
      container.innerHTML = history.map(h => {
        const date = new Date(h.created_at).toLocaleDateString('ko-KR');
        return `<div class="upload-history-item"><span>${escapeHtml(h.filename)} (${h.count}건)</span><span>${date}</span></div>`;
      }).join('');
    }
  } catch {}
}

async function previewReportEmail() {
  try {
    const resp = await fetch('/api/finance/report-preview');
    const html = await resp.text();
    document.getElementById('mail-preview-frame').innerHTML = html;
    openModal('modal-mail-preview');
  } catch { showToast('미리보기를 불러올 수 없습니다'); }
}

async function sendSettlementEmail() {
  try {
    const resp = await fetch('/api/finance/send-report', { method: 'POST' });
    const result = await resp.json();
    if (result.ok && result.sent) {
      showToast('결산 메일이 발송되었습니다 ✉️');
    } else if (result.ok && !result.sent) {
      showToast(result.message || 'SMTP 설정이 필요합니다');
    } else {
      showToast(result.message || '메일 발송에 실패했습니다.');
    }
  } catch {
    showToast('메일 발송에 실패했습니다. 다시 시도해주세요.');
  }
}

// ── Sticky Notes ─────────────────────────────────
let allNotes = [];

async function loadNotes() {
  try {
    const resp = await fetch('/api/notes');
    allNotes = await resp.json();
    renderMiniNotes();
  } catch {}
}

function renderMiniNotes() {
  const container = document.getElementById('sticky-mini-grid');
  const maxShow = 4;
  const display = allNotes.slice(0, maxShow);
  container.innerHTML = display.map(n => `
    <div class="sticky-note-mini sticky-${n.color}">
      <div class="note-text">${escapeHtml(n.content)}</div>
      <div class="note-author">– ${escapeHtml(n.author_name)}</div>
    </div>
  `).join('');

  // +N overflow badge
  const moreBadge = document.getElementById('sticky-more');
  if (allNotes.length > maxShow) {
    moreBadge.textContent = `+${allNotes.length - maxShow}`;
    moreBadge.style.display = 'inline';
  } else {
    moreBadge.style.display = 'none';
  }
}

function openStickyModal() {
  renderFullNotes();
  openModal('modal-sticky');
}

function renderFullNotes() {
  const container = document.getElementById('sticky-full-grid');
  container.innerHTML = allNotes.map(n => `
    <div class="sticky-full-note sticky-${n.color}" data-id="${n.id}">
      <div class="note-text" contenteditable="true" onblur="updateNote(${n.id}, this.textContent)">${escapeHtml(n.content)}</div>
      <div class="note-footer">
        <span>– ${escapeHtml(n.author_name)}</span>
        <button class="note-delete" onclick="deleteNote(${n.id})">✕</button>
      </div>
    </div>
  `).join('');
}

async function addStickyNote() {
  const text = document.getElementById('new-note-text').value.trim();
  if (!text) return showToast('메모 내용을 입력해주세요');
  await fetch('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: text, color: document.getElementById('new-note-color').value })
  });
  document.getElementById('new-note-text').value = '';
  await loadNotes();
  renderFullNotes();
  showToast('메모가 추가되었습니다');
}

async function updateNote(id, content) {
  await fetch(`/api/notes/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content })
  });
}

async function deleteNote(id) {
  await fetch(`/api/notes/${id}`, { method: 'DELETE' });
  await loadNotes();
  renderFullNotes();
}

// ── Calendar ─────────────────────────────────────
let calendarEvents = [];

async function loadCalendar() {
  try {
    const resp = await fetch(`/api/calendar?year=${calYear}&month=${calMonth}`);
    calendarEvents = await resp.json();
    renderCalendar();
  } catch {}
}

function renderCalendar() {
  const grid = document.getElementById('calendar-grid');
  document.getElementById('cal-month-label').textContent = `${calYear}년 ${calMonth}월`;

  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  let html = dayNames.map(d => `<div class="cal-day-name">${d}</div>`).join('');

  const firstDay = new Date(calYear, calMonth - 1, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth, 0).getDate();
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === calYear && today.getMonth() + 1 === calMonth;

  const prevMonthDays = new Date(calYear, calMonth - 1, 0).getDate();
  for (let i = firstDay - 1; i >= 0; i--) {
    html += `<div class="cal-day other-month">${prevMonthDays - i}</div>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calYear}-${String(calMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isToday = isCurrentMonth && d === today.getDate();
    const dayEvents = calendarEvents.filter(e => e.event_date === dateStr);
    const dots = [...new Set(dayEvents.map(e => e.event_type))].map(t => `<i class="dot dot-${t}"></i>`).join('');

    html += `<div class="cal-day ${isToday ? 'today' : ''}" onclick="openCalDay('${dateStr}')">
      ${d}
      ${dots ? `<div class="cal-dots">${dots}</div>` : ''}
    </div>`;
  }

  const totalCells = firstDay + daysInMonth;
  const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  for (let i = 1; i <= remaining; i++) {
    html += `<div class="cal-day other-month">${i}</div>`;
  }

  grid.innerHTML = html;
}

function changeMonth(delta) {
  calMonth += delta;
  if (calMonth > 12) { calMonth = 1; calYear++; }
  if (calMonth < 1) { calMonth = 12; calYear--; }
  loadCalendar();
}

async function openCalDay(dateStr) {
  selectedCalDate = dateStr;
  const d = new Date(dateStr + 'T00:00:00');
  document.getElementById('cal-day-title').textContent =
    d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

  try {
    const resp = await fetch(`/api/calendar/day?date=${dateStr}`);
    const { events, tasks } = await resp.json();

    const content = document.getElementById('cal-day-content');
    let html = '';
    const typeIcon = { meeting: '📋', deadline: '⏰', event: '🎉' };
    const typeLabel = { meeting: '회의', deadline: '마감', event: '이벤트' };
    if (events.length === 0 && tasks.length === 0) {
      html = '<p style="color:var(--text-secondary);text-align:center;padding:24px;font-size:13px">등록된 일정이 없습니다</p>';
    }
    events.forEach(e => {
      html += `<div class="cal-event-detail type-${e.event_type}">
        <div class="event-icon ic-${e.event_type}">${typeIcon[e.event_type] || '📋'}</div>
        <div class="event-body">
          <span class="event-title">${escapeHtml(e.title)}</span>
          <div class="event-tag">${typeLabel[e.event_type] || ''}</div>
        </div>
        ${currentUser.role === 'leader' ? `<button class="event-delete" onclick="deleteCalEvent(${e.id})">✕</button>` : ''}
      </div>`;
    });
    tasks.forEach(t => {
      html += `<div class="cal-event-detail type-task">
        <div class="event-icon ic-task">📌</div>
        <div class="event-body">
          <span class="event-title">${escapeHtml(t.title)}</span>
          <div class="event-tag">업무${t.assignee_name ? ' · ' + escapeHtml(t.assignee_name) : ''}</div>
        </div>
      </div>`;
    });
    content.innerHTML = html;
  } catch {}

  document.getElementById('cal-event-title').value = '';
  document.getElementById('cal-task-title').value = '';
  document.getElementById('cal-event-type').value = 'meeting';
  document.getElementById('cal-task-priority').value = 'medium';
  // Populate assignee select (native)
  const assignSel = document.getElementById('cal-task-assignee');
  assignSel.innerHTML = '<option value="">미배정</option>' + allUsers.map(u => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join('');
  openModal('modal-cal-day');
}

async function addCalendarEvent() {
  const title = document.getElementById('cal-event-title').value.trim();
  if (!title || !selectedCalDate) return showToast('일정 제목을 입력해주세요');
  await fetch('/api/calendar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      event_date: selectedCalDate,
      event_type: document.getElementById('cal-event-type').value
    })
  });
  document.getElementById('cal-event-title').value = '';
  await loadCalendar();
  openCalDay(selectedCalDate);
  showToast('일정이 추가되었습니다');
}

async function assignTaskFromCal() {
  const title = document.getElementById('cal-task-title').value.trim();
  if (!title) return showToast('업무 제목을 입력해주세요');
  await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      assignee_id: document.getElementById('cal-task-assignee').value || null,
      priority: document.getElementById('cal-task-priority').value,
      due_date: selectedCalDate
    })
  });
  document.getElementById('cal-task-title').value = '';
  await loadTasks();
  await loadKPI();
  await loadCalendar();
  openCalDay(selectedCalDate);
  showToast('업무가 할당되었습니다');
}

async function deleteCalEvent(id) {
  await fetch(`/api/calendar/${id}`, { method: 'DELETE' });
  await loadCalendar();
  if (selectedCalDate) openCalDay(selectedCalDate);
}

// ── AI Assistant ─────────────────────────────────
function toggleAIPopup() {
  const popup = document.getElementById('ai-popup');
  popup.classList.toggle('show');
  if (popup.classList.contains('show')) updateAIKeyState();
}

function updateAIKeyState() {
  const hasKey = currentAIProvider === 'claude' ? currentUser.hasClaudeKey : currentUser.hasOpenaiKey;
  document.getElementById('ai-no-key').style.display = 'none';
  document.getElementById('ai-input-area').style.display = 'flex';
  document.getElementById('ai-messages').style.display = 'flex';

  // Update provider button states
  document.querySelectorAll('.ai-prov-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.prov === currentAIProvider);
  });

  // 기본 모드 배지 표시
  let badge = document.getElementById('ai-basic-badge');
  if (!hasKey) {
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'ai-basic-badge';
      badge.style.cssText = 'text-align:center;padding:4px 8px;background:rgba(245,158,11,0.1);color:#F59E0B;font-size:11px;border-radius:6px;margin:0 12px 4px';
      badge.textContent = '⚡ 기본 모드 · 키워드 기반 응답';
      const msgs = document.getElementById('ai-messages');
      msgs.parentNode.insertBefore(badge, msgs);
    }
    badge.style.display = 'block';
  } else if (badge) {
    badge.style.display = 'none';
  }
}

function switchAITab(tab) {
  currentAITab = tab;
  document.querySelectorAll('.ai-tab').forEach(el => {
    el.classList.toggle('active', el.textContent.includes(tab === 'work' ? '업무' : '법률'));
  });
  const msgs = document.getElementById('ai-messages');
  msgs.innerHTML = `<div class="ai-msg ai-bot">${tab === 'work'
    ? '안녕하세요! 업무 관련 질문을 해주세요.'
    : '안녕하세요! 한국 법률 관련 질문을 해주세요.'}</div>`;
}

function switchAIProvider(prov) {
  currentAIProvider = prov;
  updateAIKeyState();
}

async function sendAIMessage() {
  const input = document.getElementById('ai-input');
  const message = input.value.trim();
  if (!message) return;
  input.value = '';

  const msgs = document.getElementById('ai-messages');
  msgs.innerHTML += `<div class="ai-msg ai-user">${escapeHtml(message)}</div>`;
  msgs.innerHTML += `<div class="ai-loading" id="ai-loading"><span></span><span></span><span></span></div>`;
  msgs.scrollTop = msgs.scrollHeight;

  try {
    const resp = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, tab: currentAITab, provider: currentAIProvider })
    });
    const data = await resp.json();
    const loading = document.getElementById('ai-loading');
    if (loading) loading.remove();

    if (data.error) {
      msgs.innerHTML += `<div class="ai-msg ai-bot" style="color:#FF5C5C">${escapeHtml(data.error)}</div>`;
    } else {
      msgs.innerHTML += `<div class="ai-msg ai-bot">${escapeHtml(data.reply).replace(/\n/g, '<br>')}</div>`;
    }
  } catch {
    const loading = document.getElementById('ai-loading');
    if (loading) loading.remove();
    msgs.innerHTML += `<div class="ai-msg ai-bot" style="color:#FF5C5C">요청 처리 중 오류가 발생했습니다.</div>`;
  }
  msgs.scrollTop = msgs.scrollHeight;
}

// ── Profile ──────────────────────────────────────
function openProfileModal(isSetup) {
  const titleEl = document.getElementById('profile-modal-title');
  const descEl = document.getElementById('profile-setup-desc');
  if (isSetup) {
    titleEl.textContent = '프로필 설정';
    descEl.style.display = 'block';
  } else {
    titleEl.textContent = '프로필 수정';
    descEl.style.display = 'none';
  }
  document.getElementById('profile-name').value = currentUser.name;
  document.getElementById('profile-email').value = currentUser.email || '';
  document.getElementById('profile-phone').value = currentUser.phone || '';
  setCustomSelect('profile-role', currentUser.role, currentUser.role === 'leader' ? '팀장' : '팀원');
  setCustomSelect('profile-region', currentUser.region || '서울', currentUser.region || '서울');

  // Dual API key fields
  document.getElementById('profile-claude-key').value = '';
  document.getElementById('profile-openai-key').value = '';

  const claudeStatus = document.getElementById('claude-key-status');
  const openaiStatus = document.getElementById('openai-key-status');
  claudeStatus.className = 'key-status ' + (currentUser.hasClaudeKey ? 'active' : 'inactive');
  openaiStatus.className = 'key-status ' + (currentUser.hasOpenaiKey ? 'active' : 'inactive');

  openModal('modal-profile');
}

async function saveProfile() {
  const data = {
    name: document.getElementById('profile-name').value,
    email: document.getElementById('profile-email').value,
    phone: document.getElementById('profile-phone').value,
    role: document.getElementById('profile-role').value,
    region: document.getElementById('profile-region').value,
  };

  const claudeKey = document.getElementById('profile-claude-key').value;
  const openaiKey = document.getElementById('profile-openai-key').value;
  if (claudeKey) data.claude_api_key = claudeKey;
  if (openaiKey) data.openai_api_key = openaiKey;

  const resp = await fetch('/api/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  currentUser = await resp.json();

  if (currentUser.role === 'leader') document.body.classList.add('is-leader');
  else document.body.classList.remove('is-leader');

  document.getElementById('dropdown-name').textContent = currentUser.name;
  document.getElementById('dropdown-role').textContent = currentUser.role === 'leader' ? '팀장' : '팀원';
  document.getElementById('header-avatar-img').src = `/avatars/${currentUser.id}`;
  document.getElementById('entry-owner-label').textContent = currentUser.name;
  document.getElementById('entry-owner').value = currentUser.name;

  closeModal('modal-profile');
  loadWeather();
  loadUsers();
  loadTasks();
  loadKPI();
  showToast('프로필이 저장되었습니다');
}

async function logout() {
  await fetch('/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
}

async function deleteAccount() {
  if (!confirm('정말 계정을 탈퇴하시겠습니까?\n모든 데이터가 삭제되며 복구할 수 없습니다.')) return;
  if (!confirm('한 번 더 확인합니다. 계정을 완전히 삭제하시겠습니까?')) return;
  try {
    const resp = await fetch('/auth/account', { method: 'DELETE' });
    const result = await resp.json();
    if (result.ok) {
      alert('계정이 삭제되었습니다. 다시 로그인하면 새 계정으로 시작합니다.');
      window.location.href = '/login.html';
    } else {
      showToast(result.error || '탈퇴에 실패했습니다');
    }
  } catch { showToast('탈퇴 처리 중 오류가 발생했습니다'); }
}

// ── Theme ────────────────────────────────────────
function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  if (financeChart) loadFinance();
}

// ── Socket Events ────────────────────────────────
function setupSocket() {
  socket.on('new-message', (msg) => {
    chatMessages.push(msg);
    renderChatPreview();
    if (document.getElementById('panel-chat').classList.contains('show')) renderFullChat();
  });

  socket.on('user-status', ({ userId, online }) => {
    const user = allUsers.find(u => u.id === userId);
    if (user) {
      user.is_online = online ? 1 : 0;
      renderTeamList();
      updateOnlineCount();
    }
  });

  socket.on('message-deleted', ({ id }) => {
    chatMessages = chatMessages.filter(m => m.id !== id);
    renderChatPreview();
    if (document.getElementById('panel-chat').classList.contains('show')) renderFullChat();
  });

  socket.on('message-ack-updated', ({ id, acks }) => {
    const msg = chatMessages.find(m => m.id === id);
    if (msg) {
      msg.acks = acks;
      renderChatPreview();
      if (document.getElementById('panel-chat').classList.contains('show')) renderFullChat();
    }
  });

  socket.on('task-updated', () => { loadTasks(); loadKPI(); });
  socket.on('finance-updated', () => { loadFinance(); loadUploadHistory(); });
  socket.on('notes-updated', () => { loadNotes(); });
  socket.on('calendar-updated', () => { loadCalendar(); });
}

// ── Events Setup ─────────────────────────────────
function setupEvents() {
  document.getElementById('btn-theme').addEventListener('click', toggleTheme);
  document.getElementById('btn-ai').addEventListener('click', toggleAIPopup);
  document.getElementById('btn-notifications').addEventListener('click', () => showToast('새로운 알림이 없습니다'));

  document.getElementById('btn-profile').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('profile-dropdown').classList.toggle('show');
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.profile-wrapper')) {
      document.getElementById('profile-dropdown').classList.remove('show');
    }
  });

  document.querySelectorAll('.fin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.fin-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFinPeriod = tab.dataset.period;
      loadFinance();
    });
  });

  document.querySelectorAll('.modal-overlay').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('show');
    });
  });

  // Upload drag & drop
  const uploadArea = document.getElementById('upload-area');
  if (uploadArea) {
    uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.style.borderColor = 'var(--accent)'; });
    uploadArea.addEventListener('dragleave', () => { uploadArea.style.borderColor = ''; });
    uploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadArea.style.borderColor = '';
      const input = document.getElementById('file-input');
      input.files = e.dataTransfer.files;
      uploadFile(input);
    });
  }
}

// ── Util ─────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showToast(message) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

// ── Start ────────────────────────────────────────
init();
