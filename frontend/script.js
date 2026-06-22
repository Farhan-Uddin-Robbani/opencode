let API = '';
let API_CHECKED = false;
let currentFile = null;
let currentData = null;
let currentProfile = null;
let currentStats = null;
let currentClean = null;
let currentOutliers = null;
let currentSegments = null;
let currentInsights = null;
let files = [];
let selectedFiles = new Set();
let dataOffset = 0;
const PAGE_SIZE = 100;

function $(id) { return document.getElementById(id); }

async function checkServer() {
  if (API_CHECKED) return true;
  for (const base of ['', 'http://localhost:8765', 'http://127.0.0.1:8765']) {
    try {
      const r = await fetch(`${base}/api/roots`, { signal: AbortSignal.timeout(3000) });
      if (r.ok) { API = base; API_CHECKED = true; return true; }
    } catch(e) { continue; }
  }
  return false;
}

async function ensureServer() {
  const ok = await checkServer();
  if (!ok) {
    const $c = $('tabContent');
    $c.innerHTML = `
      <div class="empty-state" style="padding:60px 20px;">
        <div style="font-size:40px;margin-bottom:12px;opacity:0.4;">&#9888;</div>
        <h3>Cannot reach the server</h3>
        <p style="margin-bottom:12px;">Run <code style="background:var(--surface2);padding:3px 8px;border-radius:4px;">python app.py</code> in your terminal, then refresh the page.</p>
        <button class="btn" onclick="location.reload()">Retry</button>
      </div>`;
    return false;
  }
  return true;
}

function toggleSelectAll() {
  const checked = $('selectAllCheck').checked;
  files.forEach(f => {
    if (checked) selectedFiles.add(f.path);
    else selectedFiles.delete(f.path);
  });
  renderFileList();
  updateCompareBar();
}

function renderFileList() {
  const ul = $('fileList');
  ul.innerHTML = '';
  files.forEach(f => {
    const li = document.createElement('li');
    const ext = f.name.split('.').pop().toLowerCase();
    const isSelected = selectedFiles.has(f.path);
    const isActive = currentFile === f.path;
    li.innerHTML = `
      <input type="checkbox" ${isSelected ? 'checked' : ''}
        onchange="toggleFileSelect('${f.path.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')"
        onclick="event.stopPropagation()">
      <span class="ext">${ext}</span>
      <span>${f.name}</span>
      <span class="size">${f.size_str}</span>
    `;
    if (isActive) li.classList.add('active');
    li.addEventListener('click', (e) => {
      if (e.target.tagName !== 'INPUT') selectFile(f.path);
    });
    ul.appendChild(li);
  });
}

function toggleFileSelect(path) {
  if (selectedFiles.has(path)) selectedFiles.delete(path);
  else selectedFiles.add(path);
  updateCompareBar();
}

function updateCompareBar() {
  const bar = $('compareBar');
  if (bar) {
    const tags = $('compareTags');
    if (selectedFiles.size === 0) {
      bar.style.display = 'none';
      return;
    }
    bar.style.display = 'flex';
    tags.innerHTML = '';
    selectedFiles.forEach(p => {
      const name = files.find(f => f.path === p)?.name || p.split(/[\\/]/).pop();
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.innerHTML = `${name} <span class="rm" onclick="removeFileSelect('${p.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')">&times;</span>`;
      tags.appendChild(tag);
    });
  }
}

function removeFileSelect(path) {
  selectedFiles.delete(path);
  updateCompareBar();
  renderFileList();
}

