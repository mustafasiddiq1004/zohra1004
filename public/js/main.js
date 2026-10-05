const feed  = document.getElementById('feed');
const toast = document.getElementById('toast');

/* ---------- Helpers ---------- */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// SQLite gives "YYYY-MM-DD HH:MM:SS" in UTC
function parseDbDate(s) {
  return new Date(String(s).replace(' ', 'T') + 'Z');
}

function formatUrduDate(s) {
  const d = parseDbDate(s);
  try {
    return d.toLocaleString('ur-PK-u-nu-latn', { dateStyle: 'long', timeStyle: 'short' });
  } catch {
    return d.toLocaleString();
  }
}

function showToast(msg, isError = false) {
  toast.textContent = msg;
  toast.className = 'toast show' + (isError ? ' err' : '');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (toast.className = 'toast'), 2600);
}

/* ---------- Render ---------- */
function renderPosts(posts) {
  if (!posts.length) {
    feed.innerHTML = '<div class="empty">ابھی کوئی شاعری پوسٹ نہیں ہوئی۔</div>';
    return;
  }

  feed.innerHTML = posts.map(p => `
    <article class="card" data-id="${p.id}">
      ${p.title ? `<div class="title">${esc(p.title)}</div>` : ''}
      <div class="urdu">${esc(p.content)}</div>
      <div class="meta">
        <span class="time">🕒 ${esc(formatUrduDate(p.created_at))}</span>
        <button class="like-btn ${p.liked ? 'liked' : ''}" data-like="${p.id}">
          <span class="heart">${p.liked ? '❤️' : '🤍'}</span>
          <span class="count">${p.like_count}</span>
        </button>
      </div>
    </article>
  `).join('');
}

/* ---------- Data ---------- */
async function loadPosts() {
  try {
    const res  = await fetch('/api/posts');
    const data = await res.json();
    renderPosts(data);
  } catch {
    feed.innerHTML = '<div class="empty">لوڈ کرنے میں مسئلہ ہوا۔</div>';
  }
}

/* ---------- Like (event delegation) ---------- */
feed.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-like]');
  if (!btn) return;

  const id = btn.dataset.like;
  btn.disabled = true;

  try {
    const res  = await fetch(`/api/posts/${id}/like`, { method: 'POST' });
    const data = await res.json();

    btn.classList.toggle('liked', data.liked);
    btn.querySelector('.heart').textContent = data.liked ? '❤️' : '🤍';
    btn.querySelector('.count').textContent = data.like_count;
    showToast(data.liked ? 'شکریہ! پسند کیا گیا ❤️' : 'لائک ہٹا دیا گیا');
  } catch {
    showToast('کچھ غلط ہو گیا', true);
  } finally {
    btn.disabled = false;
  }
});

/* ---------- Track visit ---------- */
fetch('/api/track-visit', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ page: location.pathname, referrer: document.referrer })
}).catch(() => {});

/* ---------- Go ---------- */
loadPosts();