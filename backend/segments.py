import pandas as pd
import numpy as np
from .profiling import classify_dataframe


def explore_segments(df: pd.DataFrame) -> list[dict]:
    classifications = classify_dataframe(df)
    numeric_cols = [c for c, t in classifications.items() if t == "Measure"]
    cat_cols = [c for c, t in classifications.items() if t == "Dimension"]

    alerts = []

    for metric in numeric_cols:
        global_mean = df[metric].mean()
        global_std = df[metric].std()

        if pd.isna(global_mean) or global_std == 0:
            continue

        for group_col in cat_cols:
            group_means = df.groupby(group_col)[metric].mean().dropna()
            for segment, seg_mean in group_means.items():
                deviation = abs(seg_mean - global_mean)
                if deviation > 1.5 * global_std:
                    direction = "higher" if seg_mean > global_mean else "lower"
                    alerts.append({
                        "metric": metric,
                        "segment_column": group_col,
                        "segment_value": str(segment),
                        "global_mean": round(float(global_mean), 4),
                        "segment_mean": round(float(seg_mean), 4),
                        "deviation": round(float(seg_mean - global_mean), 4),
                        "direction": direction,
                        "severity": round(float(deviation / global_std), 2),
                    })

    return alerts


def summarize_segments(df: pd.DataFrame) -> dict:
    alerts = explore_segments(df)
    if not alerts:
        return {"alerts": [], "narratives": [], "message": "No significant segment deviations found (>1.5x sigma threshold)."}

    narratives = []
    for a in alerts[:10]:
        msg = (
            f"Alert: Though overall {a['metric']} is {a['global_mean']}, "
            f"{a['metric']} on {a['segment_column']} = {a['segment_value']} "
            f"is significantly {a['direction']} at {a['segment_mean']} "
            f"(deviation: {a['deviation']:+.4f}, {a['severity']}x std)."
        )
        narratives.append(msg)

    return {"alerts": alerts, "narratives": narratives}
