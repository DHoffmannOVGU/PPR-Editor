from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from xml.etree import ElementTree

from automationml import (
    AdditionalInformation as AmlAdditionalInformation,
    Attribute as AmlAttribute,
    CAEXFile,
    InstanceHierarchy,
    InterfaceClass,
    InterfaceClassLib,
    InterfaceFamily,
    InternalElement,
    InternalLink,
    RoleClassLib,
    RoleFamily,
    RoleRequirements,
    SourceDocumentInformation,
    TextElement,
    XmlExtensionNode,
    XmlExtensionPayload,
)
from pydantic import ValidationError

from .model.core import Attribute
from .model.ppr import (
    PprElement,
    PprModel,
    PprRelationship,
    derive_ppr_items,
    validate_ppr_model,
)
from .sysml import SysmlMode
from .sysml import export_sysml as _export_sysml


class AutomationMlExportError(ValueError):
    """Raised when a PPR model cannot be lowered to the AutomationML profile."""


class AutomationMlImportError(ValueError):
    """Raised when an AutomationML document cannot be projected into PPR."""


def export_sysml(model: PprModel, mode: SysmlMode = "portable") -> str:
    return _export_sysml(model, mode)


def _attribute_datatype(attribute: Attribute) -> str:
    if attribute.datatype:
        return attribute.datatype
    if isinstance(attribute.value, bool):
        return "boolean"
    if isinstance(attribute.value, int):
        return "integer"
    if isinstance(attribute.value, float):
        return "real"
    return "string"


def _attribute_value(attribute: Attribute) -> str:
    if isinstance(attribute.value, bool):
        return "true" if attribute.value else "false"
    return str(attribute.value)


_AUTOMATIONML_FIXTURES = Path(__file__).resolve().parents[1] / "examples" / "automationml"
_BASE_ROLE_LIBRARY = "AutomationMLBaseRoleClassLib"
_BASE_INTERFACE_LIBRARY = "AutomationMLInterfaceClassLib"
_EDITOR_ROLE_LIBRARY = "PPRRoleClassLib"
_PPR_CONNECTOR = (
    f"{_BASE_INTERFACE_LIBRARY}/AutomationMLBaseInterface/PPRConnector"
)


def _aml_datatype(attribute: Attribute) -> str:
    datatype = _attribute_datatype(attribute).lower().removeprefix("xs:")
    aliases = {
        "bool": "boolean",
        "int": "integer",
        "float": "double",
        "real": "double",
        "number": "double",
        "str": "string",
    }
    return f"xs:{aliases.get(datatype, datatype)}"


def _aml_attribute(attribute: Attribute) -> AmlAttribute:
    return AmlAttribute(
        id=attribute.id,
        name=attribute.name,
        value=_attribute_value(attribute),
        unit=attribute.unit,
        attribute_data_type=_aml_datatype(attribute),
    )


def _aml_extension(name: str, attributes: dict[str, str]) -> AmlAdditionalInformation:
    return AmlAdditionalInformation(
        xml=XmlExtensionPayload(
            children=[XmlExtensionNode(name=name, attributes=attributes)]
        )
    )


def _base_role_library() -> RoleClassLib:
    """The small standard-library subset required by the PPR profile."""
    base_path = f"{_BASE_ROLE_LIBRARY}/AutomationMLBaseRole"
    return RoleClassLib(
        name=_BASE_ROLE_LIBRARY,
        description=TextElement(value="AutomationML base roles used by PPR"),
        role_classes=[
            RoleFamily(
                name="AutomationMLBaseRole",
                role_classes=[
                    RoleFamily(name="Facet", ref_base_class_path=base_path),
                    RoleFamily(name="Product", ref_base_class_path=base_path),
                    RoleFamily(name="Process", ref_base_class_path=base_path),
                    RoleFamily(name="Resource", ref_base_class_path=base_path),
                    RoleFamily(
                        name="Structure",
                        ref_base_class_path=base_path,
                        role_classes=[
                            RoleFamily(
                                name="ResourceStructure",
                                ref_base_class_path=f"{base_path}/Structure",
                            )
                        ],
                    ),
                ],
            )
        ],
    )


