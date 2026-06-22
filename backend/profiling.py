import re
import pandas as pd
import numpy as np

UNIQUE_RATIO_DIMENSION = 0.05
DATETIME_MATCH_RATE = 0.8
DATETIME_PARSE_RATE = 0.5
DATETIME_REGEX = re.compile(r"^\d{4}[-/]\d{2}[-/]\d{2}(\s\d{2}:\d{2}(:\d{2})?)?$")


def classify_column(series: pd.Series, name: str = "") -> str:
    series = series.dropna()
    if series.empty:
        return "Dimension"
    n = len(series)
    unique_ratio = series.nunique() / n
    try:
        if np.issubdtype(series.dtype, np.number):
            if unique_ratio < UNIQUE_RATIO_DIMENSION:
                return "Dimension"
            return "Measure"
    except (TypeError, ValueError):
        pass
    SAMPLE_SIZE = 100
    sample = series.astype(str).iloc[:SAMPLE_SIZE]
    if sample.empty:
        return "Dimension"
    match_rate = sample.str.match(DATETIME_REGEX).mean()
    if match_rate > DATETIME_MATCH_RATE:
        return "Date Dimension"
    try:
        parsed = pd.to_datetime(series, errors="coerce")
        if parsed.notna().mean() > DATETIME_PARSE_RATE:
            return "Date Dimension"
    except (ValueError, TypeError):
        pass
    return "Dimension"


def classify_dataframe(df: pd.DataFrame) -> dict:
    return {col: classify_column(df[col], col) for col in df.columns}


def profile_dataframe(df: pd.DataFrame) -> dict:
    classifications = classify_dataframe(df)
    missing_summary = {col: int(df[col].isnull().sum()) for col in df.columns}
    total_cells = df.shape[0] * df.shape[1]
    filled = int(df.notna().sum().sum())
    return {
        "rows": df.shape[0],
        "columns": df.shape[1],
        "total_cells": total_cells,
        "filled_cells": filled,
        "completeness": round(filled / total_cells * 100, 2) if total_cells else 0,
        "memory_mb": round(df.memory_usage(deep=True).sum() / 1024**2, 2),
        "dtypes": {col: str(df[col].dtype) for col in df.columns},
        "classifications": classifications,
        "missing_summary": missing_summary,
        "total_missing": sum(missing_summary.values()),
        "column_names": list(df.columns),
        "numeric_columns": sum(1 for c in classifications if classifications[c] == "Measure"),
        "categorical_columns": sum(1 for c in classifications if classifications[c] == "Dimension"),
        "date_columns": sum(1 for c in classifications if classifications[c] == "Date Dimension"),
    }


def find_shared_columns(files_data: dict[str, pd.DataFrame]) -> dict:
    col_files = {}
    for fname, df in files_data.items():
        for c in df.columns:
            col_files.setdefault(c, []).append(fname)
    return {c: files for c, files in col_files.items() if len(files) > 1}


def schema_table(df: pd.DataFrame, profile: dict) -> list[dict]:
    rows = []
    for col in df.columns:
        cls = profile["classifications"].get(col, "N/A")
        dtype = profile["dtypes"].get(col, "N/A")
        n_miss = profile["missing_summary"].get(col, 0)
        p_miss = round(n_miss / len(df) * 100, 2) if len(df) else 0
        rows.append({"Column": col, "Type": cls, "Dtype": dtype, "Missing": n_miss, "Missing %": p_miss})
    return rows
