import io, os, sys, json, glob, mimetypes, http.server, traceback, warnings, base64
from urllib.parse import urlparse, parse_qs, unquote
import pandas as pd

SAMPLE_SIZE = 8192
SEARCH_MAX_RESULTS = 200
PAGE_SIZE = 100
MAX_VIZ_COLUMNS = 5
DATA_SAMPLE_HEAD = 5
DATA_SAMPLE_TAIL = 5
DATA_SAMPLE_RANDOM = 5
RANDOM_SEED = 42
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns

from backend.profiling import profile_dataframe, classify_dataframe, schema_table, find_shared_columns, classify_column
from backend.cleaning import auto_clean, report_missingness
from backend.descriptive_stats import compute_statistics
from backend.outliers import flag_outlier_columns, OUTLIER_POLICY as OUTLIER_POLICY_STR
from backend.visualization import render_chart, chart_to_png
from backend.nlp_query import parse_nlp_query
from backend.segments import explore_segments, summarize_segments
from backend.insights import generate_narrative, generate_narrative_from_parts

warnings.filterwarnings("ignore", category=UserWarning)
sns.set_theme(style="whitegrid", palette="muted")

_file_cache = {}
_clean_cache = {}

def load_file_cached(path):
    mtime = os.path.getmtime(path)
    cached = _file_cache.get(path)
    if cached and cached[0] == mtime:
        return cached[1]
    df = load_file(path)
    _file_cache[path] = (mtime, df)
    return df


def auto_clean_cached(path, df):
    mtime = os.path.getmtime(path)
    cached = _clean_cache.get(path)
    if cached and cached[0] == mtime:
        return cached[1]
    result = auto_clean(df)
    _clean_cache[path] = (mtime, result)
    return result


def guess_delimiter(path):
    if path.endswith(".tsv"):
        return "\t"
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        sample = f.read(SAMPLE_SIZE)
    lines = sample.splitlines()
    if not lines:
        return ","
    scores = {}
    for delim in [",", ";", "\t", "|"]:
        counts = [line.count(delim) for line in lines if line.strip()]
        if counts:
            scores[delim] = np.mean(counts) / (len(counts) or 1)
    return max(scores, key=lambda k: scores[k]) if scores else ","


def load_file(path):
    ext = os.path.splitext(path)[1].lower()
    if ext in (".xlsx", ".xls"):
        return pd.read_excel(path, sheet_name=0)
    elif ext == ".csv":
        delim = guess_delimiter(path)
        return pd.read_csv(path, sep=delim, encoding="utf-8", encoding_errors="replace")
    elif ext == ".tsv":
        return pd.read_csv(path, sep="\t", encoding="utf-8", encoding_errors="replace")
    elif ext == ".json":
        return pd.read_json(path)
    elif ext == ".parquet":
        return pd.read_parquet(path)
    raise ValueError(f"Unsupported file type: {ext}")


def fmt_size(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def get_data_sample(df, offset, limit):
    total = df.shape[0]
    end = min(offset + limit, total)
    chunk = df.iloc[offset:end]
    cols = list(df.columns)
    rows = chunk.to_dict(orient='records')
    for row in rows:
        for c in cols:
            v = row[c]
            if isinstance(v, (np.integer,)):
                row[c] = int(v)
            elif isinstance(v, (np.floating,)):
                row[c] = float(v) if not np.isnan(v) else None
            elif isinstance(v, pd.Timestamp):
                row[c] = str(v)
            elif pd.isna(v) if not isinstance(v, str) else False:
                row[c] = None
    return {"columns": cols, "rows": rows, "offset": offset, "limit": limit, "total": total, "has_more": end < total}


def _sample_stratified(df, n_head=DATA_SAMPLE_HEAD, n_tail=DATA_SAMPLE_TAIL, n_random=DATA_SAMPLE_RANDOM):
    n = len(df)
    n_head = min(n_head, n)
    n_tail = min(n_tail, n)
    head_idx = list(range(n_head))
    tail_idx = list(range(max(0, n - n_tail), n))
    all_idx_set = set(head_idx) | set(tail_idx)
    mid = [i for i in range(n) if i not in all_idx_set]
    rng = np.random.default_rng(RANDOM_SEED)
    n_rand = min(n_random, len(mid))
    rand_idx = rng.choice(mid, size=n_rand, replace=False).tolist() if n_rand > 0 else []
    all_idx = sorted(all_idx_set | set(rand_idx))
    sample = df.iloc[all_idx].copy()
    tags = []
    for i in all_idx:
        tags.append("Head" if i in head_idx else "Tail" if i in tail_idx else "Random")
    sample["_sample"] = tags
    return sample

HOST = "0.0.0.0"
PORT = 8765
SERVER_TIMEOUT = 3000
UPLOAD_TIMEOUT = 60000
DATA_ROOTS = set()
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend")
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".uploads")