def _base_interface_library() -> InterfaceClassLib:
    base_path = f"{_BASE_INTERFACE_LIBRARY}/AutomationMLBaseInterface"
    return InterfaceClassLib(
        name=_BASE_INTERFACE_LIBRARY,
        description=TextElement(value="AutomationML interfaces used by PPR"),
        interface_classes=[
            InterfaceFamily(
                name="AutomationMLBaseInterface",
                interface_classes=[
                    InterfaceFamily(
                        name="PPRConnector", ref_base_class_path=base_path
                    )
                ],
            )
        ],
    )


def _extended_role_library() -> RoleClassLib:
    """Read only the RoleClassLib payload from the supplied standard file."""
    fixture = _AUTOMATIONML_FIXTURES / "AutomationMLExtendedRoleClassLib.aml"
    try:
        document = CAEXFile.from_aml_xml(fixture.read_text(encoding="utf-8-sig"))
        library = next(
            item
            for item in document.role_class_libs
            if item.name == "AutomationMLExtendedRoleClassLib"
        )
    except (OSError, StopIteration, ValueError) as error:
        raise AutomationMlExportError(
            f"Could not load the AutomationML extended role classes: {error}"
        ) from error
    return library.model_copy(deep=True)


def _role_paths(library: RoleClassLib) -> dict[str, str]:
    paths: dict[str, str] = {}

    def visit(role: RoleFamily, prefix: str) -> None:
        path = f"{prefix}/{role.name}"
        paths.setdefault(role.name.casefold(), path)
        for child in role.role_classes:
            visit(child, path)

    for role in library.role_classes:
        visit(role, library.name)
    return paths


def _definition_class_names(definitions: list[PprElement]) -> dict[str, str]:
    candidates = {
        definition.id: f"{definition.type.title()}_{safe_name(definition.name)}"
        for definition in definitions
    }
    counts: dict[str, int] = {}
    for candidate in candidates.values():
        counts[candidate] = counts.get(candidate, 0) + 1
    return {
        definition_id: (
            candidate
            if counts[candidate] == 1
            else f"{candidate}_{safe_name(definition_id)}"
        )
        for definition_id, candidate in candidates.items()
    }


def _editor_role_library(
    definitions: list[PprElement], extended_paths: dict[str, str]
) -> tuple[RoleClassLib, dict[str, str]]:
    class_names = _definition_class_names(definitions)
    class_paths = {
        definition_id: f"{_EDITOR_ROLE_LIBRARY}/{class_name}"
        for definition_id, class_name in class_names.items()
    }
    roles: list[RoleFamily] = []
    for definition in definitions:
        base_path = (
            class_paths.get(definition.parent_definition_id or "")
            or (
                extended_paths.get(definition.name.casefold())
                if definition.type == "resource"
                else None
            )
            or f"{_BASE_ROLE_LIBRARY}/AutomationMLBaseRole/{definition.type.title()}"
        )
        metadata = {
            "Name": definition.name,
            "Type": definition.type,
            "VisibleInPPR": str(definition.visible_in_ppr).lower(),
        }
        if definition.domain is not None:
            metadata["Domain"] = definition.domain
        if definition.parent_definition_id is not None:
            metadata["ParentDefinitionID"] = definition.parent_definition_id
        if definition.states is not None:
            metadata["States"] = json.dumps(definition.states, ensure_ascii=False)
        roles.append(
            RoleFamily(
                id=definition.id,
                name=class_names[definition.id],
                description=TextElement(value=definition.description),
                ref_base_class_path=base_path,
                attributes=[_aml_attribute(item) for item in definition.attributes],
                additional_information=[_aml_extension("PPRDefinition", metadata)],
            )
        )
    return RoleClassLib(name=_EDITOR_ROLE_LIBRARY, role_classes=roles), class_paths


