# SysML v2 import fixtures

These small, self-contained models are starting points for development and
regression testing of the PPR SysML v2 importer.

Most fixtures use portable SysML v2 with `item`, `action`, and `part`
specializing the local `PPR::Product`, `PPR::Process`, and `PPR::Resource`
definitions. The final fixture uses standard SysML v2 semantic metadata and
the PPR user keywords `#product`, `#process`, and `#resource`.

`manifest.json` records the PPR structure that an importer should recover from
each file. Counts refer to PPR definitions, diagram usages, and semantic
relationships—not every SysML element in the source document.

The current application import command accepts canonical PPR JSON only. These
files are ready as fixtures for adding SysML v2 text import; they are not yet
accepted by the existing **Import JSON** action.

## Coverage

1. `01_minimal_flow.portable.sysml` — one input, process, output, and performer.
2. `02_nested_cell.portable.sysml` — nested processes/resources, succession,
   flows, performers, and support allocation.
3. `03_parallel_inspection.portable.sysml` — one shared product feeding two
   independent branches.
4. `04_transfer_multiplicity.portable.sysml` — direct product transfer,
   quantity, unbounded multiplicity, and resource containment.
5. `05_perform_and_support.portable.sysml` — distinguishes `perform` from an
   allocated supporting resource.
6. `06_identity_and_properties.portable.sysml` — stable short IDs, duplicate
   human names, quoted names, and typed attributes.
7. `07_ppr_keywords.profile.sysml` — the PPR-flavoured SysML v2 surface.

Fixture 6 deliberately keeps duplicate human names under distinct short IDs.
OpenSysML accepts the model but reports four duplicate-owned-member warnings;
this is intentional importer and identity-resolution coverage. The other six
fixtures parse with zero diagnostics in strict-conformance mode.
