"""
D+1 Self-Learning Forecast milestone (Aug 2026).

Trains the two-stage (magnitude + shape) D+1 correction model and runs a
head-to-head LightGBM-vs-XGBoost comparison, exporting the winning family
to ONNX for inference from the existing Next.js runtime
(`lib/forecast/ml/ml-correction.ts`, via `onnxruntime-node`).

Input: `data/training-dataset.json`, produced by
`apps/web/scripts/ml/export-training-dataset.ts` — already a fully-built
numeric feature matrix (see that script's own doc comment for why this file
never reimplements feature construction itself: the exact same
`buildFeatureVector`/`buildDailyFeatureVector` TypeScript functions build
both the training rows here and the live inference input, so there is no
train/serve skew to keep two implementations in sync for).

Validation is walk-forward: rows are sorted chronologically by date and
split into an EARLIER training window and a STRICTLY LATER holdout window
(no random shuffling, no day ever appears in both). The holdout window is
what family selection and every reported metric is based on. Once the
winning family is chosen, it is refit on the FULL dataset (train + holdout)
for the model actually deployed — standard practice: holdout decides which
family wins, then every available row trains the artifact that ships.

Output: `data/magnitude_model.onnx`, `data/shape_model.onnx`,
`data/model-manifest.json` (metrics, hyperparameters, data provenance) for
the TypeScript side to register in `ForecastModelVersion`.
"""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import lightgbm as lgb
import xgboost as xgb
from onnxmltools import convert_lightgbm, convert_xgboost
from onnxmltools.convert.common.data_types import FloatTensorType

DATA_DIR = Path(__file__).parent / "data"
HOLDOUT_FRACTION = 0.2
CAPACITY_BOUND_MARGIN = 0.0  # forecastKw is bounded to [0, capacityKw] exactly, no slack


def load_dataset():
    with open(DATA_DIR / "training-dataset.json", "r") as f:
        data = json.load(f)
    return data


def chronological_split(dates: pd.Series, holdout_fraction: float):
    """Walk-forward split: earlier dates train, strictly later dates holdout. No shuffling."""
    unique_dates = sorted(dates.unique())
    split_index = int(len(unique_dates) * (1 - holdout_fraction))
    train_dates = set(unique_dates[:split_index])
    holdout_dates = set(unique_dates[split_index:])
    return train_dates, holdout_dates


def train_candidate(family: str, X_train, y_train, w_train, X_holdout, y_holdout):
    """Trains one candidate family on the training window, evaluates on the holdout window."""
    if family == "LIGHTGBM":
        model = lgb.LGBMRegressor(
            n_estimators=200,
            num_leaves=15,
            learning_rate=0.05,
            min_child_samples=10,
            reg_alpha=0.1,
            reg_lambda=0.1,
            verbose=-1,
        )
        model.fit(X_train, y_train, sample_weight=w_train)
    elif family == "XGBOOST":
        model = xgb.XGBRegressor(
            n_estimators=200,
            max_depth=4,
            learning_rate=0.05,
            reg_alpha=0.1,
            reg_lambda=0.1,
            missing=np.nan,
        )
        model.fit(X_train, y_train, sample_weight=w_train)
    else:
        raise ValueError(f"unknown family {family}")

    pred_holdout = model.predict(X_holdout)
    mae = float(np.mean(np.abs(pred_holdout - y_holdout)))
    rmse = float(np.sqrt(np.mean((pred_holdout - y_holdout) ** 2)))
    bias = float(np.mean(pred_holdout - y_holdout))
    return model, {"mae": mae, "rmse": rmse, "bias": bias}, pred_holdout


def refit_full(family: str, X_all, y_all, w_all):
    if family == "LIGHTGBM":
        model = lgb.LGBMRegressor(
            n_estimators=200, num_leaves=15, learning_rate=0.05, min_child_samples=10, reg_alpha=0.1, reg_lambda=0.1, verbose=-1
        )
    else:
        model = xgb.XGBRegressor(n_estimators=200, max_depth=4, learning_rate=0.05, reg_alpha=0.1, reg_lambda=0.1, missing=np.nan)
    model.fit(X_all, y_all, sample_weight=w_all)
    return model


