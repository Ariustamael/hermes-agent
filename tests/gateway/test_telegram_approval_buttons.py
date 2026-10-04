"""Tests for Telegram inline keyboard approval buttons."""

import asyncio
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agent.i18n import t
from gateway.platforms.base import unauthorized_action_notice, utf16_len

# ---------------------------------------------------------------------------
# Ensure the repo root is importable
# ---------------------------------------------------------------------------
_repo = str(Path(__file__).resolve().parents[2])
if _repo not in sys.path:
    sys.path.insert(0, _repo)


from plugins.platforms.telegram.adapter import TelegramAdapter
from gateway.config import Platform, PlatformConfig


def _make_adapter(extra=None):
    """Create a TelegramAdapter with mocked internals."""
    config = PlatformConfig(enabled=True, token="test-token", extra=extra or {})
    adapter = TelegramAdapter(config)
    adapter._bot = AsyncMock()
    adapter._app = MagicMock()
    return adapter


class _AuthRunner:
    """Minimal runner shim for callback auth tests."""

    def __init__(self, authorized: bool):
        self.authorized = authorized
        self.last_source = None

    async def _handle_message(self, event):
        return None

    def _is_user_authorized(self, source):
        self.last_source = source
        return self.authorized


# ===========================================================================
# send_exec_approval — inline keyboard buttons
# ===========================================================================

