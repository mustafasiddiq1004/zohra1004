/* ---------------- Shortcuts & helpers ---------------- */
const $ = (id) => document.getElementById(id);
const toast = $('toast');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function shortUA(ua = '') {
  if (!ua) return '—';
  const browser =
    /Edg\//.test(ua)                    ? 'Edge'    :
    /OPR\/|Opera/.test(ua)              ? 'Opera'   :
    /Chrome\//.test(ua)                 ? 'Chrome'  :
    /Safari\//.test(ua) && !/Chrome/.test(ua) ? 'Safari' :
    /Firefox\//.test(ua)                ? 'Firefox' : 'Other';

  const os =
    /Windows NT/.test(ua)  ? 'Windows' :
    /Android/.test(ua)     ? 'Android' :
    /iPhone|iPad/.test(ua) ? 'iOS'     :
    /Mac OS X/.test(ua)    ? 'macOS'   :
    /Linux/.test(ua)       ? 'Linux'   : '';

  return os ? `${browser} / ${os}` : browser;
}

function showToast(msg, isErr = false) {
  toast.textContent = msg;
  toast.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (toast.className = 'toast'), 2600);
}

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  if (res.status === 401) { showLogin(); throw new Error('Unauthorized'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

/* ---------------- Auth ---------------- */
function showLogin() {
  $('loginView').style.display = 'block';
  $('dashView').style.display  = 'none';
}

function showDash(username) {
  $('loginView').style.display = 'none';
  $('dashView').style.display  = 'block';
  $('whoUser').textContent = username;
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('loginBtn');
  btn.disabled = true;
  btn.textContent = 'Signing in…';

  try {
    const data = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({
        username: $('username').value,
        password: $('password').value
      })
    });
    showDash(data.username);
    initDashboard();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
});

$('logoutBtn').addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST' });
  showLogin();
});

/* ---------------- Tabs ---------------- */
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    ['posts', 'likes', 'visits'].forEach(name => {
      $('tab-' + name).style.display = (name === tab.dataset.tab) ? 'block' : 'none';
    });
  });
});

/* ---------------- Stats ---------------- */
async function loadStats() {
  const s = await api('/api/admin/stats');

  $('statsGrid').innerHTML = `
    <div class="stat"><div class="label">Total Posts</div>   <div class="value">${s.totalPosts}</div></div>
    <div class="stat"><div class="label">Total Likes</div>   <div class="value">${s.totalLikes}</div></div>
    <div class="stat"><div class="label">Total Visits</div>  <div class="value">${s.totalVisits}</div></div>
    <div class="stat"><div class="label">Unique Visitors</div><div class="value">${s.uniqueVisitors}</div></div>
    <div class="stat"><div class="label">Visits Today</div>  <div class="value">${s.visitsToday}</div></div>
    <div class="stat"><div class="label">Likes Today</div>   <div class="value">${s.likesToday}</div></div>
  `;

  // Chart
  const max = Math.max(1, ...s.dailyVisits.map(d => d.count));
  $('chart').innerHTML = s.dailyVisits.map(d => {
    const h   = Math.round((d.count / max) * 100);
    const day = new Date(d.day + 'T00:00:00Z')
      .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
    return `
      <div class="bar-wrap" title="${d.day}: ${d.count} visits">
        <div class="bar" style="height:${h}%"></div>
        <div class="bar-label">${day}</div>
      </div>`;
  }).join('');

  // Top posts
  $('topPosts').innerHTML = s.topPosts.length
    ? s.topPosts.map(p => `
        <div class="post-row">
          <div style="flex:1">
            ${p.title ? `<div style="color:var(--gold);font-size:.82rem;margin-bottom:4px">${esc(p.title)}</div>` : ''}
            <div style="color:var(--muted);font-size:.82rem">${esc(p.excerpt)}…</div>
          </div>
          <div class="count">❤️ ${p.like_count}</div>
        </div>`).join('')
    : '<div class="empty">No data yet</div>';
}

/* ---------------- Likes ---------------- */
async function loadLikes() {
  const rows = await api('/api/admin/likes');
  const body = $('likesBody');

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="5" class="empty">No likes yet</td></tr>';
    return;
  }

  body.innerHTML = rows.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td class="ua" title="${esc(r.post_excerpt)}">
        ${r.title ? esc(r.title) : esc(r.post_excerpt) + '…'}
      </td>
      <td class="mono">${esc(r.ip)}</td>
      <td>${esc(shortUA(r.user_agent))}</td>
      <td class="mono">${esc(r.created_at)}</td>
    </tr>
  `).join('');
}

/* ---------------- Visits ---------------- */
async function loadVisits() {
  const rows = await api('/api/admin/visits');
  const body = $('visitsBody');

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty">No visits yet</td></tr>';
    return;
  }

  body.innerHTML = rows.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td class="mono">${esc(r.ip)}</td>
      <td>${esc(r.page || '/')}</td>
      <td>${esc(shortUA(r.user_agent))}</td>
      <td class="ua" title="${esc(r.referrer)}">${esc(r.referrer || '—')}</td>
      <td class="mono">${esc(r.visited_at)}</td>
    </tr>
  `).join('');
}

