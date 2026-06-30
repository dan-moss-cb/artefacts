/* =============================================================================
 * feedback.js — on-page feedback & annotation tool
 * -----------------------------------------------------------------------------
 * Single-file ES module. Drop it in your repo, inject it on every page via
 * Netlify Snippet Injection (see README.md).
 *
 * Requires a Supabase project with a `comments` table (see README.md / schema).
 *
 * SECURITY NOTE: the host PIN below lives in client-side code, so anyone who
 * reads the JS can find it. That is an accepted trade-off for an internal tool.
 * The Supabase anon key is meant to be public and is gated by row-level
 * security policies. Comment text is always rendered with textContent (never
 * innerHTML) to prevent injection through comments.
 * ===========================================================================*/

/* ---- 1. CONFIG — fill these three in ------------------------------------- */
const CONFIG = {
  SUPABASE_URL: 'https://jtiwbaudjbwjehkpnhrg.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_uDMlUrhkEm8oQMd93U5YJg_pez5cE_Z',
  HOST_PIN: '8981',
};

/* ---- 2. dependencies from CDN -------------------------------------------- */
const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
const textQuote = await import('https://esm.sh/dom-anchor-text-quote@4.0.2');

const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

/* ---- 3. state & helpers -------------------------------------------------- */
const LS = { feedback: 'fb_feedback_mode', name: 'fb_author_name' };

const state = {
  feedback: localStorage.getItem(LS.feedback) === '1',
  host: false,               // host mode is per-session, never persisted
  panelOpen: false,
};

let currentRange = null;     // selection captured for a new comment
let comments = [];           // cache of rows for this page

const pagePath = normalizePath(location.pathname);

function normalizePath(p) {
  p = p.split('?')[0].split('#')[0];
  p = p.replace(/index\.html?$/i, '');
  if (p.length > 1) p = p.replace(/\/$/, '');
  return p || '/';
}

function esc(node, text) { node.textContent = text == null ? '' : String(text); }

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

/* ---- 4. data access ------------------------------------------------------ */
async function fetchComments() {
  const { data, error } = await sb
    .from('comments')
    .select('*')
    .eq('page_path', pagePath)
    .order('created_at', { ascending: true });
  if (error) { console.error('[feedback] load failed', error); return []; }
  return data || [];
}

async function addComment(row) {
  const { data, error } = await sb
    .from('comments')
    .insert({ ...row, page_path: pagePath })
    .select()
    .single();
  if (error) { console.error('[feedback] save failed', error); alert('Could not save comment.'); return null; }
  return data;
}

async function setResolved(id, val) {
  const { error } = await sb.from('comments').update({ resolved: val }).eq('id', id);
  if (error) console.error('[feedback] resolve failed', error);
}

async function softDelete(id) {
  const { error } = await sb.from('comments').update({ deleted: true }).eq('id', id);
  if (error) console.error('[feedback] delete failed', error);
}

/* ---- 5. banner ----------------------------------------------------------- */
function buildBanner() {
  const bar = document.createElement('div');
  bar.className = 'fb-banner';
  bar.innerHTML = `
    <span class="fb-brand">💬 Feedback</span>
    <label class="fb-switch"><input type="checkbox" id="fb-feedback-toggle">
      <span class="fb-slider"></span> Feedback mode</label>
    <label class="fb-switch"><input type="checkbox" id="fb-host-toggle">
      <span class="fb-slider"></span> 🔒 Host mode</label>
    <button class="fb-panel-btn" id="fb-panel-btn" title="Show all comments">☰</button>`;
  document.body.appendChild(bar);
  document.body.classList.add('fb-has-banner');

  const fT = bar.querySelector('#fb-feedback-toggle');
  const hT = bar.querySelector('#fb-host-toggle');
  fT.checked = state.feedback;

  fT.addEventListener('change', () => {
    state.feedback = fT.checked;
    localStorage.setItem(LS.feedback, state.feedback ? '1' : '0');
    render();
  });

  hT.addEventListener('change', () => {
    if (hT.checked) {
      const pin = prompt('Enter host PIN:');
      if (pin === CONFIG.HOST_PIN) { state.host = true; }
      else { if (pin !== null) alert('Incorrect PIN.'); hT.checked = false; state.host = false; }
    } else {
      state.host = false;
    }
    render();
  });

  bar.querySelector('#fb-panel-btn').addEventListener('click', () => {
    state.panelOpen = !state.panelOpen;
    render();
  });
}

/* ---- 6. highlight rendering --------------------------------------------- */
function clearHighlights() {
  document.querySelectorAll('mark.fb-hl').forEach(m => {
    const parent = m.parentNode;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
    parent.normalize();
  });
}

