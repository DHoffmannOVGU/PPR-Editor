from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from hashlib import sha1
from typing import Literal

from .model.core import Attribute
from .model.ppr import (
    PprElement,
    PprModel,
    PprRelationship,
    PprType,
    derive_ppr_items,
    validate_ppr_model,
)

SysmlMode = Literal["portable", "ppr"]


class SysmlExportError(ValueError):
    """Raised when a valid PPR model cannot be lowered without guessing."""


@dataclass(frozen=True)
class SysmlAttribute:
    symbol: str
    name: str
    type_name: Literal["String", "Integer", "Real", "Boolean"]
    value: str
    unit: str | None = None


@dataclass(frozen=True)
class SysmlDefinition:
    symbol: str
    name: str
    kind: PprType
    attributes: tuple[SysmlAttribute, ...]


@dataclass(frozen=True)
class SysmlPort:
    relationship_symbol: str
    name: str
    direction: Literal["in", "out"]
    product_definition_symbol: str
    quantity: float | None
    unit: str | None
    lower_bound: int | None
    upper_bound: int | Literal["*"] | None


@dataclass
class SysmlUsage:
    symbol: str
    name: str
    kind: PprType
    definition_symbol: str
    attributes: tuple[SysmlAttribute, ...]
    lower_bound: int | None = None
    upper_bound: int | Literal["*"] | None = None
    children: list[SysmlUsage] = field(default_factory=list)
    ports: list[SysmlPort] = field(default_factory=list)
    performed_action_paths: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class SysmlFlow:
    symbol: str
    source_path: str
    target_path: str
    item_definition_symbol: str | None = None
    quantity: float | None = None
    unit: str | None = None
    lower_bound: int | None = None
    upper_bound: int | Literal["*"] | None = None


@dataclass(frozen=True)
class SysmlSuccession:
    symbol: str
    source_path: str
    target_path: str


@dataclass(frozen=True)
class SysmlAllocation:
    symbol: str
    process_path: str
    resource_path: str


@dataclass(frozen=True)
class SysmlProjection:
    model_symbol: str
    model_name: str
    definitions: tuple[SysmlDefinition, ...]
    product_usages: tuple[SysmlUsage, ...]
    process_usages: tuple[SysmlUsage, ...]
    resource_usages: tuple[SysmlUsage, ...]
    flows: tuple[SysmlFlow, ...]
    successions: tuple[SysmlSuccession, ...]
    allocations: tuple[SysmlAllocation, ...]


_RESERVED_SYMBOLS = {
    "action",
    "allocation",
    "attribute",
    "def",
    "first",
    "flow",
    "in",
    "item",
    "out",
    "package",
    "part",
    "perform",
    "then",
    "to",
    "productOccurrences",
    "processOccurrences",
    "resourceOccurrences",
}

_DATATYPES: dict[str, Literal["String", "Integer", "Real", "Boolean"]] = {
    "string": "String",
    "str": "String",
    "text": "String",
    "integer": "Integer",
    "int": "Integer",
    "real": "Real",
    "number": "Real",
    "float": "Real",
    "double": "Real",
    "boolean": "Boolean",
    "bool": "Boolean",
}

# Names provided by the standard SI library that are useful for manufacturing
# examples. Unknown unit text is rejected instead of emitting unresolved SysML.
_SI_UNITS = {
    "A",
    "Hz",
    "J",
    "K",
    "N",
    "Pa",
    "V",
    "W",
    "cm",
    "d",
    "g",
    "h",
    "kg",
    "km",
    "kW",
    "m",
    "min",
    "mm",
    "ohm",
    "s",
}


def stable_symbol(value: str) -> str:
    """Create a deterministic, collision-resistant SysML identifier from a PPR ID."""
    normalized = re.sub(r"[^A-Za-z0-9_]", "_", value).strip("_") or "id"
    if normalized[0].isdigit():
        normalized = f"id_{normalized}"
    if normalized in _RESERVED_SYMBOLS:
        normalized = f"ppr_{normalized}"
    if normalized != value:
        normalized = f"{normalized}_{sha1(value.encode('utf-8')).hexdigest()[:8]}"
    return normalized


