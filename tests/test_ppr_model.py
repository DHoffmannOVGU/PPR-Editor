from __future__ import annotations

from typing import get_args

import pytest
from pydantic import ValidationError

from backend.exporters import export_automationml, export_sysml
from backend.model.core import Attribute
from backend.model.ppr import (
    ALLOWED_RELATIONS,
    RELATIONSHIP_RULES,
    PprElement,
    PprModel,
    PprRelationship,
    ProductDefinition,
    ProductUsage,
    RelationKind,
    MergeUsagesRequest,
    example_model,
    merge_ppr_usages,
    validate_ppr_model,
)


def test_attribute_is_trimmed_and_supports_engineering_metadata() -> None:
    attribute = Attribute(
        name="  payload  ",
        value="20",
        datatype="number",
        unit="kg",
    )

    assert attribute.name == "payload"
    assert attribute.value == "20"
    assert attribute.datatype == "number"
    assert attribute.unit == "kg"
    assert attribute.id.startswith("attr_")


def test_blank_attribute_name_is_rejected() -> None:
    with pytest.raises(ValidationError):
        Attribute(name="   ", value="Steel")


def test_kernel_definitions_and_usages_keep_stable_ids() -> None:
    definition = ProductDefinition(id="sheet_def", name="Sheet Metal")
    usage = ProductUsage(id="sheet_1", name="sheet1", definition_id=definition.id)

    model = PprModel(
        id="model_1",
        name="Stable model",
        library={"definitions": [PprElement(**definition.model_dump())]},
        diagram={"usages": [PprElement(**usage.model_dump())], "relationships": []},
    )

    assert model.library.definitions[0].id == "sheet_def"
    assert model.library.definitions[0].kind == "definition"
    assert model.diagram.usages[0].definition_id == "sheet_def"
    assert validate_ppr_model(model).valid


def test_standalone_usage_can_mix_with_definition_backed_usage() -> None:
    product_definition = PprElement(
        id="sheet_def", name="Sheet Metal", type="product", kind="definition"
    )
    process_definition = PprElement(
        id="weld_def", name="Welding", type="process", kind="definition"
    )
    standalone_product = PprElement(
        id="sheet_1",
        name="Unclassified sheet",
        type="product",
        kind="usage",
        definition_id=None,
    )
    backed_process = PprElement(
        id="weld_1",
        name="Weld 1",
        type="process",
        kind="usage",
        definition_id=process_definition.id,
    )
    model = PprModel(
        id="mixed-model",
        name="Mixed model",
        library={"definitions": [product_definition, process_definition]},
        diagram={
            "usages": [standalone_product, backed_process],
            "relationships": [
                PprRelationship(
                    id="sheet-to-weld",
                    source_id=standalone_product.id,
                    target_id=backed_process.id,
                    kind="input_to",
                )
            ],
        },
    )

    assert validate_ppr_model(model).valid
    assert "Unclassified sheet" in export_sysml(model)
    assert "Unclassified sheet" in export_automationml(model)


def test_example_model_is_valid_and_semantically_complete() -> None:
    model = example_model()
    result = validate_ppr_model(model)

    assert result.valid
    assert {element.type for element in model.elements} == {
        "product",
        "process",
        "resource",
    }
    assert {relationship.kind for relationship in model.relationships} == {
        "consumed_by",
        "produces",
        "performs",
        "succeeds",
    }


@pytest.mark.parametrize(
    ("kind", "source_type", "target_type"),
    [
        ("input_to", "product", "process"),
        ("produces", "process", "product"),
        ("performs", "resource", "process"),
        ("supports", "resource", "process"),
        ("succeeds", "process", "process"),
        ("flows_to", "process", "process"),
        ("contains", "product", "product"),
        ("contains", "resource", "resource"),
        ("composed_of", "product", "product"),
        ("composed_of", "resource", "resource"),
    ],
)
def test_allowed_relationship_matrix(
    kind: str, source_type: str, target_type: str
) -> None:
    source = PprElement(id="source", name="Source", type=source_type, kind="definition")
    target = PprElement(id="target", name="Target", type=target_type, kind="definition")
    model = PprModel(
        elements=[source, target],
        relationships=[
            PprRelationship(
                id="relation",
                source_id=source.id,
                target_id=target.id,
                kind=kind,
            )
        ],
    )

    assert validate_ppr_model(model).valid


def test_backend_relationship_matrix_matches_shared_contract() -> None:
    expected = {
        kind: {(rule["source"], rule["target"]) for rule in rules}
        for kind, rules in RELATIONSHIP_RULES.items()
    }

    assert set(RELATIONSHIP_RULES) == set(get_args(RelationKind))
    assert ALLOWED_RELATIONS == expected


