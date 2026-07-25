import { enableNoLimit, enableZeroExport, readStatus } from "./fusionSolar/atlanta-service";
import type { ChangeResult, StatusResult } from "./fusionSolar/atlanta-service";

export function handleStatus(): Promise<StatusResult> {
  return readStatus();
}

export function handleZeroExport(): Promise<ChangeResult> {
  return enableZeroExport();
}

export function handleNoLimit(): Promise<ChangeResult> {
  return enableNoLimit();
}
