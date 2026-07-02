import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MarketController } from './market/market.controller';
import { MarketService } from './market/market.service';
import { DecisionService } from './decision/decision.service';
import { DecisionController } from './decision/decision.controller';
import { MockMarketProvider } from './market/providers/mock-market.provider';
import { AutomationController } from './automation/automation.controller';
import { AutomationService } from './automation/automation.service';
import { PlantController } from './plant/plant.controller';
import { PlantService } from './plant/plant.service';
import { MockDriver } from './drivers/mock.driver';
import { PLANT_DRIVER } from './drivers/constants';

@Module({
  imports: [],
  controllers: [
  AppController,
  MarketController,
  DecisionController,
  AutomationController,
  PlantController,
],
  providers: [
  AppService,
  MarketService,
  MockMarketProvider,
  DecisionService,
  AutomationService,
  PlantService,
  {
  provide: PLANT_DRIVER,
  useClass: MockDriver,
  },
],
})
export class AppModule {}
