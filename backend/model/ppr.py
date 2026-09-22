from __future__ import annotations

import json
import math
from pathlib import Path
from datetime import UTC, datetime
from typing import Any, Literal, get_args

from pydantic import BaseModel, Field, field_validator, model_validator

from .core import Definition, Element, Usage, new_id

PprType = Literal["product", "process", "resource"]
PprKind = Literal["definition", "usage"]
RelationKind = Literal[
    "consumed_by",
    "produces",
    "performs",
    "succeeds",
    "contains",
    "becomes",
]
LegacyRelationKind = Literal["input_to", "flows_to", "supports", "composed_of"]
RelationshipInputKind = RelationKind | LegacyRelationKind
RelationshipModality = Literal["assigned", "capable", "supports"]
RelationshipRateBasis = Literal["cycle", "unit", "batch", "hour"]
RelationshipJoin = Literal["and", "or"]

CURRENT_SCHEMA_VERSION = "2.0"
RELATIONSHIP_KIND_ALIASES: dict[str, RelationKind] = {
    "input_to": "consumed_by",
    "flows_to": "succeeds",
    "supports": "performs",
    "composed_of": "contains",
}


RELATIONSHIP_RULES_PATH = (
    Path(__file__).resolve().parents[2]
    / "lib"
    / "api-zod"
    / "src"
    / "relationship-rules.json"
)
RELATIONSHIP_RULES: dict[str, list[dict[str, str]]] = json.loads(
    RELATIONSHIP_RULES_PATH.read_text(encoding="utf-8")
)


