from __future__ import annotations

import pytest

from backend.exporters import export_automationml, export_sysml
from backend.model.ppr import PprElement, PprModel, PprRelationship, validate_ppr_model
from backend.model.scenarios import get_ppr_scenario, get_ppr_scenarios
from backend.sysml import stable_symbol


def test_scenario_registry_contains_only_proper_production_examples() -> None:
    scenarios = get_ppr_scenarios()

    assert [scenario.id for scenario in scenarios] == [
        "two-stage-finished-product",
        "body-side-spot-welding",
        "ev-battery-module-assembly",
        "centrifugal-pump-final-assembly",
    ]
    assert all(scenario.loadable and scenario.expected.valid for scenario in scenarios)
    assert len({scenario.id for scenario in scenarios}) == len(scenarios)


@pytest.mark.parametrize(
    "scenario_id", [scenario.id for scenario in get_ppr_scenarios()]
)
def test_each_example_is_canonical_and_matches_its_contract(scenario_id: str) -> None:
    scenario = get_ppr_scenario(scenario_id)
    result = validate_ppr_model(scenario.model)

    assert len(scenario.model.diagram.usages) == scenario.expected.elementCount
    assert (
        len(scenario.model.diagram.relationships) == scenario.expected.relationshipCount
    )
    assert result.valid
    assert not [issue for issue in result.issues if issue.severity == "error"]
    assert all(
        element.kind == "definition" for element in scenario.model.library.definitions
    )
    assert all(element.kind == "usage" for element in scenario.model.diagram.usages)
    assert all(
        relationship.kind in {"consumed_by", "produces", "performs", "succeeds", "contains", "becomes"}
        for relationship in scenario.model.diagram.relationships
    )


def test_examples_are_ready_for_both_sysml_modes_and_automationml() -> None:
    for scenario in get_ppr_scenarios():
        portable = export_sysml(scenario.model, mode="portable")
        ppr = export_sysml(scenario.model, mode="ppr")

        assert f"package <{stable_symbol(scenario.model.id)}>" in portable
        assert "library package PPR" in portable
        assert "item def" in portable
        assert "action processOccurrences" in portable
        assert "flow <" in portable
        assert "//" not in portable
        assert "library package 'PPR Semantic Metadata'" in ppr
        assert "#product def" in ppr
        assert "#process action" in ppr
        assert "#resource part" in ppr
        assert "<CAEXFile" in export_automationml(scenario.model)


def test_mixed_standalone_and_definition_backed_scenario_is_exportable() -> None:
    product_definition = PprElement(
        id="def-panel", name="Panel", type="product", kind="definition"
    )
    process_definition = PprElement(
        id="def-weld", name="Weld", type="process", kind="definition"
    )
    model = PprModel(
        id="mixed-scenario",
        name="Mixed standalone scenario",
        library={"definitions": [product_definition, process_definition]},
        diagram={
            "usages": [
                PprElement(
                    id="panel-standalone",
                    name="Panel from concept sketch",
                    type="product",
                    kind="usage",
                    definition_id=None,
                ),
                PprElement(
                    id="weld-backed",
                    name="Weld operation",
                    type="process",
                    kind="usage",
                    definition_id=process_definition.id,
                ),
            ],
            "relationships": [
                PprRelationship(
                    id="panel-input",
                    source_id="panel-standalone",
                    target_id="weld-backed",
                    kind="input_to",
                )
            ],
        },
    )

    assert validate_ppr_model(model).valid
    assert "Panel from concept sketch" in export_sysml(model)
    assert "Panel from concept sketch" in export_automationml(model)


def test_primary_example_has_real_process_and_resource_decomposition() -> None:
    model = get_ppr_scenario("body-side-spot-welding").model

    containment = [
        relationship
        for relationship in model.diagram.relationships
        if relationship.kind == "contains"
    ]
    assert len(containment) == 6
    assert {
        relationship.target_id
        for relationship in containment
        if relationship.source_id == "use_welding_cell"
    } == {"use_locating_fixture", "use_welding_robot", "use_weld_camera"}


def test_starter_example_has_input_intermediate_final_flow_and_dedicated_resources() -> None:
    model = get_ppr_scenario("two-stage-finished-product").model

    assert [
        element.id
        for element in model.diagram.usages
        if element.type == "product"
    ] == [
        "use_raw_material",
        "use_intermediate_part",
        "use_finished_product",
    ]
    assert [
        element.id
        for element in model.diagram.usages
        if element.type == "process"
    ] == ["use_form_part", "use_finish_part"]
    assert [
        (relationship.source_id, relationship.target_id)
        for relationship in model.diagram.relationships
        if relationship.kind == "performs"
    ] == [
        ("use_forming_station", "use_form_part"),
        ("use_finishing_station", "use_finish_part"),
    ]


def test_starter_example_includes_engineering_attributes() -> None:
    model = get_ppr_scenario("two-stage-finished-product").model
    elements = {element.id: element for element in model.elements}

    assert elements["use_raw_material"].attributes[0].value == "RM-2401"
    assert elements["use_intermediate_part"].attributes[0].unit == "kg"
    assert elements["use_form_part"].attributes[0].value == "18.4"
    assert elements["use_finish_part"].attributes[1].value == "passed"
    assert elements["use_forming_station"].attributes[1].value == "available"
    assert elements["use_finishing_station"].attributes[0].value == "FN-01"