class TestTelegramExecApproval:
    """Test the send_exec_approval method sends InlineKeyboard buttons."""

    @pytest.mark.asyncio
    async def test_sends_inline_keyboard(self):
        adapter = _make_adapter()
        mock_msg = MagicMock()
        mock_msg.message_id = 42
        adapter._bot.send_message = AsyncMock(return_value=mock_msg)

        result = await adapter.send_exec_approval(
            chat_id="12345",
            command="rm -rf /important",
            session_key="agent:main:telegram:group:12345:99",
            description="dangerous deletion",
        )

        assert result.success is True
        assert result.message_id == "42"

        adapter._bot.send_message.assert_called_once()
        kwargs = adapter._bot.send_message.call_args[1]
        assert kwargs["chat_id"] == 12345
        assert "rm -rf /important" in kwargs["text"]
        assert "dangerous deletion" in kwargs["text"]
        assert kwargs["reply_markup"] is not None  # InlineKeyboardMarkup

    @pytest.mark.asyncio
    @pytest.mark.parametrize("smart_denied", [False, True])
    async def test_oversized_escaped_approval_text_keeps_inline_keyboard(self, smart_denied):
        """The rendered HTML card (escaped command + reason + framing) must fit Telegram's
        4096-char cap, otherwise the API rejects it and the gateway falls back to /approve."""
        adapter = _make_adapter()
        adapter._bot.send_message = AsyncMock(return_value=SimpleNamespace(message_id=42))

        await adapter.send_exec_approval(
            chat_id="12345",
            command="&" * 3700,  # inside the old raw budget; 5x larger once escaped
            session_key="s",
            description="<reason>" * 1000,
            smart_denied=smart_denied,
        )

        kwargs = adapter._bot.send_message.call_args.kwargs
        assert len(kwargs["text"]) <= adapter.MAX_MESSAGE_LENGTH
        assert "&amp;&amp;" in kwargs["text"] and "&lt;reason&gt;" in kwargs["text"]
        assert kwargs["reply_markup"] is not None

    @pytest.mark.asyncio
    async def test_emoji_dense_approval_card_fits_in_utf16_units(self):
        """Telegram counts UTF-16 code units (astral emoji = 2), like the adapter's chunker."""
        adapter = _make_adapter()
        adapter._bot.send_message = AsyncMock(return_value=SimpleNamespace(message_id=42))

        await adapter.send_exec_approval(chat_id="12345", command="😀" * 3000, session_key="s")

        kwargs = adapter._bot.send_message.call_args.kwargs
        assert utf16_len(kwargs["text"]) <= adapter.MAX_MESSAGE_LENGTH
        assert kwargs["reply_markup"] is not None

    @pytest.mark.asyncio
    async def test_slash_confirm_preview_fits_after_markdown_escaping(self):
        """The slash-confirm card is measured after format_message (MarkdownV2 escaping expands
        text), so a 3800-char raw message must still land under the 4096 cap."""
        adapter = _make_adapter()
        adapter._bot.send_message = AsyncMock(return_value=SimpleNamespace(message_id=42))

        await adapter.send_slash_confirm(
            chat_id="12345", title="t", message="." * 3800, session_key="s", confirm_id="c1")

        kwargs = adapter._bot.send_message.call_args.kwargs
        assert utf16_len(kwargs["text"]) <= adapter.MAX_MESSAGE_LENGTH
        assert kwargs["reply_markup"] is not None


    @pytest.mark.asyncio
    async def test_non_smart_allow_permanent_false_keeps_session(self, monkeypatch):
        adapter = _make_adapter()
        adapter._bot.send_message = AsyncMock(return_value=SimpleNamespace(message_id=42))
        buttons = []
        monkeypatch.setattr(
            "plugins.platforms.telegram.adapter.InlineKeyboardButton",
            lambda text, callback_data: buttons.append(text) or text,
        )
        monkeypatch.setattr(
            "plugins.platforms.telegram.adapter.InlineKeyboardMarkup", lambda rows: rows
        )

        await adapter.send_exec_approval(
            chat_id="12345", command="curl example.test", session_key="s",
            allow_permanent=False,
        )

        assert buttons == [t(f"platform.telegram.approval.action_{c}") for c in ("once", "session", "deny")]



    @pytest.mark.asyncio
    async def test_smart_deny_two_buttons_share_one_row(self, monkeypatch):
        """smart_deny yields 2 buttons — they pair into a single readable row."""
        adapter = _make_adapter()
        adapter._bot.send_message = AsyncMock(return_value=SimpleNamespace(message_id=42))
        captured_rows = []
        monkeypatch.setattr(
            "plugins.platforms.telegram.adapter.InlineKeyboardButton",
            lambda text, callback_data: text,
        )
        monkeypatch.setattr(
            "plugins.platforms.telegram.adapter.InlineKeyboardMarkup",
            lambda rows: captured_rows.extend(rows) or rows,
        )

        await adapter.send_exec_approval(
            chat_id="12345", command="curl example.test", session_key="s",
            allow_permanent=False, smart_denied=True,
        )

        assert captured_rows == [
            [t("platform.telegram.approval.action_once"), t("platform.telegram.approval.action_deny")],
        ]


    @pytest.mark.asyncio
    async def test_send_update_prompt_escapes_dynamic_prompt(self):
        adapter = _make_adapter()
        sent = {}

        async def mock_send_message(**kwargs):
            sent.update(kwargs)
            return SimpleNamespace(message_id=55)

        adapter._bot.send_message = AsyncMock(side_effect=mock_send_message)

        result = await adapter.send_update_prompt(
            chat_id="12345",
            prompt="Fix [issue]_1 and verify *markdown*",
            default="alpha_beta",
            metadata={"thread_id": "999"},
        )

        assert result.success is True
        assert "MARKDOWN_V2" in repr(sent["parse_mode"])
        assert "Fix \\[issue\\]\\_1" in sent["text"]
        assert "alpha\\_beta" in sent["text"]

    @pytest.mark.asyncio
    async def test_truncates_long_command(self):
        adapter = _make_adapter()
        mock_msg = MagicMock()
        mock_msg.message_id = 1
        adapter._bot.send_message = AsyncMock(return_value=mock_msg)

        long_cmd = "x" * 5000
        await adapter.send_exec_approval(
            chat_id="12345", command=long_cmd, session_key="s"
        )

        kwargs = adapter._bot.send_message.call_args[1]
        assert "..." in kwargs["text"]
        assert len(kwargs["text"]) < 5000


