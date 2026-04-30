"""Log collection orchestrator using CDP client and DuckDB."""

from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any

from chrome_logs.client import CDPClient
from chrome_logs.db import Database


class LogCollector:
    """Orchestrates log collection from Chrome via CDP."""

    def __init__(self, client: CDPClient, db: Database):
        self.client = client
        self.db = db
        self.session_id = str(uuid.uuid4())[:8]
        self._network_requests: dict[str, dict] = {}
        self._console_count = 0
        self._network_count = 0
        self._error_count = 0

    async def start(self, target_id: str | None = None):
        """Connect to target and start collecting logs."""
        ws_url = self.client.get_ws_url(target_id)
        await self.client.connect(ws_url)

        # Get target info for session
        targets = self.client.get_page_targets()
        target_info = next(
            (t for t in targets if ws_url.endswith(t["id"])),
            {"url": "", "title": "", "id": ""},
        )
        self.db.start_session(
            self.session_id,
            target_url=target_info.get("url", ""),
            target_title=target_info.get("title", ""),
            target_id=target_info.get("id", ""),
        )

        self._register_handlers()
        await self.client.send("Runtime.enable")
        await self.client.send("Console.enable")
        await self.client.send("Network.enable")
        await self.client.send("Log.enable")

    def _register_handlers(self):
        self.client.on("Console.messageAdded", self._on_console)
        self.client.on("Runtime.consoleAPICalled", self._on_runtime_console)
        self.client.on("Runtime.exceptionThrown", self._on_exception)
        self.client.on("Log.entryAdded", self._on_log_entry)
        self.client.on("Network.requestWillBeSent", self._on_request)
        self.client.on("Network.responseReceived", self._on_response)
        self.client.on("Network.loadingFinished", self._on_loading_finished)

    def _on_console(self, method: str, params: dict):
        msg = params.get("message", {})
        self.db.insert_console_log(
            session_id=self.session_id,
            level=msg.get("level", "log"),
            message=msg.get("text", ""),
            url=msg.get("url"),
            line=msg.get("line"),
            col=msg.get("column"),
            stack=msg.get("stackTrace", {}).get("callFrames", None)
            and json.dumps(msg["stackTrace"]["callFrames"]),
            raw=params,
        )
        self._console_count += 1

    def _on_runtime_console(self, method: str, params: dict):
        args = params.get("args", [])
        texts = []
        for arg in args:
            if "value" in arg:
                texts.append(str(arg["value"]))
            elif arg.get("type") == "string":
                texts.append(arg.get("description", ""))
            else:
                texts.append(arg.get("description", str(arg.get("type", ""))))
        message = " ".join(texts)

        stack_frames = params.get("stackTrace", {}).get("callFrames", [])
        url = stack_frames[0].get("url", "") if stack_frames else None
        line = stack_frames[0].get("lineNumber") if stack_frames else None
        col = stack_frames[0].get("columnNumber") if stack_frames else None

        self.db.insert_console_log(
            session_id=self.session_id,
            level=params.get("type", "log"),
            message=message,
            url=url,
            line=line,
            col=col,
            stack=json.dumps(stack_frames) if stack_frames else None,
            raw=params,
        )
        self._console_count += 1

    def _on_log_entry(self, method: str, params: dict):
        entry = params.get("entry", {})
        self.db.insert_console_log(
            session_id=self.session_id,
            level=entry.get("level", "info"),
            message=entry.get("text", ""),
            url=entry.get("url"),
            line=entry.get("lineNumber"),
            raw=params,
        )
        self._console_count += 1

    def _on_exception(self, method: str, params: dict):
        detail = params.get("exceptionDetails", {})
        exception = detail.get("exception", {})
        message = (
            exception.get("description")
            or detail.get("text", "Unknown error")
        )
        stack = detail.get("stackTrace", {}).get("callFrames", [])
        self.db.insert_page_error(
            session_id=self.session_id,
            error_type=exception.get("className", "Error"),
            message=message,
            url=detail.get("url"),
            line=detail.get("lineNumber"),
            col=detail.get("columnNumber"),
            stack=json.dumps(stack) if stack else None,
            raw=params,
        )
        self._error_count += 1

    def _on_request(self, method: str, params: dict):
        req = params.get("request", {})
        req_id = params.get("requestId", "")
        self._network_requests[req_id] = {
            "method": req.get("method", ""),
            "url": req.get("url", ""),
            "headers": req.get("headers"),
            "raw_request": params,
        }

    def _on_response(self, method: str, params: dict):
        req_id = params.get("requestId", "")
        resp = params.get("response", {})
        if req_id in self._network_requests:
            self._network_requests[req_id].update({
                "status": resp.get("status"),
                "mime_type": resp.get("mimeType"),
                "response_headers": resp.get("headers"),
                "timing": resp.get("timing"),
                "encoded_data_length": resp.get("encodedDataLength"),
                "raw_response": params,
            })

    def _on_loading_finished(self, method: str, params: dict):
        req_id = params.get("requestId", "")
        info = self._network_requests.pop(req_id, None)
        if not info:
            return
        size = params.get("encodedDataLength", info.get("encoded_data_length"))
        self.db.insert_network_request(
            session_id=self.session_id,
            request_id=req_id,
            method=info.get("method", ""),
            url=info.get("url", ""),
            status=info.get("status"),
            mime_type=info.get("mime_type"),
            req_headers=info.get("headers"),
            res_headers=info.get("response_headers"),
            timing=info.get("timing"),
            size=size,
            raw={"request": info.get("raw_request"), "response": info.get("raw_response")},
        )
        self._network_count += 1

    async def collect(self, duration: float | None = None):
        """Collect logs for a duration (seconds). None = indefinite."""
        await self.client.listen(duration=duration)

    async def stop(self):
        """Stop collecting and close connection."""
        self.db.end_session(self.session_id)
        await self.client.disconnect()

    @property
    def stats(self) -> dict[str, int]:
        return {
            "console_logs": self._console_count,
            "network_requests": self._network_count,
            "page_errors": self._error_count,
        }
