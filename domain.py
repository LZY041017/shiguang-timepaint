"""日期、时间覆盖与完整 24 小时统计。"""
import copy
import datetime as dt
import re
import uuid

CATEGORIES = ("study", "rest", "other")
DEFAULT_SLOTS = [(480,525),(530,575),(590,635),(640,685),(690,735),
                 (840,885),(890,935),(950,995),(1000,1045),(1050,1095),
                 (1140,1185),(1190,1235),(1240,1285),(1300,1345),(1350,1395)]


def new_state():
    return {"version": 1, "revision": 0, "events": [],
            "slots": [{"start": a, "end": b, "title": ""} for a,b in DEFAULT_SLOTS],
            "templateName": "Timetable.md"}


def valid_date(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError("日期格式应为 YYYY-MM-DD")
    return dt.date.fromisoformat(value)


def minute(value, upper=1440):
    if type(value) is not int or not 0 <= value <= upper:
        raise ValueError("时间超出一天范围")
    return value


def validate_event(event):
    valid_date(event.get("date"))
    a, b = minute(event.get("start")), minute(event.get("end"))
    if a >= b:
        raise ValueError("结束时间必须晚于开始时间")
    if event.get("category") not in CATEGORIES:
        raise ValueError("请选择考研、休息或杂项")
    if not isinstance(event.get("title"), str) or not 1 <= len(event["title"].strip()) <= 100:
        raise ValueError("事件标题应为 1–100 个字")
    if not isinstance(event.get("note", ""), str) or len(event.get("note", "")) > 10000:
        raise ValueError("备注最多 10000 个字")
    images = event.get("images", [])
    if not isinstance(images, list) or len(images) > 6 or any(
        not isinstance(x, str) or not re.fullmatch(r"[a-f0-9]{64}\.(png|jpg|gif|webp)", x) for x in images
    ):
        raise ValueError("图片附件格式错误，最多 6 张")
    return {"id": str(event.get("id") or uuid.uuid4()), "date": event["date"],
            "start": a, "end": b, "category": event["category"],
            "title": event["title"].strip(), "note": event.get("note", ""), "images": images}


def paint(events, incoming):
    """新色块优先；切开相交旧事件，保留两端及附件。"""
    result = []
    for old in events:
        if old["date"] != incoming["date"] or old["end"] <= incoming["start"] or old["start"] >= incoming["end"]:
            result.append(old)
            continue
        if old["start"] < incoming["start"]:
            result.append({**old, "end": incoming["start"], "id": str(uuid.uuid4())})
        if old["end"] > incoming["end"]:
            result.append({**old, "start": incoming["end"], "id": str(uuid.uuid4())})
    result.append(incoming)
    return sorted(result, key=lambda e: (e["date"], e["start"]))


def apply_event(state, payload):
    result = copy.deepcopy(state)
    editing = payload.get("id")
    if editing and not any(e["id"] == editing for e in result["events"]):
        raise ValueError("事件已发生变化，请刷新后重试")
    if editing:
        result["events"] = [e for e in result["events"] if e["id"] != editing]
    a, b = minute(payload.get("start"), 1439), minute(payload.get("end"))
    if a == b:
        raise ValueError("起止时间不能相同；全天请选择 00:00–24:00")
    date = valid_date(payload.get("date"))
    parts = [(date, a, b)] if b > a else [(date, a, 1440), (date + dt.timedelta(days=1), 0, b)]
    for day, start, end in parts:
        if start == end:
            continue
        item = validate_event({**payload, "id": str(uuid.uuid4()), "date": day.isoformat(), "start": start, "end": end})
        result["events"] = paint(result["events"], item)
    return result


def stats(events, date):
    totals = {"study": 0, "rest": 0, "other": 0, "empty": 1440}
    for e in events:
        if e["date"] == date:
            duration = e["end"] - e["start"]
            totals[e["category"]] += duration
            totals["empty"] -= duration
    return totals


def parse_markdown(text):
    slots = []
    pattern = r"(?<!\d)(\d{1,2})[:：](\d{2})\s*[-–—~～至]\s*(\d{1,2})[:：](\d{2})(?!\d)"
    for line in text.splitlines():
        match = re.search(pattern, line)
        if not match:
            continue
        h1, m1, h2, m2 = map(int, match.groups())
        if h1 > 23 or m1 > 59 or h2 > 24 or m2 > 59 or (h2 == 24 and m2):
            raise ValueError("Markdown 中存在不合法的时间：" + match.group())
        a, b = h1 * 60 + m1, h2 * 60 + m2
        if b <= a:
            raise ValueError("模板时段需在同一天内且结束晚于开始")
        title = line[match.end():].strip(" |\t")[:100]
        slots.append({"start": a, "end": b, "title": title})
    if not slots:
        raise ValueError("没有找到时间段，请使用 08:00–08:45 | 学习内容 的形式")
    slots.sort(key=lambda x: x["start"])
    if len(slots) > 96 or any(slots[i]["start"] < slots[i-1]["end"] for i in range(1,len(slots))):
        raise ValueError("模板最多 96 段，时段不能重叠")
    return slots


def validate_state(value):
    if not isinstance(value, dict) or value.get("version") != 1:
        raise ValueError("不支持的备份格式")
    result = new_state()
    events = value.get("events", [])
    if not isinstance(events, list) or len(events) > 50000:
        raise ValueError("事件数量不合法")
    ids = set()
    for event in events:
        item = validate_event(event)
        if item["id"] in ids:
            raise ValueError("备份中有重复事件编号")
        ids.add(item["id"])
        result["events"].append(item)
    by_day = {}
    for e in sorted(result["events"], key=lambda x: (x["date"],x["start"])):
        if by_day.get(e["date"], 0) > e["start"]:
            raise ValueError("备份中存在重叠时间")
        by_day[e["date"]] = e["end"]
    slots = value.get("slots")
    if not isinstance(slots, list) or not 1 <= len(slots) <= 96:
        raise ValueError("模板时段数量不合法")
    for s in slots:
        if minute(s.get("start")) >= minute(s.get("end")) or not isinstance(s.get("title", ""), str):
            raise ValueError("模板时段不合法")
    result["slots"] = sorted(slots, key=lambda x: x["start"])
    if any(result["slots"][i]["start"] < result["slots"][i-1]["end"] for i in range(1,len(slots))):
        raise ValueError("模板时段不能重叠")
    result["templateName"] = str(value.get("templateName", "导入模板"))[:100]
    result["revision"] = int(value.get("revision", 0))
    return result
