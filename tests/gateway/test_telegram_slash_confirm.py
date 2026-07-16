"""Regression guard: send_slash_confirm must use format_message + MARKDOWN_V2."""

import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

_repo = str(Path(__file__).resolve().parents[2])
if _repo not in sys.path:
    sys.path.insert(0, _repo)
from plugins.platforms.telegram.adapter import TelegramAdapter
from gateway.config import PlatformConfig


def _make_adapter():
    config = PlatformConfig(enabled=True, token="test-token", extra={})
    adapter = TelegramAdapter(config)
    adapter._bot = AsyncMock()
    adapter._app = MagicMock()
    return adapter


class TestSendSlashConfirm:
    @pytest.mark.asyncio
    async def test_custom_labels_can_disable_permanent_approval(self, monkeypatch):
        adapter = _make_adapter()
        adapter._bot.send_message = AsyncMock(
            return_value=SimpleNamespace(message_id=9)
        )
        import plugins.platforms.telegram.adapter as telegram_adapter

        monkeypatch.setattr(
            telegram_adapter,
            "InlineKeyboardButton",
            lambda text, callback_data: (text, callback_data),
        )
        monkeypatch.setattr(telegram_adapter, "InlineKeyboardMarkup", lambda rows: rows)

        await adapter.send_slash_confirm(
            chat_id="100",
            title="Confirm",
            message="blocked",
            session_key="sk",
            confirm_id="cid-custom",
            approve_label="🛠 Autofix safely",
            cancel_label="Keep blocked",
            allow_permanent=False,
        )

        rows = adapter._bot.send_message.call_args.kwargs["reply_markup"]
        assert rows == [
            [("🛠 Autofix safely", "sc:once:cid-custom")],
            [("Keep blocked", "sc:cancel:cid-custom")],
        ]

    @pytest.mark.asyncio
    async def test_uses_markdown_v2_and_escapes_special_chars(self):
        """send_slash_confirm must pass preview through format_message and use
        MARKDOWN_V2 — so commands with underscores, dots, or brackets don't
        raise BadRequest: Can't parse entities."""
        adapter = _make_adapter()
        sent = {}

        async def mock_send(**kwargs):
            sent.update(kwargs)
            return SimpleNamespace(message_id=7)

        adapter._bot.send_message = AsyncMock(side_effect=mock_send)

        result = await adapter.send_slash_confirm(
            chat_id="100",
            title="Confirm",
            message="/run script_name.sh --flag=value [option]",
            session_key="sk",
            confirm_id="cid1",
        )

        assert result.success is True
        assert "MARKDOWN_V2" in repr(sent["parse_mode"])
        assert "script\\_name" in sent["text"]
        assert "\\." in sent["text"]


