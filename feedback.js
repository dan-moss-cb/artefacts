/* =============================================================================
 * feedback.js — on-page feedback & annotation tool
 * ---------------------------------------------------------------------------*/

/* ---- 1. CONFIG ---------------------------------------------------------- */
const CONFIG = {
  SUPABASE_URL: 'https://jtiwbaudjbwjehkpnhrg.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_uDMlUrhkEm8oQMd93U5YJg_pez5cE_Z',
  HOST_PIN: '8981',
};

/* ---- 2. dependencies from CDN ------------------------------------------- */
const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
const textQuote = await import('https://esm.sh/dom-anchor-text-quote@4.0.2');

const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

/* ---- 3. state & helpers ------------------------------------------------- */
const LS = { feedback: 'fb_feedback_mode', name: 'fb_author_name' };

const state = {
  feedback: localStorage.getItem(LS.feedback) === '1',
  host: false,
  panelOpen: false,
  panelTab: 'open',
};

let currentRange = null;
let clickAnchor = null;       // { x, y } page-relative coords for point comments
let comments = [];

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

function isPointComment(c) {
  return c.anchor_quote === '__point__';
}

function parsePointAnchor(c) {
  try { return JSON.parse(c.anchor_prefix); } catch { return null; }
}

/* ---- 4. data access ----------------------------------------------------- */
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

/* ---- SVG icons ---------------------------------------------------------- */
const ICONS = {
  lockClosed: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 1 1 8 0v4"/></svg>`,
  lockOpen: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0"/></svg>`,
  panel: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="14" y1="4" x2="14" y2="20"/></svg>`,
  link: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  commentBubble: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#4a8c5c" stroke="#fff" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  commentBubbleResolved: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#9ca3af" stroke="#fff" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  pin: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#4a8c5c" stroke="#fff" stroke-width="1"><circle cx="12" cy="10" r="7"/><polygon points="12,22 7,14 17,14"/><text x="12" y="13" text-anchor="middle" fill="#fff" font-size="10" font-weight="bold" font-family="system-ui">#</text></svg>`,
};

/* ---- 5. banner ---------------------------------------------------------- */
function buildBanner() {
  const bar = document.createElement('div');
  bar.className = 'fb-banner';

  bar.innerHTML = `
    <button class="fb-host-btn" id="fb-host-btn">
      <span class="fb-host-icon">${ICONS.lockClosed}</span>
      <span>Host mode</span>
      <img class="fb-host-avatar" src="${new URL('profile.jpeg', import.meta.url).href}" alt="">
    </button>

    <div class="fb-mode-switcher">
      <button class="fb-mode-option" id="fb-mode-browse">Browsing</button>
      <button class="fb-mode-option" id="fb-mode-feedback">Leave feedback</button>
    </div>

    <div class="fb-centre-actions">
      <button class="fb-action-btn" id="fb-hide-btn">Hide feedback</button>
      <span class="fb-action-divider"></span>
      <div class="fb-share-wrap">
        <button class="fb-action-btn" id="fb-share-btn">Share</button>
        <div class="fb-share-menu" id="fb-share-menu" style="display:none">
          <button id="fb-share-with">${ICONS.link}<span>Share with feedback</span></button>
          <button id="fb-share-without">${ICONS.link}<span>Share without feedback</span></button>
        </div>
      </div>
    </div>

    <div class="fb-right-group">
      <span class="fb-panel-label" id="fb-panel-label">Comments panel</span>
      <button class="fb-panel-btn" id="fb-panel-btn" title="Show all comments">${ICONS.panel}</button>
    </div>`;

  document.body.appendChild(bar);
  document.body.classList.add('fb-has-banner');

  syncModeButtons();
  syncFeedbackCursor();

  bar.querySelector('#fb-mode-browse').addEventListener('click', () => {
    state.feedback = false;
    localStorage.setItem(LS.feedback, '0');
    syncModeButtons();
    syncFeedbackCursor();
    render();
  });

  bar.querySelector('#fb-mode-feedback').addEventListener('click', () => {
    state.feedback = true;
    localStorage.setItem(LS.feedback, '1');
    syncModeButtons();
    syncFeedbackCursor();
    render();
  });

  bar.querySelector('#fb-host-btn').addEventListener('click', () => {
    if (!state.host) {
      const pin = prompt('Enter host PIN:');
      if (pin === CONFIG.HOST_PIN) { state.host = true; }
      else { if (pin !== null) alert('Incorrect PIN.'); }
    } else {
      state.host = false;
    }
    syncHostBtn();
    render();
  });

  bar.querySelector('#fb-panel-label').addEventListener('click', () => {
    state.panelOpen = !state.panelOpen;
    render();
  });
  bar.querySelector('#fb-panel-btn').addEventListener('click', () => {
    state.panelOpen = !state.panelOpen;
    render();
  });

  bar.querySelector('#fb-hide-btn').addEventListener('click', () => {
    document.body.classList.add('fb-hidden');
    showRestoreBtn();
  });

  const shareBtn = bar.querySelector('#fb-share-btn');
  const shareMenu = bar.querySelector('#fb-share-menu');
  shareBtn.addEventListener('click', e => {
    e.stopPropagation();
    shareMenu.style.display = shareMenu.style.display === 'none' ? 'block' : 'none';
  });
  document.addEventListener('click', () => { shareMenu.style.display = 'none'; });
  shareMenu.addEventListener('click', e => e.stopPropagation());

  bar.querySelector('#fb-share-with').addEventListener('click', () => {
    const url = new URL(location.href);
    url.searchParams.delete('nofeedback');
    navigator.clipboard.writeText(url.toString());
    shareMenu.style.display = 'none';
    showCopied(shareBtn);
  });

  bar.querySelector('#fb-share-without').addEventListener('click', () => {
    const url = new URL(location.href);
    url.searchParams.set('nofeedback', '1');
    navigator.clipboard.writeText(url.toString());
    shareMenu.style.display = 'none';
    showCopied(shareBtn);
  });
}

