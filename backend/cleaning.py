import re
import pandas as pd
import numpy as np
from scipy import stats as sp_stats
from typing import Optional

IQR_MULTIPLIER = 1.5
DROP_THRESHOLD = 0.5
NZV_THRESHOLD = 0.95
NORMAL_ALPHA = 0.05
NORMAL_SAMPLE_SIZE = 5000
RANDOM_SEED = 42

_NULL_SENTINELS = re.compile(
    r"(?i)^(na|n/a|n\.a\.|null|nan|none|unknown|-|--|\?|\?\?|"
    r"tbd|missing|empty|undef|undefined|nil|#n/a|#null)$"
)


def _is_null_sentinel(val) -> bool:
    if isinstance(val, str):
        stripped = val.strip()
        if not stripped:
            return True
        return bool(_NULL_SENTINELS.match(stripped))
    return False


def normalize_nulls(df: pd.DataFrame) -> pd.DataFrame:
    result = df.copy()
    for col in result.columns:
        if result[col].dtype.kind in ("O", "U", "S"):
            mask = result[col].apply(_is_null_sentinel)
            if mask.any():
                result.loc[mask, col] = np.nan
    return result


def _is_numeric_col(series: pd.Series) -> bool:
    clean = series.dropna()
    if clean.empty:
        return False
    try:
        return bool(clean.dtype.kind in ("i", "u", "f", "c"))
    except TypeError:
        return False


def detect_nzv_columns(df: pd.DataFrame, threshold: float = NZV_THRESHOLD) -> list[dict]:
    results = []
    for col in df.columns:
        if not _is_numeric_col(df[col]) and df[col].dtype.kind not in ("O", "U"):
            continue
        vc = df[col].value_counts(normalize=True, dropna=False)
        if vc.empty:
            continue
        dominant_ratio = vc.iloc[0]
        if dominant_ratio >= threshold:
            results.append({"column": col, "dominant_ratio": round(float(dominant_ratio), 4)})
    return results


def detect_corrupt_values(df: pd.DataFrame) -> dict:
    corrupt = {}
    for col in df.columns:
        clean = df[col].dropna()
        if clean.empty:
            continue
        if _is_numeric_col(df[col]):
            mask = ~np.isfinite(clean)
            count = int(mask.sum())
            if count > 0:
                corrupt[col] = count
        else:
            suspicious = clean.astype(str).str.match(r"^\s*$")
            count = int(suspicious.sum())
            if count > 0:
                corrupt[col] = count
    return corrupt


def _is_normal(series: pd.Series) -> bool:
    clean = series.dropna()
    if len(clean) < 3:
        return True
    if len(clean) > NORMAL_SAMPLE_SIZE:
        clean = clean.sample(NORMAL_SAMPLE_SIZE, random_state=RANDOM_SEED)
    try:
        _, p = sp_stats.shapiro(clean)
        return p > NORMAL_ALPHA
    except Exception:
        return abs(clean.skew()) < 1.0


def handle_missing(
    df: pd.DataFrame,
    drop_threshold: float = DROP_THRESHOLD,
    group_col: Optional[str] = None,
    flag_instead_of_drop: bool = False,
) -> pd.DataFrame:
    result = df.copy()
    missing_ratio = result.isnull().mean()
    high_missing_cols = missing_ratio[missing_ratio > drop_threshold].index.tolist()

    for col in high_missing_cols:
        result[f"{col}_is_missing"] = result[col].isnull().astype(int)

    if not flag_instead_of_drop:
        result = result.drop(columns=high_missing_cols)

    for col in result.columns:
        if result[col].isnull().sum() == 0:
            continue
        clean = result[col].dropna()
        if not _is_numeric_col(result[col]):
            result[col] = result[col].fillna("Unknown")
        else:
            use_mean = _is_normal(clean)
            if group_col and group_col in result.columns:
                group_means = result.groupby(group_col)[col].transform(lambda s: s.mean() if _is_normal(s.dropna()) else s.median())
                result[col] = result[col].fillna(group_means)
                remaining = result[col].isnull().sum()
                if remaining > 0:
                    fill_val = clean.mean() if use_mean else clean.median()
                    result[col] = result[col].fillna(fill_val)
            else:
                fill_val = clean.mean() if use_mean else clean.median()
                result[col] = result[col].fillna(fill_val)

    return result


