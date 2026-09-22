from __future__ import annotations

from typing import Any
from pathlib import Path

import pytest

from backend.exporters import (
    export_automationml,
    export_sysml,
    import_automationml,
)
from backend.model.core import Attribute
from backend.model.ppr import PprElement, PprModel, PprRelationship
from backend.model.scenarios import get_ppr_scenarios
from backend.sysml_import import import_sysml


SYSML_FIXTURES = Path(__file__).resolve().parents[1] / "examples" / "sysml"
@pytest.fixture(scope="session")
def opensysml_validator() -> str:
    """Provision the pinned OpenSysML service used for strict syntax checks."""
    from opensysml.binary import ensure_binary

    try:
        return ensure_binary(version="v0.4.2")
    except Exception as error:
        pytest.fail(
            "Could not provision the OpenSysML v0.4.2 validator: "
            f"{type(error).__name__}: {error}"
        )


def _attribute_value(attribute: Attribute) -> Any:
    datatype = (attribute.datatype or "").lower()
    if datatype in {"real", "float", "double", "number"}:
        return float(attribute.value)
    if datatype in {"integer", "int"}:
        return int(attribute.value)
    if datatype in {"boolean", "bool"}:
        return (
            attribute.value
            if isinstance(attribute.value, bool)
            else str(attribute.value).lower() == "true"
        )
    return str(attribute.value)


def _attributes(elements: list[PprElement]) -> set[tuple[str, str, str, Any, str | None]]:
    return {
        (
            element.type,
            element.kind,
            attribute.name,
            _attribute_value(attribute),
            attribute.unit,
        )
        for element in elements
        for attribute in element.attributes
    }


def _semantic_model(model: PprModel) -> dict[str, object]:
    usages = model.diagram.usages
    by_id = {usage.id: usage for usage in usages}
    usage_key = {
        usage.id: (usage.type, usage.name, usage.definition_id, usage.description)
        for usage in usages
    }
    definition_names = {
        definition.id: (definition.type, definition.name, definition.description)
        for definition in model.library.definitions
    }
    usage_signatures = {
        (usage.type, usage.name, usage.definition_id, usage.description)
        for usage in usages
    }
    relationship_signatures = {
        (
            by_id[relationship.source_id].type,
            by_id[relationship.source_id].name,
            by_id[relationship.target_id].type,
            by_id[relationship.target_id].name,
            relationship.kind,
            relationship.role_name,
            relationship.quantity,
            relationship.unit,
            relationship.lower_bound,
            relationship.upper_bound,
        )
        for relationship in model.diagram.relationships
    }
    return {
        "name": model.name,
        "definitions": set(definition_names.values()),
        "usages": usage_signatures,
        "attributes": _attributes([*model.library.definitions, *usages]),
        "relationships": relationship_signatures,
        # Keep this field deliberately explicit: the normalized comparison must
        # include standalone usages rather than treating them as definitions.
        "standalone_usage_names": {
            usage.name for usage in usages if usage.definition_id is None
        },
    }


@pytest.mark.parametrize(
    "scenario_id", [scenario.id for scenario in get_ppr_scenarios()]
)
@pytest.mark.parametrize("mode", ["portable", "ppr"])
def test_production_scenarios_round_trip_through_sysml(
    scenario_id: str, mode: str
) -> None:
    source = next(
        scenario.model
        for scenario in get_ppr_scenarios()
        if scenario.id == scenario_id
    )

    imported = import_sysml(export_sysml(source, mode=mode))

    assert _semantic_model(imported) == _semantic_model(source)


@pytest.mark.parametrize(
    "scenario_id", [scenario.id for scenario in get_ppr_scenarios()]
)
def test_production_scenarios_round_trip_through_automationml(
    scenario_id: str,
) -> None:
    source = next(
        scenario.model
        for scenario in get_ppr_scenarios()
        if scenario.id == scenario_id
    )

    imported = import_automationml(export_automationml(source))

    assert _semantic_model(imported) == _semantic_model(source)


@pytest.mark.parametrize(
    "scenario_id", [scenario.id for scenario in get_ppr_scenarios()]
)
@pytest.mark.parametrize("mode", ["portable", "ppr"])
def test_exported_sysml_passes_external_validator(
    scenario_id: str, mode: str, opensysml_validator: str, tmp_path: Path
) -> None:
    source = next(
        scenario.model
        for scenario in get_ppr_scenarios()
        if scenario.id == scenario_id
    )
    fixture_path = tmp_path / f"{scenario_id}.{mode}.sysml"
    fixture_path.write_text(export_sysml(source, mode=mode), encoding="utf-8")

    try:
        import opensysml

        opensysml.load(
            str(fixture_path),
            strict=True,
            strict_conformance=True,
        )
    except Exception as error:
        pytest.fail(
            f"SysML v2 fixture '{scenario_id}' ({mode}) failed the "
            f"OpenSysML v0.4.2 strict validator: "
            f"{type(error).__name__}: {error}"
        )


