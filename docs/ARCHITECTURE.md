# Architecture

## Основни компоненти

AutomationService
    │
    ├── MarketService
    ├── DecisionService
    ├── PlantService
    ├── PlantDriver
    └── EventLog

PlantDriver
    │
    ├── HuaweiDriver
    ├── KacoDriver
    └── ...

HuaweiDriver
    │
    └── FusionSolarClient

FusionSolarClient
    │
    └── FusionSolar API