# ===========================================================================
# Ortho/Gray quiz inline keyboard buttons
# ===========================================================================

class TestTelegramQuizButtons:
    """Test Ortho Teacher quiz messages get A-E response buttons."""

    def _write_quiz(self, home: Path, qid: str = "grays_back_q005"):
        quiz_dir = home / "state" / "telegram_quizzes"
        quiz_dir.mkdir(parents=True, exist_ok=True)
        quiz = {
            "qid": qid,
            "question": "A patient has shingles in the C7 dermatome. Where has the virus proliferated?",
            "options": {
                "A": "Sympathetic chain",
                "B": "Dorsal root ganglion",
                "C": "Lateral horn",
                "D": "Posterior cutaneous branch",
                "E": "Ventral horn",
            },
            "correct": "B",
            "explanation": "Varicella-zoster reactivates in sensory dorsal root ganglia.",
            "source": "Gray's Anatomy Review",
        }
        (quiz_dir / f"{qid}.json").write_text(json.dumps(quiz), encoding="utf-8")
        return quiz

    @pytest.mark.parametrize(
        "reply_instruction",
        [
            "Tap an answer below, or reply A–E. The answer remains hidden until marked.",
            "Tap an answer below, or reply A-E. The answer remains hidden until marked.",
            "Reply with A/B/C/D/E, or use the Telegram buttons.",
        ],
    )
    def test_quiz_reply_markup_detects_stored_question(self, tmp_path, reply_instruction):
        adapter = _make_adapter()
        quiz = self._write_quiz(tmp_path)
        content = (
            "## Gray's Anatomy Review — Back Q5\n\n"
            f"{quiz['question']}\n\n"
            "A. Sympathetic chain\n"
            "B. Dorsal root ganglion\n"
            "C. Lateral horn\n"
            "D. Posterior cutaneous branch\n"
            "E. Ventral horn\n\n"
            + reply_instruction
        )

        with patch("hermes_constants.get_hermes_home", return_value=tmp_path):
            with patch(
                "plugins.platforms.telegram.adapter.InlineKeyboardButton",
                side_effect=lambda text, callback_data: SimpleNamespace(
                    text=text, callback_data=callback_data
                ),
            ):
                with patch(
                    "plugins.platforms.telegram.adapter.InlineKeyboardMarkup",
                    side_effect=lambda rows: SimpleNamespace(inline_keyboard=rows),
                ):
                    markup = adapter._quiz_reply_markup_for_content(content)

        assert markup is not None
        buttons = [button for row in markup.inline_keyboard for button in row]
        assert [button.text for button in buttons] == ["A", "B", "C", "D", "E"]
        assert [button.callback_data for button in buttons] == [
            "quiz:grays_back_q005:A",
            "quiz:grays_back_q005:B",
            "quiz:grays_back_q005:C",
            "quiz:grays_back_q005:D",
            "quiz:grays_back_q005:E",
        ]

    @pytest.mark.asyncio
    async def test_send_attaches_quiz_reply_markup_to_first_chunk(self, tmp_path):
        adapter = _make_adapter()
        quiz = self._write_quiz(tmp_path)
        mock_msg = MagicMock()
        mock_msg.message_id = 42
        adapter._bot.send_message = AsyncMock(return_value=mock_msg)
        content = f"{quiz['question']}\n\nTap an answer below, or reply A–E. The answer remains hidden until marked."

        with patch("hermes_constants.get_hermes_home", return_value=tmp_path):
            with patch(
                "plugins.platforms.telegram.adapter.InlineKeyboardButton",
                side_effect=lambda text, callback_data: SimpleNamespace(
                    text=text, callback_data=callback_data
                ),
            ):
                with patch(
                    "plugins.platforms.telegram.adapter.InlineKeyboardMarkup",
                    side_effect=lambda rows: SimpleNamespace(inline_keyboard=rows),
                ):
                    result = await adapter.send(chat_id="12345", content=content)

        assert result.success is True
        kwargs = adapter._bot.send_message.call_args[1]
        assert kwargs["reply_markup"] is not None
        buttons = [button for row in kwargs["reply_markup"].inline_keyboard for button in row]
        assert [button.callback_data for button in buttons] == [
            "quiz:grays_back_q005:A",
            "quiz:grays_back_q005:B",
            "quiz:grays_back_q005:C",
            "quiz:grays_back_q005:D",
            "quiz:grays_back_q005:E",
        ]