def role_symbol(value: str) -> str:
    parts = [part for part in re.split(r"[^A-Za-z0-9]+", value.strip()) if part]
    if not parts:
        return "itemRole"
    symbol = parts[0][:1].lower() + parts[0][1:]
    symbol += "".join(part[:1].upper() + part[1:] for part in parts[1:])
    if symbol[0].isdigit():
        symbol = f"role{symbol}"
    if symbol in _RESERVED_SYMBOLS:
        symbol = f"ppr{symbol[:1].upper()}{symbol[1:]}"
    return symbol


def _long_name(value: str) -> str:
    return value.replace("\\", "\\\\").replace("'", "\\'")


def _number(value: object, context: str) -> float:
    if isinstance(value, bool):
        raise SysmlExportError(f"{context} must contain a number, not a boolean.")
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise SysmlExportError(
            f"{context} contains {value!r}, which is not numeric."
        ) from error
    if not math.isfinite(number):
        raise SysmlExportError(f"{context} must contain a finite number.")
    return number


def _project_attribute(attribute: Attribute, owner_name: str) -> SysmlAttribute:
    datatype = attribute.datatype.lower() if attribute.datatype else None
    if datatype is None:
        if isinstance(attribute.value, bool):
            type_name = "Boolean"
        elif isinstance(attribute.value, int):
            type_name = "Integer"
        elif isinstance(attribute.value, float):
            type_name = "Real"
        else:
            type_name = "String"
    else:
        type_name = _DATATYPES.get(datatype)
        if type_name is None:
            raise SysmlExportError(
                f"Attribute '{attribute.name}' on '{owner_name}' uses unsupported datatype "
                f"'{attribute.datatype}'."
            )

    if type_name == "String":
        value = json.dumps(str(attribute.value), ensure_ascii=False)
    elif type_name == "Boolean":
        if isinstance(attribute.value, bool):
            boolean = attribute.value
        elif str(attribute.value).strip().lower() in {"true", "false"}:
            boolean = str(attribute.value).strip().lower() == "true"
        else:
            raise SysmlExportError(
                f"Attribute '{attribute.name}' on '{owner_name}' is not a boolean value."
            )
        value = "true" if boolean else "false"
    elif type_name == "Integer":
        number = _number(
            attribute.value, f"Attribute '{attribute.name}' on '{owner_name}'"
        )
        if not number.is_integer():
            raise SysmlExportError(
                f"Attribute '{attribute.name}' on '{owner_name}' is not an integer value."
            )
        value = str(int(number))
    else:
        number = _number(
            attribute.value, f"Attribute '{attribute.name}' on '{owner_name}'"
        )
        value = format(number, ".15g")

    unit = attribute.unit
    if unit is not None:
        if type_name not in {"Integer", "Real"}:
            raise SysmlExportError(
                f"Attribute '{attribute.name}' on '{owner_name}' has a unit but is not numeric."
            )
        if unit not in _SI_UNITS:
            raise SysmlExportError(
                f"Attribute '{attribute.name}' on '{owner_name}' uses unsupported SI unit '{unit}'."
            )
    return SysmlAttribute(
        symbol=stable_symbol(attribute.id),
        name=attribute.name,
        type_name=type_name,
        value=value,
        unit=unit,
    )


def _project_element_attributes(
    element: PprElement,
) -> tuple[SysmlAttribute, ...]:
    attributes = [
        _project_attribute(attribute, element.name) for attribute in element.attributes
    ]
    if element.description:
        attributes.append(
            SysmlAttribute(
                symbol=stable_symbol(f"{element.id}__ppr_description"),
                name="__ppr_description",
                type_name="String",
                value=json.dumps(element.description, ensure_ascii=False),
            )
        )
    return tuple(attributes)


def _relationship_path(
    usage_id: str,
    usage_by_id: dict[str, PprElement],
    parent_by_child: dict[str, str],
) -> str:
    usage = usage_by_id[usage_id]
    container = {
        "product": "productOccurrences",
        "process": "processOccurrences",
        "resource": "resourceOccurrences",
    }[usage.type]
    ancestors: list[str] = []
    current_id: str | None = usage_id
    while current_id is not None:
        ancestors.append(stable_symbol(current_id))
        current_id = parent_by_child.get(current_id)
    return ".".join([container, *reversed(ancestors)])


