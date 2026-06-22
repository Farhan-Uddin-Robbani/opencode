import numpy as np
import pandas as pd
from scipy import stats


OUTLIER_POLICY = (
    "IQR (Q1 - 1.5*IQR, Q3 + 1.5*IQR) for skewed distributions; "
    "Z-score (>3 sigma) for approximately normal distributions. "
    "Capped at 1st/99th percentile."
)


def _is_approximately_normal(series: pd.Series, alpha: float = 0.05) -> bool:
    clean = series.dropna()
    if len(clean) < 3:
        return False
    if len(clean) > 5000:
        clean = clean.sample(5000, random_state=42)
    try:
        _, p = stats.shapiro(clean)
        return p > alpha
    except Exception:
        skew = abs(clean.skew())
        kurt = abs(clean.kurtosis())
        return skew < 1.0 and kurt < 3.0


def detect_outliers_zscore(series: pd.Series, threshold: float = 3.0) -> pd.Series:
    clean = series.dropna()
    if len(clean) < 2:
        return pd.Series(False, index=series.index)
    z = np.abs(stats.zscore(clean, ddof=1))
    outlier_mask = pd.Series(False, index=clean.index)
    outlier_mask[z > threshold] = True
    full = pd.Series(False, index=series.index)
    full[outlier_mask.index] = outlier_mask
    return full


def detect_outliers_iqr(series: pd.Series) -> pd.Series:
    clean = series.dropna()
    if len(clean) < 4:
        return pd.Series(False, index=series.index)
    q1 = clean.quantile(0.25)
    q3 = clean.quantile(0.75)
    iqr = q3 - q1
    lower = q1 - 1.5 * iqr
    upper = q3 + 1.5 * iqr
    mask = (clean < lower) | (clean > upper)
    full = pd.Series(False, index=series.index)
    full[mask.index[mask]] = True
    return full


def detect_outliers(series: pd.Series) -> tuple[pd.Series, str]:
    clean = series.dropna()
    if len(clean) < 4:
        return pd.Series(False, index=series.index), "insufficient_data"
    if _is_approximately_normal(clean):
        return detect_outliers_zscore(clean), "zscore"
    else:
        return detect_outliers_iqr(clean), "iqr"


def flag_outlier_columns(df: pd.DataFrame) -> dict:
    results = {}
    for col in df.columns:
        try:
            if not np.issubdtype(df[col].dropna().dtype, np.number):
                continue
        except (TypeError, ValueError):
            continue
        mask, method = detect_outliers(df[col])
        n_outliers = int(mask.sum())
        if n_outliers > 0:
            is_normal = method == "zscore"
            results[col] = {
                "count": n_outliers,
                "percent": round(n_outliers / max(len(df), 1) * 100, 2),
                "method": "Z-score (normal)" if is_normal else "IQR (skewed)",
                "is_normal": is_normal,
            }
    return results
