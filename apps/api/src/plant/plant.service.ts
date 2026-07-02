import { Injectable } from '@nestjs/common';
import { ExportMode, Plant, Vendor, PlantCommand } from './plant.types';

@Injectable()
export class PlantService {
  private readonly plants: Plant[] = [
    {
      id: 'plant-1',
      name: 'Demo Plant',

      vendor: Vendor.HUAWEI,
      stationCode: 'NE=163554568',

      automation: {
        enabled: true,
        stopExportThreshold: 15,
        resumeExportThreshold: 15,
        minCommandIntervalSeconds: 60,
      },

      state: {
        exportMode: ExportMode.NO_LIMIT,
      },
    },
  ];

  getAll() {
    return this.plants;
  }

  getById(id: string) {
    return this.plants.find((p) => p.id === id);
  }

  updateExportMode(id: string, mode: ExportMode) {
  const plant = this.getById(id);

  if (!plant) {
    return;
  }

  plant.state.exportMode = mode;
  plant.state.lastSyncAt = new Date();
}

saveCommand(id: string, command: PlantCommand, success: boolean) {
  const plant = this.getById(id);

  if (!plant) {
    return;
  }

  plant.state.lastCommand = {
    command,
    executedAt: new Date(),
    success,
  };
}
}