/* ---------------- Posts CRUD ---------------- */
async function loadPosts() {
  const rows = await api('/api/admin/posts');
  const box  = $('postsList');

  if (!rows.length) {
    box.innerHTML = '<div class="empty">No posts yet. Create your first one above.</div>';
    return;
  }

  box.innerHTML = rows.map(p => `
    <div class="post-row">
      <div style="flex:1;min-width:0">
        ${p.title ? `<div style="color:var(--gold);font-size:.82rem;margin-bottom:6px">${esc(p.title)}</div>` : ''}
        <div class="urdu">${esc(p.content)}</div>
        <div style="color:var(--muted);font-size:.74rem;margin-top:8px">${esc(p.created_at)} UTC</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:9px">
        <div class="count">❤️ ${p.like_count}</div>
        <div class="actions">
          <button class="btn ghost sm" data-edit="${p.id}">Edit</button>
          <button class="btn danger sm" data-del="${p.id}">Delete</button>
        </div>
      </div>
    </div>
  `).join('');
}

// Live preview
$('postTitle').addEventListener('input', e => { $('pvTitle').textContent = e.target.value; });
$('postContent').addEventListener('input', e => {
  $('pvContent').textContent = e.target.value || 'پیش نظارہ…';
});

// Save (create or update)
$('saveBtn').addEventListener('click', async () => {
  const id      = $('editId').value;
  const title   = $('postTitle').value;
  const content = $('postContent').value;

  if (!content.trim()) return showToast('Shayari content is required', true);

  $('saveBtn').disabled = true;
  try {
    if (id) {
      await api(`/api/admin/posts/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ title, content })
      });
      showToast('Post updated ✔');
    } else {
      await api('/api/admin/posts', {
        method: 'POST',
        body: JSON.stringify({ title, content })
      });
      showToast('Shayari published ✔');
    }
    resetEditor();
    await Promise.all([loadPosts(), loadStats()]);
  } catch (err) {
    showToast(err.message, true);
  } finally {
    $('saveBtn').disabled = false;
  }
});

// Edit / Delete via delegation
$('postsList').addEventListener('click', async (e) => {
  const editBtn = e.target.closest('[data-edit]');
  const delBtn  = e.target.closest('[data-del]');

  if (editBtn) {
    const rows = await api('/api/admin/posts');
    const p = rows.find(x => String(x.id) === editBtn.dataset.edit);
    if (!p) return;

    $('editId').value      = p.id;
    $('postTitle').value   = p.title || '';
    $('postContent').value = p.content;
    $('pvTitle').textContent   = p.title || '';
    $('pvContent').textContent = p.content;
    $('editorTitle').textContent = 'Edit Shayari';
    $('saveBtn').textContent     = 'Update';
    $('cancelEditBtn').style.display = 'inline-block';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (delBtn) {
    if (!confirm('Delete this shayari permanently? Its likes will also be removed.')) return;
    try {
      await api(`/api/admin/posts/${delBtn.dataset.del}`, { method: 'DELETE' });
      showToast('Post deleted');
      await Promise.all([loadPosts(), loadStats(), loadLikes()]);
    } catch (err) {
      showToast(err.message, true);
    }
  }
});

$('cancelEditBtn').addEventListener('click', resetEditor);

function resetEditor() {
  $('editId').value      = '';
  $('postTitle').value   = '';
  $('postContent').value = '';
  $('pvTitle').textContent   = '';
  $('pvContent').textContent = 'پیش نظارہ…';
  $('editorTitle').textContent = 'Post New Shayari';
  $('saveBtn').textContent     = 'Publish';
  $('cancelEditBtn').style.display = 'none';
}

/* ---------------- Boot ---------------- */
async function initDashboard() {
  try {
    await Promise.all([loadStats(), loadPosts(), loadLikes(), loadVisits()]);
  } catch (err) {
    console.error(err);
  }
}

(async function boot() {
  try {
    const me = await api('/api/admin/me');
    if (me.loggedIn) { showDash(me.username); initDashboard(); }
    else showLogin();
  } catch { showLogin(); }
})();