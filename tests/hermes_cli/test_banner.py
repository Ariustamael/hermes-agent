"""Tests for banner toolset name normalization and skin color usage."""

from unittest.mock import patch

from rich.console import Console

from hermes_cli import banner
import model_tools
import tools.mcp_tool_discovery

def test_banner_snapshot_accepts_bom_without_weakening_freshness(tmp_path, monkeypatch):
    import json

    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setattr(banner, "get_git_banner_state", lambda: None)
    monkeypatch.setattr(banner, "get_available_skills", lambda: {"notes": ["café"]})
    tools = [{"function": {"name": "read_file"}}]
    banner.save_banner_snapshot(tools, ["file"], {}, {"read_file": "file"})
    path = banner._banner_snapshot_path()
    raw = path.read_bytes()
    assert not raw.startswith(b"\xef\xbb\xbf")
    expected = json.loads(raw)
    path.write_text(json.dumps(expected, ensure_ascii=False), encoding="utf-8-sig")
    assert banner.load_banner_snapshot(["file"]) == expected
    assert banner.load_banner_snapshot(["web"]) is None
    (tmp_path / "config.yaml").write_text("display: {skin: mono}", encoding="utf-8")
    assert banner.load_banner_snapshot(["file"]) is None

def test_cprint_falls_back_to_plain_print_when_prompt_toolkit_has_no_console(capsys):
    with patch(
        "prompt_toolkit.print_formatted_text",
        side_effect=RuntimeError("no console screen buffer"),
    ):
        banner.cprint("fallback text")

    assert capsys.readouterr().out == "fallback text\n"

def test_empty_model_shows_no_model_configured(tmp_path, monkeypatch):
    """The banner prints before credentials resolve; with no model it says so rather than guessing."""
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / ".hermes"))
    (tmp_path / ".hermes").mkdir()
    with (
        patch.object(model_tools, "check_tool_availability", return_value=([], [])),
        patch.object(banner, "get_available_skills", return_value={}),
        patch.object(banner, "get_update_result", return_value=None),
        patch.object(tools.mcp_tool_discovery, "get_mcp_status", return_value=[]),
    ):
        console = Console(record=True, force_terminal=False, color_system=None, width=160)
        banner.build_welcome_banner(console=console, model="", cwd="/tmp/project", tools=[],
                                    enabled_toolsets=[], provider="auto")
    assert "no model configured" in console.export_text()


def test_build_welcome_banner_does_not_center_pad_hero_art():
    """A braille hero relies on its own U+2800 padding for symmetry; Rich centering inserts
    ASCII spaces around the left column and distorts the silhouette (#9879). The hero line
    must start flush at the column start."""
    import io
    from types import SimpleNamespace

    skin = SimpleNamespace(banner_hero="[green]\u2800X[/]", banner_logo="")
    buf = io.StringIO()
    with (
        patch.object(model_tools, "check_tool_availability", return_value=([], [])),
        patch.object(banner, "get_available_skills", return_value={}),
        patch.object(banner, "get_update_result", return_value=None),
        patch.object(banner, "get_latest_release_tag", return_value=None),
        patch.object(tools.mcp_tool_discovery, "get_mcp_status", return_value=[]),
        patch.object(banner, "_active_skin", return_value=skin),
    ):
        console = Console(file=buf, force_terminal=False, color_system=None, width=80)
        banner.build_welcome_banner(console=console, model="m", cwd="/tmp", tools=[],
                                    get_toolset_for_tool=lambda _: None)

    hero_line = next(line for line in buf.getvalue().splitlines() if "\u2800X" in line)
    assert hero_line.startswith("\u2502  \u2800X"), repr(hero_line)


def test_baked_banner_uses_live_identity(monkeypatch):
    from hermes_cli import banner, version_info

    monkeypatch.setattr(version_info, "get_code_identity", lambda: {"short_sha": "a1b2c3d4"})
    assert banner._baked_banner_state() == {"upstream": "a1b2c3d4", "local": "a1b2c3d4", "ahead": 0, "behind": 0}


def test_banner_can_hide_capability_catalogs(tmp_path, monkeypatch):
    """The compact startup preference hides tools, MCP status, and skills."""
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    (home / "config.yaml").write_text('{"display": {"startup_banner": {"show_capabilities": false}}}')

    with (
        patch.object(model_tools, "check_tool_availability", return_value=(["file"], [])),
        patch.object(banner, "get_available_skills", return_value={"creative": ["ascii-art"]}),
        patch.object(banner, "get_update_result", return_value=None),
        patch.object(
            tools.mcp_tool_discovery,
            "get_mcp_status",
            return_value=[{"name": "documents", "transport": "stdio", "tools": 10, "connected": True}],
        ),
    ):
        console = Console(record=True, force_terminal=False, color_system=None, width=160)
        banner.build_welcome_banner(
            console=console,
            model="m",
            cwd="/tmp",
            tools=[{"function": {"name": "read_file"}}],
            enabled_toolsets=["file", "skills"],
            get_toolset_for_tool=lambda n: "file",
        )

    output = console.export_text()
    assert "Available Tools" not in output
    assert "MCP Servers" not in output
    assert "Available Skills" not in output
    assert "read_file" not in output
    assert "documents" not in output
    assert "ascii-art" not in output
    assert "/help for commands" in output


def test_banner_reports_carried_and_pending_upstream_commits(monkeypatch):
    monkeypatch.setattr(banner, "get_git_banner_state", lambda: {
        "upstream": "upstream", "local": "local", "ahead": 28, "behind": 3386,
    })
    monkeypatch.setattr("hermes_cli.update_channel.resolve_update_channel", lambda *_: "main")
    assert "+28 carried commits; 3386 upstream commits pending" in banner.format_banner_version_label()


def test_git_banner_state_counts_pending_upstream_commits(tmp_path, monkeypatch):
    monkeypatch.setattr(
        banner.source_check,
        "_git_stdout",
        lambda args, **_: {"origin/main": "upstream", "HEAD": "local"}[args[-1]],
    )
    monkeypatch.setattr(
        banner.source_check,
        "_git_count",
        lambda args, **_: 28 if args[-1] == "origin/main..HEAD" else 3386,
    )
    assert banner._compute_git_banner_state(tmp_path) == {
        "upstream": "upstream", "local": "local", "ahead": 28, "behind": 3386,
    }
