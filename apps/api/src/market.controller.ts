import { Controller, Get } from '@nestjs/common';

@Controller('market')
export class MarketController {
  @Get('price')
  getPrice() {
    return {
      market: 'IBEX',
      price: -12.45,
      currency: 'EUR/MWh',
      isNegative: true,
      source: 'mock',
      timestamp: new Date().toISOString(),
    };
  }
}