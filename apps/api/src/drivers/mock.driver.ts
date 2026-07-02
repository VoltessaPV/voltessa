import { Injectable, Logger } from '@nestjs/common';
import { PlantCommand } from '../plant/plant.types';
import { PlantDriver } from './plant-driver.interface';

@Injectable()
export class MockDriver implements PlantDriver {
  private readonly logger = new Logger(MockDriver.name);

  async execute(
    stationCode: string,
    command: PlantCommand,
  ): Promise<void> {
    this.logger.log(
      `[MOCK] ${command} -> ${stationCode}`,
    );
  }
}