def _relationship_metadata(relationship: PprRelationship) -> dict[str, str]:
    metadata = {"Kind": relationship.kind}
    if relationship.role_name is not None:
        metadata["RoleName"] = relationship.role_name
    if relationship.quantity is not None:
        metadata["Quantity"] = format(relationship.quantity, ".15g")
    if relationship.unit is not None:
        metadata["Unit"] = relationship.unit
    if relationship.lower_bound is not None:
        metadata["LowerBound"] = str(relationship.lower_bound)
    if relationship.upper_bound is not None:
        metadata["UpperBound"] = str(relationship.upper_bound)
    if relationship.modality is not None:
        metadata["Modality"] = relationship.modality
    if relationship.byproduct is not None:
        metadata["Byproduct"] = str(relationship.byproduct).lower()
    if relationship.per is not None:
        metadata["Per"] = relationship.per
    if relationship.join is not None:
        metadata["Join"] = relationship.join
    if relationship.min_offset is not None:
        metadata["MinOffset"] = format(relationship.min_offset, ".15g")
    if relationship.max_offset is not None:
        metadata["MaxOffset"] = format(relationship.max_offset, ".15g")
    if relationship.offset_unit is not None:
        metadata["OffsetUnit"] = relationship.offset_unit
    return metadata


def export_automationml(model: PprModel) -> str:
    validation = validate_ppr_model(model)
    errors = [issue for issue in validation.issues if issue.severity == "error"]
    if errors:
        details = "; ".join(
            (
                f"relationship '{issue.relationship_id}'"
                if issue.relationship_id
                else f"element '{issue.element_id}'"
            )
            + f": {issue.message}"
            for issue in errors
        )
        raise AutomationMlExportError(f"PPR model is not exportable: {details}")

    definitions_by_id = {item.id: item for item in model.library.definitions}
    usages_by_id = {usage.id: usage for usage in model.diagram.usages}
    children_by_parent: dict[str, list[PprElement]] = {}
    parent_by_child: dict[str, str] = {}
    item_id_by_usage = {
        node.element_id: item.id
        for item in derive_ppr_items(model)
        for node in item.chain
    }
    for relationship in model.diagram.relationships:
        if relationship.kind == "contains":
            if relationship.target_id in parent_by_child:
                raise AutomationMlExportError(
                    f"relationship '{relationship.id}': usage '{relationship.target_id}' "
                    "has more than one owning parent."
                )
            parent_by_child[relationship.target_id] = relationship.source_id
            children_by_parent.setdefault(relationship.source_id, []).append(
                usages_by_id[relationship.target_id]
            )

    extended_library = _extended_role_library()
    editor_library, definition_paths = _editor_role_library(
        model.library.definitions, _role_paths(extended_library)
    )

    interfaces_by_usage: dict[str, list[InterfaceClass]] = {
        usage.id: [] for usage in model.diagram.usages
    }
    links_by_source: dict[str, list[InternalLink]] = {}
    for relationship in model.diagram.relationships:
        if relationship.kind == "contains":
            continue
        source_interface_id = f"{relationship.id}__source"
        target_interface_id = f"{relationship.id}__target"
        interfaces_by_usage[relationship.source_id].append(
            InterfaceClass(
                id=source_interface_id,
                name=f"{safe_name(relationship.id)}_source",
                ref_base_class_path=_PPR_CONNECTOR,
            )
        )
        interfaces_by_usage[relationship.target_id].append(
            InterfaceClass(
                id=target_interface_id,
                name=f"{safe_name(relationship.id)}_target",
                ref_base_class_path=_PPR_CONNECTOR,
            )
        )
        links_by_source.setdefault(relationship.source_id, []).append(
            InternalLink(
                id=relationship.id,
                name=relationship.id,
                ref_partner_side_a=source_interface_id,
                ref_partner_side_b=target_interface_id,
                additional_information=[
                    _aml_extension(
                        "PPRRelationship", _relationship_metadata(relationship)
                    )
                ],
            )
        )

    def build_usage(usage: PprElement) -> InternalElement:
        if usage.definition_id and usage.definition_id not in definitions_by_id:
            raise AutomationMlExportError(
                f"Element '{usage.id}' ('{usage.name}') references missing "
                f"definition '{usage.definition_id}'."
            )
        role_path = definition_paths.get(usage.definition_id or "") or (
            f"{_BASE_ROLE_LIBRARY}/AutomationMLBaseRole/{usage.type.title()}"
        )
        attributes = [_aml_attribute(item) for item in usage.attributes]
        if usage.id in item_id_by_usage:
            attributes.append(
                _aml_attribute(
                    Attribute(
                        id=f"{usage.id}__item_id",
                        name="ItemId",
                        value=item_id_by_usage[usage.id],
                    )
                )
            )
        if usage.state is not None:
            attributes.append(
                _aml_attribute(
                    Attribute(
                        id=f"{usage.id}__state", name="State", value=usage.state
                    )
                )
            )
        return InternalElement(
            id=usage.id,
            name=usage.name,
            description=TextElement(value=usage.description),
            attributes=attributes,
            external_interfaces=interfaces_by_usage[usage.id],
            internal_elements=[
                build_usage(child) for child in children_by_parent.get(usage.id, [])
            ],
            internal_links=links_by_source.get(usage.id, []),
            role_requirements=[RoleRequirements(ref_base_role_class_path=role_path)],
        )

    roots_by_type = {
        element_type: [
            usage
            for usage in model.diagram.usages
            if usage.type == element_type and usage.id not in parent_by_child
        ]
        for element_type in ("product", "process", "resource")
    }
    hierarchies = [
        InstanceHierarchy(
            id=f"{model.id}__{element_type}",
            name=f"{model.name} - {element_type.title()} View",
            internal_elements=[build_usage(usage) for usage in roots_by_type[element_type]],
        )
        for element_type in ("product", "process", "resource")
    ]
    document = CAEXFile(
        file_name=f"{safe_name(model.name)}.aml",
        additional_information=[
            AmlAdditionalInformation(aml_version="2.0"),
            _aml_extension(
                "PPRModel",
                {"ID": model.id, "Name": model.name, "Description": model.description},
            ),
        ],
        superior_standard_versions=["AutomationML 2.10"],
        source_document_information=[
            SourceDocumentInformation(
                origin_name="PPR Modeler",
                origin_id="ppr-modeler",
                origin_version="2.0",
                last_writing_date_time=datetime.now(UTC),
            )
        ],
        interface_class_libs=[_base_interface_library()],
        role_class_libs=[
            _base_role_library(),
            extended_library,
            editor_library,
        ],
        instance_hierarchies=hierarchies,
    )
    return document.to_aml_xml(include_default_change_mode=False)


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _children(node: ElementTree.Element, name: str) -> list[ElementTree.Element]:
    return [child for child in list(node) if _local_name(child.tag) == name]