def project_sysml(model: PprModel) -> SysmlProjection:
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
        raise SysmlExportError("PPR model is not exportable: " + details)

    representative_by_usage_id: dict[str, str] = {}
    lifecycle_attributes_by_head: dict[str, Attribute] = {}
    for item in derive_ppr_items(model):
        head_id = item.chain[0].element_id
        for node in item.chain:
            representative_by_usage_id[node.element_id] = head_id
        if len(item.chain) > 1 or any(node.state is not None for node in item.chain):
            lifecycle_attributes_by_head[head_id] = Attribute(
                id=f"{head_id}__time_slices",
                name="__ppr_time_slices",
                value=json.dumps(
                    [
                        {
                            "usage_id": node.element_id,
                            "state": node.state,
                        }
                        for node in item.chain
                    ],
                    ensure_ascii=False,
                    separators=(",", ":"),
                ),
                datatype="string",
            )

    projected_usages: list[PprElement] = []
    for usage in model.diagram.usages:
        if usage.type == "product" and representative_by_usage_id.get(usage.id) != usage.id:
            continue
        if usage.id in lifecycle_attributes_by_head:
            usage = usage.model_copy(
                update={
                    "attributes": [
                        *usage.attributes,
                        lifecycle_attributes_by_head[usage.id],
                    ]
                },
                deep=True,
            )
        projected_usages.append(usage)

    relationship_keys: set[tuple[str, str, str]] = set()
    projected_relationships: list[PprRelationship] = []
    for relationship in model.diagram.relationships:
        if relationship.kind == "becomes":
            continue
        source_id = representative_by_usage_id.get(
            relationship.source_id, relationship.source_id
        )
        target_id = representative_by_usage_id.get(
            relationship.target_id, relationship.target_id
        )
        if source_id == target_id:
            continue
        key = (source_id, target_id, relationship.kind)
        if key in relationship_keys:
            continue
        relationship_keys.add(key)
        projected_relationships.append(
            relationship.model_copy(
                update={"source_id": source_id, "target_id": target_id}
            )
        )

    projected_definitions = []
    for definition in model.library.definitions:
        if definition.type == "product" and definition.states:
            definition = definition.model_copy(
                update={
                    "attributes": [
                        *definition.attributes,
                        Attribute(
                            id=f"{definition.id}__states",
                            name="__ppr_state_definition",
                            value=json.dumps(definition.states, ensure_ascii=False),
                            datatype="string",
                        ),
                    ]
                },
                deep=True,
            )
        projected_definitions.append(definition)

    model = model.model_copy(deep=True)
    model.library.definitions = projected_definitions
    model.diagram.usages = projected_usages
    model.diagram.relationships = projected_relationships

    definitions_by_id = {
        definition.id: definition for definition in model.library.definitions
    }
    usage_by_id = {usage.id: usage for usage in model.diagram.usages}
    definition_symbols = {
        definition.id: stable_symbol(definition.id)
        for definition in model.library.definitions
    }
    standalone_definition_ids = {
        usage.id: f"{usage.id}__standalone_definition"
        for usage in model.diagram.usages
        if usage.definition_id is None
    }
    for usage in model.diagram.usages:
        if usage.definition_id is None:
            definition_symbols[standalone_definition_ids[usage.id]] = stable_symbol(
                standalone_definition_ids[usage.id]
            )

    definitions = tuple(
        [
            SysmlDefinition(
                symbol=definition_symbols[definition.id],
                name=definition.name,
                kind=definition.type,
                attributes=_project_element_attributes(definition),
            )
            for definition in model.library.definitions
        ]
        + [
            SysmlDefinition(
                symbol=definition_symbols[standalone_definition_ids[usage.id]],
                name=usage.name,
                kind=usage.type,
                attributes=tuple(
                    _project_attribute(attribute, usage.name)
                    for attribute in usage.attributes
                ),
            )
            for usage in model.diagram.usages
            if usage.definition_id is None
        ]
    )

    def definition_symbol_for_usage(usage: PprElement) -> str:
        if usage.definition_id is not None:
            return definition_symbols[usage.definition_id]
        return definition_symbols[standalone_definition_ids[usage.id]]

    parent_by_child: dict[str, str] = {}
    ownership_by_child: dict[str, PprRelationship] = {}
    for relationship in model.diagram.relationships:
        if relationship.kind == "contains":
            parent_by_child[relationship.target_id] = relationship.source_id
            ownership_by_child[relationship.target_id] = relationship

    usage_nodes: dict[str, SysmlUsage] = {}
    for usage in model.diagram.usages:
        usage_nodes[usage.id] = SysmlUsage(
            symbol=stable_symbol(usage.id),
            name=usage.name,
            kind=usage.type,
            definition_symbol=definition_symbol_for_usage(usage),
            attributes=_project_element_attributes(usage),
            lower_bound=(
                ownership_by_child[usage.id].lower_bound
                if usage.id in ownership_by_child
                else None
            ),
            upper_bound=(
                ownership_by_child[usage.id].upper_bound
                if usage.id in ownership_by_child
                else None
            ),
        )

    roots: dict[PprType, list[SysmlUsage]] = {
        "product": [],
        "process": [],
        "resource": [],
    }
    for usage in model.diagram.usages:
        node = usage_nodes[usage.id]
        parent_id = parent_by_child.get(usage.id)
        if parent_id is None:
            roots[usage.type].append(node)
        else:
            usage_nodes[parent_id].children.append(node)

    flows: list[SysmlFlow] = []
    successions: list[SysmlSuccession] = []
    allocations: list[SysmlAllocation] = []
    used_port_names: dict[str, set[str]] = {}

    def port_name(
        relationship: PprRelationship, product: PprElement, process_id: str
    ) -> str:
        preferred = relationship.role_name or product.name
        name = role_symbol(preferred)
        used = used_port_names.setdefault(process_id, set())
        if name in used:
            name = f"{name}_{sha1(relationship.id.encode('utf-8')).hexdigest()[:6]}"
        used.add(name)
        return name

    for relationship in model.diagram.relationships:
        if relationship.kind == "contains":
            continue
        source = usage_by_id[relationship.source_id]
        target = usage_by_id[relationship.target_id]
        relationship_symbol = stable_symbol(relationship.id)
        source_path = _relationship_path(source.id, usage_by_id, parent_by_child)
        target_path = _relationship_path(target.id, usage_by_id, parent_by_child)

        if relationship.kind == "consumed_by":
            name = port_name(relationship, source, target.id)
            port = SysmlPort(
                relationship_symbol=relationship_symbol,
                name=name,
                direction="in",
                product_definition_symbol=definition_symbol_for_usage(source),
                quantity=relationship.quantity,
                unit=relationship.unit,
                lower_bound=relationship.lower_bound,
                upper_bound=relationship.upper_bound,
            )
            usage_nodes[target.id].ports.append(port)
            flows.append(
                SysmlFlow(
                    symbol=relationship_symbol,
                    source_path=source_path,
                    target_path=f"{target_path}.{name}",
                )
            )
        elif relationship.kind == "produces":
            name = port_name(relationship, target, source.id)
            port = SysmlPort(
                relationship_symbol=relationship_symbol,
                name=name,
                direction="out",
                product_definition_symbol=definition_symbol_for_usage(target),
                quantity=relationship.quantity,
                unit=relationship.unit,
                lower_bound=relationship.lower_bound,
                upper_bound=relationship.upper_bound,
            )
            usage_nodes[source.id].ports.append(port)
            flows.append(
                SysmlFlow(
                    symbol=relationship_symbol,
                    source_path=f"{source_path}.{name}",
                    target_path=target_path,
                )
            )
        elif relationship.kind == "performs":
            if relationship.modality == "supports":
                allocations.append(
                    SysmlAllocation(
                        symbol=relationship_symbol,
                        process_path=target_path,
                        resource_path=source_path,
                    )
                )
            else:
                usage_nodes[source.id].performed_action_paths.append(target_path)
        elif relationship.kind == "succeeds":
            prefix = "processOccurrences."
            successions.append(
                SysmlSuccession(
                    symbol=relationship_symbol,
                    source_path=source_path.removeprefix(prefix),
                    target_path=target_path.removeprefix(prefix),
                )
            )
        elif relationship.kind == "becomes":
            # Identity is represented by the occurrence projection rather than
            # a material flow between two unrelated occurrences.
            continue
        else:
            raise SysmlExportError(
                f"Relationship '{relationship.id}' of kind '{relationship.kind}' has no SysML lowering."
            )

    for flow in flows:
        relationship = next(
            item
            for item in model.diagram.relationships
            if stable_symbol(item.id) == flow.symbol
        )
        if relationship.unit is not None and relationship.unit not in _SI_UNITS:
            raise SysmlExportError(
                f"Relationship '{relationship.id}' uses unsupported SI unit '{relationship.unit}'."
            )

    return SysmlProjection(
        model_symbol=stable_symbol(model.id),
        model_name=model.name,
        definitions=definitions,
        product_usages=tuple(roots["product"]),
        process_usages=tuple(roots["process"]),
        resource_usages=tuple(roots["resource"]),
        flows=tuple(flows),
        successions=tuple(successions),
        allocations=tuple(allocations),
    )


