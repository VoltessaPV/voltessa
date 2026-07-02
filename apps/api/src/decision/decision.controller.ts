import { Controller, Get, Query } from '@nestjs/common';
import { DecisionService } from './decision.service';

@Controller('decision')
export class DecisionController {
  constructor(private readonly decisionService: DecisionService) {}

  @Get()
  decide(@Query('price') price: string) {
    const value = Number(price);

    return {
      price: value,
      action: this.decisionService.decide(value, {
        stopExportThreshold: 15,
        resumeExportThreshold: 15,
      }),
    };
  }
}