# ===========================================================================
# Compact Ortho Teacher menu
# ===========================================================================

class TestTelegramOrthoMenuLayout:
    """Keep the primary Ortho Teacher menu focused; secondary actions live under More."""

    @staticmethod
    def _labels_and_callbacks(markup):
        buttons = [button for row in markup.inline_keyboard for button in row]
        return [button.text for button in buttons], [button.callback_data for button in buttons]

    def test_primary_menu_has_only_core_actions_and_more(self):
        adapter = _make_adapter()
        with patch(
            "plugins.platforms.telegram.adapter.InlineKeyboardButton",
            side_effect=lambda text, callback_data: SimpleNamespace(text=text, callback_data=callback_data),
        ), patch(
            "plugins.platforms.telegram.adapter.InlineKeyboardMarkup",
            side_effect=lambda rows: SimpleNamespace(inline_keyboard=rows),
        ):
            markup = adapter._ortho_menu_reply_markup_for_content(
                "## Ortho Teacher\n\nChoose a mode:"
            )

        labels, callbacks = self._labels_and_callbacks(markup)
        assert labels == ["Ask", "3 pearls", "Daily", "Gray quiz", "More options →"]
        assert callbacks == [
            "ortho:prompt:topic",
            "ortho:prompt:pearls",
            "ortho:run:daily_pearls",
            "ortho:run:quiz",
            "ortho:more",
        ]

    def test_more_menu_retains_secondary_actions(self):
        adapter = _make_adapter()
        with patch(
            "plugins.platforms.telegram.adapter.InlineKeyboardButton",
            side_effect=lambda text, callback_data: SimpleNamespace(text=text, callback_data=callback_data),
        ), patch(
            "plugins.platforms.telegram.adapter.InlineKeyboardMarkup",
            side_effect=lambda rows: SimpleNamespace(inline_keyboard=rows),
        ):
            markup = adapter._ortho_more_reply_markup()

        labels, callbacks = self._labels_and_callbacks(markup)
        assert labels == ["Full bank", "Choose chapter", "Quiz stats", "Source check", "◀ Back"]
        assert callbacks == [
            "ortho:run:quiz_all",
            "ortho:chapters",
            "ortho:run:stats",
            "ortho:prompt:dry_run",
            "ortho:back",
        ]


