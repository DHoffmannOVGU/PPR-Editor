from __future__ import annotations

import json
from pathlib import Path

from backend.sysml_import import import_sysml

FIXTURES = Path(__file__).resolve().parents[1] / "examples" / "sysml"


def test_sysml_fixtures_project_to_valid_ppr_models() -> None:
    manifest = json.loads((FIXTURES / "manifest.json").read_text(encoding="utf-8"))
    for fixture in manifest["fixtures"]:
        model = import_sysml((FIXTURES / fixture["file"]).read_text(encoding="utf-8"))
        expected = fixture["expected"]
        assert len(model.library.definitions) == expected["definitionCount"]
        assert len(model.diagram.usages) == expected["usageCount"]
        assert len(model.diagram.relationships) == expected["relationshipCount"]
        assert {item.kind for item in model.diagram.relationships} == set(expected["relationshipKinds"])