def _child(node: ElementTree.Element, name: str) -> ElementTree.Element | None:
    return next(iter(_children(node, name)), None)


def _value(node: ElementTree.Element) -> str:
    value = _child(node, "Value")
    return value.text or "" if value is not None else ""


def _typed_value(raw: str, datatype: str | None) -> str | int | float | bool:
    normalized = (datatype or "").lower().removeprefix("xs:")
    if normalized in {"boolean", "bool"}:
        return raw.strip().lower() == "true"
    if normalized in {"integer", "int", "long"}:
        try:
            return int(raw)
        except ValueError:
            return raw
    if normalized in {"real", "float", "double", "decimal"}:
        try:
            return float(raw)
        except ValueError:
            return raw
    return raw


def _import_attributes(element: ElementTree.Element) -> list[Attribute]:
    result: list[Attribute] = []
    for index, node in enumerate(_children(element, "Attribute"), start=1):
        if node.get("Name") in {"ItemId", "State"}:
            continue
        raw_datatype = node.get("PPRDatatype") or node.get("AttributeDataType")
        datatype = raw_datatype.removeprefix("xs:") if raw_datatype else None
        result.append(
            Attribute(
                id=node.get("ID") or f"attr_{element.get('ID', 'element')}_{index}",
                name=node.get("Name") or f"Attribute {index}",
                value=_typed_value(_value(node), raw_datatype),
                datatype=datatype,
                unit=node.get("PPRUnit") or node.get("Unit"),
            )
        )
    return result


def _role_type(role_path: str | None) -> tuple[str, str]:
    parts = (role_path or "").split("/")
    if len(parts) != 3 or parts[0] != "PPR" or parts[1].lower() not in {
        "product",
        "process",
        "resource",
    } or parts[2].lower() not in {"definition", "usage"}:
        raise AutomationMlImportError(
            f"Unsupported or missing PPR role class path '{role_path or '<none>'}'."
        )
    return parts[1].lower(), parts[2].lower()


def _element_role(element: ElementTree.Element) -> tuple[str, str]:
    role = _child(element, "RoleRequirements")
    return _role_type(role.get("RefBaseRoleClassPath") if role is not None else None)