async function doCompare() {
  if (selectedFiles.size < 2) return;
  const $c = $('tabContent');
  $c.innerHTML = '<div class="loading"><div class="spinner"></div>Comparing files...</div>';
  switchTab('overview');
  showTabs();
  try {
    const profiles = [];
    for (const p of selectedFiles) {
      try {
        const d = await apiFetch(`/api/profile?file=${encodeURIComponent(p)}`);
        profiles.push({ path: p, profile: d.profile });
      } catch(e) { console.warn('Compare skip:', e.message); }
    }
    if (profiles.length === 0) throw new Error('No profiles loaded');

    let html = '<h2 style="margin-bottom:16px;">File Comparison</h2>';
    html += '<div style="overflow-x:auto;"><table><thead><tr><th>Property</th>';
    profiles.forEach(p => {
      const name = files.find(f => f.path === p.path)?.name || p.path.split(/[\\/]/).pop();
      html += `<th>${name}</th>`;
    });
    html += '</tr></thead><tbody>';

    const rows = [
      ['Rows', p => p.profile.rows],
      ['Columns', p => p.profile.columns],
      ['Completeness', p => p.profile.completeness + '%'],
      ['Missing Cells', p => p.profile.total_missing],
      ['Numeric Columns', p => p.profile.numeric_columns],
      ['Categorical Columns', p => p.profile.categorical_columns],
      ['Memory', p => p.profile.memory_mb + ' MB'],
    ];
    rows.forEach(([label, fn]) => {
      html += `<tr><td><strong>${label}</strong></td>`;
      profiles.forEach(p => { html += `<td>${fn(p)}</td>`; });
      html += '</tr>';
    });
    html += '</tbody></table></div>';

    html += '<h3 style="margin:20px 0 12px;">Column Comparison</h3>';
    const allCols = new Set();
    profiles.forEach(p => p.profile.column_names.forEach(c => allCols.add(c)));
    const colArr = Array.from(allCols).sort();
    html += '<div style="overflow-x:auto;"><table><thead><tr><th>Column</th>';
    profiles.forEach(p => {
      const name = files.find(f => f.path === p.path)?.name || p.path.split(/[\\/]/).pop();
      html += `<th>${name}</th>`;
    });
    html += '</tr></thead><tbody>';
    colArr.forEach(col => {
      html += `<tr><td><strong>${col}</strong></td>`;
      profiles.forEach(p => {
        const idx = p.profile.column_names.indexOf(col);
        if (idx === -1) html += '<td style="color:var(--text2)">\u2014</td>';
        else html += `<td>${p.profile.dtypes[col]}</td>`;
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';

    $c.innerHTML = html;
  } catch(e) {
    $c.innerHTML = `<div class="err">${e.message}</div>`;
  }
}

async function selectFile(filePath) {
  currentFile = filePath;
  currentData = null;
  currentProfile = null;
  currentStats = null;
  currentClean = null;
  currentOutliers = null;
  currentSegments = null;
  currentInsights = null;
  dataOffset = 0;
  renderFileList();
  showTabs();
  switchTab('overview');
}

function showTabs() {
  $('tabs').style.display = 'flex';
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.tab[data-tab="${name}"]`).classList.add('active');
  if (name === 'overview' && currentProfile) renderOverview();
  else if (name === 'stats' && currentStats) renderStats();
  else if (name === 'data' && currentData) renderData();
  else if (name === 'clean' && currentClean) renderClean();
  else if (name === 'outliers' && currentOutliers) renderOutliers();
  else if (name === 'segments' && currentSegments) renderSegments();
  else if (name === 'insights' && currentInsights) renderInsights();
  else if (name === 'viz') renderViz();
  else if (name === 'nlp') renderNLP();
  else if (name === 'overview') loadProfile(currentFile);
  else if (name === 'stats') loadStats(currentFile);
  else if (name === 'data') loadDataChunk(currentFile, 0);
  else if (name === 'clean') loadClean(currentFile);
  else if (name === 'outliers') loadOutliers(currentFile);
  else if (name === 'segments') loadSegments(currentFile);
  else if (name === 'insights') loadInsights(currentFile);
}

async function apiFetch(path, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API}${path}`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Server error (${res.status}): ${txt.slice(0, 200)}`);
    }
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    return data;
  } catch(e) {
    clearTimeout(timer);
    throw e;
  }
}

async function loadProfile(filePath) {
  const $c = $('tabContent');
  $c.innerHTML = '<div class="loading"><div class="spinner"></div>Loading profile...</div>';
  try {
    const data = await apiFetch(`/api/profile?file=${encodeURIComponent(filePath)}`);
    currentProfile = data.profile;
    renderOverview();
  } catch(e) {
    $c.innerHTML = `<div class="err">${e.message}</div>`;
  }
}

function qualityBadge(score) {
  if (score >= 90) return 'excellent';
  if (score >= 75) return 'good';
  if (score >= 50) return 'fair';
  return 'poor';
}

function missBadge(pct) {
  if (pct === 0) return '';
  if (pct <= 5) return 'miss-low';
  if (pct <= 20) return 'miss-mod';
  if (pct <= 50) return 'miss-high';
  return 'miss-crit';
}

function renderOverview() {
  if (!currentProfile) return;
  const p = currentProfile;
  const qScore = Math.round(100 - p.total_missing / Math.max(1, p.total_cells) * 50);
  const qRating = qualityBadge(qScore);

  let html = `<div class="profile-summary">
    <div class="metric"><div class="num">${p.rows.toLocaleString()}</div><div class="lbl">Rows</div></div>
    <div class="metric"><div class="num">${p.columns}</div><div class="lbl">Columns</div></div>
    <div class="metric"><div class="num">${p.completeness}%</div><div class="lbl">Completeness</div></div>
    <div class="metric"><div class="num">${p.total_missing}</div><div class="lbl">Missing</div></div>
    <div class="metric"><div class="num">${p.memory_mb}</div><div class="lbl">MB</div></div>
    <div class="metric"><div class="num"><span class="badge ${qRating}">${qRating}</span></div><div class="lbl">Quality</div></div>
  </div>`;

  html += '<h3 style="margin-bottom:12px;">Schema</h3>';
  html += '<div style="overflow-x:auto;"><table><thead><tr><th>#</th><th>Column</th><th>Type</th><th>Dtype</th><th>Missing</th></tr></thead><tbody>';
  p.column_names.forEach((col, i) => {
    const dtype = p.dtypes[col] || '';
    const miss = p.missing_summary[col] || 0;
    const missPct = p.rows > 0 ? (miss / p.rows * 100).toFixed(1) : 0;
    const isNum = /^float|^int|^uint/.test(dtype);
    const typeLabel = isNum ? 'Numeric' : /^datetime/.test(dtype) ? 'DateTime' : 'Categorical';
    html += `<tr>
      <td style="color:var(--text2)">${i+1}</td>
      <td><strong>${col}</strong></td>
      <td><span class="col-type">${typeLabel}</span></td>
      <td><span class="col-dtype">${dtype}</span></td>
      <td>${miss > 0 ? `<span class="badge ${missBadge(p.rows > 0 ? miss/p.rows*100 : 0)}">${miss} (${missPct}%)</span>` : '<span style="color:var(--green)">0</span>'}</td>
    </tr>`;
  });
  html += '</tbody></table></div>';
  $('tabContent').innerHTML = html;
}

async function loadStats(filePath) {
  const $c = $('tabContent');
  $c.innerHTML = '<div class="loading"><div class="spinner"></div>Computing statistics...</div>';
  try {
    const data = await apiFetch(`/api/stats?file=${encodeURIComponent(filePath)}`);
    currentStats = data.stats;
    renderStats();
  } catch(e) {
    $c.innerHTML = `<div class="err">${e.message}</div>`;
  }
}

function renderStats() {
  if (!currentStats) return;
  const $c = $('tabContent');
  let html = '<div class="stats-grid">';
  for (const [col, s] of Object.entries(currentStats)) {
    html += `<div class="stat-card"><h3>${col}</h3>`;
    if (s.type === 'numeric') {
      html += `<div class="stat-grid">
        <span class="label">Mean</span><span class="val">${s.mean}</span>
        <span class="label">Median</span><span class="val">${s.median}</span>
        <span class="label">Std Dev</span><span class="val">${s.std}</span>
        <span class="label">Min</span><span class="val">${s.min}</span>
        <span class="label">Max</span><span class="val">${s.max}</span>
        <span class="label">Q25</span><span class="val">${s.q25}</span>
        <span class="label">Q75</span><span class="val">${s.q75}</span>
        <span class="label">Skew</span><span class="val">${s.skew}</span>
        <span class="label">Unique</span><span class="val">${s.unique}</span>
        <span class="label">Count</span><span class="val">${s.count}</span>
        <span class="label">Missing</span><span class="val" style="${(s.missing||0) > 0 ? 'color:var(--orange)' : ''}">${s.missing ?? 0}</span>
      </div>`;
    } else if (s.type === 'categorical') {
      html += `<div class="stat-grid">
        <span class="label">Unique</span><span class="val">${s.unique}</span>
        <span class="label">Mode</span><span class="val">${s.mode || '\u2014'}</span>
        <span class="label">Count</span><span class="val">${s.count}</span>
        <span class="label">Missing</span><span class="val" style="${(s.missing||0) > 0 ? 'color:var(--orange)' : ''}">${s.missing ?? 0}</span>
      </div>`;
      if (s.top_values) {
        html += '<div style="margin-top:8px;"><div style="font-size:11px;color:var(--text2);margin-bottom:4px;">Top values</div>';
        for (const [k, v] of Object.entries(s.top_values)) {
          const pct = s.count > 0 ? (v / s.count * 100).toFixed(1) : 0;
          const barW = Math.min(100, pct * 2);
          html += `<div style="display:flex;align-items:center;gap:6px;font-size:12px;margin-bottom:2px;">
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${k}</span>
            <span style="width:40px;text-align:right;color:var(--text2)">${pct}%</span>
            <span style="width:60px;height:6px;background:var(--surface2);border-radius:3px;overflow:hidden;flex-shrink:0;">
              <span style="display:block;height:100%;width:${barW}%;background:var(--accent);border-radius:3px;"></span>
            </span>
          </div>`;
        }
        html += '</div>';
      }
    } else if (s.type === 'datetime') {
      html += `<div class="stat-grid">
        <span class="label">Min</span><span class="val">${s.min || '\u2014'}</span>
        <span class="label">Max</span><span class="val">${s.max || '\u2014'}</span>
        <span class="label">Range (days)</span><span class="val">${s.range_days ?? '\u2014'}</span>
        <span class="label">Unique</span><span class="val">${s.unique}</span>
        <span class="label">Count</span><span class="val">${s.count}</span>
        <span class="label">Missing</span><span class="val">${s.missing ?? 0}</span>
      </div>`;
    } else {
      html += `<div class="stat-grid"><span class="label">Count</span><span class="val">${s.count}</span></div>`;
    }
    html += '</div>';
  }
  html += '</div>';
  $c.innerHTML = html;
}

async function loadDataChunk(filePath, offset) {
  dataOffset = offset;
  const $c = $('tabContent');
  $c.innerHTML = '<div class="loading"><div class="spinner"></div>Loading data...</div>';
  try {
    const data = await apiFetch(`/api/data?file=${encodeURIComponent(filePath)}&offset=${offset}&limit=${PAGE_SIZE}`);
    currentData = data.data;
    renderData();
  } catch(e) {
    $c.innerHTML = `<div class="err">${e.message}</div>`;
  }
}

function renderData() {
  if (!currentData) return;
  const d = currentData;
  const totalPages = Math.ceil(d.total / PAGE_SIZE);
  const currentPage = Math.floor(d.offset / PAGE_SIZE) + 1;

  let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
    <span style="font-size:13px;color:var(--text2);">Showing rows ${d.offset+1}-${Math.min(d.offset+d.rows.length, d.total)} of ${d.total.toLocaleString()}</span>
    <span style="font-size:13px;color:var(--text2);">${d.columns.length} columns</span>
  </div>`;

  html += '<div style="overflow-x:auto;max-height:calc(100vh - 280px);overflow-y:auto;"><table><thead><tr>';
  d.columns.forEach(c => { html += `<th>${c}</th>`; });
  html += '</tr></thead><tbody>';
  d.rows.forEach(row => {
    html += '<tr>';
    d.columns.forEach(c => {
      let v = row[c];
      if (v === null || v === undefined) v = '<span style="color:var(--text2);font-style:italic;">null</span>';
      else if (typeof v === 'number') v = v.toLocaleString();
      else v = String(v);
      html += `<td title="${v.replace(/"/g, '&quot;')}">${v}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table></div>';

  html += '<div class="pagination">';
  html += `<button ${d.offset <= 0 ? 'disabled' : ''} onclick="loadDataChunk(currentFile, 0)">First</button>`;
  html += `<button ${d.offset <= 0 ? 'disabled' : ''} onclick="loadDataChunk(currentFile, Math.max(0, ${d.offset} - ${PAGE_SIZE}))">Prev</button>`;
  html += `<span>Page ${currentPage} of ${totalPages}</span>`;
  html += `<button ${!d.has_more ? 'disabled' : ''} onclick="loadDataChunk(currentFile, ${d.offset} + ${PAGE_SIZE})">Next</button>`;
  html += `<button ${!d.has_more ? 'disabled' : ''} onclick="loadDataChunk(currentFile, Math.max(0, ${d.total} - ${PAGE_SIZE}))">Last</button>`;
  html += '</div>';

  $('tabContent').innerHTML = html;
}

async function loadClean(filePath) {
  const $c = $('tabContent');
  $c.innerHTML = '<div class="loading"><div class="spinner"></div>Cleaning data...</div>';
  try {
    const d = await apiFetch(`/api/clean?file=${encodeURIComponent(filePath)}`);
    currentClean = d;
    renderClean();
  } catch(e) { $c.innerHTML = `<div class="err">${e.message}</div>`; }
}

function renderClean() {
  if (!currentClean) return;
  const r = currentClean.report;
  const m = r.cleaning_metrics;
  let html = `<div class="profile-summary">
    <div class="metric"><div class="num">${m.before_rows}</div><div class="lbl">Rows Before</div></div>
    <div class="metric"><div class="num">${m.after_rows}</div><div class="lbl">Rows After</div></div>
    <div class="metric"><div class="num">${m.duplicates_removed}</div><div class="lbl">Duplicates</div></div>
    <div class="metric"><div class="num">${m.missing_imputed}</div><div class="lbl">Imputed</div></div>
    <div class="metric"><div class="num">${m.corrupt_values_fixed}</div><div class="lbl">Corrupt Fixed</div></div>
    <div class="metric"><div class="num">${m.whitespace_cleaned}</div><div class="lbl">Whitespace</div></div>
    <div class="metric"><div class="num">${m.type_casts_performed}</div><div class="lbl">Type Casts</div></div>
    <div class="metric"><div class="num">${m.outliers_detected}</div><div class="lbl">Outlier Flags</div></div>
  </div>`;
  html += '<h3 style="margin-bottom:12px;">Missingness</h3>';
  html += '<div style="overflow-x:auto;"><table><thead><tr><th>Column</th><th>Before</th><th>%</th><th>After</th><th>%</th></tr></thead><tbody>';
  const allMissCols = new Set([...Object.keys(r.missingness_before || {}), ...Object.keys(r.missingness_after || {})]);
  for (const col of allMissCols) {
    const b = r.missingness_before[col] || { missing: 0, percent: 0 };
    const a = r.missingness_after[col] || { missing: 0, percent: 0 };
    html += `<tr><td><strong>${col}</strong></td>
      <td>${b.missing}</td><td>${b.percent}%</td>
      <td>${a.missing}</td><td>${a.percent}%</td></tr>`;
  }
  html += '</tbody></table></div>';

  if (r.near_zero_variance_columns && r.near_zero_variance_columns.length) {
    html += '<h3 style="margin:16px 0 8px;">Near-Zero Variance</h3>';
    html += `<p style="color:var(--orange);font-size:13px;">${r.near_zero_variance_columns.join(', ')}</p>`;
  }

  html += '<h3 style="margin:16px 0 8px;">Policy</h3>';
  html += `<p style="font-size:12.5px;color:var(--text2);line-height:1.5;">${r.outlier_policy || r.policy || ''}</p>`;
  $('tabContent').innerHTML = html;
}

async function loadOutliers(filePath) {
  const $c = $('tabContent');
  $c.innerHTML = '<div class="loading"><div class="spinner"></div>Detecting outliers...</div>';
  try {
    const d = await apiFetch(`/api/outliers?file=${encodeURIComponent(filePath)}`);
    currentOutliers = d;
    renderOutliers();
  } catch(e) { $c.innerHTML = `<div class="err">${e.message}</div>`; }
}

function renderOutliers() {
  if (!currentOutliers) return;
  const data = currentOutliers;
  let html = `<p style="font-size:12.5px;color:var(--text2);margin-bottom:16px;line-height:1.5;">${data.policy}</p>`;
  const cols = Object.keys(data.outliers);
  if (cols.length === 0) {
    html += '<p style="color:var(--green);font-size:14px;padding:20px 0;">No outliers detected in any column.</p>';
  } else {
    html += '<div style="overflow-x:auto;"><table><thead><tr><th>Column</th><th>Outliers</th><th>Percent</th><th>Method</th></tr></thead><tbody>';
    cols.forEach(col => {
      const o = data.outliers[col];
      html += `<tr><td><strong>${col}</strong></td><td>${o.count}</td><td>${o.percent}%</td><td>${o.method}</td></tr>`;
    });
    html += '</tbody></table></div>';
  }
  $('tabContent').innerHTML = html;
}

async function genViz(columns) {
  const $c = $('tabContent');
  $c.innerHTML = '<div class="loading"><div class="spinner"></div>Generating chart...</div>';
  try {
    const params = columns ? `&columns=${encodeURIComponent(columns)}` : '';
    const d = await apiFetch(`/api/visualize?file=${encodeURIComponent(currentFile)}${params}`);
    if (d.chart_type === 'none') {
      $c.innerHTML = `<div class="err">No suitable chart could be generated. ${d.reason || ''}</div>`;
      return;
    }
    let html = `<p style="font-size:12.5px;color:var(--text2);margin-bottom:12px;">Chart: <strong>${d.chart_type}</strong> &mdash; ${d.reason}</p>`;
    if (d.image) {
      html += `<img src="data:image/png;base64,${d.image}" style="max-width:100%;border-radius:var(--radius);box-shadow:var(--shadow-lg);">`;
    }
    $c.innerHTML += html;
  } catch(e) { $c.innerHTML = `<div class="err">${e.message}</div>`; }
}

function renderViz() {
  const cols = currentProfile ? currentProfile.column_names : [];
  let html = `<div style="margin-bottom:16px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
    <input id="vizCols" type="text" placeholder="Column names (comma-separated)" value="${cols.slice(0,3).join(', ')}"
      style="flex:1;min-width:200px;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:9px 14px;border-radius:var(--radius);font-size:13px;font-family:inherit;outline:none;">
    <button class="btn" onclick="genViz($('vizCols').value.trim())">Generate</button>
  </div>
  <p style="font-size:12px;color:var(--text3);margin-bottom:16px;">Available columns: ${cols.join(', ')}</p>
  <div id="vizResult"></div>`;
  $('tabContent').innerHTML = html;
  if (cols.length) genViz(cols.slice(0, 3).join(','));
}

async function runNLP(query) {
  const $c = $('tabContent');
  $c.innerHTML = '<div class="loading"><div class="spinner"></div>Processing query...</div>';
  try {
    const d = await apiFetch(`/api/nlp?file=${encodeURIComponent(currentFile)}&q=${encodeURIComponent(query)}`);
    if (d.chart_type === 'none') {
      $c.innerHTML = `<div class="err">Could not parse query. ${d.reason || ''}</div>`;
      return;
    }
    let html = `<p style="font-size:12.5px;color:var(--text2);margin-bottom:12px;">Query: <strong>${query}</strong> &mdash; ${d.chart_type} (${d.reason})</p>`;
    if (d.image) {
      html += `<img src="data:image/png;base64,${d.image}" style="max-width:100%;border-radius:var(--radius);box-shadow:var(--shadow-lg);">`;
    }
    $c.innerHTML = html;
  } catch(e) { $c.innerHTML = `<div class="err">${e.message}</div>`; }
}

function renderNLP() {
  const cols = currentProfile ? currentProfile.column_names : [];
  let html = `<div style="margin-bottom:16px;display:flex;gap:8px;">
    <input id="nlpQuery" type="text" placeholder='e.g. "distribution of age" or "scatter salary vs age"'
      style="flex:1;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:9px 14px;border-radius:var(--radius);font-size:13px;font-family:inherit;outline:none;">
    <button class="btn" onclick="runNLP($('nlpQuery').value.trim())">Go</button>
  </div>
  <p style="font-size:12px;color:var(--text3);margin-bottom:16px;">Available columns: ${cols.join(', ')}</p>
  <div id="nlpResult"></div>`;
  $('tabContent').innerHTML = html;
  $('nlpQuery').addEventListener('keydown', e => { if (e.key === 'Enter') runNLP(e.target.value.trim()); });
}

async function loadSegments(filePath) {
  const $c = $('tabContent');
  $c.innerHTML = '<div class="loading"><div class="spinner"></div>Exploring segments...</div>';
  try {
    const d = await apiFetch(`/api/segments?file=${encodeURIComponent(filePath)}`);
    currentSegments = d;
    renderSegments();
  } catch(e) { $c.innerHTML = `<div class="err">${e.message}</div>`; }
}

function renderSegments() {
  if (!currentSegments) return;
  const s = currentSegments;
  const alerts = s.alerts || [];
  const summary = s.summary || {};
  const narratives = summary.narratives || [];
  let html = '<h3 style="margin-bottom:12px;">Segment Alerts</h3>';
  if (alerts.length === 0) {
    html += '<p style="color:var(--green);font-size:14px;padding:20px 0;">No significant segment deviations found.</p>';
  } else {
    html += '<div style="overflow-x:auto;"><table><thead><tr><th>Metric</th><th>Segment</th><th>Global Mean</th><th>Seg. Mean</th><th>Deviation</th><th>Dir.</th><th>Severity</th></tr></thead><tbody>';
    alerts.forEach(a => {
      html += `<tr>
        <td><strong>${a.metric}</strong></td>
        <td>${a.segment_column} = ${a.segment_value}</td>
        <td>${a.global_mean}</td>
        <td>${a.segment_mean}</td>
        <td>${a.deviation}</td>
        <td>${a.direction}</td>
        <td>${a.severity}x</td>
      </tr>`;
    });
    html += '</tbody></table></div>';
  }
  if (narratives.length) {
    html += '<h3 style="margin:20px 0 12px;">Narratives</h3>';
    html += '<div style="display:flex;flex-direction:column;gap:8px;">';
    narratives.forEach(n => { html += `<div style="background:var(--surface);padding:12px 16px;border-radius:var(--radius);border:1px solid var(--border);font-size:13px;line-height:1.5;">${n}</div>`; });
    html += '</div>';
  }
  $('tabContent').innerHTML = html;
}

async function loadInsights(filePath) {
  const $c = $('tabContent');
  $c.innerHTML = '<div class="loading"><div class="spinner"></div>Generating insights...</div>';
  try {
    const d = await apiFetch(`/api/insights?file=${encodeURIComponent(filePath)}`);
    currentInsights = d;
    renderInsights();
  } catch(e) { $c.innerHTML = `<div class="err">${e.message}</div>`; }
}

function renderInsights() {
  if (!currentInsights) return;
  const d = currentInsights;
  let html = '';
  if (d.narrative) {
    const paragraphs = d.narrative.split('\n').filter(p => p.trim());
    html += '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:20px 24px;line-height:1.7;font-size:13.5px;margin-bottom:20px;">';
    paragraphs.forEach(p => {
      const trimmed = p.trim();
      if (trimmed.startsWith('---')) {
        html += `<h4 style="margin:16px 0 8px;color:var(--accent);">${trimmed.replace(/-+/g, '').trim()}</h4>`;
      } else if (trimmed) {
        html += `<p style="margin-bottom:6px;">${trimmed}</p>`;
      }
    });
    html += '</div>';
  }
  if (d.segment_alerts && d.segment_alerts.length) {
    html += '<h3 style="margin:16px 0 10px;">Segment Alerts</h3>';
    d.segment_alerts.forEach(a => {
      html += `<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:12px 16px;margin-bottom:8px;font-size:13px;">
        <strong>${a.metric}</strong> on <em>${a.segment_column} = ${a.segment_value}</em>:
        deviation of ${a.deviation} (${a.direction}, ${a.severity}x severity)
      </div>`;
    });
  }
  $('tabContent').innerHTML = html;
}

function pickFiles() { $('filePicker').click(); }

async function onFilesPicked(e) {
  const fileList = Array.from(e.target.files);
  if (!fileList || fileList.length === 0) return;
  await uploadFiles(fileList);
  $('filePicker').value = '';
}

async function uploadFiles(fileList) {
  if (!await ensureServer()) return;
  const $c = $('tabContent');
  const uploaded = [];
  const errors = [];
  let lastOk = null;
  for (const f of fileList) {
    $c.innerHTML = `<div class="loading"><div class="spinner"></div>Uploading ${f.name}...</div>`;
    try {
      const text = await f.text();
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 60000);
      const res = await fetch(`${API}/api/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: f.name, content: text }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Server (${res.status}): ${txt.slice(0, 200)}`);
      }
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      uploaded.push(data.file);
      lastOk = data.file;
    } catch(e) {
      console.error('Upload error:', e);
      let msg;
      if (e.name === 'AbortError') msg = 'Upload timed out (60s). Try a smaller file.';
      else if (e.message.includes('Failed to fetch')) msg = 'Cannot reach the server. Is <code>python app.py</code> running?';
      else msg = e.message;
      errors.push(`${f.name}: ${msg}`);
    }
  }
  files = uploaded;
  selectedFiles.clear();
  renderFileList();
  $('selectAllRow').style.display = 'flex';
  $('fileCount').textContent = `${files.length} file${files.length !== 1 ? 's' : ''}`;
  $('dirInfo').textContent = 'Uploaded files';
  if (errors.length) {
    const errHtml = errors.map(e => `<div>${e}</div>`).join('');
    if (!files.length) {
      $c.innerHTML = `<div class="err">${errHtml}</div>`;
    } else {
      $c.innerHTML = `<div class="warn">Some files failed:<br>${errHtml}</div>`;
    }
  }
  if (lastOk) {
    selectFile(lastOk.path);
    loadProfile(lastOk.path);
  }
}

checkServer().then(ok => {
  if (!ok) ensureServer();
});