def test_identity_allows_a_definition_change_but_reports_it_as_info() -> None:
    definition = PprElement(
        id="material-def", name="Material", type="product", kind="definition"
    )
    source = PprElement(
        id="source",
        name="Source",
        type="product",
        kind="usage",
        definition_id=definition.id,
    )
    target_definition = PprElement(
        id="housing-def", name="Housing", type="product", kind="definition"
    )
    target = PprElement(
        id="target",
        name="Target",
        type="product",
        kind="usage",
        definition_id=target_definition.id,
    )
    model = PprModel(
        library={"definitions": [definition, target_definition]},
        diagram={
            "usages": [source, target],
            "relationships": [
                PprRelationship(
                    id="transfer",
                    source_id=source.id,
                    target_id=target.id,
                    kind="becomes",
                )
            ],
        },
    )

    result = validate_ppr_model(model)
    assert result.valid
    assert any(issue.code == "IDENT-8" and issue.severity == "info" for issue in result.issues)


def test_validation_warns_about_disconnected_diagram_usages() -> None:
    model = PprModel(
        diagram={
            "usages": [
                PprElement(
                    id="orphan-resource",
                    name="Unassigned gauge",
                    type="resource",
                    kind="usage",
                )
            ]
        }
    )

    result = validate_ppr_model(model)

    assert result.valid is True
    assert any(
        issue.severity == "warning"
        and issue.element_id == "orphan-resource"
        and "disconnected" in issue.message
        for issue in result.issues
    )


def test_validation_reports_missing_definitions_and_wrong_relationships() -> None:
    model = PprModel(
        elements=[
            PprElement(
                id="usage",
                name="robot1",
                type="resource",
                kind="usage",
                definition_id="missing",
            ),
            PprElement(id="product", name="Sheet", type="product", kind="definition"),
        ],
        relationships=[
            PprRelationship(
                id="bad_relation",
                source_id="product",
                target_id="usage",
                kind="performs",
            ),
            PprRelationship(
                id="missing_endpoint",
                source_id="product",
                target_id="deleted",
                kind="input_to",
            ),
        ],
    )

    result = validate_ppr_model(model)
    messages = [issue.message for issue in result.issues]

    assert not result.valid
    assert any("missing definition" in message for message in messages)
    assert any("not valid from product" in message for message in messages)
    assert any("does not exist" in message for message in messages)


def test_validation_reports_duplicate_ids_and_attribute_names() -> None:
    model = PprModel(
        elements=[
            PprElement(
                id="duplicate",
                name="First",
                type="product",
                kind="definition",
                attributes=[
                    {"id": "attr_1", "name": "material", "value": "Steel"},
                    {"id": "attr_1", "name": "Material", "value": "Aluminum"},
                ],
            ),
            PprElement(
                id="duplicate", name="Second", type="product", kind="definition"
            ),
        ]
    )

    result = validate_ppr_model(model)

    assert not result.valid
    assert any(issue.severity == "warning" for issue in result.issues)
    assert any("Duplicate element ID" in issue.message for issue in result.issues)
    assert any("Duplicate attribute ID" in issue.message for issue in result.issues)


def test_exporters_map_the_same_canonical_model() -> None:
    model = example_model()
    sysml = export_sysml(model)
    automationml = export_automationml(model)

    assert "item def <def_raw_material> 'Raw Material' :> Product" in sysml
    assert (
        "action def <def_form_part> 'Form Part' :> Process" in sysml
    )
    assert (
        "perform processOccurrences.use_form_part;"
        in sysml
    )
    assert "flow <rel_raw_to_form>" in sysml
    assert "//" not in sysml
    assert 'SchemaVersion="3.0"' in automationml
    assert automationml.count("<InstanceHierarchy") == 3
    assert '<RoleClassLib Name="PPRRoleClassLib">' in automationml
    assert 'ID="def_raw_material" Name="Product_Raw_Material"' in automationml
    assert (
        'RefBaseRoleClassPath="PPRRoleClassLib/Resource_Forming_Station"'
        in automationml
    )


