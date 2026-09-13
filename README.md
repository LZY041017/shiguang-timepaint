# 时光涂涂 TimePaint

一个本地 Windows 周计划与日程管理工具：把一周的时间安排画出来，记录课程、任务和临时事件，并查看每天的已安排与未安排时间。

## 功能

- 周视图日程编辑与拖拽选择
- 重叠事件自动切分，支持跨午夜事件
- 日统计覆盖完整 1440 分钟，并区分“未安排”时间
- Markdown 课表导入、模板/复制周、撤销与备份
- 本地运行，数据保存在当前用户目录，不依赖远程服务

## 本地运行

需要 Python 3.12 或更高版本。在项目目录执行：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-build.txt
.\.venv\Scripts\python.exe server.py
```

然后访问 `http://127.0.0.1:8765`。Windows 用户也可以直接下载 Release 中的便携版 EXE。

## 项目结构

- `domain.py`：日程、重叠切分、跨午夜和统计逻辑
- `server.py`：本地服务与持久化接口
- `web/`：前端界面
- `tests/`：核心逻辑测试

## 数据边界

程序只绑定 `127.0.0.1`，不上传日程内容。请使用自己的 Markdown 课表作为本地输入，不要把个人课表或私人图片提交到公开仓库。

## 发行版

Windows x64 便携版请前往 GitHub Releases 下载。
