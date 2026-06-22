import warnings
import pandas as pd
import numpy as np
import matplotlib
if not hasattr(matplotlib, "get_backend") or matplotlib.get_backend() == "":
    matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns
from scipy import stats as sp_stats
from .profiling import classify_column
from .cleaning import _is_normal

warnings.filterwarnings("ignore", category=UserWarning)
sns.set_theme(style="whitegrid", palette="muted")


def recommend_chart(df: pd.DataFrame, columns: list[str]) -> dict:
    if not columns:
        return {"chart_type": "none", "reason": "No columns selected"}

    numeric_cols = []
    categorical_cols = []
    for col in columns:
        if col not in df.columns:
            continue
        cls = classify_column(df[col], col)
        if cls == "Measure":
            numeric_cols.append(col)
        elif cls == "Dimension":
            categorical_cols.append(col)

    n_num = len(numeric_cols)
    n_cat = len(categorical_cols)

    if n_num == 0 and n_cat == 0:
        return {"chart_type": "none", "reason": "No plottable columns"}

    if n_num == 1:
        if _is_normal(df[numeric_cols[0]]):
            return {"chart_type": "histogram", "x": numeric_cols[0], "y": None,
                    "reason": "Single normal numeric — histogram with KDE"}
        else:
            return {"chart_type": "box", "x": numeric_cols[0], "y": None,
                    "reason": "Single skewed numeric — box plot"}

    if n_num >= 2:
        return {"chart_type": "scatter", "x": numeric_cols[0], "y": numeric_cols[1],
                "reason": "Two numeric features — scatter plot"}

    if n_cat >= 1 and n_num >= 1:
        return {"chart_type": "bar", "x": categorical_cols[0], "y": numeric_cols[0],
                "reason": "Categorical + numeric — grouped bar"}

    if n_cat >= 1:
        return {"chart_type": "bar", "x": categorical_cols[0], "y": None,
                "reason": "Categorical — frequency bar"}

    return {"chart_type": "table", "reason": "Default summary table"}


def render_chart(df: pd.DataFrame, columns: list = None) -> dict:
    if columns is None:
        columns = list(df.columns)

    rec = recommend_chart(df, columns)
    chart_type = rec["chart_type"]

    fig, ax = plt.subplots(figsize=(10, 6))

    if chart_type == "none":
        ax.text(0.5, 0.5, "No chart available", ha="center", va="center", fontsize=14)
        rec["figure"] = fig
        return rec

    if chart_type == "histogram":
        sns.histplot(df[rec["x"]].dropna(), kde=True, ax=ax)
        ax.set_title(f"Distribution of {rec['x']}")
        ax.set_xlabel(rec["x"])

    elif chart_type == "box":
        sns.boxplot(x=df[rec["x"]].dropna(), ax=ax)
        ax.set_title(f"Box Plot of {rec['x']}")
        ax.set_xlabel(rec["x"])

    elif chart_type == "scatter":
        sns.scatterplot(data=df, x=rec["x"], y=rec["y"], alpha=0.6, ax=ax)
        ax.set_title(f"{rec['y']} vs {rec['x']}")
        ax.set_xlabel(rec["x"])
        ax.set_ylabel(rec["y"])

    elif chart_type == "bar":
        x_col = rec["x"]
        y_col = rec["y"]
        if y_col and x_col != y_col:
            plot_data = df.groupby(x_col)[y_col].mean().reset_index()
            sns.barplot(data=plot_data, x=x_col, y=y_col, ax=ax)
            ax.set_title(f"Mean {y_col} by {x_col}")
            ax.set_ylabel(f"Mean {y_col}")
        else:
            counts = df[x_col].value_counts().head(20)
            sns.barplot(x=counts.index, y=counts.values, ax=ax)
            ax.set_title(f"Frequency of {x_col}")
            ax.set_ylabel("Count")
        ax.set_xticklabels(ax.get_xticklabels(), rotation=45, ha="right")
        ax.set_xlabel(x_col)

    elif chart_type == "table":
        ax.axis("off")
        tbl_data = df.describe(include="all").round(2).fillna("")
        table = ax.table(cellText=tbl_data.values, rowLabels=tbl_data.index,
                         colLabels=tbl_data.columns, loc="center",
                         cellLoc="left", rowLoc="center")
        table.auto_set_font_size(False)
        table.set_fontsize(9)
        ax.set_title("Summary Table", fontsize=14, pad=20)

    fig.tight_layout()
    rec["figure"] = fig
    return rec


def chart_to_png(fig, dpi: int = 150) -> bytes:
    buf = __import__("io").BytesIO()
    fig.savefig(buf, format="png", dpi=dpi, bbox_inches="tight")
    buf.seek(0)
    return buf.getvalue()
