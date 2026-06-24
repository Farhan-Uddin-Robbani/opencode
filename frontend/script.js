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
let currentSmart = null;
let currentMerge = null;
let customRules = {};
let currentFilters = {};
let filterActive = false;
let filterTotalRows = 0;
let filterFilteredRows = 0;
let files = [];
let currentDirs = [];
let selectedFiles = new Set();
let dataOffset = 0;
let loadingTabs = new Set();
let currentDir = '';
let roots = [];
const PAGE_SIZE = 100;

function $(id) { return document.getElementById(id); }

const TOOLTIP_DEFS = {
  rows: 'Total number of rows (observations) in the dataset.',
  columns: 'Total number of columns (features) in the dataset.',
  completeness: 'Percentage of non-missing cells out of all cells.',
  missing: 'Total number of cells with missing values.',
  memory: 'RAM used by the dataset in memory.',
  quality: 'Overall data quality score based on completeness and consistency.',
  duplicates: 'Rows that are exact copies of other rows, removed during cleaning.',
  imputed: 'Missing values that were filled in using statistical strategies (mean, median, or mode).',
  corrupt_fixed: 'Values that were invalid or corrupted and repaired automatically.',
  whitespace_cleaned: 'String values with leading/trailing whitespace that was trimmed.',
  type_casts: 'Columns whose data types were corrected (e.g. numeric strings to numbers).',
  outlier_flags: 'Rows flagged as statistical outliers using the IQR method.',
  cols_dropped: 'Columns dropped during cleaning (e.g. too many missing values).',
  mean: 'Average value: sum of all values divided by count.',
  median: 'Middle value when data is sorted. Less sensitive to outliers than mean.',
  std: 'Standard deviation: measures how spread out values are from the mean.',
  variance: 'Variance: square of standard deviation, measures dispersion.',
  min: 'Minimum (smallest) value in the column.',
  max: 'Maximum (largest) value in the column.',
  range: 'Difference between the maximum and minimum values.',
  q25: '25th percentile (first quartile): 25% of values fall below this.',
  q75: '75th percentile (third quartile): 75% of values fall below this.',
  iqr: 'Interquartile range: Q75 - Q25, the middle 50% spread of data.',
  skewness: 'Measures asymmetry of the distribution. 0 = symmetric, positive = right tail, negative = left tail. Values beyond \u00b11 suggest significant skew.',
  kurtosis: 'Measures "tailedness" of the distribution. 0 = normal, positive = heavy tails (more outliers), negative = light tails (fewer outliers). Excess kurtosis relative to normal distribution.',
  unique: 'Number of distinct values in the column.',
  unique_ratio: 'Ratio of unique values to total count. Low ratio (<0.05) may indicate a categorical column disguised as numeric. High ratio near 1.0 suggests an ID-like column.',
  count: 'Number of non-missing values.',
  mode: 'Most frequently occurring value.',
  nzv: 'Near-Zero Variance: a column where one value dominates (>95% of rows), offering little predictive power.',
  range_days: 'Number of days between the earliest and latest date.',
  rows_before: 'Row count before cleaning operations were applied.',
  rows_after: 'Row count after cleaning operations were applied.',
  numeric: 'Columns classified as numeric (continuous or integer measures).',
  categorical: 'Columns classified as categorical (discrete groups or categories).',
  date: 'Columns classified as date/time types.',
};

let activeTip = null;

function tip(key) {
  const text = TOOLTIP_DEFS[key] || '';
  if (!text) return '';
  return `<span class="tooltip-wrap" onmouseenter="showTip(event)" onmouseleave="hideTip(event)"><span class="tooltip-icon">?</span><span class="tooltip-text">${text}</span></span>`;
}

function showTip(e) {
  hideTip();
  const wrap = e.currentTarget;
  const icon = wrap.querySelector('.tooltip-icon');
  const src = wrap.querySelector('.tooltip-text');
  if (!icon || !src) return;
  const el = document.createElement('div');
  el.className = 'tt-fixed';
  el.textContent = src.textContent;
  document.body.appendChild(el);
  const r = icon.getBoundingClientRect();
  let left = r.left + r.width / 2;
  let top = r.top - 10;
  el.style.left = left + 'px';
  el.style.top = top + 'px';
  el.style.transform = 'translate(-50%, -100%)';
  requestAnimationFrame(() => {
    const er = el.getBoundingClientRect();
    if (er.left < 8) { el.style.left = (er.width / 2 + 8) + 'px'; el.style.transform = 'translate(0, -100%)'; }
    else if (er.right > window.innerWidth - 8) { el.style.left = (window.innerWidth - er.width / 2 - 8) + 'px'; el.style.transform = 'translate(-100%, -100%)'; }
    if (er.top < 8) { el.style.top = (r.bottom + 10) + 'px'; el.style.transform = el.style.transform.replace('-100%', '0%'); el.classList.add('tt-below'); }
    el.classList.add('tt-visible');
  });
  activeTip = el;
}