_PORTABLE_LIBRARY = """library package PPR {
    abstract item def Product;
    abstract action def Process;
    abstract part def Resource;
}"""

_PPR_KEYWORD_LIBRARY = """library package 'PPR Model Library' {
    abstract item def Product;
    abstract item products : Product[*] nonunique;
    abstract action def Process;
    abstract action processes : Process[*] nonunique;
    abstract part def Resource;
    abstract part resources : Resource[*] nonunique;
}

library package 'PPR Semantic Metadata' {
    private import 'PPR Model Library'::*;
    private import Metaobjects::SemanticMetadata;

    metadata def product :> SemanticMetadata {
        :>> baseType = products meta SysML::Usage;
    }
    metadata def process :> SemanticMetadata {
        :>> baseType = processes meta SysML::Usage;
    }
    metadata def resource :> SemanticMetadata {
        :>> baseType = resources meta SysML::Usage;
    }
}"""


def _indent(level: int) -> str:
    return "    " * level


def _render_attribute(attribute: SysmlAttribute, level: int) -> str:
    unit = f" [{attribute.unit}]" if attribute.unit else ""
    return (
        f"{_indent(level)}attribute <{attribute.symbol}> '{_long_name(attribute.name)}' "
        f": {attribute.type_name} = {attribute.value}{unit};"
    )