def _link_metadata(link: ElementTree.Element) -> dict[str, str]:
    values: dict[str, str] = {}
    for node in _children(link, "Attribute"):
        name = node.get("Name")
        if name:
            values[name] = _value(node)
    for node in link.iter():
        if _local_name(node.tag) != "PPRRelationship":
            continue
        metadata_attributes = {
            "Kind": "kind",
            "RoleName": "role_name",
            "Quantity": "quantity",
            "Unit": "unit",
            "LowerBound": "lower_bound",
            "UpperBound": "upper_bound",
            "Modality": "modality",
            "Byproduct": "byproduct",
            "Per": "per",
            "Join": "join",
            "MinOffset": "min_offset",
            "MaxOffset": "max_offset",
            "OffsetUnit": "offset_unit",
        }
        for source_name, target_name in metadata_attributes.items():
            if source_name in node.attrib:
                values[target_name] = node.attrib[source_name]
        break
    for key in (
        "kind", "role_name", "quantity", "unit", "lower_bound", "upper_bound",
        "modality", "byproduct", "per", "join", "min_offset", "max_offset",
        "offset_unit",
    ):
        if key in link.attrib:
            values[key] = link.attrib[key]
    return values


def _optional_int(value: str | None) -> int | None:
    return int(value) if value not in (None, "") else None


def _optional_upper(value: str | None) -> int | str | None:
    if value in (None, ""):
        return None
    return "*" if value == "*" else int(value)


