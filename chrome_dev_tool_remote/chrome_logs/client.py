"""Chrome DevTools Protocol client via WebSocket."""

from __future__ import annotations

import asyncio
import json
from typing import Any, Callable

import requests
import websockets


class CDPClient:
    """CDP WebSocket client for Chrome remote debugging."""

    def __init__(self, host: str = "localhost", port: int = 9222):
        self.host = host
        self.port = port
        self.base_url = f"http://{host}:{port}"
        self._ws = None
        self._msg_id = 0
        self._callbacks: dict[str, list[Callable]] = {}

    def list_targets(self) -> list[dict]:
        """List available debugging targets."""
        resp = requests.get(f"{self.base_url}/json", timeout=5)
        resp.raise_for_status()
        return resp.json()

    def get_page_targets(self) -> list[dict]:
        """List only page-type targets."""
        return [t for t in self.list_targets() if t.get("type") == "page"]

    def get_ws_url(self, target_id: str | None = None) -> str:
        """Get WebSocket URL for a target. Uses first page if target_id is None."""
        if target_id:
            targets = self.list_targets()
            for t in targets:
                if t["id"] == target_id:
                    return t["webSocketDebuggerUrl"]
            raise ValueError(f"Target {target_id} not found")
        pages = self.get_page_targets()
        if not pages:
            raise RuntimeError("No page targets available")
        return pages[0]["webSocketDebuggerUrl"]

    async def connect(self, ws_url: str):
        """Connect to a target via WebSocket."""
        self._ws = await websockets.connect(ws_url, max_size=50 * 1024 * 1024)

    async def disconnect(self):
        """Close WebSocket connection."""
        if self._ws:
            await self._ws.close()
            self._ws = None

    async def send(self, method: str, params: dict | None = None) -> dict:
        """Send a CDP command and wait for response."""
        self._msg_id += 1
        msg = {"id": self._msg_id, "method": method, "params": params or {}}
        await self._ws.send(json.dumps(msg))

        while True:
            raw = await self._ws.recv()
            data = json.loads(raw)
            if "id" in data and data["id"] == msg["id"]:
                return data
            if "method" in data:
                self._dispatch_event(data["method"], data.get("params", {}))

    def on(self, event: str, callback: Callable):
        """Register a callback for a CDP event."""
        self._callbacks.setdefault(event, []).append(callback)

    def _dispatch_event(self, method: str, params: dict):
        for cb in self._callbacks.get(method, []):
            cb(method, params)

    async def enable_domains(self):
        """Enable Console, Log, Network, Runtime domains."""
        await self.send("Runtime.enable")
        await self.send("Log.entryAdded")  # subscribe
        await self.send("Console.enable")
        await self.send("Network.enable")

    async def listen(self, duration: float | None = None):
        """Listen for events. If duration is set, stop after that many seconds."""
        try:
            if duration:
                await asyncio.wait_for(self._listen_loop(), timeout=duration)
            else:
                await self._listen_loop()
        except asyncio.TimeoutError:
            pass

    async def _listen_loop(self):
        async for raw in self._ws:
            data = json.loads(raw)
            if "method" in data:
                self._dispatch_event(data["method"], data.get("params", {}))
