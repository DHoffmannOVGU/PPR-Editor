# AutomationML reference material

`CAEX_ClassModel_V2.15.xsd` is the CAEX 2.15 schema used by the
legacy import compatibility tests. It is sourced from the
[amlModeling/amlMetaModel](https://github.com/amlModeling/amlMetaModel)
project's `examples/01_Topology/Source/CAEX_Classmodel_V2.15.xsd` fixture.

New exports are authored as CAEX 3.0 documents with the official
`automationml` Python SDK. They contain separate product, process, and resource
`InstanceHierarchy` views and a generated `PPRRoleClassLib` for definitions
created in the editor.

The supplied AutomationML role-library files are reference inputs. The exporter
loads only the `RoleClassLib` payload from `AutomationMLExtendedRoleClassLib.aml`;
it does not copy the source document's header or external-reference wrapper.
