---
name: Starter model persistence
description: How the default PPR example becomes the model shown after a restart
---

The default example is defined in the shared scenario registry, but the API restores the persisted model seed during startup. After changing starter scenario content, reload the API registry and reseed the persisted example through the existing example-model endpoint.

**Why:** Restarting the API alone can leave users seeing the older persisted example even when the scenario fixture and its tests contain the new data.

**How to apply:** Treat fixture changes and persisted example refresh as one change. Verify the API response after reseeding, then restart or refresh the web preview before checking the visible starter model.