def _render_definition(
    definition: SysmlDefinition, mode: SysmlMode, level: int
) -> list[str]:
    if mode == "ppr":
        keyword = {
            "product": "#product def",
            "process": "#process def",
            "resource": "#resource def",
        }[definition.kind]
        specialization = ""
    else:
        keyword = {
            "product": "item def",
            "process": "action def",
            "resource": "part def",
        }[definition.kind]
        specialization = f" :> {definition.kind.title()}"
    declaration = (
        f"{_indent(level)}{keyword} <{definition.symbol}> '{_long_name(definition.name)}'"
        f"{specialization}"
    )
    if not definition.attributes:
        return [f"{declaration};"]
    return [
        f"{declaration} {{",
        *[
            _render_attribute(attribute, level + 1)
            for attribute in definition.attributes
        ],
        f"{_indent(level)}}}",
    ]


def _multiplicity(
    lower_bound: int | None,
    upper_bound: int | Literal["*"] | None,
) -> str:
    if lower_bound is None and upper_bound is None:
        return ""
    lower = lower_bound if lower_bound is not None else 0
    upper = upper_bound if upper_bound is not None else "*"
    return f"[{lower}]" if lower == upper else f"[{lower}..{upper}]"


def _render_port(port: SysmlPort, level: int) -> list[str]:
    declaration = (
        f"{_indent(level)}{port.direction} item {port.name} : "
        f"{port.product_definition_symbol}{_multiplicity(port.lower_bound, port.upper_bound)}"
    )
    if port.quantity is None:
        return [f"{declaration};"]
    unit = f" [{port.unit}]" if port.unit else ""
    quantity = format(port.quantity, ".15g")
    return [
        f"{declaration} {{",
        f"{_indent(level + 1)}attribute requestedQuantity : Real = {quantity}{unit};",
        f"{_indent(level)}}}",
    ]