// Wrap every text node intersecting `range` in a <mark> tagged with the id.
function highlightRange(range, id, resolved) {
  const root = range.commonAncestorContainer;
  const host = root.nodeType === Node.TEXT_NODE ? root.parentNode : root;
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, {
    acceptNode: n => range.intersectsNode(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  });
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  if (nodes.length === 0 && root.nodeType === Node.TEXT_NODE) nodes.push(root);

  nodes.forEach(node => {
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.length;
    if (start >= end) return;
    const r = document.createRange();
    r.setStart(node, start);
    r.setEnd(node, end);
    const mark = document.createElement('mark');
    mark.className = 'fb-hl' + (resolved ? ' fb-hl-resolved' : '');
    mark.dataset.fbId = id;
    try { r.surroundContents(mark); } catch (e) { /* skip awkward boundaries */ }
  });
}

function renderHighlights(tops) {
  clearHighlights();
  const orphans = [];
  tops.forEach(c => {
    let range = null;
    try {
      range = textQuote.toRange(document.body, {
        exact: c.anchor_quote, prefix: c.anchor_prefix, suffix: c.anchor_suffix,
      });
    } catch (e) { range = null; }
    if (range) highlightRange(range, c.id, c.resolved);
    else orphans.push(c);
  });

  document.querySelectorAll('mark.fb-hl').forEach(m => {
    m.addEventListener('click', e => {
      e.stopPropagation();
      state.panelOpen = true;
      render();
      const el = document.querySelector(`.fb-thread[data-id="${m.dataset.fbId}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });
  return orphans;
}

/* ---- 7. selection -> new comment ---------------------------------------- */
function buildFloatingBtn() {
  const btn = document.createElement('button');
  btn.className = 'fb-add-btn';
  btn.textContent = '💬 Comment';
  btn.style.display = 'none';
  document.body.appendChild(btn);

  document.addEventListener('mouseup', () => {
    if (!state.feedback) return;
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) { btn.style.display = 'none'; return; }
      const range = sel.getRangeAt(0);
      if (range.startContainer.parentElement?.closest('.fb-banner,.fb-panel,.fb-composer')) return;
      currentRange = range.cloneRange();
      const rect = range.getBoundingClientRect();
      btn.style.top = (window.scrollY + rect.top - 38) + 'px';
      btn.style.left = (window.scrollX + rect.left) + 'px';
      btn.style.display = 'block';
    }, 10);
  });

  document.addEventListener('mousedown', e => {
    if (!e.target.closest('.fb-add-btn,.fb-composer')) btn.style.display = 'none';
  });

  btn.addEventListener('click', () => { btn.style.display = 'none'; openComposer(); });
}

function openComposer() {
  if (!currentRange) return;
  document.querySelector('.fb-composer')?.remove();
  const box = document.createElement('div');
  box.className = 'fb-composer';
  const savedName = localStorage.getItem(LS.name) || '';
  box.innerHTML = `
    <div class="fb-quote"></div>
    <input class="fb-name" placeholder="Your name" value="">
    <textarea class="fb-body" placeholder="Add your comment…"></textarea>
    <div class="fb-composer-actions">
      <button class="fb-cancel">Cancel</button>
      <button class="fb-submit">Comment</button>
    </div>`;
  esc(box.querySelector('.fb-quote'), '“' + currentRange.toString().slice(0, 140) + '”');
  box.querySelector('.fb-name').value = savedName;
  document.body.appendChild(box);

  const rect = currentRange.getBoundingClientRect();
  box.style.top = (window.scrollY + rect.bottom + 6) + 'px';
  box.style.left = (window.scrollX + rect.left) + 'px';
  box.querySelector('.fb-body').focus();

  box.querySelector('.fb-cancel').addEventListener('click', () => box.remove());
  box.querySelector('.fb-submit').addEventListener('click', async () => {
    const name = box.querySelector('.fb-name').value.trim() || 'Anonymous';
    const body = box.querySelector('.fb-body').value.trim();
    if (!body) return;
    localStorage.setItem(LS.name, name);
    let selector = {};
    try { selector = textQuote.fromRange(document.body, currentRange); } catch (e) {}
    await addComment({
      parent_id: null, author_name: name, body,
      anchor_quote: selector.exact || currentRange.toString(),
      anchor_prefix: selector.prefix || '', anchor_suffix: selector.suffix || '',
    });
    box.remove();
    state.panelOpen = true;
    await render();
  });
}

/* ---- 8. side panel (threads) -------------------------------------------- */
function buildCommentEl(c, isReply) {
  const el = document.createElement('div');
  el.className = 'fb-comment' + (isReply ? ' fb-reply' : '');
  const head = document.createElement('div');
  head.className = 'fb-comment-head';
  const who = document.createElement('span'); who.className = 'fb-who'; esc(who, c.author_name);
  const when = document.createElement('span'); when.className = 'fb-when'; esc(when, timeAgo(c.created_at));
  head.append(who, when);
  const body = document.createElement('div'); body.className = 'fb-comment-body'; esc(body, c.body);
  el.append(head, body);

  if (state.host) {
    const tools = document.createElement('div');
    tools.className = 'fb-host-tools';
    if (!isReply) {
      const res = document.createElement('button');
      res.textContent = c.resolved ? 'Unresolve' : 'Resolve';
      res.addEventListener('click', async () => { await setResolved(c.id, !c.resolved); await render(); });
      tools.append(res);
    }
    const del = document.createElement('button');
    del.textContent = 'Delete'; del.className = 'fb-del';
    del.addEventListener('click', async () => {
      if (confirm('Delete this comment?')) { await softDelete(c.id); await render(); }
    });
    tools.append(del);
    el.append(tools);
  }
  return el;
}

function buildThreadEl(top, replies) {
  const wrap = document.createElement('div');
  wrap.className = 'fb-thread' + (top.resolved ? ' fb-resolved' : '');
  wrap.dataset.id = top.id;

  if (top.resolved) {
    const tag = document.createElement('div');
    tag.className = 'fb-resolved-tag';
    tag.textContent = '✓ Resolved — click to expand';
    tag.addEventListener('click', () => wrap.classList.toggle('fb-expanded'));
    wrap.append(tag);
  }

  const inner = document.createElement('div');
  inner.className = 'fb-thread-inner';
  inner.append(buildCommentEl(top, false));
  replies.forEach(r => inner.append(buildCommentEl(r, true)));

  // reply box
  const reply = document.createElement('div');
  reply.className = 'fb-replybox';
  reply.innerHTML = `
    <input class="fb-name" placeholder="Your name">
    <div class="fb-reply-row">
      <textarea class="fb-body" placeholder="Reply…"></textarea>
      <button class="fb-reply-send">Reply</button>
    </div>`;
  reply.querySelector('.fb-name').value = localStorage.getItem(LS.name) || '';
  reply.querySelector('.fb-reply-send').addEventListener('click', async () => {
    const name = reply.querySelector('.fb-name').value.trim() || 'Anonymous';
    const body = reply.querySelector('.fb-body').value.trim();
    if (!body) return;
    localStorage.setItem(LS.name, name);
    await addComment({ parent_id: top.id, author_name: name, body, anchor_quote: null });
    await render();
  });
  inner.append(reply);
  wrap.append(inner);
  return wrap;
}

function buildPanel(tops, repliesByParent, orphans) {
  document.querySelector('.fb-panel')?.remove();
  if (!state.panelOpen) return;

  const panel = document.createElement('div');
  panel.className = 'fb-panel';
  const header = document.createElement('div');
  header.className = 'fb-panel-head';
  header.innerHTML = `<strong>Comments (${tops.length})</strong><button class="fb-close">✕</button>`;
  header.querySelector('.fb-close').addEventListener('click', () => { state.panelOpen = false; render(); });
  panel.append(header);

  if (tops.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'fb-empty';
    empty.textContent = state.feedback
      ? 'No comments yet. Highlight any text to add one.'
      : 'Turn on Feedback mode to add comments.';
    panel.append(empty);
  }

  tops.forEach(top => panel.append(buildThreadEl(top, repliesByParent[top.id] || [])));

  if (orphans.length) {
    const oh = document.createElement('div');
    oh.className = 'fb-orphan-head';
    oh.textContent = `⚠ ${orphans.length} comment(s) whose highlighted text changed`;
    panel.append(oh);
    orphans.forEach(top => panel.append(buildThreadEl(top, repliesByParent[top.id] || [])));
  }

  document.body.appendChild(panel);
}

/* ---- 9. master render ---------------------------------------------------- */
async function render() {
  // banner toggle visual sync
  const fT = document.querySelector('#fb-feedback-toggle');
  const hT = document.querySelector('#fb-host-toggle');
  if (fT) fT.checked = state.feedback;
  if (hT) hT.checked = state.host;
  document.querySelector('#fb-panel-btn')?.classList.toggle('fb-active', state.panelOpen);

  if (!state.feedback) {
    clearHighlights();
    document.querySelector('.fb-panel')?.remove();
    return;
  }

  comments = await fetchComments();
  const tops = comments.filter(c => !c.parent_id && !c.deleted);
  const repliesByParent = {};
  comments.filter(c => c.parent_id && !c.deleted).forEach(r => {
    (repliesByParent[r.parent_id] ||= []).push(r);
  });

  const orphans = renderHighlights(tops);
  const anchored = tops.filter(t => !orphans.includes(t));
  buildPanel(anchored, repliesByParent, orphans);
}

/* ---- 10. boot ------------------------------------------------------------ */
function injectCSS() {
  // load feedback.css sitting next to this module (e.g. /feedback.css)
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('feedback.css', import.meta.url).href;
  document.head.appendChild(link);
}

function boot() {
  injectCSS();
  buildBanner();
  buildFloatingBtn();
  render();
  let t;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => state.feedback && render(), 250); });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
