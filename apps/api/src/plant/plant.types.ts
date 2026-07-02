export enum Vendor {
  HUAWEI = 'HUAWEI',
  KACO = 'KACO',
  SMA = 'SMA',
}

export enum ExportMode {
  UNKNOWN = 'UNKNOWN',
  ZERO_EXPORT = 'ZERO_EXPORT',
  NO_LIMIT = 'NO_LIMIT',
}

export interface Plant {
  id: string;
  name: string;

  vendor: Vendor;
  stationCode: string;

  automation: {
    enabled: boolean;

    stopExportThreshold: number;
    resumeExportThreshold: number;

    minCommandIntervalSeconds: number;
  };

  state: {
    exportMode: ExportMode;

    lastCommand?: LastCommand;

    lastSyncAt?: Date;
  };
}

export enum PlantCommand {
  STOP_EXPORT = 'STOP_EXPORT',
  RESUME_EXPORT = 'RESUME_EXPORT',
}

export interface LastCommand {
  command: PlantCommand;
  executedAt: Date;
  success: boolean;
}