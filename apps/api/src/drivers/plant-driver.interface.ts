import { PlantCommand } from '../plant/plant.types';

export interface PlantDriver {
  execute(
    stationCode: string,
    command: PlantCommand,
  ): Promise<void>;
}