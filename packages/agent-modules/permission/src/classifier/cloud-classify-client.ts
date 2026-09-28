/**
 * Cloud permission classifier — endpoint resolution + gating.
 *
 * The desktop permission model step (Stage-2 LLM decision) runs server-side through the managed
 * `/rig` namespace: `POST /rig/api/v1/permission/check`, sharing the managed gateway with
 * content safety at `/rig/api/v1/content`. This module only handles:
 * - {@link getPermissionCheckApiUrl}: Resolve the endpoint URL by region × buildEnv for actual
 *   requests by `HttpCloudGatewayClient`.
 * - {@link shouldUseCloudClassify}: Decide whether the current runtime uses cloud classification.
 *
 * Actual HTTP calls / fail-closed behavior live in `../http-cloud-gateway-client.ts`.
 */

import {
  getRuntimeRegion,
  getRuntimeBuildEnv,
  isManagedRuntime,
  type RigRegion,
  type RigBuildEnv,
} from '../host-utils.js';

/**
 * Base URL for permission/check, routed by region × buildEnv. Uses the same managed gateway hosts
 * as SAFETY_API_BASE in safety-client.ts (same `/rig` origin).
 */
const PERMISSION_API_BASE: Record<RigRegion, Record<RigBuildEnv, string>> = {
  cn: {
    dev: 'https://matrix-test.example.invalid',
    test: 'https://matrix-test.example.invalid',
    staging: 'https://matrix-pre.example.invalid',
    prod: 'https://agent.rig.cn',
  },
  en: {
    dev: 'https://matrix-overseas-test.example.invalid',
    test: 'https://matrix-overseas-test.example.invalid',
    staging: 'https://matrix-overseas-pre.example.invalid',
    prod: 'https://agent.rig.io',
  },
};

/** The permission/check endpoint URL for the current runtime. */
export function getPermissionCheckApiUrl(): string {
  const region = getRuntimeRegion();
  const buildEnv = getRuntimeBuildEnv();
  const baseUrl = PERMISSION_API_BASE[region]?.[buildEnv];
  if (!baseUrl) {
    throw new Error(
      `No permission/check API base configured for region=${region} buildEnv=${buildEnv}`,
    );
  }
  return `${baseUrl}/rig/api/v1/permission/check`;
}

/**
 * Whether to use cloud classification.
 *
 * MVP: Use server-side classification only in managed runtimes (managed desktop / cloud). Unmanaged
 * / purely local development daemons retain the local path to avoid affecting UI-only development
 * and offline use.
 */
export function shouldUseCloudClassify(): boolean {
  return isManagedRuntime();
}
