#!/usr/bin/env python3
"""
Mortality Atlas — data builder (rerunnable)

Sources (UN World Population Prospects 2024, CC BY 3.0 IGO):
  - Deaths by single age & sex, Medium, 1950-2023 (estimates)  [probe copy]
  - Deaths by single age & sex, Medium, 2024-2100 (projection; only 2024-2025 kept)
  - Population by single age & sex, Medium, 1950-2023 + 2024-2100 (only 2024-2025)

Aggregation: single ages -> 22 groups:
  0, 1-4, 5-9, 10-14, ..., 95-99, 100+

Deaths values in the UN CSVs are in THOUSANDS (3 decimals) -> converted to persons (int).
Population values: header/unit asserted at runtime (see assert_population_units).
Output: data/data.json (single file if <=12MB else per-region shards + index.json),
        data/sample_totals.csv, VALIDATION.md (validation section appended by this script
        into ../VALIDATION.md — see VALIDATION_OUT).
"""
import csv
import gzip
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DL = os.path.join(ROOT, "downloads")
DATA_DIR = os.path.join(ROOT, "data")
PROBE_DEATHS_1950 = os.path.expanduser("~/workspace/deaths-data-probe/deaths_single.gz")
DEATHS_2024 = os.path.join(DL, "deaths_2024-2100.csv.gz")
POP_1950 = os.path.join(DL, "pop_1950-2023.csv.gz")
POP_2024 = os.path.join(DL, "pop_2024-2100.csv.gz")
VALIDATION_OUT = os.path.join(ROOT, "VALIDATION.md")

AGE_LABELS = ["0", "1-4"] + [f"{a}-{a+4}" for a in range(5, 100, 5)] + ["100+"]
assert len(AGE_LABELS) == 22, AGE_LABELS

# Location (UN original name) -> (code, english display, chinese display)
REGIONS = [
    ("World", "WLD", "World", "全球"),
    ("China", "CHN", "China", "中国"),
    ("United States of America", "USA", "United States", "美国"),
    ("Japan", "JPN", "Japan", "日本"),
    ("India", "IND", "India", "印度"),
    ("Indonesia", "IDN", "Indonesia", "印度尼西亚"),
    ("Brazil", "BRA", "Brazil", "巴西"),
    ("Russian Federation", "RUS", "Russia", "俄罗斯"),
    ("Mexico", "MEX", "Mexico", "墨西哥"),
    ("Germany", "DEU", "Germany", "德国"),
    ("United Kingdom", "GBR", "United Kingdom", "英国"),
    ("France", "FRA", "France", "法国"),
    ("Italy", "ITA", "Italy", "意大利"),
    ("Spain", "ESP", "Spain", "西班牙"),
    ("Republic of Korea", "KOR", "South Korea", "韩国"),
    ("Canada", "CAN", "Canada", "加拿大"),
]
LOC2CODE = {loc: code for loc, code, _, _ in REGIONS}

# Expected totals from SOURCE-REPORT.md §2 (persons)
EXPECTED = {
    "World": {1950: 48486892, 1970: 48163467, 1990: 49794345, 2000: 52240368, 2010: 54268588, 2020: 63546315, 2023: 61651608},
    "China": {1950: 12564023, 1970: 9817572, 1990: 7975056, 2000: 7780055, 2010: 8788793, 2020: 10411387, 2023: 11684178},
    "United States of America": {1950: 1479684, 1970: 1960710, 1990: 2178346, 2000: 2423914, 2010: 2502227, 2020: 3384292, 2023: 2975657},
    "Japan": {1950: 943059, 1970: 743915, 1990: 830979, 2000: 994661, 2010: 1235563, 2020: 1423308, 2023: 1524431},
}


def age_group_index(age_start: int) -> int:
    if age_start == 0:
        return 0
    if age_start <= 4:
        return 1
    if age_start >= 100:
        return 21
    return 2 + (age_start - 5) // 5


def parse_deaths(path, years_wanted):
    """Return {loc: {year: [male22, female22]}} in persons (float during accumulation)."""
    out = {}
    with gzip.open(path, "rt", encoding="utf-8-sig", newline="") as f:
        r = csv.DictReader(f)
        assert "DeathMale" in r.fieldnames and "DeathFemale" in r.fieldnames, r.fieldnames
        for row in r:
            loc = row["Location"]
            if loc not in LOC2CODE:
                continue
            year = int(row["Time"])
            if year not in years_wanted:
                continue
            g = age_group_index(int(row["AgeGrpStart"]))
            slot = out.setdefault(loc, {}).setdefault(year, [[0.0] * 22, [0.0] * 22])
            slot[0][g] += float(row["DeathMale"]) * 1000.0
            slot[1][g] += float(row["DeathFemale"]) * 1000.0
    return out


def parse_population(path, years_wanted):
    """Return {loc: {year: [male22, female22]}} in persons. Asserts header + unit."""
    out = {}
    with gzip.open(path, "rt", encoding="utf-8-sig", newline="") as f:
        r = csv.DictReader(f)
        fields = r.fieldnames
        # Real WPP2024 population-by-single-age file columns (verified at runtime):
        assert "PopMale" in fields and "PopFemale" in fields, f"unexpected pop header: {fields}"
        for row in r:
            loc = row["Location"]
            if loc not in LOC2CODE:
                continue
            year = int(row["Time"])
            if year not in years_wanted:
                continue
            g = age_group_index(int(row["AgeGrpStart"]))
            slot = out.setdefault(loc, {}).setdefault(year, [[0.0] * 22, [0.0] * 22])
            slot[0][g] += float(row["PopMale"]) * 1000.0
            slot[1][g] += float(row["PopFemale"]) * 1000.0
    return out


