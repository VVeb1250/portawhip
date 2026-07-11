#!/usr/bin/env node

import { collectSurfaceInventory } from "../core/surface/surface-inventory.mjs";

const inventory = await collectSurfaceInventory();
console.log(JSON.stringify(inventory, null, 2));
