from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel

from .ppr import PprModel


SCENARIOS_PATH = (
    Path(__file__).resolve().parents[2]
    / "artifacts"
    / "ppr-modeler"
    / "src"
    / "testing"
    / "ppr-scenarios.json"
)


class PprScenarioExpectation(BaseModel):
    valid: bool
    issueIncludes: list[str]
    elementCount: int
    relationshipCount: int


class PprScenario(BaseModel):
    id: str
    label: str
    description: str
    characteristics: list[str]
    loadable: bool
    expected: PprScenarioExpectation
    model: PprModel


@lru_cache(maxsize=1)
def get_ppr_scenarios() -> tuple[PprScenario, ...]:
    payload = json.loads(SCENARIOS_PATH.read_text(encoding="utf-8"))
    return tuple(PprScenario.model_validate(item) for item in payload["scenarios"])


def get_ppr_scenario(scenario_id: str) -> PprScenario:
    for scenario in get_ppr_scenarios():
        if scenario.id == scenario_id:
            return scenario
    raise KeyError(f"Unknown PPR scenario: {scenario_id}")