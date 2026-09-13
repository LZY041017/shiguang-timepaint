import base64
import datetime as dt
import json
import os
from pathlib import Path
import random
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from domain import new_state, apply_event, parse_markdown, stats, validate_state


def event(a, b, category="study", day="2026-09-11", **kwargs):
    return {"date":day,"start":a,"end":b,"category":category,"title":"测试时光","note":"记录", "images":[],**kwargs}


class DomainTests(unittest.TestCase):
    def test_partial_cover_retains_both_sides(self):
        state=apply_event(new_state(),event(480,660,title="原学习"))
        state=apply_event(state,event(540,600,"rest",title="休息"))
        self.assertEqual([(e["start"],e["end"],e["title"]) for e in state["events"]],
                         [(480,540,"原学习"),(540,600,"休息"),(600,660,"原学习")])
        self.assertEqual(stats(state["events"],"2026-09-11"),{"study":120,"rest":60,"other":0,"empty":1260})

    def test_midnight_and_week_boundary(self):
        state=apply_event(new_state(),event(1380,420,"rest",day="2026-09-13"))
        self.assertEqual([(e["date"],e["start"],e["end"]) for e in state["events"]],
                         [("2026-09-13",1380,1440),("2026-09-14",0,420)])
        self.assertEqual(stats(state["events"],"2026-09-14")["rest"],420)

    def test_all_day_and_touching_edges(self):
        state=apply_event(new_state(),event(0,1440,"rest"))
        self.assertEqual(stats(state["events"],"2026-09-11")["empty"],0)
        state=apply_event(state,event(480,525))
        state=apply_event(state,event(525,575,"other"))
        self.assertEqual(sum(stats(state["events"],"2026-09-11").values()),1440)
        self.assertEqual(len(state["events"]),4)

    def test_edit_and_invalid_input(self):
        state=apply_event(new_state(),event(480,525))
        old=state["events"][0]
        state=apply_event(state,{**old,"start":600,"end":640})
        self.assertEqual(len(state["events"]),1)
        self.assertEqual(state["events"][0]["start"],600)
        for bad in [event(60,60),event(1440,120),event(0,20,"unknown"),event(0,20,day="2026-02-31"),event(0,20,title=" ")]:
            with self.assertRaises(ValueError):apply_event(state,bad)

    def test_markdown(self):
        for divider in ["-","–","—","~","～","至"]:
            self.assertEqual(parse_markdown(f"| 08:00{divider}08:45 | 英语 |"),[{"start":480,"end":525,"title":"英语"}])
        for bad in ["没有时间", "| 08:00–09:00 |\n| 08:30–10:00 |", "| 24:30–25:00 |", "| 09:00–08:00 |"]:
            with self.assertRaises(ValueError):parse_markdown(bad)

    def test_backup_validation(self):
        state=apply_event(new_state(),event(480,525))
        self.assertEqual(validate_state(state)["events"],state["events"])
        state["events"].append(dict(state["events"][0]))
        with self.assertRaises(ValueError):validate_state(state)

    def test_random_paint_matches_minute_oracle(self):
        rng=random.Random(1729)
        state=new_state();oracle=["empty"]*1440
        for _ in range(350):
            a,b=sorted(rng.sample(range(1441),2));category=rng.choice(["study","rest","other"])
            state=apply_event(state,event(a,b,category))
            oracle[a:b]=[category]*(b-a)
            totals=stats(state["events"],"2026-09-11")
            self.assertEqual(totals,{k:oracle.count(k) for k in ["study","rest","other","empty"]})
            validate_state(state)


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.work=Path(__file__).resolve().parents[4]/"work"
        cls.temp=tempfile.TemporaryDirectory(prefix="timepaint-test-",dir=cls.work)
        cls.root=Path(cls.temp.name)
        cls.start_server()

    @classmethod
    def start_server(cls):
        launch=[os.environ["TIMEPAINT_TEST_EXE"]] if os.environ.get("TIMEPAINT_TEST_EXE") else [sys.executable,"-B",str(Path(__file__).resolve().parents[1]/"server.py")]
        cls.proc=subprocess.Popen([*launch,"--data-dir",str(cls.root),"--no-browser","--stay"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        for _ in range(80):
            try:
                port=json.loads((cls.root/"port.json").read_text())["port"]
                cls.url=f"http://127.0.0.1:{port}"
                cls.state=cls.get("/api/state")
                return
            except Exception:time.sleep(.1)
        raise RuntimeError("测试服务启动失败")

    @classmethod
    def get(cls,path):
        with urllib.request.urlopen(cls.url+path,timeout=10) as response:return json.load(response)

    def post(self,path,data,token=None):
        request=urllib.request.Request(self.url+path,data=json.dumps({"revision":self.state["revision"],**data}).encode(),
                                       headers={"Content-Type":"application/json","X-TimePaint-Token":token or self.state["token"]})
        with urllib.request.urlopen(request,timeout=10) as response:result=json.load(response)
        if "events" in result:self.__class__.state=result
        return result

    def test_full_persistence_attachment_backup_cycle(self):
        raw=base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=")
        image=self.post("/api/upload",{"data":base64.b64encode(raw).decode()})["name"]
        result=self.post("/api/event",event(480,600,title="带图片的中文记录",images=[image]))
        record=result["events"][-1]
        with urllib.request.urlopen(self.url+"/media/"+image) as response:self.assertEqual(response.read(),raw)
        backup=self.get("/api/export")
        self.assertIn(image,backup["media"])
        self.post("/api/delete",{"id":record["id"]})
        self.assertFalse(self.state["events"])
        self.post("/api/undo",{})
        self.assertEqual(self.state["events"][0]["images"],[image])
        self.post("/api/event",event(510,540,"rest"))
        self.assertEqual(len(self.state["events"]),3)
        self.post("/api/restore",{"backup":backup})
        self.assertEqual(len(self.state["events"]),1)
        self.assertTrue(list((self.root/"backups").glob("before-restore-*.json")))
        self.stop_server()
        self.start_server()
        self.assertEqual(self.state["events"][0]["title"],"带图片的中文记录")
        reports=self.get("/api/reports")
        self.assertEqual(sum(reports["2026-09-11"]["minutes"].values()),1440)

    def test_stale_revision_and_token_rejected(self):
        for payload,token,status in [({"revision":-1},None,409),({},"wrong",403)]:
            with self.assertRaises(urllib.error.HTTPError) as caught:self.post("/api/event",{**event(700,710),**payload},token=token)
            self.assertEqual(caught.exception.code,status)

    def test_template_copy_and_undo(self):
        self.post("/api/template",{"text":"| 10:00–10:45 | 英语复习 |", "name":"新模板.md", "fillWeek":True,"week":"2026-10-05"})
        self.assertEqual(len([e for e in self.state["events"] if e["date"].startswith("2026-10")]),7)
        self.post("/api/copy-week",{"source":"2026-10-05","target":"2026-10-12"})
        self.assertEqual(len([e for e in self.state["events"] if e["date"].startswith("2026-10")]),14)
        self.post("/api/undo",{})
        self.assertEqual(len([e for e in self.state["events"] if e["date"].startswith("2026-10")]),7)

    @classmethod
    def stop_server(cls):
        if os.name=="nt" and os.environ.get("TIMEPAINT_TEST_EXE"):
            subprocess.run(["taskkill","/PID",str(cls.proc.pid),"/T","/F"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        else:
            cls.proc.terminate()
        cls.proc.wait(timeout=5)

    @classmethod
    def tearDownClass(cls):
        cls.stop_server()
        if not cls.root.resolve().is_relative_to(cls.work.resolve()):
            raise RuntimeError("拒绝清理工作目录外的路径")
        for attempt in range(10):
            try:
                cls.temp.cleanup()
                break
            except PermissionError:
                if attempt==9:raise
                time.sleep(.2)


if __name__=="__main__":unittest.main(verbosity=2)
