import { Controller, Get } from '@nestjs/common';
import { AutomationService } from './automation.service';

@Controller('automation')
export class AutomationController {
  constructor(
    private readonly automationService: AutomationService,
  ) {}

  @Get('evaluate')
  evaluate() {
    return this.automationService.evaluate();
  }
}