def import_automationml(content: str) -> PprModel:
    """Project the deterministic PPR AutomationML profile into canonical PPR."""
    if not content.strip():
        raise AutomationMlImportError("The AutomationML document is empty.")
    try:
        root = ElementTree.fromstring(content)
    except ElementTree.ParseError as error:
        raise AutomationMlImportError(f"Invalid AutomationML XML: {error}") from error
    if _local_name(root.tag) != "CAEXFile":
        raise AutomationMlImportError("The document root must be CAEXFile.")
    hierarchies = [
        node for node in root.iter() if _local_name(node.tag) == "InstanceHierarchy"
    ]
    if not hierarchies:
        raise AutomationMlImportError("AutomationML does not contain an InstanceHierarchy.")

    def extension(node: ElementTree.Element, name: str) -> ElementTree.Element | None:
        for information in _children(node, "AdditionalInformation"):
            match = next(
                (child for child in list(information) if _local_name(child.tag) == name),
                None,
            )
            if match is not None:
                return match
        return None

    definitions: list[PprElement] = []
    definition_by_role_path: dict[str, PprElement] = {}
    editor_library = next(
        (
            node
            for node in root.iter()
            if _local_name(node.tag) == "RoleClassLib"
            and node.get("Name") == _EDITOR_ROLE_LIBRARY
        ),
        None,
    )
    if editor_library is not None:
        def read_role_classes(node: ElementTree.Element, prefix: str) -> None:
            for role in _children(node, "RoleClass"):
                role_path = f"{prefix}/{role.get('Name', '')}"
                metadata = extension(role, "PPRDefinition")
                if metadata is not None:
                    definition_id = role.get("ID")
                    if not definition_id:
                        raise AutomationMlImportError(
                            f"PPR role class '{role_path}' does not have an ID."
                        )
                    element_type = metadata.get("Type")
                    if element_type not in {"product", "process", "resource"}:
                        raise AutomationMlImportError(
                            f"PPR role class '{role_path}' has unsupported type "
                            f"'{element_type or '<none>'}'."
                        )
                    states: list[str] | None = None
                    if metadata.get("States"):
                        try:
                            raw_states = json.loads(metadata.get("States", "[]"))
                        except json.JSONDecodeError as error:
                            raise AutomationMlImportError(
                                f"PPR role class '{role_path}' has invalid states."
                            ) from error
                        if not isinstance(raw_states, list) or not all(
                            isinstance(item, str) for item in raw_states
                        ):
                            raise AutomationMlImportError(
                                f"PPR role class '{role_path}' has invalid states."
                            )
                        states = raw_states
                    description_node = _child(role, "Description")
                    definition = PprElement(
                        id=definition_id,
                        name=role.get("Name") or definition_id,
                        type=element_type,
                        kind="definition",
                        description=(
                            description_node.text or ""
                            if description_node is not None
                            else ""
                        ),
                        attributes=_import_attributes(role),
                        domain=metadata.get("Domain"),
                        parent_definition_id=metadata.get("ParentDefinitionID"),
                        visible_in_ppr=metadata.get("VisibleInPPR", "true").lower()
                        == "true",
                        states=states,
                    )
                    # The AML class name is path-safe. Preserve the editor name in
                    # a dedicated metadata field when present (new exports always do).
                    editor_name = metadata.get("Name")
                    if editor_name:
                        definition.name = editor_name
                    definitions.append(definition)
                    definition_by_role_path[role_path] = definition
                read_role_classes(role, role_path)

        read_role_classes(editor_library, _EDITOR_ROLE_LIBRARY)

    usages: list[PprElement] = []
    element_nodes: dict[str, ElementTree.Element] = {}
    element_types: dict[str, tuple[str, str]] = {}
    parent_by_child: dict[str, str] = {}
    definition_id_by_usage: dict[str, str] = {}
    interface_owner: dict[str, str] = {}
    for hierarchy in hierarchies:
        for node in hierarchy.iter():
            if _local_name(node.tag) != "InternalElement":
                continue
            element_id = node.get("ID")
            if not element_id:
                raise AutomationMlImportError("Every InternalElement must have an ID.")
            if element_id in element_nodes:
                raise AutomationMlImportError(
                    f"Duplicate InternalElement ID '{element_id}'."
                )
            element_nodes[element_id] = node
            role = _child(node, "RoleRequirements")
            role_path = role.get("RefBaseRoleClassPath") if role is not None else None
            role_definition = definition_by_role_path.get(role_path or "")
            if role_definition is not None:
                element_type, element_kind = role_definition.type, "usage"
                definition_id_by_usage[element_id] = role_definition.id
            elif role_path and role_path.startswith(
                f"{_BASE_ROLE_LIBRARY}/AutomationMLBaseRole/"
            ):
                element_type, element_kind = role_path.rsplit("/", 1)[-1].lower(), "usage"
                if element_type not in {"product", "process", "resource"}:
                    raise AutomationMlImportError(
                        f"Element '{element_id}' has unsupported base role '{role_path}'."
                    )
            else:
                try:
                    element_type, element_kind = _element_role(node)
                except AutomationMlImportError as error:
                    raise AutomationMlImportError(
                        f"Element '{element_id}' is invalid: {error}"
                    ) from error
            element_types[element_id] = element_type, element_kind
            description_node = _child(node, "Description")
            target = PprElement(
                id=element_id,
                name=node.get("Name") or element_id,
                type=element_type,
                kind=element_kind,
                description=(
                    description_node.text or "" if description_node is not None else ""
                ),
                attributes=_import_attributes(node),
                state=next(
                    (
                        _value(attribute)
                        for attribute in _children(node, "Attribute")
                        if attribute.get("Name") == "State"
                    ),
                    None,
                )
                if element_kind == "usage" and element_type == "product"
                else None,
            )
            (definitions if element_kind == "definition" else usages).append(target)
            for interface in _children(node, "ExternalInterface"):
                if interface.get("ID"):
                    interface_owner[interface.get("ID", "")] = element_id
            for child in _children(node, "InternalElement"):
                child_id = child.get("ID")
                if child_id:
                    parent_by_child[child_id] = element_id

    definitions_by_id = {item.id: item for item in definitions}
    usages_by_id = {item.id: item for item in usages}
    for usage in usages:
        node = element_nodes[usage.id]
        definition_id = definition_id_by_usage.get(usage.id) or node.get(
            "RefBaseSystemUnitPath"
        )
        role_requirements = _child(node, "RoleRequirements")
        mapping = (
            _child(node, "ExternalInterfaceMapping")
            or (
                _child(role_requirements, "ExternalInterfaceMapping")
                if role_requirements is not None
                else None
            )
        )
        if definition_id is None and mapping is not None:
            definition_id = mapping.get("RefPartnerSideA")
        if definition_id is not None:
            if definition_id not in definitions_by_id:
                raise AutomationMlImportError(
                    f"Usage '{usage.id}' references unknown definition '{definition_id}'."
                )
            usage.definition_id = definition_id

    relationships: list[PprRelationship] = []
    relationship_ids: set[str] = set()
    for link in root.iter():
        if _local_name(link.tag) != "InternalLink":
            continue
        relationship_id = link.get("Name")
        source_ref = link.get("RefPartnerSideA")
        target_ref = link.get("RefPartnerSideB")
        source_id = interface_owner.get(source_ref or "") or (
            source_ref.split(":", 1)[0] if source_ref else None
        )
        target_id = interface_owner.get(target_ref or "") or (
            target_ref.split(":", 1)[0] if target_ref else None
        )
        metadata = _link_metadata(link)
        if not relationship_id or not source_id or not target_id:
            raise AutomationMlImportError(
                "Every InternalLink must identify a name, source, and target."
            )
        if source_id not in usages_by_id or target_id not in usages_by_id:
            raise AutomationMlImportError(
                f"Relationship '{relationship_id}' references a non-usage endpoint "
                f"('{source_id}' -> '{target_id}')."
            )
        if relationship_id in relationship_ids:
            raise AutomationMlImportError(
                f"Duplicate relationship ID '{relationship_id}'."
            )
        kind = metadata.get("kind")
        if not kind:
            raise AutomationMlImportError(
                f"Relationship '{relationship_id}' is missing its PPR kind."
            )
        try:
            relationships.append(
                PprRelationship(
                    id=relationship_id,
                    source_id=source_id,
                    target_id=target_id,
                    kind=kind,
                    role_name=metadata.get("role_name"),
                    quantity=(
                        float(metadata["quantity"])
                        if metadata.get("quantity") not in (None, "")
                        else None
                    ),
                    unit=metadata.get("unit"),
                    lower_bound=_optional_int(metadata.get("lower_bound")),
                    upper_bound=_optional_upper(metadata.get("upper_bound")),
                    modality=metadata.get("modality"),
                    byproduct=(
                        metadata["byproduct"].strip().lower() == "true"
                        if metadata.get("byproduct") not in (None, "")
                        else None
                    ),
                    per=metadata.get("per"),
                    join=metadata.get("join"),
                    min_offset=(
                        float(metadata["min_offset"])
                        if metadata.get("min_offset") not in (None, "")
                        else None
                    ),
                    max_offset=(
                        float(metadata["max_offset"])
                        if metadata.get("max_offset") not in (None, "")
                        else None
                    ),
                    offset_unit=metadata.get("offset_unit"),
                )
            )
        except (ValidationError, ValueError) as error:
            raise AutomationMlImportError(
                f"Relationship '{relationship_id}' is invalid: {error}"
            ) from error
        relationship_ids.add(relationship_id)

    existing_relationships = {
        (item.source_id, item.target_id, item.kind) for item in relationships
    }
    for child_id, parent_id in parent_by_child.items():
        if child_id not in usages_by_id or parent_id not in usages_by_id:
            continue
        key = (parent_id, child_id, "contains")
        if key not in existing_relationships:
            relationships.append(
                PprRelationship(
                    id=f"contains_{child_id}",
                    source_id=parent_id,
                    target_id=child_id,
                    kind="contains",
                )
            )
            existing_relationships.add(key)

    model_metadata = extension(root, "PPRModel")
    first_hierarchy = hierarchies[0]
    model = PprModel(
        id=(
            model_metadata.get("ID")
            if model_metadata is not None
            else first_hierarchy.get("ID") or "imported_automationml_model"
        ),
        name=(
            model_metadata.get("Name")
            if model_metadata is not None
            else first_hierarchy.get("Name") or "Imported AutomationML model"
        ),
        description=(
            model_metadata.get("Description", "")
            if model_metadata is not None
            else ""
        ),
        library={"definitions": definitions},
        diagram={"usages": usages, "relationships": relationships},
    )
    validation = validate_ppr_model(model)
    errors = [
        (
            f"relationship '{issue.relationship_id}'"
            if issue.relationship_id
            else f"element '{issue.element_id}'"
            if issue.element_id
            else "model"
        )
        + f": {issue.message}"
        for issue in validation.issues
        if issue.severity == "error"
    ]
    if errors:
        raise AutomationMlImportError(
            "Imported AutomationML is not a valid PPR model: " + "; ".join(errors)
        )
    return model


def safe_name(value: str) -> str:
    return (
        "".join(character if character.isalnum() else "_" for character in value).strip(
            "_"
        )
        or "Unnamed"
    )
