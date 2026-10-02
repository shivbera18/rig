#!/usr/bin/env node
import { configureRigToolsChildEnvironment } from './rig-tools-environment.js';

configureRigToolsChildEnvironment();
const embeddedEntry = new URL('./embedded/rig-tools/cli.mjs', import.meta.url);
await import(embeddedEntry.href);