class TestTelegramOrthoAskSave:
    """Only a sourced answer launched from the Ask menu may expose a vault save."""

    @pytest.mark.asyncio
    async def test_ask_output_attaches_save_button_and_stores_exact_content(self, tmp_path):
        adapter = _make_adapter()
        mock_msg = MagicMock()
        mock_msg.message_id = 42
        adapter._bot.send_message = AsyncMock(return_value=mock_msg)
        answer = "## Osteolysis\n\nA cited Ortho Teacher answer.\n\nSources: [S1]"

        with patch("hermes_constants.get_hermes_home", return_value=tmp_path), patch(
            "plugins.platforms.telegram.adapter.InlineKeyboardButton",
            side_effect=lambda text, callback_data: SimpleNamespace(text=text, callback_data=callback_data),
        ), patch(
            "plugins.platforms.telegram.adapter.InlineKeyboardMarkup",
            side_effect=lambda rows: SimpleNamespace(inline_keyboard=rows),
        ):
            await adapter._send_ortho_output(
                "12345", answer, save_to_obsidian=True, topic="what is osteolysis", user_id="12345"
            )

        buttons = [button for row in adapter._bot.send_message.call_args[1]["reply_markup"].inline_keyboard for button in row]
        assert [(button.text, button.callback_data.split(":", 1)[0]) for button in buttons] == [("📥 Save to Obsidian", "ortho-save")]
        payloads = list((tmp_path / "state" / "telegram_ortho_saves").glob("*.json"))
        assert len(payloads) == 1
        payload = json.loads(payloads[0].read_text(encoding="utf-8"))
        assert payload["topic"] == "what is osteolysis"
        assert payload["content"] == answer

    @pytest.mark.asyncio
    async def test_save_callback_writes_one_exact_note_and_removes_button(self, tmp_path):
        adapter = _make_adapter()
        answer = "## Osteolysis\n\nA cited Ortho Teacher answer.\n\nSources: [S1]"
        with patch("hermes_constants.get_hermes_home", return_value=tmp_path):
            save_id = adapter._store_ortho_save_payload(
                chat_id="12345", user_id="12345", thread_id=None,
                topic="what is osteolysis", content=answer,
            )
            assert save_id

            query = AsyncMock()
            query.data = f"ortho-save:{save_id}"
            query.message = MagicMock()
            query.message.chat_id = 12345
            query.message.chat.type = "private"
            query.from_user = MagicMock()
            query.from_user.id = 12345
            query.from_user.first_name = "Chester"
            query.answer = AsyncMock()
            query.edit_message_reply_markup = AsyncMock()
            update = MagicMock()
            update.callback_query = query

            with patch.dict(os.environ, {"TELEGRAM_ALLOWED_USERS": "*"}, clear=False):
                await adapter._handle_callback_query(update, MagicMock())

        notes = list((tmp_path / "vault" / "05 Resources" / "Medicine" / "Orthopaedics" / "Ortho Teacher Questions").glob("*.md"))
        assert len(notes) == 1
        note = notes[0].read_text(encoding="utf-8")
        assert "# Ortho Teacher — what is osteolysis" in note
        assert answer in note
        query.edit_message_reply_markup.assert_awaited_once_with(reply_markup=None)