function showCopied(anchor) {
  anchor.parentElement.querySelector('.fb-copied')?.remove();
  const el = document.createElement('span');
  el.className = 'fb-copied';
  el.textContent = 'Link copied!';
  anchor.parentElement.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

function showRestoreBtn() {
  if (document.querySelector('.fb-restore-btn')) return;
  const btn = document.createElement('button');
  btn.className = 'fb-restore-btn';
  btn.textContent = 'Show feedback';
  document.body.appendChild(btn);
  btn.addEventListener('click', () => {
    document.body.classList.remove('fb-hidden');
    btn.remove();
  });
}

function syncModeButtons() {
  const browse = document.querySelector('#fb-mode-browse');
  const feedback = document.querySelector('#fb-mode-feedback');
  if (!browse || !feedback) return;
  browse.classList.remove('fb-mode-active', 'fb-mode-browse-active');
  feedback.classList.remove('fb-mode-active');
  if (state.feedback) {
    feedback.classList.add('fb-mode-active');
  } else {
    browse.classList.add('fb-mode-browse-active');
  }
}

function syncFeedbackCursor() {
  document.body.classList.toggle('fb-feedback-on', state.feedback);
  const btn = document.querySelector('.fb-add-btn');
  if (btn && !state.feedback) {
    btn.style.display = 'none';
    btn.classList.remove('fb-add-pinned');
  }
}

function syncHostBtn() {
  const btn = document.querySelector('#fb-host-btn');
  if (!btn) return;
  const icon = btn.querySelector('.fb-host-icon');
  if (state.host) {
    btn.classList.add('fb-host-active');
    icon.innerHTML = ICONS.lockOpen;
  } else {
    btn.classList.remove('fb-host-active');
    icon.innerHTML = ICONS.lockClosed;
  }
}

/* ---- 6. highlight & marker rendering ------------------------------------ */
function clearHighlights() {
  document.querySelectorAll('mark.fb-hl').forEach(m => {
    const parent = m.parentNode;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
    parent.normalize();
  });
}

function clearMarkers() {
  document.querySelectorAll('.fb-marker,.fb-point-marker').forEach(m => m.remove());
}

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

function placeMarkerAtRange(range, c, repliesByParent) {
  const rect = range.getBoundingClientRect();
  const marker = document.createElement('div');
  marker.className = 'fb-marker';
  marker.dataset.fbId = c.id;
  marker.innerHTML = c.resolved ? ICONS.commentBubbleResolved : ICONS.commentBubble;
  marker.style.top = (window.scrollY + rect.top - 12) + 'px';
  marker.style.left = (window.scrollX + rect.left - 28) + 'px';
  document.body.appendChild(marker);
  marker.addEventListener('click', e => {
    e.stopPropagation();
    toggleInlineThread(c, repliesByParent, marker);
  });
}

function placePointMarker(c, repliesByParent) {
  const anchor = parsePointAnchor(c);
  if (!anchor) return false;
  const marker = document.createElement('div');
  marker.className = 'fb-point-marker';
  marker.dataset.fbId = c.id;
  marker.innerHTML = c.resolved ? ICONS.commentBubbleResolved : ICONS.commentBubble;
  marker.style.top = (anchor.y - 14) + 'px';
  marker.style.left = (anchor.x - 14) + 'px';
  document.body.appendChild(marker);
  marker.addEventListener('click', e => {
    e.stopPropagation();
    toggleInlineThread(c, repliesByParent, marker);
  });
  return true;
}

function toggleInlineThread(top, repliesByParent, marker) {
  const existing = document.querySelector(`.fb-inline-thread[data-id="${top.id}"]`);
  if (existing) { existing.remove(); return; }
  document.querySelectorAll('.fb-inline-thread').forEach(el => el.remove());

  const wrap = document.createElement('div');
  wrap.className = 'fb-inline-thread';
  wrap.dataset.id = top.id;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'fb-close';
  closeBtn.innerHTML = '&times;';
  closeBtn.addEventListener('click', () => wrap.remove());
  wrap.append(closeBtn);

  const inner = document.createElement('div');
  inner.className = 'fb-thread-inner';
  inner.append(buildCommentEl(top, false));
  (repliesByParent[top.id] || []).forEach(r => inner.append(buildCommentEl(r, true)));

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
    wrap.remove();
    await render();
  });
  inner.append(reply);
  wrap.append(inner);

  const mRect = marker.getBoundingClientRect();
  wrap.style.top = (window.scrollY + mRect.bottom + 6) + 'px';
  wrap.style.left = (window.scrollX + mRect.left) + 'px';
  document.body.appendChild(wrap);
}

