---
name: Exchange round-trip semantics
description: Durable rules for comparing and extending PPR SysML and AutomationML exchange formats.
---

Round-trip checks should normalize values through their declared datatype and exclude generated identifiers and canvas coordinates, while still requiring definitions, usages, descriptions, custom properties, relationship endpoints, kinds, roles, quantities, units, and multiplicities.

**Why:** SysML and AutomationML legitimately regenerate symbols and do not share the PPR canvas layout, but silently dropping relationship metadata or standalone-vs-library identity changes the engineering model.

**How to apply:** When adding an exchange field that lacks a native standard representation, use a deterministic profile extension and make both exporters and importers understand it; keep the normalized fixture comparison as the regression guard.

The generated client may serialize XML string request bodies as JSON strings even when the media type is `application/xml`; the transport must unwrap exactly that extra layer while preserving raw XML.

**Why:** AutomationML imports otherwise receive quoted XML and fail before semantic validation, while blindly parsing every body could corrupt non-XML requests.

**How to apply:** Keep XML body normalization at the shared request transport boundary and scope it to XML media types.

Standards compatibility checks should run the exchange's own validator in addition to local semantic round trips: OpenSysML strict conformance for SysML v2 and CAEX schema validation plus a pyautomationml parse for AutomationML.

**Why:** A model can preserve all application-level meaning while still violating ordering, placement, or construct rules that external engineering tools enforce.

**How to apply:** Pin validator releases, keep the CAEX schema with the repository, and include the scenario, exchange mode, and validator diagnostic in every failure.