class TestTelegramApprovalCallback:
    """Test the approval callback handling in _handle_callback_query."""


    @pytest.mark.asyncio
    async def test_resume_typing_after_inline_approval(self):
        """Clicking an inline approval button must un-pause the chat's typing.

        Regression for #27853: the text /approve path resumed typing, but the
        ea: callback path did not, so the typing indicator stayed gone for the
        rest of a long-running turn after a button click.
        """
        adapter = _make_adapter()
        adapter._approval_state[5] = "agent:main:telegram:group:12345:99"
        adapter.pause_typing_for_chat("12345")
        assert "12345" in adapter._typing_paused

        query = AsyncMock()
        query.data = "ea:once:5"
        query.message = MagicMock()
        query.message.chat_id = 12345
        query.from_user = MagicMock()
        query.from_user.first_name = "Norbert"
        query.from_user.id = "12345"
        query.answer = AsyncMock()
        query.edit_message_text = AsyncMock()

        update = MagicMock()
        update.callback_query = query
        context = MagicMock()

        with patch.dict(os.environ, {"TELEGRAM_ALLOWED_USERS": "*"}, clear=False):
            with patch("tools.approval.resolve_gateway_approval", return_value=1):
                await adapter._handle_callback_query(update, context)

        assert "12345" not in adapter._typing_paused


    @pytest.mark.asyncio
    async def test_approval_callback_escapes_dynamic_user_name(self):
        adapter = _make_adapter()
        adapter._approval_state[3] = "agent:main:telegram:group:12345:99"

        query = AsyncMock()
        query.data = "ea:once:3"
        query.message = MagicMock()
        query.message.chat_id = 12345
        query.from_user = MagicMock()
        query.from_user.first_name = "Alice_Bob"
        query.answer = AsyncMock()
        query.edit_message_text = AsyncMock()

        update = MagicMock()
        update.callback_query = query
        context = MagicMock()
        query.from_user.id = "12345"

        with patch.dict(os.environ, {"TELEGRAM_ALLOWED_USERS": "*"}, clear=False):
            with patch("tools.approval.resolve_gateway_approval", return_value=1):
                await adapter._handle_callback_query(update, context)

        edit_kwargs = query.edit_message_text.call_args[1]
        assert "MARKDOWN_V2" in repr(edit_kwargs["parse_mode"])
        assert "Alice\\_Bob" in edit_kwargs["text"]


    @pytest.mark.asyncio
    async def test_update_prompt_callback_not_affected(self, tmp_path):
        """Ensure update prompt callbacks still work."""
        adapter = _make_adapter()

        query = AsyncMock()
        query.data = "update_prompt:y"
        query.message = MagicMock()
        query.message.chat_id = 12345
        query.from_user = MagicMock()
        query.from_user.id = 123
        query.answer = AsyncMock()
        query.edit_message_text = AsyncMock()

        update = MagicMock()
        update.callback_query = query
        context = MagicMock()

        with patch("tools.approval.resolve_gateway_approval") as mock_resolve:
            with patch("hermes_constants.get_hermes_home", return_value=tmp_path):
                # Allow the caller — the new fail-closed allowlist gate
                # (#24457) rejects empty TELEGRAM_ALLOWED_USERS, but this
                # test isn't exercising that gate; it's verifying the
                # update_prompt callback still writes the response.
                with patch.dict(os.environ, {"TELEGRAM_ALLOWED_USERS": "*"}):
                    await adapter._handle_callback_query(update, context)

        # Should NOT have triggered approval resolution
        mock_resolve.assert_not_called()
        assert (tmp_path / ".update_response").read_text() == "y"

    @pytest.mark.asyncio
    async def test_update_prompt_callback_rejects_unauthorized_user(self, tmp_path):
        """Update prompt buttons should honor TELEGRAM_ALLOWED_USERS."""
        adapter = _make_adapter()

        query = AsyncMock()
        query.data = "update_prompt:y"
        query.message = MagicMock()
        query.message.chat_id = 12345
        query.from_user = MagicMock()
        query.from_user.id = 222
        query.answer = AsyncMock()
        query.edit_message_text = AsyncMock()

        update = MagicMock()
        update.callback_query = query
        context = MagicMock()

        with patch("hermes_constants.get_hermes_home", return_value=tmp_path):
            with patch.dict(os.environ, {"TELEGRAM_ALLOWED_USERS": "111"}):
                await adapter._handle_callback_query(update, context)

        query.answer.assert_called_once()
        assert query.answer.call_args[1]["text"] == unauthorized_action_notice("telegram")
        query.edit_message_text.assert_not_called()
        assert not (tmp_path / ".update_response").exists()

    @pytest.mark.asyncio
    async def test_update_prompt_callback_rejects_user_blocked_by_global_allowlist(self, tmp_path):
        adapter = _make_adapter()
        runner = _AuthRunner(authorized=False)
        adapter._message_handler = runner._handle_message

        query = AsyncMock()
        query.data = "update_prompt:y"
        query.message = MagicMock()
        query.message.chat_id = 12345
        query.message.chat.type = "private"
        query.from_user = MagicMock()
        query.from_user.id = 222
        query.from_user.first_name = "Mallory"
        query.answer = AsyncMock()
        query.edit_message_text = AsyncMock()

        update = MagicMock()
        update.callback_query = query
        context = MagicMock()

        with patch("hermes_constants.get_hermes_home", return_value=tmp_path):
            with patch.dict(os.environ, {"TELEGRAM_ALLOWED_USERS": ""}):
                await adapter._handle_callback_query(update, context)

        query.answer.assert_called_once()
        assert query.answer.call_args[1]["text"] == unauthorized_action_notice("telegram")
        query.edit_message_text.assert_not_called()
        assert not (tmp_path / ".update_response").exists()
        assert runner.last_source is not None
        assert runner.last_source.platform == Platform.TELEGRAM
        assert runner.last_source.user_id == "222"

