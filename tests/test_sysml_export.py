from __future__ import annotations

import pytest

from backend.model.core import Attribute
from backend.model.ppr import PprModel, PprRelationship, example_model, validate_ppr_model
from backend.sysml import SysmlExportError, export_sysml, project_sysml, stable_symbol


def test_projection_preserves_starter_flow_and_resource_assignments() -> None:
    projection = project_sysml(example_model())
    assert [process.symbol for process in projection.process_usages] == [
        "use_form_part",
        "use_finish_part",
    ]
    assert [resource.symbol for resource in projection.resource_usages] == [
        "use_forming_station",
        "use_finishing_station",
    ]
    assert projection.resource_usages[0].performed_action_paths == [
        "processOccurrences.use_form_part"
    ]
    assert projection.resource_usages[1].performed_action_paths == [
        "processOccurrences.use_finish_part"
    ]
    assert [flow.symbol for flow in projection.flows] == [
        "rel_raw_to_form",
        "rel_form_to_intermediate",
        "rel_intermediate_to_finish",
        "rel_finish_to_final",
    ]


def test_portable_and_ppr_modes_share_the_same_lowering() -> None:
    model = example_model()
    portable = export_sysml(model, mode="portable")
    ppr = export_sysml(model, mode="ppr")

    assert "item def <def_raw_material> 'Raw Material' :> Product" in portable
    assert "#product def <def_raw_material> 'Raw Material'" in ppr
    assert "#product item <use_raw_material> 'Raw Material Infeed'" in ppr
    for semantic_statement in [
        "flow <rel_raw_to_form>",
        "perform processOccurrences.use_form_part;",
    ]:
        assert semantic_statement in portable
        assert semantic_statement in ppr
    assert "//" not in portable
    assert "//" not in ppr


def test_typed_attributes_and_relationship_quantities_are_emitted() -> None:
    portable = export_sysml(example_model())

    assert "'asset id' : String = \"FS-01\";" in portable
    assert "attribute requestedQuantity : Real = 1;" in portable


def test_identity_exports_as_one_occurrence_with_time_slices() -> None:
    model = PprModel.model_validate(
        {
            "id": "model-transfer",
            "name": "Transfer and containment",
            "library": {
                "definitions": [
                    {
                        "id": "def-material",
                        "name": "Material",
                        "type": "product",
                        "kind": "definition",
                    },
                    {
                        "id": "def-cell",
                        "name": "Cell",
                        "type": "resource",
                        "kind": "definition",
                    },
                    {
                        "id": "def-tool",
                        "name": "Tool",
                        "type": "resource",
                        "kind": "definition",
                    },
                ]
            },
            "diagram": {
                "usages": [
                    {
                        "id": "material-a",
                        "name": "Material A",
                        "type": "product",
                        "kind": "usage",
                        "definition_id": "def-material",
                        "state": "raw",
                    },
                    {
                        "id": "material-b",
                        "name": "Material B",
                        "type": "product",
                        "kind": "usage",
                        "definition_id": "def-material",
                        "state": "released",
                    },
                    {
                        "id": "cell",
                        "name": "Cell 1",
                        "type": "resource",
                        "kind": "usage",
                        "definition_id": "def-cell",
                    },
                    {
                        "id": "tool",
                        "name": "Tool",
                        "type": "resource",
                        "kind": "usage",
                        "definition_id": "def-tool",
                    },
                ],
                "relationships": [
                    {
                        "id": "identity",
                        "source_id": "material-a",
                        "target_id": "material-b",
                        "kind": "becomes",
                    },
                    {
                        "id": "owns-tool",
                        "source_id": "cell",
                        "target_id": "tool",
                        "kind": "contains",
                    },
                ],
            },
        }
    )

    exported = export_sysml(model)

    assert f"item <{stable_symbol('material-a')}>" in exported
    assert f"item <{stable_symbol('material-b')}>" not in exported
    assert "'__ppr_time_slices'" in exported
    assert "raw" in exported and "released" in exported
    assert "flow <identity>" not in exported
    assert f": {stable_symbol('def-tool')};" in exported


def test_export_rejects_unknown_units_instead_of_emitting_unresolved_names() -> None:
    model = example_model()
    model.library.definitions[0].attributes.append(
        Attribute(name="test quantity", value=1, datatype="real", unit="widgets")
    )

    with pytest.raises(SysmlExportError, match="unsupported SI unit 'widgets'"):
        export_sysml(model)


def test_becomes_rejects_material_qualifiers() -> None:
    model = example_model()
    model.diagram.relationships.append(
        PprRelationship(
            id="bad-identity",
            source_id="use_raw_material",
            target_id="use_finished_product",
            kind="becomes",
            quantity=1,
        )
    )

    result = validate_ppr_model(model)

    assert not result.valid
    assert any(
        issue.code == "IDENT-4"
        for issue in result.issues
    )


def test_stable_symbols_do_not_collapse_distinct_ppr_ids() -> None:
    assert stable_symbol("part-a") != stable_symbol("part_a")
    assert stable_symbol("part_a") == "part_a"
