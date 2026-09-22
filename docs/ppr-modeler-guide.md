# PPR Engineering Modeler Guide

## What this release models

The workspace describes a production system through three kinds of engineering concepts:

- **Products** are things being made, transformed, consumed, or transferred through a process.
- **Processes** are operations, stages, or subprocesses that act on products.
- **Resources** are equipment, people, tools, fixtures, or capabilities that support or perform processes.

The PPR graph and the Product, Process, and Resource views are editing surfaces over the same semantic model. Each individual view can also retain supporting detail that is intentionally omitted from the main PPR diagram.

## Definitions and usages

The **Library** contains reusable definitions such as “Six-axis welding robot” or “Panel assembly.” A **diagram usage** is a concrete occurrence of a definition in the current engineering model.

Use a library definition when several diagram elements should share a concept. Use a standalone usage when the element is intentionally local or has not been assigned to a reusable definition yet. A usage can be attached to a compatible definition or cleared later from the inspector.

## Editing the graph

1. Choose **PPR** for the complete relationship graph.
2. Add a library-backed or standalone Product, Process, or Resource usage.
   Each view has a type-specific quick-create palette and a filtered Library browser.
3. Drag nodes to arrange the diagram; positions are part of the saved model.
4. Select a node or relationship to inspect its properties.
5. Use the explicit relationship action when connecting two usages. The available directions are domain-aware.
6. Use validation before sharing or exporting when the model contains imported or partially authored data.

Dragging a relationship from a source handle onto empty canvas creates the fitting next node and its edge in one step. In PPR this follows the Product–Process–Resource handle direction. In the individual views it creates Product transfer or composition, Process succession, and Resource containment as appropriate for the active lens. In the Process view, the bottom source and top target handles always connect sequential follow-up processes; they never imply subprocess containment.

Clicking empty canvas clears the current selection. Delete removes the selected usage or relationship only after it is explicitly selected.

## Review lenses

- **Product** offers a PPR-derived lifecycle view and a Gozinto-style BOM view.
- **Process** is a single nested working view. It shows explicit and product-inferred process succession while rendering subprocesses inside their parent processes. Use **Add subprocess** on a selected process to create a new nested process, or select two existing processes and create a `contains` relationship from parent to subprocess.
- **Resource** keeps both representations of the same MBSE semantics: **Contains tree** shows explicit `contains` edges, while **Nested subresources** renders contained resources inside their owner. Switching the visualization does not change or duplicate the underlying relationships.

The individual views are structurally editable. New usages created there start as **view only**, which is useful for supporting products such as screws, subprocesses, and subresources. Select a node and use **Include in PPR diagram** to promote it; the node and its relationships appear in PPR once their endpoints are included. The node badge shows whether it is currently included or view only.

## Save and checkpoints

Editing updates the working model. **Save** writes the current model and creates a checkpoint when it differs from the latest saved checkpoint. **History** lists retained checkpoints and can restore an earlier model.

Export the model before a major experiment or before sharing it externally. If a save or collaboration update fails, keep the local error message visible and retry after the service is available.

## Import and export

The workspace can import SysML v2 and AutomationML files through the Actions menu. It can export:

- JSON for the native PPR model
- Portable SysML v2
- PPR-profiled SysML v2
- AutomationML

Standards exchange is an adapter around the canonical Pydantic-backed PPR model. Review validation results after importing, especially when a source file contains relationships outside the PPR profile.

## Collaboration

Start a collaboration session from the header, copy the session ID and six-digit access code, and share them with reviewers. Participants see presence, cursor, surface, and selection context, while model edits are synchronized live.

Sessions expire after a limited idle window and are held in memory. Save a checkpoint and export JSON when the shared state needs to outlive the session.

## First-release browser support matrix

The graph editor is release-tested with the Playwright browser projects below. “Full” means the exhaustive graph interaction suite covers the graph, review lenses, Library, selection, dragging, import/export, and collaboration entry flows. “Portable smoke” is a focused cross-browser check covering each of those categories without claiming that every Chromium timing/gesture assertion is a contract for every engine. “Narrow smoke” covers the narrow layout’s reachable editing and entry points without promising a mobile editing experience.

| Target | Graph / review lenses / Library | Selection and dragging | Import / export | Collaboration entry |
| --- | --- | --- | --- | --- |
| Chromium desktop | Full | Full | Full | Full |
| Firefox desktop | Portable smoke | Portable smoke | Portable smoke | Portable smoke |
| WebKit desktop | Unsupported | Unsupported | Unsupported | Unsupported |
| Chromium at 900×800 | Narrow smoke | Narrow smoke | Narrow smoke | Narrow smoke |

The narrow target is a desktop-class Chromium viewport. Its side panels intentionally collapse, while the graph canvas, surface switcher, file actions, export entry point, and collaboration dialog remain reachable. Use a desktop viewport for dense authoring, inspector-based edits, and Library catalog work.

The following combinations are outside the first-release promise and must not be described as supported editing targets:

- Mobile-sized viewports or native mobile applications.
- Firefox or WebKit at the narrow 900×800 viewport; they are not part of the repeatable narrow smoke project.
- WebKit desktop in the current release environment; the Playwright WebKit binary requires Ubuntu ABI libraries that are not available in the Replit Nix runtime. Do not treat a missing WebKit launch as an application pass or as evidence of browser support.
- Browser versions other than the current Playwright-managed desktop browser channels used by the release suite.
- Chromium flows outside the exhaustive desktop suite and the 900×800 smoke check; Firefox flows outside the portable smoke check are not separately release-qualified.

The first release is intended for private, single-instance use. It does not provide user accounts, tenant isolation, or durable multi-instance collaboration storage.