@pytest.mark.parametrize(
    "scenario_id", [scenario.id for scenario in get_ppr_scenarios()]
)
def test_exported_automationml_passes_caex_validator(
    scenario_id: str, tmp_path: Path
) -> None:
    source = next(
        scenario.model
        for scenario in get_ppr_scenarios()
        if scenario.id == scenario_id
    )
    content = export_automationml(source)
    fixture_path = tmp_path / f"{scenario_id}.aml"
    fixture_path.write_text(content, encoding="utf-8")

    try:
        from automationml import CAEXFile

        document = CAEXFile.from_aml_xml(content)
    except Exception as error:
        pytest.fail(
            f"AutomationML fixture '{scenario_id}' failed the AutomationML "
            f"Python SDK parser: {type(error).__name__}: {error}"
        )

    assert document.schema_version == "3.0"
    assert len(document.instance_hierarchies) == 3
    assert {item.name.rsplit(" - ", 1)[-1] for item in document.instance_hierarchies} == {
        "Product View",
        "Process View",
        "Resource View",
    }
    editor_roles = next(
        item for item in document.role_class_libs if item.name == "PPRRoleClassLib"
    )
    assert len(editor_roles.role_classes) == len(source.library.definitions)


def test_automationml_definitions_are_role_classes_with_inheritance() -> None:
    source = PprModel(
        id="role-model",
        name="Role model",
        library={
            "definitions": [
                PprElement(
                    id="equipment",
                    name="Equipment",
                    type="resource",
                    kind="definition",
                ),
                PprElement(
                    id="welder",
                    name="Spot welder",
                    type="resource",
                    kind="definition",
                    parent_definition_id="equipment",
                ),
            ]
        },
        diagram={
            "usages": [
                PprElement(
                    id="welder-1",
                    name="Welder 1",
                    type="resource",
                    kind="usage",
                    definition_id="welder",
                )
            ]
        },
    )

    from automationml import CAEXFile

    document = CAEXFile.from_aml_xml(export_automationml(source))
    extended = next(
        item
        for item in document.role_class_libs
        if item.name == "AutomationMLExtendedRoleClassLib"
    )
    editor = next(
        item for item in document.role_class_libs if item.name == "PPRRoleClassLib"
    )
    equipment, welder = editor.role_classes

    assert extended.role_classes
    assert not document.external_references
    assert equipment.ref_base_class_path == "AutomationMLExtendedRoleClassLib/Equipment"
    assert welder.ref_base_class_path == "PPRRoleClassLib/Resource_Equipment"
    resource_view = next(
        item for item in document.instance_hierarchies if item.name.endswith("Resource View")
    )
    assert (
        resource_view.internal_elements[0]
        .role_requirements[0]
        .ref_base_role_class_path
        == "PPRRoleClassLib/Resource_Spot_welder"
    )
    assert import_automationml(document.to_aml_xml()).library.definitions == source.library.definitions


def test_standalone_usage_is_not_promoted_to_library_definition() -> None:
    source = PprModel(
        id="standalone-model",
        name="Standalone usage",
        diagram={
            "usages": [
                PprElement(
                    id="standalone-product",
                    name="Concept product",
                    type="product",
                    kind="usage",
                    attributes=[
                        {
                            "id": "concept-grade",
                            "name": "grade",
                            "value": "A",
                            "datatype": "string",
                        }
                    ],
                ),
                PprElement(
                    id="standalone-process",
                    name="Concept operation",
                    type="process",
                    kind="usage",
                ),
            ],
            "relationships": [
                PprRelationship(
                    id="concept-input",
                    source_id="standalone-product",
                    target_id="standalone-process",
                    kind="input_to",
                    quantity=2,
                    unit="kg",
                    lower_bound=1,
                    upper_bound="*",
                    role_name="charge",
                )
            ],
        },
    )

    sysml = import_sysml(export_sysml(source))
    automationml = import_automationml(export_automationml(source))

    assert not sysml.library.definitions
    assert not automationml.library.definitions
    assert _semantic_model(sysml) == _semantic_model(source)
    assert _semantic_model(automationml) == _semantic_model(source)


def test_sysml_round_trip_keeps_transfer_and_nested_multiplicity() -> None:
    source = import_sysml(
        (SYSML_FIXTURES / "04_transfer_multiplicity.portable.sysml").read_text(
            encoding="utf-8"
        )
    )

    imported = import_sysml(export_sysml(source))

    assert _semantic_model(imported) == _semantic_model(source)
