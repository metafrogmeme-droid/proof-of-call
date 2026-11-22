import type { DeploymentFiles } from '@proof-of-call/core';

declare global {
  /** Deployment records compiled in by vite.config.ts. */
  const __POC_DEPLOYMENTS__: DeploymentFiles;
}
