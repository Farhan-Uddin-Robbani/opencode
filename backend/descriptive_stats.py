import pandas as pd
import numpy as np
from .profiling import classify_dataframe


def numeric_summary(series: pd.Series) -> dict:
    clean = series.dropna()
    if len(clean) == 0:
        return {}
    mn, mx = float(clean.min()), float(clean.max())
    mode_val = clean.mode()
    return {
        "mean": round(float(clean.mean()), 4),
        "median": round(float(clean.median()), 4),
        "mode": mode_val.iloc[0] if not mode_val.empty else None,
        "std": round(float(clean.std(ddof=1)), 4),
        "variance": round(float(clean.var(ddof=1)), 4),
        "min": round(mn, 4),
        "max": round(mx, 4),
        "range": round(mx - mn, 4),
        "q25": round(float(clean.quantile(0.25)), 4),
        "q75": round(float(clean.quantile(0.75)), 4),
        "skewness": round(float(clean.skew()), 4),
        "kurtosis": round(float(clean.kurtosis()), 4),
        "count": int(len(clean)),
        "missing": int(series.isnull().sum()),
    }


def categorical_summary(series: pd.Series) -> dict:
    clean = series.dropna()
    total = len(clean)
    if total == 0:
        return {}
    value_counts = clean.value_counts()
    frequencies = value_counts.head(20).to_dict()
    percentages = (value_counts.head(20) / total * 100).round(2).to_dict()
    mode_val = value_counts.index[0] if not value_counts.empty else None
    return {
        "unique_values": int(clean.nunique()),
        "top_values": list(frequencies.keys()),
        "frequencies": {str(k): int(v) for k, v in frequencies.items()},
        "percentages": {str(k): float(v) for k, v in percentages.items()},
        "mode": mode_val,
        "mode_frequency": int(value_counts.iloc[0]) if not value_counts.empty else 0,
        "mode_percent": round(float(value_counts.iloc[0] / total * 100), 2),
        "count": int(total),
        "missing": int(series.isnull().sum()),
    }


def datetime_summary(series: pd.Series) -> dict:
    clean = pd.to_datetime(series, errors="coerce").dropna()
    if clean.empty:
        return {"count": 0, "missing": int(series.isnull().sum())}
    return {
        "min": str(clean.min()),
        "max": str(clean.max()),
        "range_days": int((clean.max() - clean.min()).days),
        "count": int(len(clean)),
        "missing": int(series.isnull().sum()),
    }


def compute_statistics(df: pd.DataFrame, classifications=None) -> dict:
    if classifications is None:
        classifications = classify_dataframe(df)
    results = {}
    for col in df.columns:
        cls = classifications[col]
        if cls == "Measure":
            results[col] = {"type": "numeric", "stats": numeric_summary(df[col])}
        elif cls == "Date Dimension":
            results[col] = {"type": "datetime", "stats": datetime_summary(df[col])}
        else:
            results[col] = {"type": "categorical", "stats": categorical_summary(df[col])}
    return results
