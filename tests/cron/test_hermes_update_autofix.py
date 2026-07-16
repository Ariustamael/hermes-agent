"""Tests for the opt-in Telegram Hermes-update autofix action."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from cron import scheduler


def test_extract_hermes_update_autofix_action_strips_private_marker():
    content, requested = scheduler._extract_hermes_update_autofix_action(
        "⚠️ Hermes update blocked\n[[HERMES_UPDATE_AUTOFIX_BUTTON]]"
    )

    assert requested is True
    assert content == "⚠️ Hermes update blocked"
    unchanged, requested = scheduler._extract_hermes_update_autofix_action("ordinary report")
    assert unchanged == "ordinary report"
    assert requested is False


def test_queue_hermes_update_autofix_creates_one_authorized_origin_job(monkeypatch):
    created = {}
    triggered = []

    def fake_create_job(**kwargs):
        created.update(kwargs)
        return {"id": "repair123"}

    monkeypatch.setattr("cron.jobs.create_job", fake_create_job)
    monkeypatch.setattr("cron.jobs.trigger_job", lambda job_id: triggered.append(job_id))
    monkeypatch.setattr(scheduler, "_notify_provider_jobs_changed", lambda: None)

    result = scheduler._queue_hermes_update_autofix(
        {"id": "maintenance", "skills": ["hermes-agent"], "workdir": "/repo"},
        chat_id="47417084",
        thread_id="42",
    )

    assert result == "✅ Autofix queued as `repair123`. I will report the inspected repair result here."
    assert created["schedule"] == "every 1m"
    assert created["repeat"] == 1
    assert created["deliver"] == "origin"
    assert created["origin"] == {
        "platform": "telegram", "chat_id": "47417084", "thread_id": "42",
    }
    assert created["skills"] == ["hermes-agent"]
    assert "never discard, reset, or auto-stash" in created["prompt"]
    assert triggered == ["repair123"]


@pytest.mark.asyncio
async def test_autofix_button_registers_confirmation_and_queues_only_once(monkeypatch):
    adapter = SimpleNamespace(send_slash_confirm=AsyncMock(return_value=SimpleNamespace(success=True)))
    queued = []
    monkeypatch.setattr(
        scheduler,
        "_queue_hermes_update_autofix",
        lambda job, **kwargs: queued.append((job, kwargs)) or "queued",
    )

    assert await scheduler._send_hermes_update_autofix_prompt(
        adapter,
        {"id": "maintenance"},
        chat_id="47417084",
        thread_id="42",
        message="blocked",
    )
    call = adapter.send_slash_confirm.await_args.kwargs
    assert call["title"] == "Hermes update blocked"
    assert "Approve Once" in call["message"]
    assert call["approve_label"] == "🛠 Autofix safely"
    assert call["cancel_label"] == "Keep blocked"
    assert call["allow_permanent"] is False

    from tools import slash_confirm
    assert await slash_confirm.resolve(call["session_key"], call["confirm_id"], "once") == "queued"
    assert len(queued) == 1
    assert await slash_confirm.resolve(call["session_key"], call["confirm_id"], "once") is None