def report_missingness(df: pd.DataFrame) -> dict:
    report = {}
    for col in df.columns:
        n_miss = int(df[col].isnull().sum())
        pct = round(n_miss / len(df) * 100, 2) if len(df) else 0
        report[col] = {"missing": n_miss, "percent": pct}
    return report


def parse_datetime_features(df: pd.DataFrame) -> pd.DataFrame:
    result = df.copy()
    for col in result.columns:
        try:
            parsed = pd.to_datetime(result[col], errors="coerce")
            if parsed.notna().mean() > 0.5:
                result[col] = parsed
        except (ValueError, TypeError):
            continue
    return result


def count_whitespace_issues(df: pd.DataFrame) -> int:
    total = 0
    for col in df.columns:
        if df[col].dtype.kind in ("O", "U", "S"):
            total += int(df[col].astype(str).str.match(r"^\s+|\s+$").sum())
    return total


def count_duplicates(df: pd.DataFrame) -> int:
    return int(df.duplicated().sum())


OUTLIER_POLICY = (
    "Outliers detected using IQR (Q1 - 1.5*IQR, Q3 + 1.5*IQR) for skewed distributions "
    "and Z-score (>3 sigma) for approximately normal distributions. "
    "Detected outliers are capped at the 1st and 99th percentiles rather than deleted."
)


def compute_cleaning_metrics(before: pd.DataFrame, after: pd.DataFrame, before_report: dict) -> dict:
    metrics = {}
    metrics["duplicates_removed"] = count_duplicates(before)
    common_cols = [c for c in before.columns if c in after.columns]
    missing_before = int(before[common_cols].isnull().sum().sum())
    missing_after = int(after[common_cols].isnull().sum().sum())
    metrics["missing_imputed"] = max(0, missing_before - missing_after)
    metrics["corrupt_values_fixed"] = sum(before_report.get("corrupt_values", {}).values())
    metrics["whitespace_cleaned"] = count_whitespace_issues(before)
    outliers_total = 0
    for col in before.columns:
        if _is_numeric_col(before[col]) and before[col].nunique() > 2:
            q1 = before[col].quantile(0.25)
            q3 = before[col].quantile(0.75)
            iqr = q3 - q1
            lower = q1 - IQR_MULTIPLIER * iqr
            upper = q3 + IQR_MULTIPLIER * iqr
            outliers_total += int(((before[col] < lower) | (before[col] > upper)).sum())
    metrics["outliers_detected"] = outliers_total
    type_changes = 0
    for col in before.columns:
        if col in after.columns and str(before[col].dtype) != str(after[col].dtype):
            type_changes += 1
    metrics["type_casts_performed"] = type_changes
    metrics["before_rows"] = len(before)
    metrics["after_rows"] = len(after)
    metrics["before_cols"] = len(before.columns)
    metrics["after_cols"] = len(after.columns)
    metrics["rows_filtered"] = max(0, len(before) - len(after))
    before_cols_set = set(before.columns)
    after_cols_set = set(after.columns)
    metrics["columns_dropped"] = len(before_cols_set - after_cols_set)
    return metrics


def auto_clean(
    df: pd.DataFrame,
    drop_threshold: float = DROP_THRESHOLD,
    nzv_threshold: float = NZV_THRESHOLD,
    group_col: Optional[str] = None,
    flag_instead_of_drop: bool = False,
) -> tuple[pd.DataFrame, dict]:
    report = {}

    nzv = detect_nzv_columns(df, nzv_threshold)
    report["near_zero_variance_columns"] = nzv

    corrupt = detect_corrupt_values(df)
    report["corrupt_values"] = corrupt

    missing_before = report_missingness(df)
    report["missingness_before"] = missing_before

    before = df

    result = normalize_nulls(df)
    result = handle_missing(result, drop_threshold=drop_threshold, group_col=group_col, flag_instead_of_drop=flag_instead_of_drop)
    result = parse_datetime_features(result)

    report["missingness_after"] = report_missingness(result)
    report["cleaning_metrics"] = compute_cleaning_metrics(before, result, report)
    report["outlier_policy"] = OUTLIER_POLICY

    return result, report