def assert_population_units(pop):
    """Pop values are in thousands: World year-2000 total must be ~6.17e9 persons."""
    w = pop.get("World", {}).get(2000)
    assert w is not None, "World 2000 population missing"
    total = sum(w[0]) + sum(w[1])
    print(f"[assert] World 2000 population total = {total:,.0f} persons")
    assert 6.0e9 < total < 6.35e9, f"population unit assertion failed: {total}"


def merge(dst, src):
    for loc, years in src.items():
        for y, v in years.items():
            dst.setdefault(loc, {})[y] = v
    return dst


def main():
    years_est = set(range(1950, 2024))
    years_proj = {2024, 2025}

    print("parsing deaths 1950-2023 ...")
    deaths = parse_deaths(PROBE_DEATHS_1950, years_est)
    print("parsing deaths 2024-2100 (2024-2025 only) ...")
    merge(deaths, parse_deaths(DEATHS_2024, years_proj))

    print("parsing population 1950-2023 ...")
    pop = parse_population(POP_1950, years_est)
    print("parsing population 2024-2100 (2024-2025 only) ...")
    merge(pop, parse_population(POP_2024, years_proj))
    assert_population_units(pop)

    missing = [loc for loc, *_ in REGIONS if loc not in deaths]
    if missing:
        print(f"WARNING missing locations in deaths: {missing}", file=sys.stderr)

    # ---- validation vs SOURCE-REPORT §2 ----
    val_rows = []
    all_ok = True
    for loc, exp_years in EXPECTED.items():
        for y, exp in sorted(exp_years.items()):
            m, f_ = deaths[loc][y]
            got = round(sum(m) + sum(f_))
            rel = abs(got - exp) / exp
            ok = rel < 0.001
            all_ok = all_ok and ok
            val_rows.append((loc, y, exp, got, rel, ok))
    print(f"validation all within 0.1%: {all_ok}")

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(os.path.join(DATA_DIR, "sample_totals.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["location", "year", "expected_total_deaths", "computed_total_deaths", "rel_diff_pct", "within_0.1pct"])
        for loc, y, exp, got, rel, ok in val_rows:
            w.writerow([loc, y, exp, got, f"{rel*100:.4f}", ok])

    # ---- build output structure ----
    regions_out = []
    for loc, code, en, zh in REGIONS:
        if loc not in deaths:
            continue
        years_out = {}
        for y in range(1950, 2026):
            dm, df = deaths[loc][y]
            pm, pf = pop[loc][y]
            years_out[str(y)] = [
                [round(v) for v in dm],
                [round(v) for v in df],
                [round(v) for v in pm],
                [round(v) for v in pf],
            ]
        regions_out.append({"code": code, "en": en, "zh": zh, "loc": loc, "years": years_out})

    payload = {
        "meta": {
            "source": "UN World Population Prospects 2024 (UN Population Division), Deaths & Population by single age and sex, Medium variant",
            "license": "CC BY 3.0 IGO",
            "ageLabels": AGE_LABELS,
            "years": [1950, 2025],
            "estimateYears": [1950, 2023],
            "projectionYears": [2024, 2025],
            "note": "1950-2023: UN estimates; 2024-2025: UN medium projection. Deaths/population converted from thousands to persons.",
            "yearDataFormat": "[maleDeaths[22], femaleDeaths[22], malePop[22], femalePop[22]] (persons)",
        },
        "regions": regions_out,
    }
    blob = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    size = len(blob)
    print(f"data.json size = {size/1e6:.2f} MB")
    if size <= 12_000_000:
        with open(os.path.join(DATA_DIR, "data.json"), "wb") as f:
            f.write(blob)
        # file:// fallback: fetch() is blocked on file:// in some browsers,
        # so app.js can fall back to this script-tag copy of the same payload.
        with open(os.path.join(DATA_DIR, "data.js"), "wb") as f:
            f.write(b"window.MORTALITY_DATA=")
            f.write(blob)
            f.write(b";")
        mode = "single data/data.json"
    else:
        index = {"meta": payload["meta"], "regions": []}
        for reg in regions_out:
            fn = f"{reg['code']}.json"
            with open(os.path.join(DATA_DIR, fn), "w", encoding="utf-8") as f:
                json.dump(reg, f, ensure_ascii=False, separators=(",", ":"))
            index["regions"].append({k: reg[k] for k in ("code", "en", "zh", "loc")})
        with open(os.path.join(DATA_DIR, "index.json"), "w", encoding="utf-8") as f:
            json.dump(index, f, ensure_ascii=False, separators=(",", ":"))
        mode = "sharded data/<code>.json + index.json"

    # ---- validation report ----
    lines = [
        "## 数据校验（build_data.py 自动生成）",
        "",
        f"- 输出模式：{mode}；data 体积 {size/1e6:.2f} MB",
        f"- 校验基准：SOURCE-REPORT.md §2（UN 单岁文件全龄求和）；容差 <0.1%；结论：**{'全部通过' if all_ok else '存在超差，见下表'}**",
        "",
        "| 地区 | 年 | 报告值 | 本次计算 | 相对差 | 通过 |",
        "|---|---|---|---|---|---|",
    ]
    for loc, y, exp, got, rel, ok in val_rows:
        lines.append(f"| {loc} | {y} | {exp:,} | {got:,} | {rel*100:.4f}% | {'✓' if ok else '✗'} |")
    lines.append("")
    with open(VALIDATION_OUT, "a", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print("wrote VALIDATION.md section, sample_totals.csv, data ->", mode)


if __name__ == "__main__":
    main()
