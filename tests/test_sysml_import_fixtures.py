from __future__ import annotations

import json
from pathlib import Path
from typing import get_args

from backend.model.ppr import RelationKind

FIXTURE_DIRECTORY = Path(__file__).resolve().parents[1] / "examples" / "sysml"
MANIFEST_PATH = FIXTURE_DIRECTORY / "manifest.json"


def load_manifest() -> dict[str, object]:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def test_manifest_covers_every_sysml_fixture_once() -> None:
    manifest = load_manifest()
    fixtures = manifest["fixtures"]
    manifest_files = [fixture["file"] for fixture in fixtures]
    disk_files = sorted(path.name for path in FIXTURE_DIRECTORY.glob("*.sysml"))

    assert manifest["version"] == 1
    assert len(fixtures) == 7
    assert len(set(manifest_files)) == len(manifest_files)
    assert sorted(manifest_files) == disk_files


def test_fixture_expectations_use_the_canonical_ppr_vocabulary() -> None:
    manifest = load_manifest()
    allowed_kinds = set(get_args(RelationKind))

    for fixture in manifest["fixtures"]:
        expected = fixture["expected"]
        assert fixture["focus"]
        assert expected["definitionCount"] > 0
        assert expected["usageCount"] > 0
        assert expected["relationshipCount"] == sum(
            1
            for _ in _relationship_occurrences(
                (FIXTURE_DIRECTORY / fixture["file"]).read_text(encoding="utf-8")
            )
        )
        assert set(expected["relationshipKinds"]) <= allowed_kinds


def test_portable_and_profile_fixtures_are_self_contained() -> None:
    manifest = load_manifest()

    for fixture in manifest["fixtures"]:
        content = (FIXTURE_DIRECTORY / fixture["file"]).read_text(encoding="utf-8")
        assert content.count("{") == content.count("}")
        assert "productOccurrences" in content
        assert "processOccurrences" in content
        assert "resourceOccurrences" in content
        if fixture["mode"] == "portable":
            assert "library package PPR" in content
            assert " :> Product" in content
            assert "#product" not in content
        else:
            assert "library package 'PPR Semantic Metadata'" in content
            assert "#product def" in content
            assert "#process action" in content
            assert "#resource part" in content


def _relationship_occurrences(content: str):
    semantic_markers = (
        "flow <",
        "perform ",
        "succession <",
        "allocation <",
    )
    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith("flow <") and " of " in stripped:
            continue
        if stripped.startswith(semantic_markers):
            yield stripped

    # Nested occurrences encode PPR contains relationships. Container
    # declarations themselves are not PPR usages and are excluded.
    nesting_depths: list[int] = []
    for line in content.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith(("library", "package")):
            continue
        indentation = len(line) - len(line.lstrip())
        if stripped.startswith(("item <", "action <", "part <")):
            while nesting_depths and indentation <= nesting_depths[-1]:
                nesting_depths.pop()
            if nesting_depths:
                yield stripped
            if stripped.endswith("{"):
                nesting_depths.append(indentation)
        elif stripped == "}":
            while nesting_depths and indentation <= nesting_depths[-1]:
                nesting_depths.pop()
