# Voltessa Vision

## Mission

Voltessa е независима платформа за интелигентно управление на фотоволтаични централи и батерийни системи.

Целта е да автоматизира решенията на операторите, като използва пазарни данни, прогнози и информация от централите, за да максимизира приходите и да намали риска.

---

## Long-term Vision

Voltessa трябва да може да управлява хиляди енергийни активи от различни производители чрез единна платформа.

Поддържани активи:

- Solar PV
- Battery Energy Storage Systems (BESS)
- Hybrid Systems

Поддържани производители:

- Huawei
- KACO
- SMA
- Sungrow
- KSTAR
- други

---

## Core Principles

- Vendor independent
- Cloud first
- API first
- Secure by design
- Fully automated
- Scalable
- Observable
- Extensible

---

## Main Objectives

### Energy Trading

Автоматично управление на експорта според:

- Day Ahead prices
- Intraday prices
- Negative prices
- Dynamic thresholds

### Battery Optimization

Оптимално:

- зареждане
- разреждане
- арбитраж
- peak shaving

### Monitoring

- Real-time status
- Alerts
- Event history
- Diagnostics

### Remote Control

Без локален хардуер, когато производителят позволява cloud управление.

---

## Target Customers

- Собственици на PV централи
- Инвеститори
- EPC компании
- O&M компании
- Aggregators
- Energy Traders

---

## Long-term Goal

Voltessa да бъде универсална cloud платформа за управление на възобновяеми енергийни активи, която позволява автоматизация на решенията независимо от производителя на оборудването.

## Design Goal

Добавянето на нов производител не трябва да изисква промяна в бизнес логиката.

AutomationService и DecisionService трябва да работят само с абстрактни интерфейси.

Всеки нов производител се добавя чрез нов Driver.