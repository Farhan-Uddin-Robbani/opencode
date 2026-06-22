from .descriptive_stats import compute_statistics
from .outliers import flag_outlier_columns
from .segments import explore_segments


def _summarize_numeric(col: str, stats: dict) -> list[str]:
    lines = []
    lines.append(
        f"'{col}' has mean={stats['mean']}, median={stats['median']}, "
        f"std={stats['std']}, range=[{stats['min']}, {stats['max']}]."
    )
    if stats["skewness"] > 1:
        lines.append(
            f"The distribution of '{col}' is right-skewed ({stats['skewness']}), "
            f"indicating a tail of high values."
        )
    elif stats["skewness"] < -1:
        lines.append(
            f"The distribution of '{col}' is left-skewed ({stats['skewness']}), "
            f"indicating a tail of low values."
        )
    else:
        lines.append(f"The distribution of '{col}' is approximately symmetric.")
    return lines


def _summarize_categorical(col: str, stats: dict) -> list[str]:
    lines = []
    lines.append(
        f"'{col}' has {stats['unique_values']} unique values. "
        f"Mode='{stats['mode']}' ({stats['mode_frequency']} times, {stats['mode_percent']}%)."
    )
    top = stats.get("top_values", [])
    if top:
        lines.append(f"Top categories: {', '.join(str(v) for v in top[:5])}.")
    return lines


def _summarize_outliers(outliers: dict) -> list[str]:
    lines = []
    for col, info in outliers.items():
        lines.append(
            f"'{col}': {info['count']} outlier(s) ({info['percent']}%) "
            f"via {info['method']}."
        )
    return lines


def _summarize_segments(alerts: list) -> list[str]:
    lines = []
    for a in alerts[:5]:
        lines.append(
            f"Segment '{a['segment_value']}' in '{a['segment_column']}' "
            f"deviates {a['direction']} on '{a['metric']}' "
            f"(global: {a['global_mean']}, segment: {a['segment_mean']})."
        )
    return lines


def generate_narrative(df) -> dict:
    desc = compute_statistics(df)
    outliers = flag_outlier_columns(df)
    segments = explore_segments(df)

    sections = []

    sections.append(f"Dataset contains {len(df)} rows and {len(df.columns)} columns.")

    numeric_lines = []
    cat_lines = []
    for col, info in desc.items():
        if info["type"] == "numeric":
            numeric_lines.extend(_summarize_numeric(col, info["stats"]))
        elif info["type"] == "categorical":
            cat_lines.extend(_summarize_categorical(col, info["stats"]))

    if numeric_lines:
        sections.append("--- Numeric Columns ---")
        sections.extend(numeric_lines)

    if cat_lines:
        sections.append("--- Categorical Columns ---")
        sections.extend(cat_lines)

    out_lines = _summarize_outliers(outliers)
    if out_lines:
        sections.append("--- Outlier Detection ---")
        sections.extend(out_lines)

    seg_lines = _summarize_segments(segments)
    if seg_lines:
        sections.append("--- Segment Alerts ---")
        sections.extend(seg_lines)

    narrative = "\n".join(sections)
    return {
        "narrative": narrative,
        "descriptives": desc,
        "outliers": outliers,
        "segment_alerts": segments,
    }