_mime = mimetypes.MimeTypes()
_mime.add_type("text/html", ".html")
_mime.add_type("text/css", ".css")
_mime.add_type("application/javascript", ".js")


def json_response(data, status=200):
    body = json.dumps(data, default=str).encode("utf-8")
    return status, {"Content-Type": "application/json; charset=utf-8"}, body


def error_response(msg, status=400):
    return json_response({"ok": False, "error": msg}, status)


def resolve_path(raw):
    raw = unquote(raw).strip().strip('"').strip("'")
    if os.path.isabs(raw):
        return raw
    for root in DATA_ROOTS:
        candidate = os.path.join(root, raw)
        if os.path.exists(candidate):
            return candidate
    return raw


def smart_analysis(df):
    profile = profile_dataframe(df)
    cleaned, clean_report = auto_clean(df)
    clean_profile = profile_dataframe(cleaned)
    classifications = classify_dataframe(cleaned)
    stats = compute_statistics(cleaned, classifications)
    outliers = flag_outlier_columns(cleaned)
    segments = explore_segments(cleaned, classifications)
    narrative = generate_narrative_from_parts(cleaned, stats, outliers, segments, classifications)
    numeric_cols = [c for c, t in classifications.items() if t == "Measure"][:3]
    charts = []
    for col in numeric_cols:
        rec = render_chart(cleaned, columns=[col], classifications=classifications)
        if rec.get("figure"):
            charts.append({"column": col, "chart_type": rec.get("chart_type"), "description": rec.get("reason", ""), "image": base64.b64encode(chart_to_png(rec["figure"])).decode("utf-8")})
            plt.close(rec["figure"])
    if len(numeric_cols) >= 2:
        rec = render_chart(cleaned, columns=numeric_cols[:2], classifications=classifications)
        if rec.get("figure"):
            charts.append({"column": f"{numeric_cols[0]} vs {numeric_cols[1]}", "chart_type": rec.get("chart_type"), "description": rec.get("reason", ""), "image": base64.b64encode(chart_to_png(rec["figure"])).decode("utf-8")})
            plt.close(rec["figure"])
    if not numeric_cols and list(df.columns):
        cat_cols = [c for c, t in classifications.items() if t == "Dimension"][:3]
        for col in cat_cols:
            rec = render_chart(cleaned, columns=[col], classifications=classifications)
            if rec.get("figure"):
                charts.append({"column": col, "chart_type": rec.get("chart_type"), "description": rec.get("reason", ""), "image": base64.b64encode(chart_to_png(rec["figure"])).decode("utf-8")})
                plt.close(rec["figure"])
    return {"profile": profile, "clean_profile": clean_profile, "clean_report": clean_report, "stats": stats, "outliers": outliers, "charts": charts, "narrative": narrative.get("narrative", ""), "segment_alerts": narrative.get("segment_alerts", [])}


DATA_EXTS = {".csv", ".tsv", ".xlsx", ".xls", ".json", ".parquet"}


def list_files(path):
    path = resolve_path(path)
    if os.path.isfile(path):
        ext = os.path.splitext(path)[1].lower()
        if ext not in DATA_EXTS:
            return [], []
        size = os.path.getsize(path)
        return [], [{"name": os.path.basename(path), "path": path, "size": size, "size_str": fmt_size(size)}]
    if not os.path.isdir(path):
        return [], []
    dirs = []
    files = []
    for entry in os.scandir(path):
        if entry.is_dir():
            dirs.append({"name": entry.name, "path": entry.path})
        elif entry.is_file():
            ext = os.path.splitext(entry.name)[1].lower()
            if ext in DATA_EXTS:
                st = entry.stat()
                files.append({"name": entry.name, "path": entry.path, "size": st.st_size, "size_str": fmt_size(st.st_size)})
    dirs.sort(key=lambda x: x["name"].lower())
    files.sort(key=lambda x: x["name"].lower())
    return dirs, files