function renderAnnotations(tops, repliesByParent) {
  clearHighlights();
  clearMarkers();
  document.querySelectorAll('.fb-inline-thread').forEach(el => el.remove());
  const orphans = [];

  tops.forEach(c => {
    if (isPointComment(c)) {
      if (!placePointMarker(c, repliesByParent)) orphans.push(c);
      return;
    }

    let range = null;
    try {
      range = textQuote.toRange(document.body, {
        exact: c.anchor_quote, prefix: c.anchor_prefix, suffix: c.anchor_suffix,
      });
    } catch (e) { range = null; }

    if (!range) { orphans.push(c); return; }

    if (state.feedback) {
      highlightRange(range, c.id, c.resolved);
    } else {
      placeMarkerAtRange(range, c, repliesByParent);
    }
  });

  if (state.feedback) {
    document.querySelectorAll('mark.fb-hl').forEach(m => {
      m.addEventListener('click', e => {
        e.stopPropagation();
        state.panelOpen = true;
        render();
        const el = document.querySelector(`.fb-thread[data-id="${m.dataset.fbId}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
  }

  return orphans;
}

/* ---- 7. selection / click -> new comment -------------------------------- */
function buildFloatingBtn() {
  const btn = document.createElement('button');
  btn.className = 'fb-add-btn';
  btn.textContent = 'Comment';
  btn.style.display = 'none';
  document.body.appendChild(btn);
  let pinned = false;

  document.addEventListener('mousemove', e => {
    if (!state.feedback || pinned) return;
    if (e.target.closest('.fb-banner,.fb-panel,.fb-composer')) {
      btn.style.display = 'none';
      return;
    }
    btn.style.display = 'block';
    btn.style.left = (e.clientX + 16) + 'px';
    btn.style.top = (e.clientY - 10) + 'px';
  });

  document.addEventListener('mousedown', e => {
    if (!state.feedback) return;
    if (e.target.closest('.fb-banner,.fb-panel,.fb-composer,.fb-add-btn')) return;
    if (pinned) {
      pinned = false;
      btn.classList.remove('fb-add-pinned');
      return;
    }
    pinned = true;
    btn.classList.add('fb-add-pinned');
    btn.style.left = (e.clientX + 16) + 'px';
    btn.style.top = (e.clientY - 10) + 'px';
    clickAnchor = { x: e.pageX, y: e.pageY };
    currentRange = null;
    const sel = window.getSelection();
    if (sel) sel.removeAllRanges();
  });

  document.addEventListener('mouseup', () => {
    if (!state.feedback || !pinned) return;
    setTimeout(() => {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim()) {
        const range = sel.getRangeAt(0);
        if (!range.startContainer.parentElement?.closest('.fb-banner,.fb-panel,.fb-composer')) {
          currentRange = range.cloneRange();
        }
      }
    }, 10);
  });

  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (!pinned) return;
    pinned = false;
    btn.classList.remove('fb-add-pinned');
    btn.style.display = 'none';
    openComposer();
  });
}

function openComposer() {
  document.querySelector('.fb-composer')?.remove();
  const hasText = currentRange && currentRange.toString().trim();
  const box = document.createElement('div');
  box.className = 'fb-composer';
  const savedName = localStorage.getItem(LS.name) || '';

  let quoteHtml = '';
  if (hasText) {
    quoteHtml = '<div class="fb-quote"></div>';
  }

  box.innerHTML = `
    ${quoteHtml}
    <input class="fb-name" placeholder="Your name" value="">
    <textarea class="fb-body" placeholder="Add your comment…"></textarea>
    <div class="fb-composer-actions">
      <button class="fb-cancel">Cancel</button>
      <button class="fb-submit">Comment</button>
    </div>`;

  if (hasText) {
    esc(box.querySelector('.fb-quote'), '"' + currentRange.toString().slice(0, 140) + '"');
  }
  box.querySelector('.fb-name').value = savedName;
  document.body.appendChild(box);

  if (hasText) {
    const rect = currentRange.getBoundingClientRect();
    box.style.top = (window.scrollY + rect.bottom + 6) + 'px';
    box.style.left = (window.scrollX + rect.left) + 'px';
  } else if (clickAnchor) {
    box.style.top = (clickAnchor.y + 6) + 'px';
    box.style.left = (clickAnchor.x + 6) + 'px';
  }
  box.querySelector('.fb-body').focus();

  box.querySelector('.fb-cancel').addEventListener('click', () => box.remove());
  box.querySelector('.fb-submit').addEventListener('click', async () => {
    const name = box.querySelector('.fb-name').value.trim() || 'Anonymous';
    const body = box.querySelector('.fb-body').value.trim();
    if (!body) return;
    localStorage.setItem(LS.name, name);

    if (hasText) {
      let selector = {};
      try { selector = textQuote.fromRange(document.body, currentRange); } catch (e) {}
      await addComment({
        parent_id: null, author_name: name, body,
        anchor_quote: selector.exact || currentRange.toString(),
        anchor_prefix: selector.prefix || '', anchor_suffix: selector.suffix || '',
      });
    } else if (clickAnchor) {
      await addComment({
        parent_id: null, author_name: name, body,
        anchor_quote: '__point__',
        anchor_prefix: JSON.stringify(clickAnchor),
        anchor_suffix: '',
      });
    }

    box.remove();
    clickAnchor = null;
    currentRange = null;
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

function highlightMarkerById(id) {
  const marker = document.querySelector(`.fb-marker[data-fb-id="${id}"],.fb-point-marker[data-fb-id="${id}"]`);
  if (marker) {
    marker.classList.add('fb-marker-highlight');
    marker.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  const hl = document.querySelector(`mark.fb-hl[data-fb-id="${id}"]`);
  if (hl) {
    hl.style.outline = '2px solid var(--fb-accent)';
    hl.style.outlineOffset = '2px';
    hl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function unhighlightMarkerById(id) {
  const marker = document.querySelector(`.fb-marker[data-fb-id="${id}"],.fb-point-marker[data-fb-id="${id}"]`);
  if (marker) marker.classList.remove('fb-marker-highlight');
  document.querySelectorAll(`mark.fb-hl[data-fb-id="${id}"]`).forEach(hl => {
    hl.style.outline = '';
    hl.style.outlineOffset = '';
  });
}

function buildThreadEl(top, replies) {
  const wrap = document.createElement('div');
  wrap.className = 'fb-thread' + (top.resolved ? ' fb-resolved' : '');
  wrap.dataset.id = top.id;

  wrap.addEventListener('mouseenter', () => highlightMarkerById(top.id));
  wrap.addEventListener('mouseleave', () => unhighlightMarkerById(top.id));
  wrap.addEventListener('click', () => {
    highlightMarkerById(top.id);
    setTimeout(() => unhighlightMarkerById(top.id), 2000);
  });

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

  const allThreads = [...tops, ...orphans];
  const openCount = allThreads.filter(t => !t.resolved).length;
  const resolvedCount = allThreads.filter(t => t.resolved).length;
  const totalCount = allThreads.length;

  const header = document.createElement('div');
  header.className = 'fb-panel-head';
  header.innerHTML = `<strong>Comments</strong><button class="fb-close">&times;</button>`;
  header.querySelector('.fb-close').addEventListener('click', () => { state.panelOpen = false; render(); });
  panel.append(header);

  const tabs = document.createElement('div');
  tabs.className = 'fb-tabs';
  const tabData = [
    { key: 'open', label: 'Open', count: openCount },
    { key: 'resolved', label: 'Resolved', count: resolvedCount },
    { key: 'all', label: 'All', count: totalCount },
  ];
  tabData.forEach(({ key, label, count }) => {
    const btn = document.createElement('button');
    btn.className = 'fb-tab' + (state.panelTab === key ? ' fb-tab-active' : '');
    btn.innerHTML = `${label}<span class="fb-tab-count">${count}</span>`;
    btn.addEventListener('click', () => { state.panelTab = key; render(); });
    tabs.append(btn);
  });
  panel.append(tabs);

  const filteredTops = tops.filter(t => {
    if (state.panelTab === 'open') return !t.resolved;
    if (state.panelTab === 'resolved') return t.resolved;
    return true;
  });
  const filteredOrphans = orphans.filter(t => {
    if (state.panelTab === 'open') return !t.resolved;
    if (state.panelTab === 'resolved') return t.resolved;
    return true;
  });

  if (filteredTops.length === 0 && filteredOrphans.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'fb-empty';
    if (totalCount === 0) {
      empty.textContent = state.feedback
        ? 'No comments yet. Click anywhere or select text to add one.'
        : 'No comments yet.';
    } else {
      empty.textContent = state.panelTab === 'open'
        ? 'No open comments.'
        : 'No resolved comments.';
    }
    panel.append(empty);
  }

  filteredTops.forEach(top => panel.append(buildThreadEl(top, repliesByParent[top.id] || [])));

  if (filteredOrphans.length) {
    const oh = document.createElement('div');
    oh.className = 'fb-orphan-head';
    oh.textContent = `${filteredOrphans.length} comment(s) whose highlighted text changed`;
    panel.append(oh);
    filteredOrphans.forEach(top => panel.append(buildThreadEl(top, repliesByParent[top.id] || [])));
  }

  document.body.appendChild(panel);
}

/* ---- 9. master render --------------------------------------------------- */
async function render() {
  syncModeButtons();
  syncHostBtn();
  document.querySelector('#fb-panel-btn')?.classList.toggle('fb-active', state.panelOpen);

  comments = await fetchComments();
  const tops = comments.filter(c => !c.parent_id && !c.deleted);
  const repliesByParent = {};
  comments.filter(c => c.parent_id && !c.deleted).forEach(r => {
    (repliesByParent[r.parent_id] ||= []).push(r);
  });

  const orphans = renderAnnotations(tops, repliesByParent);
  const anchored = tops.filter(t => !orphans.includes(t));
  buildPanel(anchored, repliesByParent, orphans);
}

/* ---- 10. boot ----------------------------------------------------------- */
function injectCSS() {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('feedback.css', import.meta.url).href;
  document.head.appendChild(link);
}

function boot() {
  if (new URLSearchParams(location.search).get('nofeedback') === '1') {
    return;
  }
  injectCSS();
  buildBanner();
  buildFloatingBtn();
  render();
  let t;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(render, 250); });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
