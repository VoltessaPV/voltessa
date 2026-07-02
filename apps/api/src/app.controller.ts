import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'Voltessa API',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    };
  }
}
