# 死亡人口图谱 · Mortality Atlas (1950–2025)

历年分年龄、分性别死亡人口的交互网页：死亡金字塔随年份播放/暂停/拖动，指标三档切换
（死亡人数 / 死亡占比 / 年龄别死亡率‰），底部逐年龄组明细表可下载 CSV。

## 覆盖

- **国家级**：全球 + 中国、美国、日本、印度、印度尼西亚、巴西、俄罗斯、墨西哥、德国、
  英国、法国、意大利、西班牙、韩国、加拿大（共 16 个），1950–2025 年，22 个年龄组
  （0、1–4、5–9、…、95–99、100+）。1950–2023 为 UN 估计，2024–2025 为 UN 中位预测（页面有徽标）。
- **中国省级**：上海、山东、广东、河南、四川、北京、江苏、浙江 8 省，仅 2000 / 2010
  两个普查年份有官方分年龄性别死亡数据（国家统计局人口普查表 6-1 实测）。
  省级逐年年龄别数据官方未公开连续序列，页面与方法区有诚实说明；省级无分年龄人口，不提供死亡率。

## 数据来源与口径

- UN *World Population Prospects 2024*（联合国人口司），Deaths / Population by single age
  and sex, Medium 口径，CC BY 3.0 IGO。原始值为千人，本项目换算为个人并由单岁聚合为 5 岁组。
- 交叉验证：UN 估计与各国登记终值差异——美国 ±2% 内（2023 −3.7%）、日本 +1.3%～+4.2%、
  中国 −7.8%～+5.3%（详见 `VALIDATION.md` 与页面方法区）。
- 死亡占比 = 某组死亡 ÷ 当年总死亡；死亡率 = 某组死亡 ÷ 同组年中人口 ×1000（‰）。

## 本地运行

纯静态、零构建、无外部 CDN：

```bash
python3 -m http.server 8000   # 打开 http://localhost:8000
```

直接双击 `index.html`（file://）亦可：fetch 失败时自动回退到 `data/*.js` 副本加载。

## 复跑数据管线

```bash
python3 scripts/build_provinces.py   # 普查 HTML（downloads/census/）-> data/provinces.json
python3 scripts/build_data.py        # UN gz -> data/data.json + sample_totals.csv + VALIDATION.md 校验节
```

UN 大文件下载注意：`population.un.org` 对整文件 GET 间歇返回 SPA 页（404），
`scripts/download_range.sh` 用分片 Range + 逐片校验拼接，是本环境验证可靠的方式。
原始下载件在 `downloads/`（已被 .gitignore 排除，不入库）。

## 校验

见 `VALIDATION.md`：World/China/USA/Japan 七个基准年总死亡与独立求和报告逐项对账（容差 <0.1%），
省级每省小计=男+女、分组和=总计的断言结果，以及本地页面验证记录。
