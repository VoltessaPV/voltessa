import { Roles } from "./roles";

export const Permissions = {
  canManagePlatform: [
    Roles.ADMIN,
  ],

  canManagePlants: [
    Roles.ADMIN,
    Roles.OWNER,
  ],

  canOperatePlants: [
    Roles.ADMIN,
    Roles.OWNER,
    Roles.OPERATOR,
  ],

  canViewPlants: [
    Roles.ADMIN,
    Roles.OWNER,
    Roles.OPERATOR,
    Roles.VIEWER,
  ],
};