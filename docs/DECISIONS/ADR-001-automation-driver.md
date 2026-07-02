# ADR-001

## Title

Automation Service depends on PlantDriver instead of Huawei.

## Status

Accepted

## Context

Voltessa трябва да поддържа различни производители.

## Decision

AutomationService използва PlantDriver интерфейс.

Конкретният Driver се избира чрез Dependency Injection.

## Consequences

Добавянето на нов производител не изисква промяна в AutomationService.