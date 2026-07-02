import { Injectable, Inject } from '@nestjs/common';

import { MarketService } from '../market/market.service';
import { PlantService } from '../plant/plant.service';
import { DecisionService } from '../decision/decision.service';

import {
  ExportMode,
  PlantCommand,
} from '../plant/plant.types';

import { PLANT_DRIVER } from '../drivers/constants';
import type { PlantDriver } from '../drivers/plant-driver.interface';

@Injectable()
export class AutomationService {
  constructor(
    private readonly marketService: MarketService,
    private readonly decisionService: DecisionService,
    private readonly plantService: PlantService,

    @Inject(PLANT_DRIVER)
    private readonly driver: PlantDriver,
  ) {}

  async evaluate() {
    const market = await this.marketService.getCurrentPrice();

    const plant = this.plantService.getById('plant-1');

    if (!plant) {
      throw new Error('Plant not found');
    }

    const threshold = plant.automation.stopExportThreshold;

    const command = this.decisionService.decide(market.price, {
      stopExportThreshold: threshold,
      resumeExportThreshold: threshold,
    });

    const shouldSend = this.shouldSendCommand(
      plant.state.exportMode,
      command,
    );

    if (shouldSend) {
      await this.driver.execute(
        plant.stationCode,
        command,
      );

      this.plantService.saveCommand(
        plant.id,
        command,
        true,
      );
    }

    return {
      market: market.market,
      price: market.price,
      threshold,
      command,
      shouldSend,
      currentMode: plant.state.exportMode,
      reason:
        command === PlantCommand.STOP_EXPORT
          ? 'Market price below threshold'
          : 'Market price above threshold',
      timestamp: market.timestamp,
    };
  }

  private shouldSendCommand(
    currentMode: ExportMode,
    command: PlantCommand,
  ): boolean {
    if (currentMode === ExportMode.UNKNOWN) {
      return true;
    }

    if (
      currentMode === ExportMode.ZERO_EXPORT &&
      command === PlantCommand.STOP_EXPORT
    ) {
      return false;
    }

    if (
      currentMode === ExportMode.NO_LIMIT &&
      command === PlantCommand.RESUME_EXPORT
    ) {
      return false;
    }

    return true;
  }
}