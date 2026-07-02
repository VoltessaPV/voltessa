import { Controller, Get, Param } from '@nestjs/common';
import { PlantService } from './plant.service';

@Controller('plants')
export class PlantController {
  constructor(private readonly plantService: PlantService) {}

  @Get()
  getAll() {
    return this.plantService.getAll();
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.plantService.getById(id);
  }
}