def to_onnx(model, family: str, n_features: int):
    initial_types = [("input", FloatTensorType([None, n_features]))]
    if family == "LIGHTGBM":
        return convert_lightgbm(model.booster_, initial_types=initial_types)
    else:
        return convert_xgboost(model.get_booster(), initial_types=initial_types)


def compute_d1_metrics(rows_df: pd.DataFrame, forecast_col: str, actual_col: str):
    """Interval-level D+1 metrics: MAE, RMSE, bias, plus daily-energy/peak error grouped per plant-day."""
    mae = float(np.mean(np.abs(rows_df[forecast_col] - rows_df[actual_col])))
    rmse = float(np.sqrt(np.mean((rows_df[forecast_col] - rows_df[actual_col]) ** 2)))
    bias = float(np.mean(rows_df[forecast_col] - rows_df[actual_col]))

    # Multi-Horizon milestone: group by horizonTier too - the same (plantId, date) now has up to
    # 3 distinct rows (one per simulated lead-time scenario), which must never be pooled together
    # into one fake "day" (that would silently sum SHORT + MEDIUM + LONG intervals for the same
    # calendar day into a single nonsensical daily total/peak).
    group_keys = ["plantId", "date", "horizonTier"] if "horizonTier" in rows_df.columns else ["plantId", "date"]
    daily = rows_df.groupby(group_keys).apply(
        lambda g: pd.Series(
            {
                "forecastKwh": g[forecast_col].sum() * 0.25,
                "actualKwh": g[actual_col].sum() * 0.25,
                "forecastPeak": g[forecast_col].max(),
                "actualPeak": g[actual_col].max(),
            }
        ),
        include_groups=False,
    )
    daily["energyErrPct"] = np.where(daily["actualKwh"] > 0, (daily["forecastKwh"] - daily["actualKwh"]) / daily["actualKwh"] * 100, np.nan)
    daily["peakErrKw"] = np.abs(daily["forecastPeak"] - daily["actualPeak"])

    return {
        "intervalMaeKw": mae,
        "intervalRmseKw": rmse,
        "biasKw": bias,
        "dailyEnergyErrPctMean": float(daily["energyErrPct"].dropna().abs().mean()) if len(daily) else None,
        "peakMaeKw": float(daily["peakErrKw"].mean()) if len(daily) else None,
        "nIntervalRows": int(len(rows_df)),
        "nDays": int(len(daily)),
    }


