import { Injectable } from '@nestjs/common';

export enum PlantCommand {
  STOP_EXPORT = 'STOP_EXPORT',
  RESUME_EXPORT = 'RESUME_EXPORT',
}

export interface DecisionSettings {
  stopExportThreshold: number;
  resumeExportThreshold: number;
}

@Injectable()
export class DecisionService {
  decide(
    price: number,
    settings: DecisionSettings,
  ): PlantCommand {
    if (price <= settings.stopExportThreshold) {
      return PlantCommand.STOP_EXPORT;
    }

    return PlantCommand.RESUME_EXPORT;
  }
}