def _render_usage(usage: SysmlUsage, mode: SysmlMode, level: int) -> list[str]:
    if mode == "ppr":
        keyword = {
            "product": "#product item",
            "process": "#process action",
            "resource": "#resource part",
        }[usage.kind]
    else:
        keyword = {"product": "item", "process": "action", "resource": "part"}[
            usage.kind
        ]
    declaration = (
        f"{_indent(level)}{keyword} <{usage.symbol}> '{_long_name(usage.name)}' "
        f": {usage.definition_symbol}{_multiplicity(usage.lower_bound, usage.upper_bound)}"
    )
    has_body = bool(
        usage.attributes
        or usage.children
        or usage.ports
        or usage.performed_action_paths
    )
    if not has_body:
        return [f"{declaration};"]

    lines = [f"{declaration} {{"]
    lines.extend(
        _render_attribute(attribute, level + 1) for attribute in usage.attributes
    )
    for port in usage.ports:
        lines.extend(_render_port(port, level + 1))
    for child in usage.children:
        lines.extend(_render_usage(child, mode, level + 1))
    for action_path in usage.performed_action_paths:
        lines.append(f"{_indent(level + 1)}perform {action_path};")
    lines.append(f"{_indent(level)}}}")
    return lines


def render_sysml(projection: SysmlProjection, mode: SysmlMode = "portable") -> str:
    if mode not in {"portable", "ppr"}:
        raise ValueError(f"Unknown SysML export mode: {mode}")
    library = _PPR_KEYWORD_LIBRARY if mode == "ppr" else _PORTABLE_LIBRARY
    import_name = "'PPR Semantic Metadata'" if mode == "ppr" else "PPR"
    lines = [
        library,
        "",
        f"package <{projection.model_symbol}> '{_long_name(projection.model_name)}' {{",
        f"    private import {import_name}::*;",
        "    private import ScalarValues::*;",
        "    private import SI::*;",
        "",
    ]

    for definition in projection.definitions:
        lines.extend(_render_definition(definition, mode, 1))
    if projection.definitions:
        lines.append("")

    usage_groups = (
        ("part", "productOccurrences", projection.product_usages),
        ("action", "processOccurrences", projection.process_usages),
        ("part", "resourceOccurrences", projection.resource_usages),
    )
    for container_keyword, container_name, usages in usage_groups:
        lines.append(f"    {container_keyword} {container_name} {{")
        for usage in usages:
            lines.extend(_render_usage(usage, mode, 2))
        if container_name == "processOccurrences":
            for succession in projection.successions:
                lines.append(
                    f"        succession <{succession.symbol}> first {succession.source_path} "
                    f"then {succession.target_path};"
                )
        lines.append("    }")
        lines.append("")

    for flow in projection.flows:
        payload = ""
        if flow.item_definition_symbol is not None:
            payload = (
                f" of {flow.item_definition_symbol}"
                f"{_multiplicity(flow.lower_bound, flow.upper_bound)}"
            )
        declaration = f"    flow <{flow.symbol}>{payload} from {flow.source_path} to {flow.target_path}"
        if flow.quantity is None:
            lines.append(f"{declaration};")
        else:
            unit = f" [{flow.unit}]" if flow.unit else ""
            quantity = format(flow.quantity, ".15g")
            lines.extend(
                [
                    f"{declaration} {{",
                    f"        attribute requestedQuantity : Real = {quantity}{unit};",
                    "    }",
                ]
            )
    for allocation in projection.allocations:
        lines.append(
            f"    allocation <{allocation.symbol}> allocate {allocation.process_path} "
            f"to {allocation.resource_path};"
        )
    if projection.flows or projection.allocations:
        lines.append("")
    lines.append("}")
    return "\n".join(lines)


def export_sysml(model: PprModel, mode: SysmlMode = "portable") -> str:
    return render_sysml(project_sysml(model), mode)