def main():
    print("Loading dataset...")
    data = load_dataset()
    interval_names = data["intervalFeatureNames"]
    daily_names = data["dailyFeatureNames"]

    interval_df = pd.DataFrame(data["intervalRows"])
    daily_df = pd.DataFrame(data["dailyRows"])
    print(f"Interval rows: {len(interval_df)}, daily rows: {len(daily_df)}")
    print(f"True vintage days: {data['trueVintageDays']}, retrospective replay days: {data['replayDays']}")

    if len(interval_df) == 0:
        print("No training data available - nothing to train. Exiting without producing a model.")
        sys.exit(1)

    train_dates, holdout_dates = chronological_split(interval_df["date"], HOLDOUT_FRACTION)
    print(f"Walk-forward split: {len(train_dates)} training days, {len(holdout_dates)} holdout days (strictly later, chronological)")

    # ---------- Stage 1: daily magnitude ----------
    daily_X = np.array(daily_df["features"].tolist(), dtype=np.float32)
    daily_y = daily_df["label"].to_numpy(dtype=np.float32)
    daily_w = daily_df["sourceWeight"].to_numpy(dtype=np.float32)
    daily_train_mask = daily_df["date"].isin(train_dates).to_numpy()
    daily_holdout_mask = daily_df["date"].isin(holdout_dates).to_numpy()

    stage1_results = {}
    for family in ["LIGHTGBM", "XGBOOST"]:
        _, metrics, _ = train_candidate(
            family,
            daily_X[daily_train_mask],
            daily_y[daily_train_mask],
            daily_w[daily_train_mask],
            daily_X[daily_holdout_mask],
            daily_y[daily_holdout_mask],
        )
        stage1_results[family] = metrics
        print(f"Stage 1 ({family}) holdout: MAE={metrics['mae']:.3f} kWh RMSE={metrics['rmse']:.3f} bias={metrics['bias']:.3f}")

    stage1_winner = min(stage1_results, key=lambda f: stage1_results[f]["mae"])
    print(f"Stage 1 winner: {stage1_winner}")

    # ---------- Stage 2: interval shape residual ----------
    interval_X = np.array(interval_df["features"].tolist(), dtype=np.float32)
    interval_y = interval_df["label"].to_numpy(dtype=np.float32)
    interval_w = interval_df["sourceWeight"].to_numpy(dtype=np.float32)
    interval_train_mask = interval_df["date"].isin(train_dates).to_numpy()
    interval_holdout_mask = interval_df["date"].isin(holdout_dates).to_numpy()

    stage2_results = {}
    stage2_holdout_preds = {}
    for family in ["LIGHTGBM", "XGBOOST"]:
        _, metrics, pred = train_candidate(
            family,
            interval_X[interval_train_mask],
            interval_y[interval_train_mask],
            interval_w[interval_train_mask],
            interval_X[interval_holdout_mask],
            interval_y[interval_holdout_mask],
        )
        stage2_results[family] = metrics
        stage2_holdout_preds[family] = pred
        print(f"Stage 2 ({family}) holdout: MAE={metrics['mae']:.3f} kW RMSE={metrics['rmse']:.3f} bias={metrics['bias']:.3f}")

    stage2_winner = min(stage2_results, key=lambda f: stage2_results[f]["mae"])
    print(f"Stage 2 winner: {stage2_winner}")

    # ---------- Combined D+1 holdout evaluation (physical + two-stage correction, bounded) ----------
    holdout_df = interval_df[interval_holdout_mask].copy()
    holdout_df["mlForecastKw"] = np.clip(holdout_df["physicalKw"] + stage2_holdout_preds[stage2_winner], 0, holdout_df["capacityKw"])
    holdout_df["physicalOnlyKw"] = holdout_df["physicalKw"]

    combined_metrics = compute_d1_metrics(holdout_df, "mlForecastKw", "actualKw")
    physical_baseline_metrics = compute_d1_metrics(holdout_df, "physicalOnlyKw", "actualKw")
    print(f"\nHoldout D+1 combined (physical + winning two-stage correction): {combined_metrics}")
    print(f"Holdout D+1 physical-only baseline (for reference):            {physical_baseline_metrics}")

    per_plant_metrics = {}
    for plant_id, g in holdout_df.groupby("plantId"):
        per_plant_metrics[plant_id] = {
            "ml": compute_d1_metrics(g, "mlForecastKw", "actualKw"),
            "physicalOnly": compute_d1_metrics(g, "physicalOnlyKw", "actualKw"),
        }

    per_regime_metrics = {}
    for regime, g in holdout_df.groupby("weatherRegime"):
        per_regime_metrics[regime] = {
            "ml": compute_d1_metrics(g, "mlForecastKw", "actualKw"),
            "physicalOnly": compute_d1_metrics(g, "physicalOnlyKw", "actualKw"),
        }

    # Multi-Horizon milestone: "combined" above pools SHORT/MEDIUM/LONG together (D+1 is the
    # majority of rows and therefore dominates that pooled number, but LONG-tier rows are real
    # rows in the same holdout, not a separate evaluation run) - this breaks the SAME holdout out
    # by horizonTier so D+1 maturity is never mistaken for "the whole model is this good at every
    # lead time." A horizon with very few holdout rows is flagged, never silently averaged in as
    # if it had equal evidence.
    per_horizon_metrics = {}
    for tier, g in holdout_df.groupby("horizonTier"):
        per_horizon_metrics[tier] = {
            "ml": compute_d1_metrics(g, "mlForecastKw", "actualKw"),
            "physicalOnly": compute_d1_metrics(g, "physicalOnlyKw", "actualKw"),
        }
    print("\nPer-horizon-tier holdout metrics:")
    for tier, m in per_horizon_metrics.items():
        print(f"  {tier}: ML MAE={m['ml']['intervalMaeKw']:.3f}kW ({m['ml']['nDays']}d/{m['ml']['nIntervalRows']}r) vs physical-only MAE={m['physicalOnly']['intervalMaeKw']:.3f}kW")

    # ---------- Refit winners on the FULL dataset for the deployed artifact ----------
    print("\nRefitting winning families on the full dataset for deployment...")
    stage1_final = refit_full(stage1_winner, daily_X, daily_y, daily_w)
    stage2_final = refit_full(stage2_winner, interval_X, interval_y, interval_w)

    stage1_onnx = to_onnx(stage1_final, stage1_winner, len(daily_names))
    stage2_onnx = to_onnx(stage2_final, stage2_winner, len(interval_names))

    with open(DATA_DIR / "magnitude_model.onnx", "wb") as f:
        f.write(stage1_onnx.SerializeToString())
    with open(DATA_DIR / "shape_model.onnx", "wb") as f:
        f.write(stage2_onnx.SerializeToString())

    manifest = {
        "featureSchemaVersion": data["featureSchemaVersion"],
        "stage1Family": stage1_winner,
        "stage2Family": stage2_winner,
        "trainingDataStart": min(interval_df["date"]),
        "trainingDataEnd": max(interval_df["date"]),
        "trainingSampleCount": int(len(interval_df)),
        "trueVintageSampleCount": int((interval_df["dataSource"] == "TRUE_VINTAGE").sum()),
        "plantsCovered": sorted(interval_df["plantId"].unique().tolist()),
        "holdoutTrainDays": len(train_dates),
        "holdoutTestDays": len(holdout_dates),
        "validationMetrics": {
            "stage1HeadToHead": stage1_results,
            "stage2HeadToHead": stage2_results,
            "combinedD1Holdout": combined_metrics,
            "physicalBaselineHoldout": physical_baseline_metrics,
            "perPlant": per_plant_metrics,
            "perWeatherRegime": per_regime_metrics,
            "perHorizonTier": per_horizon_metrics,
            # Multi-Horizon milestone: maturity tracked PER TIER, never one aggregate number
            # pretending every horizon is equally learned - see this milestone's own explicit
            # requirement. Lives inside validationMetrics (the existing free-form diagnostics
            # container) rather than as new dedicated ForecastModelVersion columns.
            "trueVintageSampleCountByTier": {
                tier: int(((interval_df["dataSource"] == "TRUE_VINTAGE") & (interval_df["horizonTier"] == tier)).sum())
                for tier in interval_df["horizonTier"].unique()
            },
            "trainingSampleCountByTier": {
                tier: int((interval_df["horizonTier"] == tier).sum()) for tier in interval_df["horizonTier"].unique()
            },
        },
        "hyperparameters": {
            "stage1": {"n_estimators": 200, "learning_rate": 0.05},
            "stage2": {"n_estimators": 200, "learning_rate": 0.05},
        },
    }

    with open(DATA_DIR / "model-manifest.json", "w") as f:
        json.dump(manifest, f, indent=2, default=str)

    print(f"\nWrote magnitude_model.onnx, shape_model.onnx, model-manifest.json to {DATA_DIR}")
    print(f"Winner: Stage1={stage1_winner}, Stage2={stage2_winner}")


if __name__ == "__main__":
    main()