class PprElement(Element):
    """A diagram usage or library definition payload."""

    type: PprType
    kind: PprKind
    definition_id: str | None = None
    domain: str | None = None
    parent_definition_id: str | None = None
    visible_in_ppr: bool = True
    state: str | None = None
    states: list[str] | None = None

    @field_validator("definition_id")
    @classmethod
    def definition_id_is_trimmed(cls, value: str | None) -> str | None:
        return value.strip() if value else value

    @field_validator("domain")
    @classmethod
    def domain_is_trimmed(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None

    @field_validator("parent_definition_id")
    @classmethod
    def parent_definition_id_is_trimmed(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None

    @field_validator("state")
    @classmethod
    def state_is_trimmed(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None

    @field_validator("states")
    @classmethod
    def states_are_trimmed(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        trimmed = [state.strip() for state in value]
        if any(not state for state in trimmed):
            raise ValueError("Definition states cannot contain a blank value.")
        if len(set(trimmed)) != len(trimmed):
            raise ValueError("Definition states must be unique.")
        return trimmed

    @model_validator(mode="after")
    def identity_fields_apply_to_products(self) -> PprElement:
        if self.state is not None and (self.type != "product" or self.kind != "usage"):
            raise ValueError("State is only valid on product usages.")
        if self.states is not None and (
            self.type != "product" or self.kind != "definition"
        ):
            raise ValueError("States are only valid on product definitions.")
        return self


class ProductDefinition(Definition):
    type: Literal["product"] = "product"


class ProductUsage(Usage):
    type: Literal["product"] = "product"


class ProcessDefinition(Definition):
    type: Literal["process"] = "process"


class ProcessUsage(Usage):
    type: Literal["process"] = "process"


class ResourceDefinition(Definition):
    type: Literal["resource"] = "resource"


class ResourceUsage(Usage):
    type: Literal["resource"] = "resource"


class PprRelationship(BaseModel):
    id: str = Field(default_factory=lambda: new_id("rel"))
    source_id: str
    target_id: str
    kind: RelationKind
    role_name: str | None = None
    quantity: float | None = Field(default=None, ge=0)
    unit: str | None = None
    lower_bound: int | None = Field(default=None, ge=0)
    upper_bound: int | Literal["*"] | None = None
    modality: RelationshipModality | None = None
    byproduct: bool | None = None
    per: RelationshipRateBasis | None = None
    join: RelationshipJoin | None = None
    min_offset: float | None = None
    max_offset: float | None = None
    offset_unit: str | None = None

    @model_validator(mode="before")
    @classmethod
    def map_legacy_kind(cls, obj: Any) -> Any:
        if not isinstance(obj, dict):
            return obj
        kind = obj.get("kind")
        if kind not in RELATIONSHIP_KIND_ALIASES:
            return obj
        migrated = dict(obj)
        migrated["kind"] = RELATIONSHIP_KIND_ALIASES[kind]
        if kind == "supports":
            migrated.setdefault("modality", "supports")
        return migrated

    @field_validator("quantity", "min_offset", "max_offset")
    @classmethod
    def numeric_qualifier_is_finite(cls, value: float | None) -> float | None:
        if value is not None and not math.isfinite(value):
            raise ValueError("Numeric relationship qualifiers must be finite.")
        return value

    @field_validator("role_name", "unit", "offset_unit")
    @classmethod
    def optional_text_is_trimmed(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None

    @model_validator(mode="after")
    def bounds_are_ordered(self) -> PprRelationship:
        if self.kind == "performs" and self.modality is None:
            self.modality = "assigned"
        if self.kind == "produces" and self.byproduct is None:
            self.byproduct = False
        if (
            self.lower_bound is not None
            and isinstance(self.upper_bound, int)
            and self.upper_bound < self.lower_bound
        ):
            raise ValueError(
                "Upper multiplicity bound cannot be below the lower bound."
            )
        if (
            self.min_offset is not None
            and self.max_offset is not None
            and self.max_offset < self.min_offset
        ):
            raise ValueError("Maximum offset cannot be below the minimum offset.")
        return self


class PprLibrary(BaseModel):
    definitions: list[PprElement] = Field(default_factory=list)


class PprDiagram(BaseModel):
    usages: list[PprElement] = Field(default_factory=list)
    relationships: list[PprRelationship] = Field(default_factory=list)


class PprModel(BaseModel):
    """One project containing a reusable library and a usage-only diagram."""

    id: str = Field(default_factory=lambda: new_id("model"))
    name: str = "Untitled production model"
    description: str = ""
    schema_version: str = CURRENT_SCHEMA_VERSION
    library: PprLibrary = Field(default_factory=PprLibrary)
    diagram: PprDiagram = Field(default_factory=PprDiagram)

    @model_validator(mode="before")
    @classmethod
    def migrate_legacy_model(cls, obj: Any) -> Any:
        if (
            isinstance(obj, dict)
            and "library" not in obj
            and "diagram" not in obj
            and ("elements" in obj or "relationships" in obj)
        ):
            elements = [
                element.model_dump() if isinstance(element, BaseModel) else element
                for element in obj.get("elements", [])
            ]
            legacy_definitions = [
                element for element in elements if element.get("kind") == "definition"
            ]
            definition_ids = {
                element["id"]: f"{element['id']}__definition"
                for element in legacy_definitions
            }
            definitions = [
                {
                    **element,
                    "id": definition_ids[element["id"]],
                    "kind": "definition",
                    "definition_id": None,
                }
                for element in legacy_definitions
            ]
            usages = [
                {
                    **element,
                    "kind": "usage",
                    "definition_id": (
                        definition_ids.get(element["id"])
                        if element.get("kind") == "definition"
                        else definition_ids.get(
                            element.get("definition_id"),
                            element.get("definition_id"),
                        )
                    ),
                }
                for element in elements
            ]
            relationships = obj.get("relationships", [])
            obj = {
                **{
                    key: value
                    for key, value in obj.items()
                    if key not in {"elements", "relationships"}
                },
                "library": {"definitions": definitions},
                "diagram": {
                    "usages": usages,
                    "relationships": relationships,
                },
            }
        if isinstance(obj, dict) and obj.get("schema_version") != CURRENT_SCHEMA_VERSION:
            diagram = obj.get("diagram")
            if isinstance(diagram, dict):
                migrated_relationships: list[Any] = []
                for raw_relationship in diagram.get("relationships", []):
                    relationship = (
                        raw_relationship.model_dump()
                        if isinstance(raw_relationship, BaseModel)
                        else dict(raw_relationship)
                    )
                    old_kind = relationship.get("kind")
                    if old_kind == "transfers":
                        continue
                    if old_kind in RELATIONSHIP_KIND_ALIASES:
                        relationship["kind"] = RELATIONSHIP_KIND_ALIASES[old_kind]
                        if old_kind == "supports":
                            relationship.setdefault("modality", "supports")
                    migrated_relationships.append(relationship)
                obj = {
                    **obj,
                    "schema_version": CURRENT_SCHEMA_VERSION,
                    "diagram": {
                        **diagram,
                        "relationships": migrated_relationships,
                    },
                }
        return obj

    @property
    def elements(self) -> list[PprElement]:
        """Read-only compatibility view for callers migrating from the flat model."""
        return [*self.library.definitions, *self.diagram.usages]

    @property
    def relationships(self) -> list[PprRelationship]:
        """Read-only compatibility view for callers migrating from the flat model."""
        return self.diagram.relationships


class PprRevision(BaseModel):
    """An immutable model snapshot with safe provenance metadata."""

    id: str = Field(default_factory=lambda: new_id("revision"))
    revision: int = Field(ge=0)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    created_by: str = "Workspace user"
    summary: str = "Saved model snapshot"
    model: PprModel


MAX_REVISION_HISTORY = 50
"""Maximum number of complete model snapshots retained for any history."""


def retain_ppr_revisions(
    history: list[PprRevision],
    *,
    limit: int | None = None,
) -> list[PprRevision]:
    """Keep the newest revisions while preserving their original numbers.

    Revision numbers are intentionally not renumbered after pruning. This lets
    clients tell that older revisions are unavailable and keeps restore-created
    revisions monotonic across restarts.
    """

    retention_limit = MAX_REVISION_HISTORY if limit is None else limit
    if retention_limit < 1:
        raise ValueError("Revision history retention limit must be at least one.")
    return list(history[-retention_limit:])


def make_ppr_revision(
    model: PprModel,
    *,
    revision: int,
    summary: str,
    created_by: str = "Workspace user",
) -> PprRevision:
    """Create a detached snapshot so later edits cannot mutate history."""

    return PprRevision(
        revision=revision,
        summary=summary,
        created_by=created_by,
        model=model.model_copy(deep=True),
    )


MergeChoice = Literal["first", "second"]
MergeDefinitionChoice = Literal["first", "second", "none"]
MergeAttributeChoice = Literal["first", "second", "both"]
MergeSelfLoopPolicy = Literal["reject", "drop"]


class MergeAttributeDecision(BaseModel):
    """An explicit choice for a conflicting attribute name."""

    name: str = Field(min_length=1)
    source: MergeAttributeChoice


class MergeUsagesRequest(BaseModel):
    """The complete, explicit decision set for merging two diagram usages."""

    first_id: str
    second_id: str
    survivor_id: str
    name_source: MergeChoice
    description_source: MergeChoice
    definition_source: MergeDefinitionChoice
    attribute_decisions: list[MergeAttributeDecision] = Field(default_factory=list)
    self_loop_policy: MergeSelfLoopPolicy


def _attributes_are_equal(first: Any, second: Any) -> bool:
    return first.model_dump(exclude={"id"}) == second.model_dump(exclude={"id"})


def merge_ppr_usages(model: PprModel, request: MergeUsagesRequest) -> PprModel:
    """Return a validated model with two same-type usages merged atomically.

    The input model is never mutated. Relationship IDs and metadata are retained
    from the first relationship in model order when semantic duplicates result
    from retargeting.
    """

    if request.first_id == request.second_id:
        raise ValueError("Choose two different diagram usages to merge.")
    if request.survivor_id not in {request.first_id, request.second_id}:
        raise ValueError("The surviving usage must be one of the selected usages.")

    usages_by_id = {usage.id: usage for usage in model.diagram.usages}
    first = usages_by_id.get(request.first_id)
    second = usages_by_id.get(request.second_id)
    if first is None or second is None:
        raise ValueError("Both selected usages must exist in the diagram.")
    if first.kind != "usage" or second.kind != "usage":
        raise ValueError("Only diagram usages can be merged.")
    if first.type != second.type:
        raise ValueError(
            "Only usages of the same Product, Process, or Resource type can be merged."
        )

    source_by_choice = {"first": first, "second": second}
    survivor = source_by_choice[
        "first" if request.survivor_id == first.id else "second"
    ]

    attribute_groups: dict[str, list[tuple[str, Any]]] = {}
    for source_name, element in (("first", first), ("second", second)):
        for attribute in element.attributes:
            attribute_groups.setdefault(attribute.name.casefold(), []).append(
                (source_name, attribute)
            )

    decisions_by_name: dict[str, MergeAttributeChoice] = {}
    for decision in request.attribute_decisions:
        normalized_name = decision.name.casefold()
        if normalized_name in decisions_by_name:
            raise ValueError(
                f"Attribute decision '{decision.name}' was provided more than once."
            )
        if normalized_name not in attribute_groups:
            raise ValueError(
                f"Attribute decision '{decision.name}' does not match either usage."
            )
        decisions_by_name[normalized_name] = decision.source

    merged_attributes: list[Any] = []
    for normalized_name, grouped_attributes in attribute_groups.items():
        first_values = [
            attribute
            for source_name, attribute in grouped_attributes
            if source_name == "first"
        ]
        second_values = [
            attribute
            for source_name, attribute in grouped_attributes
            if source_name == "second"
        ]
        has_conflict = bool(first_values and second_values) and any(
            not _attributes_are_equal(first_attribute, second_attribute)
            for first_attribute in first_values
            for second_attribute in second_values
        )
        choice = decisions_by_name.get(normalized_name)
        if has_conflict and choice is None:
            display_name = first_values[0].name
            raise ValueError(
                f"Choose which values to keep for conflicting attribute '{display_name}'."
            )
        if choice is None:
            choice = "first" if first_values else "second"
        selected_sources = {"first", "second"} if choice == "both" else {choice}
        selected = [
            attribute
            for source_name, attribute in grouped_attributes
            if source_name in selected_sources
        ]
        for attribute in selected:
            if any(existing.id == attribute.id for existing in merged_attributes):
                merged_attributes.append(
                    attribute.model_copy(update={"id": new_id("attr")})
                )
            else:
                merged_attributes.append(attribute)

    merged_element = survivor.model_copy(
        update={
            "name": source_by_choice[request.name_source].name,
            "description": source_by_choice[request.description_source].description,
            "definition_id": (
                None
                if request.definition_source == "none"
                else source_by_choice[request.definition_source].definition_id
            ),
            "attributes": merged_attributes,
        }
    )

    replacement_ids = {first.id, second.id}
    endpoint_replacement = {first.id: survivor.id, second.id: survivor.id}
    merged_relationships: list[PprRelationship] = []
    semantic_keys: set[tuple[str, str, str]] = set()
    for relationship in model.diagram.relationships:
        source_id = endpoint_replacement.get(
            relationship.source_id, relationship.source_id
        )
        target_id = endpoint_replacement.get(
            relationship.target_id, relationship.target_id
        )
        if source_id == target_id:
            if request.self_loop_policy == "drop":
                continue
            raise ValueError(
                f"Merging these usages would create a self-loop from '{merged_element.name}'. "
                "Choose 'drop' to remove that connection explicitly."
            )
        key = (source_id, target_id, relationship.kind)
        if key in semantic_keys:
            continue
        semantic_keys.add(key)
        merged_relationships.append(
            relationship.model_copy(
                update={"source_id": source_id, "target_id": target_id}
            )
        )

    candidate = model.model_copy(deep=True)
    candidate.diagram.usages = [
        merged_element if usage.id == survivor.id else usage
        for usage in candidate.diagram.usages
        if usage.id not in replacement_ids or usage.id == survivor.id
    ]
    candidate.diagram.relationships = merged_relationships
    result = validate_ppr_model(candidate)
    if not result.valid:
        messages = "; ".join(
            issue.message for issue in result.issues if issue.severity == "error"
        )
        raise ValueError(f"The merged model is invalid: {messages}")
    return candidate


ALLOWED_RELATIONS: dict[RelationKind, set[tuple[PprType, PprType]]] = {
    kind: {(rule["source"], rule["target"]) for rule in RELATIONSHIP_RULES[kind]}
    for kind in get_args(RelationKind)
}


class ValidationIssue(BaseModel):
    code: str = "MODEL-VALIDATION"
    severity: Literal["error", "warning", "info"]
    message: str
    element_id: str | None = None
    relationship_id: str | None = None


class ValidationResult(BaseModel):
    valid: bool
    issues: list[ValidationIssue]


def validate_ppr_model(model: PprModel) -> ValidationResult:
    issues: list[ValidationIssue] = []
    element_by_id: dict[str, PprElement] = {}
    definitions = model.library.definitions
    usages = model.diagram.usages
    all_elements = [*definitions, *usages]
    for element in all_elements:
        if element.id in element_by_id:
            issues.append(
                ValidationIssue(
                    severity="error",
                    message=f"Duplicate element ID: {element.id}",
                    element_id=element.id,
                )
            )
        element_by_id[element.id] = element
        attribute_ids: set[str] = set()
        attribute_names: set[str] = set()
        for attribute in element.attributes:
            if attribute.id in attribute_ids:
                issues.append(
                    ValidationIssue(
                        severity="error",
                        message=f"Duplicate attribute ID on {element.name}: {attribute.id}",
                        element_id=element.id,
                    )
                )
            if attribute.name.lower() in attribute_names:
                issues.append(
                    ValidationIssue(
                        severity="warning",
                        message=f"Duplicate attribute name on {element.name}: {attribute.name}",
                        element_id=element.id,
                    )
                )
            attribute_ids.add(attribute.id)
            attribute_names.add(attribute.name.lower())

    definition_by_id = {definition.id: definition for definition in definitions}
    for definition in definitions:
        if definition.kind != "definition":
            issues.append(
                ValidationIssue(
                    severity="error",
                    message=f"Library element '{definition.name}' must be a definition.",
                    element_id=definition.id,
                )
            )
        if definition.parent_definition_id is None:
            continue
        parent = definition_by_id.get(definition.parent_definition_id)
        if parent is None:
            issues.append(
                ValidationIssue(
                    severity="error",
                    message=f"Definition '{definition.name}' references a missing parent definition.",
                    element_id=definition.id,
                )
            )
        elif parent.id == definition.id:
            issues.append(
                ValidationIssue(
                    severity="error",
                    message=f"Definition '{definition.name}' cannot inherit from itself.",
                    element_id=definition.id,
                )
            )
        elif parent.type != definition.type:
            issues.append(
                ValidationIssue(
                    severity="error",
                    message=(
                        f"Definition '{definition.name}' must inherit from a "
                        f"{definition.type} definition."
                    ),
                    element_id=definition.id,
                )
            )

    reported_inheritance_cycles: set[frozenset[str]] = set()
    for definition in definitions:
        path: list[str] = []
        current: PprElement | None = definition
        while current is not None and current.parent_definition_id is not None:
            if current.id in path:
                cycle = frozenset(path[path.index(current.id) :])
                if cycle not in reported_inheritance_cycles:
                    reported_inheritance_cycles.add(cycle)
                    issues.append(
                        ValidationIssue(
                            severity="error",
                            message="Definition inheritance must not form a cycle.",
                            element_id=definition.id,
                        )
                    )
                break
            path.append(current.id)
            current = definition_by_id.get(current.parent_definition_id)

    for usage in usages:
        if usage.kind != "usage":
            issues.append(
                ValidationIssue(
                    severity="error",
                    message=f"Diagram element '{usage.name}' must be a usage.",
                    element_id=usage.id,
                )
            )
        if usage.parent_definition_id is not None:
            issues.append(
                ValidationIssue(
                    severity="error",
                    message=f"Diagram usage '{usage.name}' cannot inherit from a definition.",
                    element_id=usage.id,
                )
            )
        if usage.definition_id is None:
            continue
        definition = next(
            (item for item in definitions if item.id == usage.definition_id), None
        )
        if not definition:
            issues.append(
                ValidationIssue(
                    severity="error",
                    message=f"Usage '{usage.name}' references a missing definition.",
                    element_id=usage.id,
                )
            )
        elif definition.type != usage.type:
            issues.append(
                ValidationIssue(
                    severity="error",
                    message=f"Usage '{usage.name}' must reference a {usage.type} definition.",
                    element_id=usage.id,
                )
            )

    usage_by_id = {usage.id: usage for usage in usages}
    relationship_ids: set[str] = set()
    connected_usage_ids: set[str] = set()
    becomes_incoming: dict[str, list[PprRelationship]] = {}
    becomes_outgoing: dict[str, list[PprRelationship]] = {}
    parent_by_child: dict[str, str] = {}
    material_inputs_by_process: dict[str, set[str]] = {}
    material_outputs_by_process: dict[str, set[str]] = {}
    performing_resources_by_process: dict[str, set[str]] = {}

    qualifier_fields = {
        "role_name",
        "quantity",
        "unit",
        "lower_bound",
        "upper_bound",
        "modality",
        "byproduct",
        "per",
        "join",
        "min_offset",
        "max_offset",
        "offset_unit",
    }
    valid_qualifiers: dict[RelationKind, set[str]] = {
        "consumed_by": {
            "role_name",
            "quantity",
            "unit",
            "lower_bound",
            "upper_bound",
            "per",
        },
        "produces": {
            "role_name",
            "quantity",
            "unit",
            "lower_bound",
            "upper_bound",
            "per",
            "byproduct",
        },
        "performs": {"modality"},
        "contains": set(),
        "succeeds": {"join", "min_offset", "max_offset", "offset_unit"},
        "becomes": set(),
    }

    for relationship in model.diagram.relationships:
        if relationship.id in relationship_ids:
            issues.append(
                ValidationIssue(
                    code="RELATIONSHIP-DUPLICATE-ID",
                    severity="error",
                    message=f"Duplicate relationship ID: {relationship.id}",
                    relationship_id=relationship.id,
                )
            )
        relationship_ids.add(relationship.id)
        source = usage_by_id.get(relationship.source_id)
        target = usage_by_id.get(relationship.target_id)
        if not source or not target:
            issues.append(
                ValidationIssue(
                    code="RELATIONSHIP-MISSING-ENDPOINT",
                    severity="error",
                    message="Relationship source or target does not exist as a diagram usage.",
                    relationship_id=relationship.id,
                )
            )
            continue
        connected_usage_ids.update((source.id, target.id))
        if relationship.kind not in ALLOWED_RELATIONS:
            issues.append(
                ValidationIssue(
                    code="RELATIONSHIP-KIND",
                    severity="error",
                    message=f"Unknown relationship kind: {relationship.kind}",
                    relationship_id=relationship.id,
                )
            )
            continue
        if (source.type, target.type) not in ALLOWED_RELATIONS[relationship.kind]:
            issues.append(
                ValidationIssue(
                    code=("IDENT-1" if relationship.kind == "becomes" else "RELATIONSHIP-ENDPOINTS"),
                    severity="error",
                    message=(
                        "becomes endpoints must both be product usages"
                        if relationship.kind == "becomes"
                        else (
                            f"'{relationship.kind}' is not valid from {source.type} "
                            f"'{source.name}' to {target.type} '{target.name}'."
                        )
                    ),
                    relationship_id=relationship.id,
                )
            )

        present_qualifiers = {
            field_name
            for field_name in qualifier_fields
            if getattr(relationship, field_name) is not None
        }
        invalid_qualifiers = present_qualifiers - valid_qualifiers[relationship.kind]
        if invalid_qualifiers:
            issues.append(
                ValidationIssue(
                    code=("IDENT-4" if relationship.kind == "becomes" else "RELATIONSHIP-QUALIFIER"),
                    severity="error",
                    message=(
                        "becomes carries no quantity, unit, role_name or bounds"
                        if relationship.kind == "becomes"
                        else (
                            f"Qualifier(s) {', '.join(sorted(invalid_qualifiers))} "
                            f"are not valid on '{relationship.kind}'."
                        )
                    ),
                    relationship_id=relationship.id,
                )
            )
        if relationship.unit is not None and relationship.quantity is None:
            issues.append(
                ValidationIssue(
                    code="RELATIONSHIP-UNIT-WITHOUT-QUANTITY",
                    severity="error",
                    message="A relationship unit requires a quantity.",
                    relationship_id=relationship.id,
                )
            )
        if (
            relationship.offset_unit is not None
            and relationship.min_offset is None
            and relationship.max_offset is None
        ):
            issues.append(
                ValidationIssue(
                    code="RELATIONSHIP-OFFSET-UNIT-WITHOUT-OFFSET",
                    severity="error",
                    message="An offset unit requires a minimum or maximum offset.",
                    relationship_id=relationship.id,
                )
            )

        if relationship.kind == "becomes":
            becomes_outgoing.setdefault(source.id, []).append(relationship)
            becomes_incoming.setdefault(target.id, []).append(relationship)
            if source.definition_id != target.definition_id:
                issues.append(
                    ValidationIssue(
                        code="IDENT-8",
                        severity="info",
                        message="becomes endpoints use different product definitions",
                        relationship_id=relationship.id,
                    )
                )
        elif relationship.kind == "consumed_by":
            material_inputs_by_process.setdefault(target.id, set()).add(source.id)
        elif relationship.kind == "produces":
            material_outputs_by_process.setdefault(source.id, set()).add(target.id)
        elif relationship.kind == "performs":
            performing_resources_by_process.setdefault(target.id, set()).add(source.id)
        elif relationship.kind == "contains":
            if relationship.source_id == relationship.target_id:
                issues.append(
                    ValidationIssue(
                        code="MODEL-4",
                        severity="error",
                        message="An element cannot contain itself.",
                        relationship_id=relationship.id,
                    )
                )
            existing_parent = parent_by_child.get(relationship.target_id)
            if existing_parent is not None and existing_parent != relationship.source_id:
                issues.append(
                    ValidationIssue(
                        code="CONTAINS-MULTIPLE-PARENTS",
                        severity="error",
                        message="An element cannot have more than one owning parent.",
                        relationship_id=relationship.id,
                    )
                )
            else:
                parent_by_child[relationship.target_id] = relationship.source_id

    for usage_id, relationships in becomes_incoming.items():
        if len(relationships) > 1:
            issues.append(
                ValidationIssue(
                    code="IDENT-2",
                    severity="error",
                    message="a usage has more than one incoming becomes relationship",
                    element_id=usage_id,
                    relationship_id=relationships[-1].id,
                )
            )
    for usage_id, relationships in becomes_outgoing.items():
        if len(relationships) > 1:
            issues.append(
                ValidationIssue(
                    code="IDENT-2",
                    severity="error",
                    message="a usage has more than one outgoing becomes relationship",
                    element_id=usage_id,
                    relationship_id=relationships[-1].id,
                )
            )

    next_usage = {
        source_id: relationships[0].target_id
        for source_id, relationships in becomes_outgoing.items()
        if relationships
    }
    reported_identity_cycles: set[frozenset[str]] = set()
    for usage_id in next_usage:
        path: list[str] = []
        current_id: str | None = usage_id
        while current_id in next_usage:
            if current_id in path:
                cycle = frozenset(path[path.index(current_id) :])
                if cycle not in reported_identity_cycles:
                    reported_identity_cycles.add(cycle)
                    issues.append(
                        ValidationIssue(
                            code="IDENT-3",
                            severity="error",
                            message="becomes chains must be acyclic",
                            element_id=current_id,
                        )
                    )
                break
            path.append(current_id)
            current_id = next_usage.get(current_id)

    for source_id, relationships in becomes_outgoing.items():
        for relationship in relationships:
            target_id = relationship.target_id
            coherent = any(
                source_id in inputs and target_id in material_outputs_by_process.get(process_id, set())
                for process_id, inputs in material_inputs_by_process.items()
            )
            if not coherent:
                issues.append(
                    ValidationIssue(
                        code="IDENT-5",
                        severity="warning",
                        message=(
                            "identity chain skips a process — no process both consumes "
                            f"{source_id} and produces {target_id}"
                        ),
                        relationship_id=relationship.id,
                    )
                )

    for usage in usages:
        if usage.id not in connected_usage_ids:
            issues.append(
                ValidationIssue(
                    code="MODEL-1",
                    severity="warning",
                    message=f"Diagram usage '{usage.name}' is disconnected.",
                    element_id=usage.id,
                )
            )
        if usage.type == "product" and usage.state is not None:
            definition = definition_by_id.get(usage.definition_id or "")
            if definition is not None and definition.states is not None and usage.state not in definition.states:
                issues.append(
                    ValidationIssue(
                        code="IDENT-6",
                        severity="info",
                        message=(
                            f"State '{usage.state}' is not declared by definition "
                            f"'{definition.name}'."
                        ),
                        element_id=usage.id,
                    )
                )
            if usage.id not in becomes_incoming and usage.id not in becomes_outgoing:
                issues.append(
                    ValidationIssue(
                        code="IDENT-7",
                        severity="info",
                        message="product usage has a state but no becomes edge",
                        element_id=usage.id,
                    )
                )
        if usage.type == "process":
            if usage.id not in performing_resources_by_process:
                issues.append(
                    ValidationIssue(
                        code="MODEL-2",
                        severity="warning",
                        message=f"Process '{usage.name}' has no performing resource.",
                        element_id=usage.id,
                    )
                )
            missing: list[str] = []
            if usage.id not in material_inputs_by_process:
                missing.append("inputs")
            if usage.id not in material_outputs_by_process:
                missing.append("outputs")
            if missing:
                issues.append(
                    ValidationIssue(
                        code="MODEL-3",
                        severity="warning",
                        message=f"Process '{usage.name}' has no {' or no '.join(missing)}.",
                        element_id=usage.id,
                    )
                )

    reported_contains_cycles: set[frozenset[str]] = set()
    for child_id in parent_by_child:
        path: list[str] = []
        current_id: str | None = child_id
        while current_id is not None:
            if current_id in path:
                cycle = frozenset(path[path.index(current_id) :])
                if cycle not in reported_contains_cycles:
                    reported_contains_cycles.add(cycle)
                    issues.append(
                        ValidationIssue(
                            code="MODEL-4",
                            severity="error",
                            message="contains hierarchy contains a cycle",
                            element_id=child_id,
                        )
                    )
                break
            path.append(current_id)
            current_id = parent_by_child.get(current_id)
    return ValidationResult(
        valid=not any(issue.severity == "error" for issue in issues),
        issues=issues,
    )


class ItemChainNode(BaseModel):
    element_id: str
    state: str | None = None
    produced_by: str | None = None
    consumed_by: str | None = None


class PprItem(BaseModel):
    id: str
    name: str
    definition_ids: list[str]
    chain: list[ItemChainNode]
    absorbed_into: str | None = None


class IdentityProposal(BaseModel):
    source_id: str
    target_id: str
    confidence: Literal["high", "medium"]
    reason: str


class IdentityInferenceRequest(BaseModel):
    apply: bool = False


class IdentityInferenceResult(BaseModel):
    proposals: list[IdentityProposal]
    needs_review: list[str]


def _transition_process(
    source_id: str,
    target_id: str,
    relationships: list[PprRelationship],
) -> str | None:
    consuming_processes = {
        relationship.target_id
        for relationship in relationships
        if relationship.kind == "consumed_by" and relationship.source_id == source_id
    }
    return next(
        (
            relationship.source_id
            for relationship in relationships
            if relationship.kind == "produces"
            and relationship.target_id == target_id
            and relationship.source_id in consuming_processes
        ),
        None,
    )


def derive_ppr_items(model: PprModel) -> list[PprItem]:
    """Return the complete product-usage partition induced by becomes chains."""

    products = [usage for usage in model.diagram.usages if usage.type == "product"]
    product_by_id = {product.id: product for product in products}
    relationships = model.diagram.relationships
    outgoing = {
        relationship.source_id: relationship.target_id
        for relationship in relationships
        if relationship.kind == "becomes"
        and relationship.source_id in product_by_id
        and relationship.target_id in product_by_id
    }
    incoming = {target_id: source_id for source_id, target_id in outgoing.items()}
    heads = [product.id for product in products if product.id not in incoming]
    visited: set[str] = set()
    chains: list[list[PprElement]] = []

    def append_chain(head_id: str) -> None:
        chain: list[PprElement] = []
        current_id: str | None = head_id
        local_ids: set[str] = set()
        while (
            current_id is not None
            and current_id in product_by_id
            and current_id not in visited
            and current_id not in local_ids
        ):
            local_ids.add(current_id)
            visited.add(current_id)
            chain.append(product_by_id[current_id])
            current_id = outgoing.get(current_id)
        if chain:
            chains.append(chain)

    for head_id in heads:
        append_chain(head_id)
    # Invalid cyclic data has no head. Keeping it visible makes this endpoint a
    # complete partition even while the validator reports IDENT-3.
    for product in products:
        if product.id not in visited:
            append_chain(product.id)

    items: list[PprItem] = []
    item_by_usage_id: dict[str, str] = {}
    for chain in chains:
        head = chain[0]
        suffix = head.id.partition("_")[2] or head.id
        item_id = f"item_{suffix}"
        definition_ids = list(
            dict.fromkeys(
                element.definition_id
                for element in chain
                if element.definition_id is not None
            )
        )
        nodes: list[ItemChainNode] = []
        for index, element in enumerate(chain):
            previous = chain[index - 1] if index > 0 else None
            following = chain[index + 1] if index + 1 < len(chain) else None
            produced_by = (
                _transition_process(previous.id, element.id, relationships)
                if previous is not None
                else None
            )
            consumed_by = (
                _transition_process(element.id, following.id, relationships)
                if following is not None
                else None
            )
            if produced_by is None:
                produced_by = next(
                    (
                        relationship.source_id
                        for relationship in relationships
                        if relationship.kind == "produces"
                        and relationship.target_id == element.id
                    ),
                    None,
                )
            if consumed_by is None:
                consumed_by = next(
                    (
                        relationship.target_id
                        for relationship in relationships
                        if relationship.kind == "consumed_by"
                        and relationship.source_id == element.id
                    ),
                    None,
                )
            nodes.append(
                ItemChainNode(
                    element_id=element.id,
                    state=element.state,
                    produced_by=produced_by,
                    consumed_by=consumed_by,
                )
            )
            item_by_usage_id[element.id] = item_id
        items.append(
            PprItem(
                id=item_id,
                name=head.name,
                definition_ids=definition_ids,
                chain=nodes,
            )
        )

    item_by_id = {item.id: item for item in items}
    for chain, item in zip(chains, items, strict=True):
        tail_id = chain[-1].id
        containing_usage_id = next(
            (
                relationship.source_id
                for relationship in relationships
                if relationship.kind == "contains"
                and relationship.target_id == tail_id
                and relationship.source_id in item_by_usage_id
            ),
            None,
        )
        if containing_usage_id is not None:
            containing_item_id = item_by_usage_id[containing_usage_id]
            if containing_item_id in item_by_id and containing_item_id != item.id:
                item.absorbed_into = containing_item_id
    return items


def infer_identity(model: PprModel) -> IdentityInferenceResult:
    usage_by_id = {usage.id: usage for usage in model.diagram.usages}
    existing_pairs = {
        (relationship.source_id, relationship.target_id)
        for relationship in model.diagram.relationships
        if relationship.kind == "becomes"
    }
    proposals: list[IdentityProposal] = []
    needs_review: list[str] = []
    for process in (usage for usage in model.diagram.usages if usage.type == "process"):
        inputs = [
            (usage_by_id.get(relationship.source_id), relationship)
            for relationship in model.diagram.relationships
            if relationship.kind == "consumed_by"
            and relationship.target_id == process.id
        ]
        outputs = [
            usage_by_id.get(relationship.target_id)
            for relationship in model.diagram.relationships
            if relationship.kind == "produces"
            and relationship.source_id == process.id
            and relationship.byproduct is False
        ]
        typed_inputs = [
            (usage, relationship)
            for usage, relationship in inputs
            if usage is not None and usage.type == "product"
        ]
        typed_outputs = [
            usage for usage in outputs if usage is not None and usage.type == "product"
        ]
        selected: tuple[PprElement, PprElement, Literal["high", "medium"], str] | None = None
        if len(typed_inputs) == 1 and len(typed_outputs) == 1:
            selected = (
                typed_inputs[0][0],
                typed_outputs[0],
                "high",
                f"{process.name} has exactly one non-byproduct input and output",
            )
        elif len(typed_inputs) > 1 and len(typed_outputs) == 1:
            output = typed_outputs[0]
            matching = [
                pair
                for pair in typed_inputs
                if pair[0].definition_id is not None
                and pair[0].definition_id == output.definition_id
            ]
            candidates = matching or typed_inputs
            chosen, chosen_relationship = max(
                candidates,
                key=lambda pair: pair[1].quantity
                if pair[1].quantity is not None
                else float("-inf"),
            )
            reason = (
                f"{chosen.name} matches {output.name}'s definition"
                if matching
                else f"{chosen.name} has the highest input quantity for {process.name}"
            )
            selected = (chosen, output, "medium", reason)
        else:
            needs_review.append(process.id)
        if selected is None:
            continue
        source, target, confidence, reason = selected
        if source.id == target.id or (source.id, target.id) in existing_pairs:
            continue
        proposals.append(
            IdentityProposal(
                source_id=source.id,
                target_id=target.id,
                confidence=confidence,
                reason=reason,
            )
        )
    return IdentityInferenceResult(proposals=proposals, needs_review=needs_review)


def example_model() -> PprModel:
    """Return a fresh copy of the compact starter production example."""
    from .scenarios import get_ppr_scenario

    return get_ppr_scenario("two-stage-finished-product").model.model_copy(deep=True)