function hideTip() {
  if (activeTip) { activeTip.remove(); activeTip = null; }
}

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
  currentDirs.forEach(d => {
    const li = document.createElement('li');
    li.style.cursor = 'pointer';
    li.innerHTML = `<span style="opacity:0.6;margin-right:4px;">&#128193;</span><span>${d.name}</span><span style="margin-left:auto;font-size:11px;color:var(--text3);">folder</span>`;
    li.addEventListener('click', () => loadDirectory(d.path));
    ul.appendChild(li);
  });
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
    const btn = $('compareBtn');
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
    btn.style.display = selectedFiles.size >= 2 ? 'inline-block' : 'none';
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
  showTabs();
  switchTab('overview');
  try {
    const filePaths = Array.from(selectedFiles);
    const filesParam = filePaths.map(p => encodeURIComponent(p)).join(',');
    const data = await apiFetch(`/api/compare?files=${filesParam}`);
    const cmp = data.comparison;
    const names = cmp.file_names;
    const profiles = cmp.profiles;

    let html = '<h2 style="margin-bottom:16px;">File Comparison</h2>';

    html += '<div class="compare-nav" style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;">';
    html += '<button class="btn" onclick="document.getElementById(\'compareMetrics\').scrollIntoView({behavior:\'smooth\'})" style="font-size:11.5px;padding:6px 14px;">Metrics</button>';
    html += '<button class="btn" onclick="document.getElementById(\'compareSchema\').scrollIntoView({behavior:\'smooth\'})" style="font-size:11.5px;padding:6px 14px;">Schema</button>';
    html += '<button class="btn" onclick="document.getElementById(\'compareMissing\').scrollIntoView({behavior:\'smooth\'})" style="font-size:11.5px;padding:6px 14px;">Missing</button>';
    html += '<button class="btn" onclick="document.getElementById(\'compareStats\').scrollIntoView({behavior:\'smooth\'})" style="font-size:11.5px;padding:6px 14px;">Stats</button>';
    html += '</div>';

    html += '<div id="compareMetrics" style="margin-bottom:24px;scroll-margin-top:70px;">';
    html += '<h3 style="margin-bottom:10px;">Dataset Metrics</h3>';
    html += '<div style="overflow-x:auto;"><table><thead><tr><th>Property</th>';
    names.forEach(n => { html += `<th>${n}</th>`; });
    html += '</tr></thead><tbody>';

    var metricRows = [
      ['Rows', p => p.rows.toLocaleString(), 'rows'],
      ['Columns', p => p.columns, 'columns'],
      ['Completeness', p => p.completeness + '%', 'completeness'],
      ['Missing Cells', p => p.total_missing.toLocaleString(), 'missing'],
      ['Numeric Columns', p => p.numeric_columns, 'numeric'],
      ['Categorical Columns', p => p.categorical_columns, 'categorical'],
      ['Date Columns', p => p.date_columns, 'date'],
      ['Memory', p => p.memory_mb + ' MB', 'memory'],
      ['Quality Score', function(p) {
        var q = Math.round(100 - p.total_missing / Math.max(1, p.total_cells) * 50);
        return '<span class="badge ' + qualityBadge(q) + '">' + q + '</span>';
      }, 'quality'],
    ];
    metricRows.forEach(function(r) {
      var label = r[0], fn = r[1], tipKey = r[2];
      var vals = names.map(function(n) { return fn(profiles[n]); });
      var maxVal = null;
      if (label === 'Rows' || label === 'Completeness' || label === 'Numeric Columns' || label === 'Quality Score') {
        var nums = vals.map(function(v) {
          var s = String(v);
          var m = s.match(/[\d.]+/);
          return m ? parseFloat(m[0]) : null;
        }).filter(function(v) { return v !== null; });
        if (nums.length) maxVal = Math.max.apply(null, nums);
      }
      html += '<tr><td><strong>' + label + tip(tipKey) + '</strong></td>';
      names.forEach(function(n, i) {
        var v = fn(profiles[n]);
        var highlight = '';
        if (maxVal !== null) {
          var num = parseFloat(String(v).match(/[\d.]+/));
          if (num === maxVal && names.length > 1) highlight = ' style="color:var(--green);font-weight:600;"';
        }
        html += '<td' + highlight + '>' + v + '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table></div></div>';

    html += '<div id="compareSchema" style="margin-bottom:24px;scroll-margin-top:70px;">';
    html += '<h3 style="margin-bottom:10px;">Schema &amp; Types</h3>';
    html += '<p style="font-size:12px;color:var(--text3);margin-bottom:8px;">Shared columns are highlighted in green. Columns present in all files are marked with <span style="color:var(--green);">&#9679;</span>.</p>';
    html += '<div style="overflow-x:auto;"><table><thead><tr><th>Column</th>';
    names.forEach(function(n) { html += '<th>' + n + '</th>'; });
    html += '<th>Shared</th></tr></thead><tbody>';

    var allColumns = cmp.all_columns;
    allColumns.forEach(function(col) {
      var sharedIn = col in cmp.shared_columns ? cmp.shared_columns[col] : [];
      var presentInAll = sharedIn.length === names.length;
      var sharedCount = sharedIn.length;
      html += '<tr><td><strong>' + col + '</strong></td>';
      names.forEach(function(n) {
        var p = profiles[n];
        var idx = p.column_names.indexOf(col);
        if (idx === -1) {
          html += '<td style="color:var(--text2);font-style:italic;">&mdash;</td>';
        } else {
          var dtype = p.dtypes[col] || '';
          var cls = p.classifications[col] || '';
          var typeLabel = cls === 'Measure' ? 'Numeric' : cls === 'Date Dimension' ? 'Date' : 'Categorical';
          html += '<td><span class="col-dtype">' + dtype + '</span> <span class="col-type">' + typeLabel + '</span></td>';
        }
      });
      html += '<td style="text-align:center;">' + (presentInAll ? '<span style="color:var(--green);font-size:16px;">&#9679;</span>' : sharedCount + '/' + names.length) + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table></div></div>';

    html += '<div id="compareMissing" style="margin-bottom:24px;scroll-margin-top:70px;">';
    html += '<h3 style="margin-bottom:10px;">Missing Values</h3>';
    html += '<div style="overflow-x:auto;"><table><thead><tr><th>Column</th>';
    names.forEach(function(n) { html += '<th>' + n + '</th>'; });
    html += '</tr></thead><tbody>';

    allColumns.forEach(function(col) {
      html += '<tr><td><strong>' + col + '</strong></td>';
      names.forEach(function(n) {
        var p = profiles[n];
        var miss = p.missing_summary[col];
        if (miss === undefined) {
          html += '<td style="color:var(--text2);font-style:italic;">&mdash;</td>';
        } else {
          var pct = p.rows > 0 ? (miss / p.rows * 100).toFixed(1) : 0;
          var badgeCls = missBadge(p.rows > 0 ? miss / p.rows * 100 : 0);
          html += '<td>' + (miss > 0 ? '<span class="badge ' + badgeCls + '">' + miss + ' (' + pct + '%)</span>' : '<span style="color:var(--green)">0</span>') + '</td>';
        }
      });
      html += '</tr>';
    });
    html += '</tbody></table></div></div>';

    html += '<div id="compareStats" style="margin-bottom:24px;scroll-margin-top:70px;">';
    html += '<h3 style="margin-bottom:10px;">Numeric Stats Comparison</h3>';
    html += '<p style="font-size:12px;color:var(--text3);margin-bottom:8px;">Side-by-side statistics for numeric columns present in at least one file.</p>';

    var allNumCols = [];
    names.forEach(function(n) {
      var stats = cmp.stats[n] || {};
      Object.keys(stats).forEach(function(c) {
        if (stats[c].type === 'numeric' && allNumCols.indexOf(c) === -1) allNumCols.push(c);
      });
    });
    allNumCols.sort();

    if (allNumCols.length === 0) {
      html += '<p style="color:var(--text2);padding:12px 0;">No numeric columns found across selected files.</p>';
    } else {
      var statLabels = ['mean', 'median', 'std', 'min', 'max', 'q25', 'q75', 'skewness', 'kurtosis', 'count', 'missing'];
      var statTips = ['mean', 'median', 'std', 'min', 'max', 'q25', 'q75', 'skewness', 'kurtosis', 'count', 'missing'];

      allNumCols.forEach(function(col) {
        var presentIn = [];
        names.forEach(function(n, i) {
          var s = (cmp.stats[n] || {})[col];
          if (s && s.type === 'numeric') presentIn.push(i);
        });
        html += '<div style="margin-bottom:16px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:14px;overflow-x:auto;">';
        html += '<h4 style="font-size:13px;margin-bottom:8px;color:var(--accent);">' + col + ' <span style="font-weight:400;font-size:11px;color:var(--text3);">(in ' + presentIn.length + '/' + names.length + ' files)</span></h4>';
        html += '<table style="font-size:12px;"><thead><tr><th>Stat</th>';
        presentIn.forEach(function(i) { html += '<th>' + names[i] + '</th>'; });
        html += '</tr></thead><tbody>';
        statLabels.forEach(function(sl, si) {
          html += '<tr><td style="font-weight:500;">' + sl + tip(statTips[si]) + '</td>';
          presentIn.forEach(function(i) {
            var s = (cmp.stats[names[i]] || {})[col];
            var val = s && s.stats ? s.stats[sl] : (s ? s[sl] : null);
            html += '<td>' + (val !== null && val !== undefined ? val : '\u2014') + '</td>';
          });
          html += '</tr>';
        });
        html += '</tbody></table></div>';
      });
    }
    html += '</div>';

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
  currentSmart = null;
  currentMerge = null;
  currentFilters = {};
  crossFilters = {};
  dndMapping = { x: null, y: null };
  destroyChart();
  filterActive = false;
  filterTotalRows = 0;
  filterFilteredRows = 0;
  dataOffset = 0;
  renderFileList();
  showTabs();
  switchTab('overview');
  preloadAllTabs(filePath);
}

async function preloadAllTabs(filePath) {
  const tabs = ['stats', 'clean', 'outliers', 'segments', 'insights', 'data', 'smart'];
  tabs.forEach(function(t) { setTabLoading(t, true); });

  const results = await Promise.allSettled([
    apiFetch('/api/stats?file=' + encodeURIComponent(filePath)).then(function(d) { currentStats = d.stats; }),
    apiFetch('/api/clean?file=' + encodeURIComponent(filePath)).then(function(d) { currentClean = d; }),
    apiFetch('/api/outliers?file=' + encodeURIComponent(filePath)).then(function(d) { currentOutliers = d; }),
    apiFetch('/api/segments?file=' + encodeURIComponent(filePath)).then(function(d) { currentSegments = d; }),
    apiFetch('/api/insights?file=' + encodeURIComponent(filePath)).then(function(d) { currentInsights = d; }),
    apiFetch('/api/data?file=' + encodeURIComponent(filePath) + '&offset=0&limit=' + PAGE_SIZE).then(function(d) { currentData = d.data; }),
    apiFetch('/api/smart-analysis?file=' + encodeURIComponent(filePath)).then(function(d) { currentSmart = d; }),
  ]);

  results.forEach(function(r, i) {
    var tab = tabs[i];
    setTabLoading(tab, false);
    if (r.status === 'rejected') console.warn(tab + ' preload failed:', r.reason);
  });

  var activeTab = document.querySelector('.tab.active');
  if (activeTab) {
    var name = activeTab.dataset.tab;
    if (name === 'stats') renderStats();
    else if (name === 'data') renderData();
    else if (name === 'clean') renderClean();
    else if (name === 'outliers') renderOutliers();
    else if (name === 'segments') renderSegments();
    else if (name === 'insights') renderInsights();
    else if (name === 'smart') renderSmart();
  }
}

function showTabs() {
  $('tabs').style.display = 'flex';
}

function setTabLoading(name, loading) {
  const tab = document.querySelector(`.tab[data-tab="${name}"]`);
  if (!tab) return;
  if (loading) {
    loadingTabs.add(name);
    if (!tab.querySelector('.tab-spinner')) {
      const sp = document.createElement('span');
      sp.className = 'tab-spinner';
      tab.appendChild(sp);
    }
  } else {
    loadingTabs.delete(name);
    const sp = tab.querySelector('.tab-spinner');
    if (sp) sp.remove();
  }
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  const activeTab = document.querySelector(`.tab[data-tab="${name}"]`);
  if (activeTab) activeTab.classList.add('active');
  if (name !== 'viz') destroyChart();
  if (name === 'overview' && currentProfile) renderOverview();
  else if (name === 'stats' && currentStats) renderStats();
  else if (name === 'data' && currentData) renderData();
  else if (name === 'clean' && currentClean) renderClean();
  else if (name === 'outliers' && currentOutliers) renderOutliers();
  else if (name === 'segments' && currentSegments) renderSegments();
  else if (name === 'insights' && currentInsights) renderInsights();
  else if (name === 'viz') renderViz();
  else if (name === 'nlp') renderNLP();
  else if (name === 'overview') { setTabLoading('overview', true); loadProfile(currentFile); }
  else if (name === 'stats') { setTabLoading('stats', true); loadStats(currentFile); }
  else if (name === 'data') { setTabLoading('data', true); loadDataChunk(currentFile, 0); }
  else if (name === 'clean') { setTabLoading('clean', true); loadClean(currentFile); }
  else if (name === 'outliers') { setTabLoading('outliers', true); loadOutliers(currentFile); }
  else if (name === 'segments') { setTabLoading('segments', true); loadSegments(currentFile); }
  else if (name === 'smart' && currentSmart) renderSmart();
  else if (name === 'smart') { setTabLoading('smart', true); loadSmartAnalysis(currentFile); }
  else if (name === 'merge' && currentMerge) renderMerge();
  else if (name === 'merge') renderMerge();
  else if (name === 'insights') { setTabLoading('insights', true); loadInsights(currentFile); }
}

async function apiFetch(path, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API}${path}`, { signal: controller.signal, ...options });
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
  setTabLoading('overview', true);
  $c.innerHTML = '<div class="loading"><div class="spinner"></div>Loading profile...</div>';
  try {
    const data = await apiFetch(`/api/profile?file=${encodeURIComponent(filePath)}`);
    currentProfile = data.profile;
    renderOverview();
  } catch(e) {
    $c.innerHTML = `<div class="err">${e.message}</div>`;
  } finally {
    setTabLoading('overview', false);
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
    <div class="metric"><div class="num">${p.rows.toLocaleString()}</div><div class="lbl">Rows${tip('rows')}</div></div>
    <div class="metric"><div class="num">${p.columns}</div><div class="lbl">Columns${tip('columns')}</div></div>
    <div class="metric"><div class="num">${p.completeness}%</div><div class="lbl">Completeness${tip('completeness')}</div></div>
    <div class="metric"><div class="num">${p.total_missing}</div><div class="lbl">Missing${tip('missing')}</div></div>
    <div class="metric"><div class="num">${p.memory_mb}</div><div class="lbl">MB${tip('memory')}</div></div>
    <div class="metric"><div class="num"><span class="badge ${qRating}">${qRating}</span></div><div class="lbl">Quality${tip('quality')}</div></div>
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
  setTabLoading('stats', true);
  $c.innerHTML = '<div class="loading"><div class="spinner"></div>Computing statistics...</div>';
  try {
    const data = await apiFetch(`/api/stats?file=${encodeURIComponent(filePath)}`);
    currentStats = data.stats;
    renderStats();
  } catch(e) {
    $c.innerHTML = `<div class="err">${e.message}</div>`;
  } finally {
    setTabLoading('stats', false);
  }
}

function renderStats() {
  if (!currentStats) return;
  const $c = $('tabContent');
  let html = '<div class="stats-grid">';
  for (const [col, s] of Object.entries(currentStats)) {
    html += `<div class="stat-card"><h3>${col}</h3>`;
    if (s.type === 'numeric') {
      const stats = s.stats || s;
      html += `<div class="stat-grid">
        <span class="label">Mean${tip('mean')}</span><span class="val">${stats.mean ?? s.mean}</span>
        <span class="label">Median${tip('median')}</span><span class="val">${stats.median ?? s.median}</span>
        <span class="label">Std Dev${tip('std')}</span><span class="val">${stats.std ?? s.std}</span>
        <span class="label">Variance${tip('variance')}</span><span class="val">${stats.variance ?? '\u2014'}</span>
        <span class="label">Min${tip('min')}</span><span class="val">${stats.min ?? s.min}</span>
        <span class="label">Max${tip('max')}</span><span class="val">${stats.max ?? s.max}</span>
        <span class="label">Q25${tip('q25')}</span><span class="val">${stats.q25 ?? s.q25}</span>
        <span class="label">Q75${tip('q75')}</span><span class="val">${stats.q75 ?? s.q75}</span>
        <span class="label">Skewness${tip('skewness')}</span><span class="val">${stats.skewness ?? stats.skew ?? s.skew ?? s.skewness}</span>
        <span class="label">Kurtosis${tip('kurtosis')}</span><span class="val">${stats.kurtosis ?? '\u2014'}</span>
        <span class="label">Unique${tip('unique')}</span><span class="val">${stats.unique ?? s.unique ?? stats.count}</span>
        <span class="label">Unique Ratio${tip('unique_ratio')}</span><span class="val">${stats.unique_ratio ?? '\u2014'}</span>
        <span class="label">Count${tip('count')}</span><span class="val">${stats.count ?? s.count}</span>
        <span class="label">Missing${tip('missing')}</span><span class="val" style="${(stats.missing ?? s.missing ?? 0) > 0 ? 'color:var(--orange)' : ''}">${stats.missing ?? s.missing ?? 0}</span>
      </div>`;
    } else if (s.type === 'categorical') {
      const stats = s.stats || s;
      html += `<div class="stat-grid">
        <span class="label">Unique${tip('unique')}</span><span class="val">${stats.unique_values ?? stats.unique ?? s.unique}</span>
        <span class="label">Mode${tip('mode')}</span><span class="val">${stats.mode || s.mode || '\u2014'}</span>
        <span class="label">Count${tip('count')}</span><span class="val">${stats.count ?? s.count}</span>
        <span class="label">Missing${tip('missing')}</span><span class="val" style="${(stats.missing ?? s.missing ?? 0) > 0 ? 'color:var(--orange)' : ''}">${stats.missing ?? s.missing ?? 0}</span>
      </div>`;
      const topValues = stats.frequencies || stats.top_values;
      if (topValues) {
        const entries = typeof topValues === 'object' && !Array.isArray(topValues) ? Object.entries(topValues) : (Array.isArray(topValues) ? topValues.map(v => [v, stats.frequencies?.[v] ?? 0]) : []);
        if (entries.length) {
          html += '<div style="margin-top:8px;"><div style="font-size:11px;color:var(--text2);margin-bottom:4px;">Top values</div>';
          const count = stats.count ?? s.count ?? 1;
          entries.forEach(([k, v]) => {
            const pct = count > 0 ? (v / count * 100).toFixed(1) : 0;
            const barW = Math.min(100, pct * 2);
            html += `<div style="display:flex;align-items:center;gap:6px;font-size:12px;margin-bottom:2px;">
              <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${k}</span>
              <span style="width:40px;text-align:right;color:var(--text2)">${pct}%</span>
              <span style="width:60px;height:6px;background:var(--surface2);border-radius:3px;overflow:hidden;flex-shrink:0;">
                <span style="display:block;height:100%;width:${barW}%;background:var(--accent);border-radius:3px;"></span>
              </span>
            </div>`;
          });
          html += '</div>';
        }
      }
    } else if (s.type === 'datetime') {
      const stats = s.stats || s;
      html += `<div class="stat-grid">
        <span class="label">Min${tip('min')}</span><span class="val">${stats.min || '\u2014'}</span>
        <span class="label">Max${tip('max')}</span><span class="val">${stats.max || '\u2014'}</span>
        <span class="label">Range (days)${tip('range_days')}</span><span class="val">${stats.range_days ?? '\u2014'}</span>
        <span class="label">Unique${tip('unique')}</span><span class="val">${stats.count ?? s.count}</span>
        <span class="label">Count${tip('count')}</span><span class="val">${stats.count ?? s.count}</span>
        <span class="label">Missing${tip('missing')}</span><span class="val">${stats.missing ?? s.missing ?? 0}</span>
      </div>`;
    } else {
      html += `<div class="stat-grid"><span class="label">Count${tip('count')}</span><span class="val">${s.count}</span></div>`;
    }
    html += '</div>';
  }
  html += '</div>';
  $c.innerHTML = html;
}

async function loadDataChunk(filePath, offset) {
  dataOffset = offset;
  const $c = $('tabContent');
  setTabLoading('data', true);
  $c.innerHTML = '<div class="loading"><div class="spinner"></div>Loading data...</div>';
  try {
    const data = await apiFetch(`/api/data?file=${encodeURIComponent(filePath)}&offset=${offset}&limit=${PAGE_SIZE}`);
    currentData = data.data;
    renderData();
  } catch(e) {
    $c.innerHTML = `<div class="err">${e.message}</div>`;
  } finally {
    setTabLoading('data', false);
  }
}

function renderData() {
  if (!currentData) return;
  const d = currentData;
  const totalPages = Math.ceil(d.total / PAGE_SIZE);
  const currentPage = Math.floor(d.offset / PAGE_SIZE) + 1;
  const activeFilterCount = Object.keys(currentFilters).length;

  let html = '';
  html += `<div style="display:flex;gap:8px;margin-bottom:12px;align-items:center;">
    <input id="dataSearchInput" type="text" placeholder="Search data... (Ctrl+F)"
      style="flex:1;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:9px 14px;border-radius:var(--radius);font-size:13px;font-family:inherit;outline:none;transition:border-color var(--transition);"
      onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'"
      onkeydown="if(event.key==='Enter'){event.preventDefault();runDataSearch(this.value.trim())}">
    <button class="btn" onclick="runDataSearch($('dataSearchInput').value.trim())" style="font-size:12.5px;padding:9px 16px;">Search</button>
  </div>`;
  if (filterActive) {
    html += `<div style="background:rgba(91,138,245,0.08);border:1px solid rgba(91,138,245,0.2);border-radius:var(--radius);padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
      <span style="font-size:12.5px;"><span style="color:var(--accent);font-weight:600;">Filters Active</span> &mdash; Showing ${filterFilteredRows.toLocaleString()} of ${filterTotalRows.toLocaleString()} rows</span>
      <button onclick="clearAllFilters()" style="background:var(--surface);border:1px solid var(--border);color:var(--text2);padding:4px 12px;border-radius:6px;cursor:pointer;font-size:11.5px;font-family:inherit;">Clear Filters</button>
    </div>`;
  }

  html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px;">
    <span style="font-size:13px;color:var(--text2);">Showing rows ${d.offset+1}-${Math.min(d.offset+d.rows.length, d.total)} of ${d.total.toLocaleString()}</span>
    <span style="font-size:13px;color:var(--text2);">${d.columns.length} columns${activeFilterCount > 0 ? ` &middot; <span style="color:var(--accent)">${activeFilterCount} filter${activeFilterCount > 1 ? 's' : ''}</span>` : ''}</span>
  </div>`;

  html += '<div style="overflow-x:auto;max-height:calc(100vh - 320px);overflow-y:auto;"><table><thead><tr>';
  d.columns.forEach(c => {
    const hasFilter = currentFilters[c] !== undefined;
    html += `<th style="cursor:pointer;user-select:none;position:relative;" onclick="toggleFilterDropdown(event, '${c.replace(/'/g, "\\'")}')">${c}${hasFilter ? ' <span style="color:var(--accent);font-size:9px;">&#9660;</span>' : ''}</th>`;
  });
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

  html += '<div id="filterDropdown" style="display:none;position:fixed;z-index:1000;background:var(--surface);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid var(--border);border-radius:var(--radius);padding:14px;box-shadow:var(--shadow-lg);min-width:240px;"></div>';

  $('tabContent').innerHTML = html;
}

async function runDataSearch(query) {
  if (!query || !currentFile) return;
  const $c = $('tabContent');
  $c.innerHTML = '<div class="loading"><div class="spinner"></div>Searching...</div>';
  try {
    const data = await apiFetch(`/api/search?file=${encodeURIComponent(currentFile)}&q=${encodeURIComponent(query)}`);
    const d = data.data;
    if (!d.rows.length) {
      $c.innerHTML = `<div style="padding:40px 20px;text-align:center;color:var(--text2);">
        <div style="font-size:32px;margin-bottom:12px;opacity:0.3;">&#128269;</div>
        <p>No results found for "<strong>${query}</strong>"</p>
        <button class="btn" onclick="switchTab('data')" style="margin-top:12px;font-size:12.5px;">Back to Data</button>
      </div>`;
      return;
    }
    let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
      <span style="font-size:13px;color:var(--text2);">Search results for "<strong style="color:var(--text);">${query}</strong>" &mdash; ${d.total} match${d.total !== 1 ? 'es' : ''}</span>
      <button onclick="switchTab('data')" style="background:var(--surface);border:1px solid var(--border);color:var(--text2);padding:4px 12px;border-radius:6px;cursor:pointer;font-size:11.5px;font-family:inherit;">Back to Data</button>
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
    $c.innerHTML = html;
  } catch(e) {
    $c.innerHTML = `<div class="err">${e.message}</div>`;
  }
}

function toggleFilterDropdown(e, col) {
  e.stopPropagation();
  const dd = $('filterDropdown');
  if (!dd) return;
  if (dd.style.display === 'block' && dd.dataset.col === col) {
    dd.style.display = 'none';
    return;
  }
  dd.dataset.col = col;
  const isNum = currentProfile && currentProfile.classifications && currentProfile.classifications[col] === 'Measure';
  const saved = currentFilters[col] || {};
  const savedType = saved.contains !== undefined ? 'contains' : saved.equals !== undefined ? 'equals' : (saved.min !== undefined || saved.max !== undefined) ? 'range' : 'none';

  let inner = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
    <span style="font-size:12px;font-weight:600;color:var(--text);">${col}</span>
    <span style="font-size:10px;color:var(--text3);cursor:pointer;padding:2px 6px;border-radius:4px;" onclick="closeFilterDropdown()">&#10005;</span>
  </div>`;

  if (isNum) {
    inner += `<div style="margin-bottom:8px;">
      <select id="dd_type_${col}" onchange="onDDTypeChange('${col}')" style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:6px 8px;border-radius:6px;font-size:12px;font-family:inherit;margin-bottom:8px;">
        <option value="none" ${savedType === 'none' ? 'selected' : ''}>No filter</option>
        <option value="range" ${savedType === 'range' ? 'selected' : ''}>Range (min/max)</option>
        <option value="equals" ${savedType === 'equals' ? 'selected' : ''}>Equals</option>
      </select>
      <div id="dd_range_${col}" style="display:${savedType === 'range' ? 'flex' : 'none'};gap:6px;margin-bottom:6px;">
        <input type="number" id="dd_min_${col}" placeholder="Min" value="${saved.min !== undefined ? saved.min : ''}" style="flex:1;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:6px 8px;border-radius:6px;font-size:12px;font-family:inherit;">
        <input type="number" id="dd_max_${col}" placeholder="Max" value="${saved.max !== undefined ? saved.max : ''}" style="flex:1;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:6px 8px;border-radius:6px;font-size:12px;font-family:inherit;">
      </div>
      <div id="dd_equals_${col}" style="display:${savedType === 'equals' ? 'block' : 'none'};">
        <input type="number" id="dd_eq_${col}" placeholder="Value" value="${saved.equals !== undefined ? saved.equals : ''}" style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:6px 8px;border-radius:6px;font-size:12px;font-family:inherit;">
      </div>
    </div>`;
  } else {
    inner += `<div style="margin-bottom:8px;">
      <select id="dd_type_${col}" onchange="onDDTypeChange('${col}')" style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:6px 8px;border-radius:6px;font-size:12px;font-family:inherit;margin-bottom:8px;">
        <option value="none" ${savedType === 'none' ? 'selected' : ''}>No filter</option>
        <option value="contains" ${savedType === 'contains' ? 'selected' : ''}>Contains</option>
        <option value="equals" ${savedType === 'equals' ? 'selected' : ''}>Equals</option>
      </select>
      <div id="dd_contains_${col}" style="display:${savedType === 'contains' ? 'block' : 'none'};">
        <input type="text" id="dd_cont_${col}" placeholder="Search text" value="${saved.contains !== undefined ? saved.contains : ''}" style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:6px 8px;border-radius:6px;font-size:12px;font-family:inherit;">
      </div>
      <div id="dd_equals_${col}" style="display:${savedType === 'equals' ? 'block' : 'none'};">
        <input type="text" id="dd_eq_${col}" placeholder="Exact value" value="${saved.equals !== undefined ? saved.equals : ''}" style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:6px 8px;border-radius:6px;font-size:12px;font-family:inherit;">
      </div>
    </div>`;
  }

  inner += `<div style="display:flex;gap:6px;">
    <button class="btn" onclick="applyDDFilter('${col.replace(/'/g, "\\'")}')" style="flex:1;font-size:11.5px;padding:6px 0;">Apply</button>
    <button onclick="removeDDFilter('${col.replace(/'/g, "\\'")}')" style="flex:1;background:var(--surface);border:1px solid var(--border);color:var(--text2);padding:6px 0;border-radius:var(--radius);cursor:pointer;font-size:11.5px;font-family:inherit;">Remove</button>
  </div>`;

  dd.innerHTML = inner;
  dd.style.display = 'block';
  const rect = e.target.getBoundingClientRect();
  dd.style.left = Math.min(rect.left, window.innerWidth - 260) + 'px';
  dd.style.top = (rect.bottom + 4) + 'px';
}

function closeFilterDropdown() {
  const dd = $('filterDropdown');
  if (dd) dd.style.display = 'none';
}

function onDDTypeChange(col) {
  const sel = $(`dd_type_${col}`);
  if (!sel) return;
  const v = sel.value;
  const rangeDiv = $(`dd_range_${col}`);
  const containsDiv = $(`dd_contains_${col}`);
  const equalsDiv = $(`dd_equals_${col}`);
  if (rangeDiv) rangeDiv.style.display = v === 'range' ? 'flex' : 'none';
  if (containsDiv) containsDiv.style.display = v === 'contains' ? 'block' : 'none';
  if (equalsDiv) equalsDiv.style.display = v === 'equals' ? 'block' : 'none';
}

function applyDDFilter(col) {
  const sel = $(`dd_type_${col}`);
  if (!sel) return;
  const v = sel.value;
  if (v === 'none') {
    delete currentFilters[col];
  } else if (v === 'range') {
    const min = $(`dd_min_${col}`)?.value;
    const max = $(`dd_max_${col}`)?.value;
    const filter = {};
    if (min !== '') filter.min = parseFloat(min);
    if (max !== '') filter.max = parseFloat(max);
    if (Object.keys(filter).length > 0) currentFilters[col] = filter;
    else delete currentFilters[col];
  } else if (v === 'contains') {
    const val = $(`dd_cont_${col}`)?.value;
    if (val) currentFilters[col] = { contains: val };
    else delete currentFilters[col];
  } else if (v === 'equals') {
    const val = $(`dd_eq_${col}`)?.value;
    if (val) currentFilters[col] = { equals: val };
    else delete currentFilters[col];
  }
  closeFilterDropdown();
  applyCurrentFilters();
}

function removeDDFilter(col) {
  delete currentFilters[col];
  closeFilterDropdown();
  applyCurrentFilters();
}

async function applyCurrentFilters() {
  if (!currentFile) return;
  if (Object.keys(currentFilters).length === 0) {
    try {
      await apiFetch('/api/filter-clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: currentFile }),
      });
      filterActive = false;
      filterTotalRows = 0;
      filterFilteredRows = 0;
      loadDataChunk(currentFile, 0);
    } catch(e) { console.error(e); }
    return;
  }
  try {
    const d = await apiFetch('/api/filter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: currentFile, filters: currentFilters }),
    });
    filterActive = true;
    filterTotalRows = d.total_rows;
    filterFilteredRows = d.filtered_rows;
    loadDataChunk(currentFile, 0);
  } catch(e) { console.error(e); }
}

async function clearAllFilters() {
  if (!currentFile) return;
  try {
    await apiFetch('/api/filter-clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: currentFile }),
    });
    currentFilters = {};
    filterActive = false;
    filterTotalRows = 0;
    filterFilteredRows = 0;
    loadDataChunk(currentFile, 0);
  } catch(e) { console.error(e); }
}

document.addEventListener('click', (e) => {
  const dd = $('filterDropdown');
  if (dd && dd.style.display === 'block' && !dd.contains(e.target)) {
    dd.style.display = 'none';
  }
});

function exportClean(format) {
  if (!currentFile) return;
  const url = `${API}/api/export-clean?file=${encodeURIComponent(currentFile)}&format=${format}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function loadClean(filePath) {
  const $c = $('tabContent');
  setTabLoading('clean', true);
  $c.innerHTML = '<div class="loading"><div class="spinner"></div>Cleaning data...</div>';
  try {
    const d = await apiFetch(`/api/clean?file=${encodeURIComponent(filePath)}`);
    currentClean = d;
    renderClean();
  } catch(e) { $c.innerHTML = `<div class="err">${e.message}</div>`; }
  finally { setTabLoading('clean', false); }
}

function renderClean() {
  if (!currentClean) return;
  const r = currentClean.report;
  const m = r.cleaning_metrics;
  const missBefore = r.missingness_before || {};
  let html = `<div class="profile-summary">
    <div class="metric"><div class="num">${m.before_rows}</div><div class="lbl">Rows Before${tip('rows_before')}</div></div>
    <div class="metric"><div class="num">${m.after_rows}</div><div class="lbl">Rows After${tip('rows_after')}</div></div>
    <div class="metric"><div class="num">${m.duplicates_removed}</div><div class="lbl">Duplicates${tip('duplicates')}</div></div>
    <div class="metric"><div class="num">${m.missing_imputed}</div><div class="lbl">Imputed${tip('imputed')}</div></div>
    <div class="metric"><div class="num">${m.corrupt_values_fixed}</div><div class="lbl">Corrupt Fixed${tip('corrupt_fixed')}</div></div>
    <div class="metric"><div class="num">${m.whitespace_cleaned}</div><div class="lbl">Whitespace${tip('whitespace_cleaned')}</div></div>
    <div class="metric"><div class="num">${m.type_casts_performed}</div><div class="lbl">Type Casts${tip('type_casts')}</div></div>
    <div class="metric"><div class="num">${m.outliers_detected}</div><div class="lbl">Outlier Flags${tip('outlier_flags')}</div></div>
  </div>`;
  html += '<h3 style="margin-bottom:12px;">Missingness</h3>';
  html += '<div style="overflow-x:auto;"><table><thead><tr><th>Column</th><th>Before</th><th>%</th><th>After</th><th>%</th></tr></thead><tbody>';
  const allMissCols = new Set([...Object.keys(missBefore), ...Object.keys(r.missingness_after || {})]);
  for (const col of allMissCols) {
    const b = missBefore[col] || { missing: 0, percent: 0 };
    const a = (r.missingness_after || {})[col] || { missing: 0, percent: 0 };
    html += `<tr><td><strong>${col}</strong></td>
      <td>${b.missing}</td><td>${b.percent}%</td>
      <td>${a.missing}</td><td>${a.percent}%</td></tr>`;
  }
  html += '</tbody></table></div>';

  if (r.near_zero_variance_columns && r.near_zero_variance_columns.length) {
    html += `<h3 style="margin:16px 0 8px;">Near-Zero Variance${tip('nzv')}</h3>`;
    html += `<p style="color:var(--orange);font-size:13px;">${r.near_zero_variance_columns.join(', ')}</p>`;
  }

  html += '<h3 style="margin:16px 0 8px;">Policy</h3>';
  html += `<p style="font-size:12.5px;color:var(--text2);line-height:1.5;">${r.outlier_policy || r.policy || ''}</p>`;

  const colsWithMissing = Object.keys(missBefore).filter(c => missBefore[c].missing > 0);
  if (colsWithMissing.length) {
    html += '<div style="margin-top:24px;padding-top:20px;border-top:1px solid var(--border);">';
    html += '<h3 style="margin-bottom:4px;">Custom Cleaning Rules</h3>';
    html += '<p style="font-size:12px;color:var(--text3);margin-bottom:12px;">Choose how to handle missing values for each column. Columns with no missing values are hidden.</p>';
    html += '<div style="overflow-x:auto;"><table><thead><tr><th>Column</th><th>Missing</th><th>Strategy</th><th>Custom Value</th></tr></thead><tbody>';
    colsWithMissing.forEach(col => {
      const miss = missBefore[col].missing;
      const saved = customRules[col] || 'auto';
      const isCustom = saved && typeof saved === 'object' && 'custom' in saved;
      const strategy = isCustom ? 'custom' : saved;
      const customVal = isCustom ? saved.custom : '';
      html += `<tr>
        <td><strong>${col}</strong></td>
        <td>${miss}</td>
        <td><select id="rule_${col}" onchange="onRuleChange('${col}')" style="background:var(--surface);border:1px solid var(--border);color:var(--text);padding:5px 8px;border-radius:6px;font-size:12px;font-family:inherit;">
          <option value="auto" ${strategy === 'auto' ? 'selected' : ''}>Auto</option>
          <option value="mean" ${strategy === 'mean' ? 'selected' : ''}>Mean</option>
          <option value="median" ${strategy === 'median' ? 'selected' : ''}>Median</option>
          <option value="mode" ${strategy === 'mode' ? 'selected' : ''}>Mode</option>
          <option value="drop" ${strategy === 'drop' ? 'selected' : ''}>Drop Rows</option>
          <option value="custom" ${strategy === 'custom' ? 'selected' : ''}>Custom Value</option>
        </select></td>
        <td><input id="custom_${col}" type="text" placeholder="e.g. 0, N/A" value="${customVal}" ${strategy !== 'custom' ? 'disabled' : ''} onchange="onCustomValueChange('${col}')" style="background:var(--surface);border:1px solid var(--border);color:var(--text);padding:5px 8px;border-radius:6px;font-size:12px;font-family:inherit;width:120px;${strategy !== 'custom' ? 'opacity:0.4;' : ''}"></td>
      </tr>`;
    });
    html += '</tbody></table></div>';
    html += `<div style="margin-top:12px;display:flex;gap:8px;align-items:center;">
      <button class="btn" onclick="applyCustomClean()" style="font-size:12.5px;padding:8px 18px;">Apply Custom Rules</button>
      <button onclick="resetCustomRules()" style="background:var(--surface);border:1px solid var(--border);color:var(--text2);padding:8px 18px;border-radius:var(--radius);cursor:pointer;font-size:12.5px;font-family:inherit;">Reset to Auto</button>
      <span id="customCleanStatus" style="font-size:12px;color:var(--text3);margin-left:8px;"></span>
    </div>`;
    html += '</div>';
  }

  html += `<div style="margin-top:24px;padding-top:20px;border-top:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
    <span style="font-size:13px;color:var(--text2);">Export cleaned data for further analysis:</span>
    <div style="display:flex;gap:8px;">
      <button class="btn" onclick="exportClean('csv')" style="font-size:12.5px;padding:8px 18px;">&#128190; Download CSV</button>
      <button class="btn" onclick="exportClean('xlsx')" style="font-size:12.5px;padding:8px 18px;background:linear-gradient(135deg,#34d399,#059669);">&#128190; Download Excel</button>
    </div>
  </div>`;
  $('tabContent').innerHTML = html;
}

function onRuleChange(col) {
  const sel = $(`rule_${col}`);
  const inp = $(`custom_${col}`);
  const isCustom = sel.value === 'custom';
  inp.disabled = !isCustom;
  inp.style.opacity = isCustom ? '1' : '0.4';
  if (isCustom) {
    customRules[col] = { custom: inp.value || '' };
  } else if (sel.value === 'auto') {
    delete customRules[col];
  } else {
    customRules[col] = sel.value;
  }
}

function onCustomValueChange(col) {
  const sel = $(`rule_${col}`);
  const inp = $(`custom_${col}`);
  if (sel.value === 'custom') {
    customRules[col] = { custom: inp.value };
  }
}

function resetCustomRules() {
  customRules = {};
  renderClean();
}

async function applyCustomClean() {
  if (!currentFile) return;
  const $c = $('tabContent');
  const status = $('customCleanStatus');
  if (status) status.textContent = 'Applying...';
  try {
    const d = await apiFetch('/api/clean-custom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: currentFile, rules: customRules }),
    });
    currentClean = d;
    renderClean();
  } catch(e) {
    if (status) status.textContent = 'Error: ' + e.message;
  }
}

async function loadOutliers(filePath) {
  const $c = $('tabContent');
  setTabLoading('outliers', true);
  $c.innerHTML = '<div class="loading"><div class="spinner"></div>Detecting outliers...</div>';
  try {
    const d = await apiFetch(`/api/outliers?file=${encodeURIComponent(filePath)}`);
    currentOutliers = d;
    renderOutliers();
  } catch(e) { $c.innerHTML = `<div class="err">${e.message}</div>`; }
  finally { setTabLoading('outliers', false); }
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

let activeChart = null;
let crossFilters = {};
let dndMapping = { x: null, y: null };

function destroyChart() {
  if (activeChart) { activeChart.destroy(); activeChart = null; }
}

function renderCrossFilterBanner() {
  const keys = Object.keys(crossFilters);
  const bar = $('crossFilterBar');
  if (!bar) return;
  if (keys.length === 0) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  const tags = $('crossFilterTags');
  tags.innerHTML = '';
  keys.forEach(k => {
    const v = crossFilters[k];
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.innerHTML = `${k} = ${v} <span class="rm" onclick="removeCrossFilter('${k.replace(/'/g, "\\'")}')">&times;</span>`;
    tags.appendChild(tag);
  });
}

function applyCrossFilter(col, value) {
  if (crossFilters[col] === value) {
    delete crossFilters[col];
  } else {
    crossFilters[col] = value;
  }
  syncFiltersFromCross();
  renderCrossFilterBanner();
  refreshCurrentChart();
}

function removeCrossFilter(col) {
  delete crossFilters[col];
  syncFiltersFromCross();
  renderCrossFilterBanner();
  refreshCurrentChart();
}

function clearCrossFilters() {
  crossFilters = {};
  syncFiltersFromCross();
  renderCrossFilterBanner();
  refreshCurrentChart();
}

function syncFiltersFromCross() {
  Object.keys(crossFilters).forEach(k => {
    currentFilters[k] = { equals: String(crossFilters[k]) };
  });
  Object.keys(currentFilters).forEach(k => {
    if (!(k in crossFilters)) delete currentFilters[k];
  });
}

async function refreshCurrentChart() {
  const cols = $('vizCols');
  if (cols) await genViz(cols.value.trim());
}

async function genViz(columns) {
  destroyChart();
  const target = $('vizChartResult') || $('tabContent');
  try {
    target.innerHTML = '<div class="loading"><div class="spinner"></div>Generating chart...</div>';
    if (typeof Chart === 'undefined') { target.innerHTML = '<div class="err">Chart.js library not loaded. Please refresh.</div>'; return; }
    if (!currentFile) { target.innerHTML = '<div class="err">No file selected.</div>'; return; }
    const p = columns ? '&columns=' + encodeURIComponent(columns) : '';
    const d = await apiFetch('/api/chart-data?file=' + encodeURIComponent(currentFile) + p);
    if (d.chart_type === 'none') { target.innerHTML = '<div class="err">No chart for these columns.</div>'; return; }
    const cd = d.chart_data;
    const xc = cd.x_col, yc = cd.y_col;
    const isScatter = d.chart_type === 'scatter';

    const inputEl = $('vizCols');
    if (inputEl && columns) inputEl.value = columns;

    let h = '';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">';
    h += '<span style="font-size:12.5px;color:var(--text2);">Chart: <strong>' + d.chart_type + '</strong> &mdash; ' + (cd.title || '') + (xc ? ' (' + xc + (yc ? ' vs ' + yc : '') + ')' : '') + '</span>';
    h += '<span style="font-size:11px;color:var(--text3);">Click a bar/segment to cross-filter</span>';
    h += '</div>';
    h += '<div style="position:relative;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;"><canvas id="vizCanvas" width="600" height="400"></canvas></div>';
    target.innerHTML = h;

    const canvas = document.getElementById('vizCanvas');
    if (!canvas) { target.innerHTML = '<div class="err">Canvas element not found.</div>'; return; }
    const ctx = canvas.getContext('2d');
    const labels = cd.labels || [];
    const values = cd.values || [];
    const colors = labels.map(function(_, i) {
      return (xc && crossFilters[xc] === labels[i]) ? 'rgba(139,92,246,0.9)' : 'hsla(' + ((i * 360 / labels.length) % 360) + ',65%,60%,0.75)';
    });

    if (isScatter) {
      activeChart = new Chart(ctx, {
        type: 'scatter',
        data: { datasets: [{ label: yc + ' vs ' + xc, data: cd.x.map(function(xi, i) { return {x:xi, y:cd.y[i]}; }), backgroundColor: 'rgba(91,138,245,0.5)', borderColor: 'rgba(91,138,245,0.8)', pointRadius: 4, pointHoverRadius: 7 }] },
        options: {
          responsive: true, maintainAspectRatio: true,
          onClick: function(e) { var pts = activeChart.getElementsAtEventForMode(e,'nearest',{intersect:true},false); if(!pts.length)return; var i=pts[0].index; var xv=cd.x[i],yv=cd.y[i]; if(crossFilters[xc]===xv&&crossFilters[yc]===yv){delete crossFilters[xc];delete crossFilters[yc];}else{crossFilters[xc]=xv;crossFilters[yc]=yv;} syncFiltersFromCross();renderCrossFilterBanner();refreshCurrentChart(); },
          plugins: { legend: { display: false } },
          scales: { x: { title: { display: true, text: xc, color: '#8888a8' }, ticks: { color: '#666680' }, grid: { color: 'rgba(255,255,255,0.04)' } }, y: { title: { display: true, text: yc, color: '#8888a8' }, ticks: { color: '#666680' }, grid: { color: 'rgba(255,255,255,0.04)' } } }
        }
      });
    } else {
      activeChart = new Chart(ctx, {
        type: 'bar',
        data: { labels: labels, datasets: [{ label: yc || 'Count', data: values, backgroundColor: colors, borderColor: colors.map(function(c){return c.replace(/[\d.]+\)$/,'1)');}), borderWidth: 1, borderRadius: 4 }] },
        options: {
          responsive: true, maintainAspectRatio: true,
          onClick: function(e) { var pts = activeChart.getElementsAtEventForMode(e,'nearest',{intersect:true},false); if(!pts.length)return; var i=pts[0].index; applyCrossFilter(xc, labels[i]); },
          plugins: { legend: { display: false } },
          scales: { x: { ticks: { color: '#666680', maxRotation: 45 }, grid: { display: false } }, y: { title: { display: true, text: yc || 'Count', color: '#8888a8' }, ticks: { color: '#666680' }, grid: { color: 'rgba(255,255,255,0.04)' } } }
        }
      });
    }
  } catch(e) { console.error('Chart error:', e); target.innerHTML = '<div class="err">Error: ' + e.message + '</div>'; }
}

function renderViz() {
  const cols = currentProfile ? currentProfile.column_names : [];
  const $c = $('tabContent');

  let h = '';

  h += '<div id="crossFilterBar" style="display:none;background:rgba(91,138,245,0.08);border:1px solid rgba(91,138,245,0.2);border-radius:var(--radius);padding:10px 14px;margin-bottom:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">';
  h += '<span style="font-size:12.5px;"><span style="color:var(--accent);font-weight:600;">Cross-Filter Active</span></span>';
  h += '<div id="crossFilterTags" style="display:flex;gap:6px;flex-wrap:wrap;"></div>';
  h += '<button onclick="clearCrossFilters()" style="background:var(--surface);border:1px solid var(--border);color:var(--text2);padding:4px 12px;border-radius:6px;cursor:pointer;font-size:11.5px;font-family:inherit;">Clear</button>';
  h += '</div>';

  h += '<div style="margin-bottom:16px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;">';
  h += '<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.7px;color:var(--text3);font-weight:600;margin-bottom:12px;">Drag &amp; Drop Column Mapping</div>';

  h += '<div style="margin-bottom:12px;">';
  h += '<div style="font-size:10.5px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text3);margin-bottom:6px;">Available Columns</div>';
  h += '<div id="colPool" style="display:flex;flex-wrap:wrap;gap:6px;min-height:36px;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);">';
  cols.forEach(function(c) {
    var assigned = dndMapping.x === c || dndMapping.y === c;
    if (!assigned) {
      h += '<span draggable="true" ondragstart="dragCol(event)" data-col="' + c.replace(/"/g, '&quot;') + '" class="col-pill">' + c + '</span>';
    }
  });
  h += '</div></div>';

  h += '<div style="display:flex;gap:12px;flex-wrap:wrap;">';

  ['x', 'y'].forEach(function(role) {
    var label = role === 'x' ? 'X Axis' : 'Y Axis';
    h += '<div style="flex:1;min-width:140px;"><div style="font-size:10.5px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text3);margin-bottom:6px;">' + label + '</div>';
    h += '<div id="drop' + role.toUpperCase() + '" class="drop-zone" ondrop="dropCol(event)" ondragover="allowDrop(event)" ondragenter="dragEnterZone(event)" ondragleave="dragLeaveZone(event)" data-role="' + role + '">';
    if (dndMapping[role]) {
      h += '<span class="col-pill col-pill-assigned">' + dndMapping[role] + ' <span class="col-remove" onclick="removeMapping(\'' + role + '\')">&times;</span></span>';
    } else {
      h += '<span class="drop-hint">Drop column here</span>';
    }
    h += '</div></div>';
  });

  h += '</div></div>';

  var inputVal = (dndMapping.x && dndMapping.y) ? dndMapping.x + ', ' + dndMapping.y : cols.slice(0, 3).join(', ');
  h += '<div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">';
  h += '<input id="vizCols" type="text" placeholder="Column names (comma-separated)" value="' + inputVal.replace(/"/g, '&quot;') + '" style="flex:1;min-width:200px;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:9px 14px;border-radius:var(--radius);font-size:13px;font-family:inherit;outline:none;">';
  h += '<button class="btn" onclick="genViz(document.getElementById(\'vizCols\').value.trim())">Generate</button>';
  h += '</div>';

  h += '<div id="vizChartResult"></div>';

  $c.innerHTML = h;
  renderCrossFilterBanner();
  autoGenChart();
}

function allowDrop(e) {
  e.preventDefault();
}

function dragCol(e) {
  e.dataTransfer.setData('text/plain', e.target.dataset.col);
}

function dropCol(e) {
  e.preventDefault();
  var col = e.dataTransfer.getData('text/plain');
  var el = e.target.closest('.drop-zone');
  if (!el) return;
  var role = el.dataset.role;
  if (!col || !role) return;
  if (dndMapping[role] === col) return;
  if (dndMapping.x === col) dndMapping.x = null;
  if (dndMapping.y === col) dndMapping.y = null;
  dndMapping[role] = col;
  renderViz();
}

function dragEnterZone(e) {
  var el = e.target.closest('.drop-zone');
  if (el) el.classList.add('drag-over');
}

function dragLeaveZone(e) {
  var el = e.target.closest('.drop-zone');
  if (el) el.classList.remove('drag-over');
}

function removeMapping(role) {
  dndMapping[role] = null;
  renderViz();
}

function autoGenChart() {
  var cols = [];
  if (dndMapping.x) cols.push(dndMapping.x);
  if (dndMapping.y) cols.push(dndMapping.y);
  if (cols.length) {
    var input = $('vizCols');
    if (input) input.value = cols.join(', ');
    genViz(cols.join(', '));
  }
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
  setTabLoading('segments', true);
  $c.innerHTML = '<div class="loading"><div class="spinner"></div>Exploring segments...</div>';
  try {
    const d = await apiFetch(`/api/segments?file=${encodeURIComponent(filePath)}`);
    currentSegments = d;
    renderSegments();
  } catch(e) { $c.innerHTML = `<div class="err">${e.message}</div>`; }
  finally { setTabLoading('segments', false); }
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

async function loadSmartAnalysis(filePath) {
  const $c = $('tabContent');
  setTabLoading('smart', true);
  $c.innerHTML = '<div class="loading"><div class="spinner"></div>Running Smart Analysis...</div>';
  try {
    const d = await apiFetch(`/api/smart-analysis?file=${encodeURIComponent(filePath)}`);
    currentSmart = d;
    renderSmart();
  } catch(e) { $c.innerHTML = `<div class="err">${e.message}</div>`; }
  finally { setTabLoading('smart', false); }
}

function renderSmart() {
  if (!currentSmart) return;
  const p = currentSmart.profile;
  const cp = currentSmart.clean_profile;
  const cr = currentSmart.clean_report;
  const st = currentSmart.stats;
  const ol = currentSmart.outliers;
  const charts = currentSmart.charts || [];
  const narrative = currentSmart.narrative || '';

  let html = '<h2 style="margin-bottom:16px;display:flex;align-items:center;gap:10px;"><span style="background:var(--accent-gradient);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">&#9670;</span> Smart Analysis</h2>';

  html += '<div class="profile-summary">';
  html += `<div class="metric"><div class="num">${p.rows.toLocaleString()}</div><div class="lbl">Rows${tip('rows')}</div></div>`;
  html += `<div class="metric"><div class="num">${p.columns}</div><div class="lbl">Columns${tip('columns')}</div></div>`;
  html += `<div class="metric"><div class="num">${p.completeness}%</div><div class="lbl">Completeness${tip('completeness')}</div></div>`;
  html += `<div class="metric"><div class="num">${p.total_missing}</div><div class="lbl">Missing Cells${tip('missing')}</div></div>`;
  html += `<div class="metric"><div class="num">${p.memory_mb}</div><div class="lbl">Memory (MB)${tip('memory')}</div></div>`;
  html += `<div class="metric"><div class="num">${p.numeric_columns}</div><div class="lbl">Numeric${tip('numeric')}</div></div>`;
  html += `<div class="metric"><div class="num">${p.categorical_columns}</div><div class="lbl">Categorical${tip('categorical')}</div></div>`;
  html += `<div class="metric"><div class="num">${p.date_columns}</div><div class="lbl">Date${tip('date')}</div></div>`;
  html += '</div>';
  const colNames = p.column_names || [];
  html += `<div style="margin:-12px 0 20px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;"><span style="font-size:11px;color:var(--text3);font-weight:600;margin-right:4px;">DATA COLUMNS:</span>${colNames.map(c => `<span style="font-size:12px;background:var(--surface);border:1px solid var(--border);padding:3px 10px;border-radius:6px;color:var(--text2);">${c}</span>`).join('')}</div>`;

  const m = cr.cleaning_metrics || {};
  html += '<h3 style="margin:20px 0 12px;">Cleaning Summary</h3>';
  html += '<div class="profile-summary">';
  html += `<div class="metric"><div class="num">${m.duplicates_removed ?? 0}</div><div class="lbl">Duplicates${tip('duplicates')}</div></div>`;
  html += `<div class="metric"><div class="num">${m.missing_imputed ?? 0}</div><div class="lbl">Imputed${tip('imputed')}</div></div>`;
  html += `<div class="metric"><div class="num">${m.corrupt_values_fixed ?? 0}</div><div class="lbl">Corrupt Fixed${tip('corrupt_fixed')}</div></div>`;
  html += `<div class="metric"><div class="num">${m.columns_dropped ?? 0}</div><div class="lbl">Cols Dropped${tip('cols_dropped')}</div></div>`;
  html += `<div class="metric"><div class="num">${m.outliers_detected ?? 0}</div><div class="lbl">Outlier Flags${tip('outlier_flags')}</div></div>`;
  html += '</div>';

  const olCols = Object.keys(ol.outliers || {});
  if (olCols.length) {
    html += '<h3 style="margin:20px 0 12px;">Outliers Detected</h3>';
    html += '<div style="overflow-x:auto;margin-bottom:20px;"><table><thead><tr><th>Column</th><th>Count</th><th>Percent</th><th>Method</th></tr></thead><tbody>';
    olCols.forEach(col => {
      const o = ol.outliers[col];
      html += `<tr><td><strong>${col}</strong></td><td>${o.count}</td><td>${o.percent}%</td><td>${o.method}</td></tr>`;
    });
    html += '</tbody></table></div>';
  } else {
    html += '<p style="color:var(--green);font-size:13px;margin:16px 0;">No outliers detected.</p>';
  }

  if (charts.length) {
    html += '<h3 style="margin:20px 0 12px;">Key Charts</h3>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(400px,1fr));gap:16px;margin-bottom:20px;">';
    charts.forEach(ch => {
      html += `<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;">
        <div style="font-size:12px;color:var(--text2);margin-bottom:8px;"><strong style="color:var(--text);">${ch.column}</strong> &mdash; ${ch.chart_type} (${ch.description})</div>
        <img src="data:image/png;base64,${ch.image}" style="max-width:100%;border-radius:6px;">
      </div>`;
    });
    html += '</div>';
  }

  if (narrative) {
    html += '<h3 style="margin:20px 0 12px;">Narrative Insights</h3>';
    html += '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:20px 24px;line-height:1.7;font-size:13.5px;margin-bottom:20px;">';
    const paragraphs = narrative.split('\n').filter(p => p.trim());
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

  $('tabContent').innerHTML = html;
}

function renderMerge() {
  const $c = $('tabContent');
  const available = files.length;
  const hasResult = currentMerge !== null;

  let html = '<h2 style="margin-bottom:16px;">Dataset Merging</h2>';

  if (available < 2) {
    html += '<div class="empty-state" style="padding:30px 0;"><div class="icon" style="font-size:36px;">&#128279;</div><h3>Need at least 2 datasets</h3><p>Upload or select multiple files from the sidebar, then use this tab to join them on key columns.</p></div>';
    $c.innerHTML = html;
    return;
  }

  html += '<div style="display:flex;gap:16px;flex-wrap:wrap;">';

  html += '<div style="flex:1;min-width:300px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;">';
  html += '<h3 style="font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text2);margin-bottom:12px;">Merge Configuration</h3>';

  html += '<div style="margin-bottom:10px;">';
  html += '<label style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px;">Left Dataset</label>';
  html += '<select id="mergeFile1" style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:7px 10px;border-radius:6px;font-size:12px;font-family:inherit;" onchange="onMergeFileChange()">';
  files.forEach(function(f, i) {
    html += '<option value="' + f.path.replace(/"/g, '&quot;') + '"' + (i === 0 ? ' selected' : '') + '>' + f.name + '</option>';
  });
  html += '</select>';
  html += '</div>';

  html += '<div style="margin-bottom:10px;">';
  html += '<label style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px;">Right Dataset</label>';
  html += '<select id="mergeFile2" style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:7px 10px;border-radius:6px;font-size:12px;font-family:inherit;" onchange="onMergeFileChange()">';
  files.forEach(function(f, i) {
    html += '<option value="' + f.path.replace(/"/g, '&quot;') + '"' + (i === (files.length > 1 ? 1 : 0) ? ' selected' : '') + '>' + f.name + '</option>';
  });
  html += '</select>';
  html += '</div>';

  html += '<div style="margin-bottom:10px;">';
  html += '<label style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px;">Join Type</label>';
  html += '<select id="mergeHow" style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:7px 10px;border-radius:6px;font-size:12px;font-family:inherit;">';
  html += '<option value="inner">Inner (only matching keys)</option>';
  html += '<option value="left">Left (keep all left rows)</option>';
  html += '<option value="right">Right (keep all right rows)</option>';
  html += '<option value="outer">Outer (keep all rows)</option>';
  html += '<option value="cross">Cross (Cartesian product)</option>';
  html += '</select>';
  html += '</div>';

  html += '<div id="mergeKeySection" style="margin-bottom:10px;">';
  html += '<div style="margin-bottom:8px;">';
  html += '<label style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px;">Left Key Column</label>';
  html += '<select id="mergeLeftOn" style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:7px 10px;border-radius:6px;font-size:12px;font-family:inherit;"></select>';
  html += '</div>';
  html += '<div style="margin-bottom:8px;">';
  html += '<label style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px;">Right Key Column</label>';
  html += '<select id="mergeRightOn" style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:7px 10px;border-radius:6px;font-size:12px;font-family:inherit;"></select>';
  html += '</div>';
  html += '</div>';

  html += '<div style="margin-bottom:10px;">';
  html += '<label style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px;">Output Name (optional)</label>';
  html += '<input id="mergeOutputName" type="text" placeholder="Leave blank for auto-name" style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:7px 10px;border-radius:6px;font-size:12px;font-family:inherit;">';
  html += '</div>';

  html += '<button class="btn" onclick="doMerge()" style="width:100%;font-size:13px;padding:10px;">&#128279; Merge Datasets</button>';
  html += '<div id="mergeStatus" style="margin-top:8px;font-size:12px;color:var(--text2);"></div>';

  html += '</div>';

  html += '<div id="mergeResult" style="flex:2;min-width:400px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;">';
  if (hasResult) {
    var r = currentMerge;
    html += '<h3 style="font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text2);margin-bottom:12px;">Merge Result</h3>';
    html += '<div class="profile-summary" style="margin-bottom:12px;">';
    html += '<div class="metric"><div class="num">' + r.rows_before.left.toLocaleString() + '</div><div class="lbl">Left Rows</div></div>';
    html += '<div class="metric"><div class="num">' + r.rows_before.right.toLocaleString() + '</div><div class="lbl">Right Rows</div></div>';
    html += '<div class="metric"><div class="num">' + r.rows_after.toLocaleString() + '</div><div class="lbl">Merged Rows</div></div>';
    html += '<div class="metric"><div class="num">' + r.columns.length + '</div><div class="lbl">Merged Columns</div></div>';
    html += '</div>';
    var p = r.profile;
    html += '<p style="font-size:12px;color:var(--text2);margin-bottom:8px;">Completeness: ' + p.completeness + '% &middot; ' + p.total_missing + ' missing cells</p>';
    html += '<div style="margin-bottom:10px;"><a class="btn" href="' + API + '/api/export-merge?file=' + encodeURIComponent(r.file.path) + '&format=csv" download style="font-size:11.5px;padding:6px 14px;text-decoration:none;">&#128190; Download Merged CSV</a></div>';
    if (r.sample && r.sample.rows) {
      html += '<div style="font-size:11px;color:var(--text3);margin-bottom:6px;">Preview (sample)</div>';
      html += '<div style="overflow-x:auto;max-height:300px;overflow-y:auto;"><table><thead><tr>';
      r.sample.columns.forEach(function(c) { html += '<th>' + c + '</th>'; });
      html += '</tr></thead><tbody>';
      r.sample.rows.forEach(function(row) {
        html += '<tr>';
        r.sample.columns.forEach(function(c) {
          var v = row[c];
          if (v === null || v === undefined) v = '<span style="color:var(--text2);font-style:italic;">null</span>';
          else if (typeof v === 'number') v = v.toLocaleString();
          else v = String(v);
          html += '<td>' + v + '</td>';
        });
        html += '</tr>';
      });
      html += '</tbody></table></div>';
    }
  } else {
    html += '<div class="empty-state" style="padding:30px 0;"><div class="icon" style="font-size:32px;">&#128279;</div><h3>No merge yet</h3><p>Select two files, choose join columns and type, then click <strong>Merge Datasets</strong>.</p></div>';
  }
  html += '</div>';

  html += '</div>';

  $c.innerHTML = html;
  onMergeFileChange();
}

var _mergeProfiles = {};

function onMergeFileChange() {
  var f1 = $('mergeFile1');
  var f2 = $('mergeFile2');
  var leftOn = $('mergeLeftOn');
  var rightOn = $('mergeRightOn');
  var how = $('mergeHow');
  if (!f1 || !f2 || !leftOn || !rightOn || !how) return;
  var keySection = $('mergeKeySection');
  keySection.style.display = how.value === 'cross' ? 'none' : 'block';

  var f1path = f1.value;
  var f2path = f2.value;

  var loadCols = function(sel, fpath, fallback) {
    if (currentProfile && currentFile === fpath) {
      populateSelect(sel, currentProfile.column_names);
      return;
    }
    if (_mergeProfiles[fpath]) {
      populateSelect(sel, _mergeProfiles[fpath]);
      return;
    }
    sel.innerHTML = '<option value="">Loading...</option>';
    apiFetch('/api/profile?file=' + encodeURIComponent(fpath)).then(function(d) {
      _mergeProfiles[fpath] = d.profile.column_names;
      if ($('mergeFile1') && $('mergeFile1').value === fpath && sel === leftOn) populateSelect(sel, d.profile.column_names);
      else if ($('mergeFile2') && $('mergeFile2').value === fpath && sel === rightOn) populateSelect(sel, d.profile.column_names);
      else populateSelect(sel, d.profile.column_names);
    }).catch(function() {
      sel.innerHTML = '<option value="">Error loading</option>';
    });
  };

  var populateSelect = function(sel, cols) {
    sel.innerHTML = '';
    cols.forEach(function(c) {
      var opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      sel.appendChild(opt);
    });
  };

  loadCols(leftOn, f1path);
  loadCols(rightOn, f2path);
}

async function doMerge() {
  var f1 = $('mergeFile1');
  var f2 = $('mergeFile2');
  var how = $('mergeHow');
  var leftOn = $('mergeLeftOn');
  var rightOn = $('mergeRightOn');
  var outName = $('mergeOutputName');
  var status = $('mergeStatus');
  var btn = document.querySelector('#mergeResult .btn');

  if (!f1 || !f2 || !how) return;
  if (status) status.textContent = 'Merging...';

  var payload = {
    file1: f1.value,
    file2: f2.value,
    how: how.value,
  };
  if (how.value !== 'cross') {
    if (!leftOn || !leftOn.value || !rightOn || !rightOn.value) {
      if (status) status.textContent = 'Please select key columns for both datasets.';
      return;
    }
    payload.left_on = leftOn.value;
    payload.right_on = rightOn.value;
  }
  if (outName && outName.value.trim()) {
    payload.output_name = outName.value.trim();
  }

  try {
    const data = await apiFetch('/api/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }, 60000);
    currentMerge = data;
    files.push(data.file);
    renderFileList();
    if (status) status.textContent = 'Merge complete! ' + data.rows_after.toLocaleString() + ' rows.';
    renderMerge();
  } catch(e) {
    if (status) status.textContent = 'Error: ' + e.message;
  }
}

async function loadInsights(filePath) {
  const $c = $('tabContent');
  setTabLoading('insights', true);
  $c.innerHTML = '<div class="loading"><div class="spinner"></div>Generating insights...</div>';
  try {
    const d = await apiFetch(`/api/insights?file=${encodeURIComponent(filePath)}`);
    currentInsights = d;
    renderInsights();
  } catch(e) { $c.innerHTML = `<div class="err">${e.message}</div>`; }
  finally { setTabLoading('insights', false); }
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
  let firstOk = null;
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
      if (!firstOk) firstOk = data.file;
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
  currentDirs = [];
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
  if (firstOk) {
    selectFile(firstOk.path);
    loadProfile(firstOk.path);
  }
}

async function loadDirectory(dirPath) {
  if (!await ensureServer()) return;
  currentDir = dirPath;
  const $c = $('tabContent');
  $c.innerHTML = '<div class="loading"><div class="spinner"></div>Loading files...</div>';
  try {
    const data = await apiFetch(`/api/files?path=${encodeURIComponent(dirPath)}`);
    currentDirs = data.dirs || [];
    files = data.files || [];
    selectedFiles.clear();
    renderFileList();
    const parent = dirPath.replace(/[\\/]+$/, '').split(/[\\/]/).slice(0, -1).join('/');
    const parentLabel = parent ? '<span style="cursor:pointer;color:var(--accent);" onclick="loadDirectory(\'' + parent.replace(/\\/g, '\\\\') + '\')">..</span> / ' : '';
    const dirLabel = dirPath.split(/[\\/]/).pop() || dirPath;
    $('selectAllRow').style.display = files.length ? 'flex' : 'none';
    $('fileCount').textContent = `${files.length} file${files.length !== 1 ? 's' : ''}`;
    $('dirInfo').innerHTML = `${parentLabel}${dirLabel}`;
    $('tabContent').innerHTML = files.length
      ? `<div class="empty-state" style="padding:40px;"><h3>${files.length} file${files.length !== 1 ? 's' : ''} found</h3><p>Click a file in the sidebar to explore it.</p></div>`
      : '<div class="empty-state"><div class="icon">&#128194;</div><h3>No data files</h3><p>This folder contains no supported data files (.csv, .tsv, .xlsx, .xls, .json, .parquet).</p></div>';
  } catch(e) {
    $c.innerHTML = `<div class="err">${e.message}</div>`;
  }
}

async function loadRoots() {
  if (!await ensureServer()) return;
  try {
    const data = await apiFetch('/api/roots');
    roots = data.roots || [];
    const ul = $('fileList');
    ul.innerHTML = '';
    roots.forEach(r => {
      if (r === '<not-set>') return;
      const li = document.createElement('li');
      li.innerHTML = `<span style="opacity:0.6;margin-right:4px;">&#128193;</span><span>${r}</span>`;
      li.style.cursor = 'pointer';
      li.addEventListener('click', () => loadDirectory(r));
      ul.appendChild(li);
    });
    if (!roots.length || roots[0] === '<not-set>') {
      $('dirInfo').textContent = 'No data roots configured. Set DATA_ROOT env var.';
    } else {
      $('dirInfo').textContent = `${roots.length} root${roots.length !== 1 ? 's' : ''} — click to browse`;
      if (roots[0] !== '<not-set>') loadDirectory(roots[0]);
    }
  } catch(e) {
    $('tabContent').innerHTML = `<div class="err">${e.message}</div>`;
  }
}

checkServer().then(ok => {
  if (ok) loadRoots();
  else ensureServer();
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
    if (e.key === 'o' || e.key === 'O') {
      e.preventDefault();
      pickFiles();
    } else if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      if (currentFile) {
        switchTab('data');
        setTimeout(() => {
          const inp = $('dataSearchInput');
          if (inp) { inp.focus(); inp.select(); }
        }, 100);
      }
    } else if (e.key === 'e' || e.key === 'E') {
      e.preventDefault();
      if (currentFile) exportClean('csv');
    }
  }
});
