#!/usr/bin/env node
import { configureMcodeToolsChildEnvironment } from './rig-tools-environment.js';

configureMcodeToolsChildEnvironment();
const embeddedEntry = new URL('./embedded/rig-tools/cli.mjs', import.meta.url);
await import(embeddedEntry.href);