def test_merge_ppr_usages_combines_attributes_and_retargets_relationships() -> None:
    first = PprElement(
        id="product-first",
        name="Sheet A",
        type="product",
        kind="usage",
        attributes=[
            {"id": "attr-material", "name": "Material", "value": "Steel"},
            {"id": "attr-thickness", "name": "Thickness", "value": 1},
        ],
    )
    second = PprElement(
        id="product-second",
        name="Sheet B",
        type="product",
        kind="usage",
        attributes=[
            {"id": "attr-material-b", "name": "Material", "value": "Aluminum"},
            {"id": "attr-width", "name": "Width", "value": 500, "unit": "mm"},
        ],
    )
    process = PprElement(
        id="process",
        name="Weld",
        type="process",
        kind="usage",
    )
    model = PprModel(
        diagram={
            "usages": [first, second, process],
            "relationships": [
                PprRelationship(
                    id="input-first",
                    source_id=first.id,
                    target_id=process.id,
                    kind="input_to",
                    quantity=1,
                    unit="kg",
                ),
                PprRelationship(
                    id="output-second",
                    source_id=process.id,
                    target_id=second.id,
                    kind="produces",
                ),
            ],
        }
    )

    merged = merge_ppr_usages(
        model,
        MergeUsagesRequest(
            first_id=first.id,
            second_id=second.id,
            survivor_id=first.id,
            name_source="second",
            description_source="first",
            definition_source="none",
            attribute_decisions=[{"name": "Material", "source": "both"}],
            self_loop_policy="reject",
        ),
    )

    survivor = next(usage for usage in merged.diagram.usages if usage.id == first.id)
    assert len(merged.diagram.usages) == 2
    assert survivor.name == second.name
    assert {attribute.name for attribute in survivor.attributes} == {
        "Material",
        "Thickness",
        "Width",
    }
    assert [
        attribute.value
        for attribute in survivor.attributes
        if attribute.name == "Material"
    ] == [
        "Steel",
        "Aluminum",
    ]
    assert {
        (relationship.source_id, relationship.target_id, relationship.kind)
        for relationship in merged.diagram.relationships
    } == {
        (first.id, process.id, "consumed_by"),
        (process.id, first.id, "produces"),
    }
    assert merged.diagram.relationships[0].quantity == 1
    assert merged.diagram.relationships[0].unit == "kg"
    assert all(usage.id != second.id for usage in merged.diagram.usages)


def test_merge_ppr_usages_deduplicates_retargeted_connections_deterministically() -> (
    None
):
    first = PprElement(id="first", name="First", type="process", kind="usage")
    second = PprElement(id="second", name="Second", type="process", kind="usage")
    successor = PprElement(
        id="successor", name="Successor", type="process", kind="usage"
    )
    model = PprModel(
        diagram={
            "usages": [first, second, successor],
            "relationships": [
                PprRelationship(
                    id="earliest",
                    source_id=first.id,
                    target_id=successor.id,
                    kind="succeeds",
                ),
                PprRelationship(
                    id="later",
                    source_id=second.id,
                    target_id=successor.id,
                    kind="succeeds",
                ),
            ],
        }
    )

    merged = merge_ppr_usages(
        model,
        MergeUsagesRequest(
            first_id=first.id,
            second_id=second.id,
            survivor_id=second.id,
            name_source="first",
            description_source="second",
            definition_source="none",
            self_loop_policy="reject",
        ),
    )

    assert len(merged.diagram.relationships) == 1
    assert merged.diagram.relationships[0].id == "earliest"
    assert merged.diagram.relationships[0].source_id == second.id


def test_merge_ppr_usages_requires_explicit_self_loop_policy() -> None:
    first = PprElement(id="first", name="Parent", type="product", kind="usage")
    second = PprElement(id="second", name="Child", type="product", kind="usage")
    model = PprModel(
        diagram={
            "usages": [first, second],
            "relationships": [
                PprRelationship(
                    id="composition",
                    source_id=first.id,
                    target_id=second.id,
                    kind="composed_of",
                )
            ],
        }
    )

    with pytest.raises(ValueError, match="self-loop"):
        merge_ppr_usages(
            model,
            MergeUsagesRequest(
                first_id=first.id,
                second_id=second.id,
                survivor_id=first.id,
                name_source="first",
                description_source="first",
                definition_source="none",
                self_loop_policy="reject",
            ),
        )

    merged = merge_ppr_usages(
        model,
        MergeUsagesRequest(
            first_id=first.id,
            second_id=second.id,
            survivor_id=first.id,
            name_source="first",
            description_source="first",
            definition_source="none",
            self_loop_policy="drop",
        ),
    )
    assert merged.diagram.relationships == []


def test_merge_ppr_usages_rejects_cross_type_and_missing_conflict_decisions() -> None:
    product = PprElement(id="product", name="Product", type="product", kind="usage")
    process = PprElement(
        id="process",
        name="Process",
        type="process",
        kind="usage",
        attributes=[{"id": "speed", "name": "Speed", "value": 10}],
    )
    other_process = PprElement(
        id="other-process",
        name="Other process",
        type="process",
        kind="usage",
        attributes=[{"id": "speed-other", "name": "Speed", "value": 20}],
    )
    model = PprModel(diagram={"usages": [product, process, other_process]})

    with pytest.raises(ValueError, match="same Product"):
        merge_ppr_usages(
            model,
            MergeUsagesRequest(
                first_id=product.id,
                second_id=process.id,
                survivor_id=product.id,
                name_source="first",
                description_source="first",
                definition_source="none",
                self_loop_policy="reject",
            ),
        )
    with pytest.raises(ValueError, match="conflicting attribute"):
        merge_ppr_usages(
            model,
            MergeUsagesRequest(
                first_id=process.id,
                second_id=other_process.id,
                survivor_id=process.id,
                name_source="first",
                description_source="first",
                definition_source="none",
                self_loop_policy="reject",
            ),
        )
