import re
import pandas as pd
from .profiling import classify_dataframe
from .visualization import render_chart, recommend_chart


_PATTERNS = [
    (r"(?:total|sum|average|mean|count)\s+(?:\w+\s+)*?(?:by|per|for|grouped\s+by)\s+(\w+)",
     "aggregate"),
    (r"(?:revenue|sales|amount|price|cost|value|profit)\s+(?:by|per|for|over)\s+(\w+)",
     "aggregate"),
    (r"trend\s+(?:of|in)?\s*(\w+)\s+(?:by|over|per|across)\s+(\w+)",
     "trend"),
    (r"distribution\s+(?:of|for)?\s*(\w+)",
     "distribution"),
    (r"(?:show|plot|chart|display|graph)\s+(?:me\s+)?(?:the\s+)?(\w+)\s+(?:vs|versus|against|by)\s+(\w+)",
     "scatter"),
    (r"(?:count|frequency)\s+(?:of|for)?\s*(\w+)",
     "frequency"),
]


def parse_nlp_query(query: str, df: pd.DataFrame) -> dict:
    q = query.lower()
    classifications = classify_dataframe(df)
    numeric_cols = [c for c, t in classifications.items() if t == "Measure"]
    cat_cols = [c for c, t in classifications.items() if t == "Dimension"]
    all_cols = list(df.columns)

    for pattern, action in _PATTERNS:
        m = re.search(pattern, q)
        if not m:
            continue

        if action == "aggregate":
            group_col = m.group(1)
            if group_col not in all_cols:
                group_col = next((c for c in cat_cols if c in q), cat_cols[0] if cat_cols else None)
            if not group_col:
                continue
            metric = next((c for c in numeric_cols if c in q), numeric_cols[0] if numeric_cols else None)
            if metric:
                return render_chart(df, columns=[group_col, metric])
            return render_chart(df, columns=[group_col])

        if action == "trend":
            col = m.group(1)
            time_col = m.group(2)
            if col in all_cols and time_col in all_cols:
                return render_chart(df, columns=[time_col, col])
            if col in all_cols:
                return render_chart(df, columns=[col])

        if action == "distribution":
            col = m.group(1)
            if col in all_cols:
                return render_chart(df, columns=[col])

        if action == "scatter":
            c1, c2 = m.group(1), m.group(2)
            if c1 in all_cols and c2 in all_cols:
                return render_chart(df, columns=[c1, c2])

        if action == "frequency":
            col = m.group(1)
            if col in all_cols:
                return render_chart(df, columns=[col])

    return recommend_chart(df, list(df.columns))


QUICK_REFERENCE = """
| Pattern | Example |
|---|---|
| Aggregate by category | "total revenue by region" |
| Distribution of column | "distribution of customer_age" |
| Trend over time | "trend of revenue by date" |
| Scatter comparison | "show price vs rating" |
| Frequency count | "count of category" |
"""
