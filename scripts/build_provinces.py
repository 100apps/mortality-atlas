#!/usr/bin/env python3
"""
Mortality Atlas — provincial census points builder (rerunnable)

Sources (National Bureau of Statistics of China, census table 6-1):
  - 2000 census (5th): https://www.stats.gov.cn/sj/pcsj/rkpc/5rp/html/t0601.htm
      deaths during 1999.11.1-2000.10.31, by province x age group x sex
  - 2010 census (6th): https://www.stats.gov.cn/sj/pcsj/rkpc/6rp/html/A0601a.htm
      deaths during 2009.11.1-2010.10.31, by province x age group x sex
HTML files are Excel-exported, GB2312. Layout (both years):
  col0 = province, col1-3 = total (all/male/female),
  then 22 age groups x 3 cols (subtotal/male/female), groups:
  0, 1-4, 5-9, ..., 95-99, 100+  — identical to the 22 groups used site-wide.
Output: data/provinces.json — deaths only (persons, integers, as published).
No population-by-age is taken from these tables, so no mortality rate is
computed for provinces; the frontend disables that metric in province mode.

2020: the 2020 census yearbook table 6-1 exists in print / CNKI
(《中国人口普查年鉴-2020》) but no open machine-readable provincial
age/sex death table was obtained in this build; recorded in VALIDATION.md.
"""
import json
import os
import re

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CENSUS_DIR = os.path.join(ROOT, "downloads", "census")
DATA_DIR = os.path.join(ROOT, "data")

AGE_LABELS = ["0", "1-4"] + [f"{a}-{a+4}" for a in range(5, 100, 5)] + ["100+"]
TARGETS = {  # normalised name -> display name
    "上海": "上海", "山东": "山东", "广东": "广东", "河南": "河南",
    "四川": "四川", "北京": "北京", "江苏": "江苏", "浙江": "浙江",
}

FILES = {
    2000: ("t0601_2000.htm", "https://www.stats.gov.cn/sj/pcsj/rkpc/5rp/html/t0601.htm",
           "1999.11.1-2000.10.31", "第五次全国人口普查 表6-1"),
    2010: ("A0601a_2010.htm", "https://www.stats.gov.cn/sj/pcsj/rkpc/6rp/html/A0601a.htm",
           "2009.11.1-2010.10.31", "第六次全国人口普查 表6-1"),
}


def norm_name(s: str) -> str:
    s = re.sub(r"\s+", "", str(s))
    for suf in ("省", "市", "壮族自治区", "回族自治区", "维吾尔自治区", "自治区"):
        if s.endswith(suf):
            s = s[: -len(suf)]
            break
    return s


def parse(path):
    t = pd.read_html(path, encoding="gb2312")[0]
    out = {}
    for _, row in t.iterrows():
        name = norm_name(row.iloc[0]) if pd.notna(row.iloc[0]) else ""
        if name not in TARGETS:
            continue
        vals = []
        for c in range(1, 70):
            v = row.iloc[c]
            vals.append(int(float(v)) if pd.notna(v) and str(v).strip() != "" else 0)
        total_all, total_m, total_f = vals[0], vals[1], vals[2]
        male, female = [], []
        for g in range(22):
            sub, m, f = vals[3 + g * 3: 6 + g * 3]
            assert sub == m + f, f"{name} group {g}: subtotal {sub} != {m}+{f}"
            male.append(m)
            female.append(f)
        assert sum(male) == total_m and sum(female) == total_f, \
            f"{name}: group sums {sum(male)}/{sum(female)} != totals {total_m}/{total_f}"
        out[TARGETS[name]] = {"m": male, "f": female, "total": total_all}
    return out


def main():
    provinces = {}
    meta_years = {}
    for year, (fn, url, period, table) in FILES.items():
        parsed = parse(os.path.join(CENSUS_DIR, fn))
        print(year, "provinces parsed:", sorted(parsed.keys()))
        meta_years[str(year)] = {"source": f"国家统计局 {table}", "url": url, "period": period}
        for prov, d in parsed.items():
            provinces.setdefault(prov, {})[str(year)] = d
    payload = {
        "meta": {
            "ageLabels": AGE_LABELS,
            "kind": "census",
            "note": "普查登记期（上年11.1-当年10.31）内死亡人口，国家统计局普查表6-1实测值，非全年日历年度登记数。仅有死亡数，无分年龄人口，故省级不提供死亡率指标。",
            "years": meta_years,
            "missing2020": "2020年省级分年龄性别死亡见《中国人口普查年鉴-2020》表6-1（纸质/CNKI），本项目未取得公开可机读版本，未收录。",
        },
        "provinces": provinces,
    }
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(os.path.join(DATA_DIR, "provinces.json"), "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(DATA_DIR, "provinces.js"), "w", encoding="utf-8") as f:
        f.write("window.PROVINCES_DATA=")
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";")
    print("wrote data/provinces.json:",
          {p: sorted(y.keys()) for p, y in provinces.items()})


if __name__ == "__main__":
    main()