class DataHandler(http.server.BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        print(f"[{self.log_date_time_string()}] {format % args}", file=sys.stderr, flush=True)

    def _send(self, status, headers, body):
        self.send_response(status)
        for k, v in headers.items():
            self.send_header(k, v)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def do_GET(self):
        try:
            self._handle_get()
        except Exception as e:
            st, hdrs, body = error_response(f"{e}\n{traceback.format_exc()}", 500)
            self._send(st, hdrs, body)

    def do_POST(self):
        try:
            self._handle_post()
        except Exception as e:
            traceback.print_exc()
            st, hdrs, body = error_response(f"{e}\n{traceback.format_exc()}", 500)
            self._send(st, hdrs, body)

    def _handle_get(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")
        params = parse_qs(parsed.query)

        if path in ("", "/", "/index.html"):
            self._send_static("index.html")
            return

        if path.startswith("/static/"):
            self._send_static(path[8:])
            return

        if path == "/api/roots":
            roots = sorted(DATA_ROOTS) if DATA_ROOTS else ["<not-set>"]
            self._send(*json_response({"ok": True, "roots": roots}))
            return

        if path == "/api/files":
            directory = params.get("path", [""])[0]
            if not directory:
                self._send(*error_response("Missing 'path' query parameter"))
                return
            dirs, files = list_files(directory)
            resolved = resolve_path(directory)
            self._send(*json_response({"ok": True, "dirs": dirs, "files": files, "directory": resolved}))
            return

        fpath = params.get("file", [""])[0]
        if not fpath:
            self._send_static(path)
            return
        fpath = resolve_path(fpath)
        if not os.path.isfile(fpath):
            self._send(*error_response(f"File not found: {fpath}"))
            return

        df = load_file_cached(fpath)

        if path == "/api/profile":
            self._send(*json_response({"ok": True, "profile": profile_dataframe(df)}))
        elif path == "/api/clean":
            cleaned, report = auto_clean_cached(fpath, df)
            self._send(*json_response({
                "ok": True, "report": report, "profile": profile_dataframe(cleaned),
                "sample": get_data_sample(_sample_stratified(cleaned), 0, 15),
            }))
        elif path == "/api/stats":
            self._send(*json_response({"ok": True, "stats": compute_statistics(df)}))
        elif path == "/api/outliers":
            self._send(*json_response({"ok": True, "outliers": flag_outlier_columns(df), "policy": OUTLIER_POLICY_STR}))
        elif path == "/api/data":
            offset = int(params.get("offset", ["0"])[0])
            limit = min(int(params.get("limit", [str(PAGE_SIZE)])[0]), 1000)
            self._send(*json_response({"ok": True, "data": get_data_sample(df, offset, limit)}))
        elif path == "/api/search":
            q = params.get("q", [""])[0].lower()
            if not q:
                self._send(*error_response("Missing 'q' parameter"))
                return
            mask = pd.Series(False, index=df.index)
            for col in df.columns:
                try:
                    mask |= df[col].astype(str).str.lower().str.contains(q, na=False)
                except Exception:
                    continue
            self._send(*json_response({"ok": True, "data": get_data_sample(df[mask], 0, SEARCH_MAX_RESULTS)}))
        elif path == "/api/visualize":
            cols_str = params.get("columns", [""])[0]
            cols = [c.strip() for c in cols_str.split(",") if c.strip()][:MAX_VIZ_COLUMNS] if cols_str else list(df.columns)
            rec = render_chart(df, columns=cols)
            resp = {"ok": True, "chart_type": rec.get("chart_type", "none"), "reason": rec.get("reason", "")}
            if rec.get("figure"):
                resp["image"] = base64.b64encode(chart_to_png(rec["figure"])).decode("utf-8")
                plt.close(rec["figure"])
            self._send(*json_response(resp))
        elif path == "/api/nlp":
            q = params.get("q", [""])[0]
            if not q:
                self._send(*error_response("Missing 'q' parameter"))
                return
            rec = parse_nlp_query(q, df)
            resp = {"ok": True, "chart_type": rec.get("chart_type", "none"), "reason": rec.get("reason", "")}
            if rec.get("figure"):
                resp["image"] = base64.b64encode(chart_to_png(rec["figure"])).decode("utf-8")
                plt.close(rec["figure"])
            self._send(*json_response(resp))
        elif path == "/api/segments":
            alerts = explore_segments(df)
            self._send(*json_response({"ok": True, "alerts": alerts, "summary": summarize_segments(df, alerts)}))
        elif path == "/api/smart-analysis":
            self._send(*json_response({"ok": True, **smart_analysis(df)}))
        elif path == "/api/export-clean":
            fmt = params.get("format", ["csv"])[0].lower()
            cleaned, _ = auto_clean_cached(fpath, df)
            base = os.path.splitext(os.path.basename(fpath))[0]
            if fmt == "xlsx":
                buf = io.BytesIO()
                cleaned.to_excel(buf, index=False, engine="openpyxl")
                body = buf.getvalue()
                ctype = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                fname = f"{base}_cleaned.xlsx"
            else:
                body = cleaned.to_csv(index=False).encode("utf-8-sig")
                ctype = "text/csv; charset=utf-8"
                fname = f"{base}_cleaned.csv"
            self._send(200, {"Content-Type": ctype, "Content-Disposition": f'attachment; filename="{fname}"'}, body)
            return
        elif path == "/api/insights":
            self._send(*json_response({"ok": True, **generate_narrative(df)}))
        else:
            self._send_static(path)

    def _handle_post(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")
        if path == "/api/upload":
            os.makedirs(UPLOAD_DIR, exist_ok=True)
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length)
            data = json.loads(raw.decode("utf-8"))
            fname = data.get("name", "upload.csv")
            content = data.get("content", "")
            fpath = os.path.join(UPLOAD_DIR, fname)
            with open(fpath, "w", encoding="utf-8") as f:
                f.write(content)
            try:
                df = load_file(fpath)
            except Exception:
                df = pd.read_csv(io.StringIO(content))
            self._send(*json_response({"ok": True, "file": {"name": fname, "path": fpath, "size": len(content), "size_str": fmt_size(len(content))}}))
        else:
            self._send(*error_response("Not found", 404))

    def _send_static(self, rel_path):
        if not rel_path or rel_path == "/":
            rel_path = "index.html"
        rel_path = rel_path.lstrip("/")
        safe = os.path.normpath(rel_path).replace("..", "").lstrip("\\")
        filepath = os.path.join(STATIC_DIR, safe)
        if not os.path.isfile(filepath):
            self._send(404, {"Content-Type": "text/plain"}, b"Not Found")
            return
        ctype, _ = _mime.guess_type(filepath)
        with open(filepath, "rb") as f:
            self._send(200, {"Content-Type": ctype or "application/octet-stream"}, f.read())


def start_server():
    global DATA_ROOTS
    for env_var in ["DATA_ROOT", "DATASETS", "DATA_DIR"]:
        val = os.environ.get(env_var)
        if val and os.path.isdir(val):
            DATA_ROOTS.add(os.path.abspath(val))
    for folder in ["~/Desktop", "~/Downloads", "~/Documents"]:
        expanded = os.path.expanduser(folder)
        if os.path.isdir(expanded):
            DATA_ROOTS.add(expanded)

    port = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    url = f"http://localhost:{port}"
    print(f"\n  {'=' * 56}", flush=True)
    print(f"     Data Explorer Server is running!", flush=True)
    print(f"     Open: {url}", flush=True)
    print(f"  {'=' * 56}\n", flush=True)

    server = http.server.HTTPServer((HOST, port), DataHandler)

    import threading
    threading.Thread(target=lambda: _open_browser(url), daemon=True).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.server_close()


def _open_browser(url):
    import webbrowser as wb
    try:
        wb.open(url)
    except Exception:
        pass


if __name__ == "__main__":
    start_server()
